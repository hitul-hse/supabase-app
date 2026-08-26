/*
 * The roadmap tells you to fix the workbook and re-import. Is that actually safe?
 *
 * "Then re-import" is advice I gave without testing it, and a re-import is the
 * single most destructive operation in this repo: it upserts all 231 projects and
 * DELETE/INSERTs every assignment. The importer was written for a one-off
 * migration from demo data. Since it last ran, other work has written columns it
 * does not know about -- so the question is whether re-running it now silently
 * discards that work.
 *
 * This compares what the importer WRITES against what the live rows CARRY, and
 * names every column that would be lost or reverted. READ-ONLY.
 */
import { readFileSync } from "node:fs";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const src = readFileSync("C:/Supabase/scripts/import-masterdata-projects.mjs", "utf8");

/* ---------------- what does the importer actually put in a projects row? ---- */

const block = /projectRows\.push\(\{([\s\S]*?)\n {2}\}\);/.exec(src);
if (!block) { console.error("could not locate projectRows.push"); process.exit(1); }
/*
 * Both spellings, or the result is a false alarm:
 *   `foo: value,`   explicit
 *   `foo,`          ES6 shorthand -- `status` is written this way, and a
 *                   name-only regex reported it as omitted, which would have
 *                   sent someone hunting a bug that does not exist.
 */
const written = [...block[1].matchAll(/^\s+([a-z_]+)\s*(?::|,\s*$)/gm)].map((m) => m[1]);

console.log("columns the importer WRITES on public.projects:");
console.log(`  ${written.join(", ")}\n`);

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const { rows: cols } = await c.query(`
  select column_name, is_nullable, column_default
    from information_schema.columns
   where table_schema='public' and table_name='projects'
   order by ordinal_position`);

let failures = 0;
const check = (l, ok, d = "") => { console.log(`${ok ? "PASS" : "FAIL"}: ${l}${d ? `\n        ${d}` : ""}`); if (!ok) failures += 1; };

/*
 * Upsert semantics, MEASURED rather than assumed (see
 * scripts/check-upsert-merge-semantics.mjs, which runs the exact statement
 * PostgREST emits against real Postgres):
 *
 *   ON CONFLICT DO UPDATE sets ONLY the columns in the payload. A column the
 *   importer omits is PRESERVED on an existing row -- it is NOT reset to its
 *   default or nulled.
 *
 * My first version of this gate claimed the opposite and would have told someone
 * a safe script destroys 230 entity links. So the omitted columns below are
 * reported as context, not as a failure.
 */
const omitted = cols.map((r) => r.column_name).filter((n) => !written.includes(n) && n !== "id");
console.log(`columns the importer OMITS (${omitted.length}): ${omitted.join(", ")}`);
console.log("  -> preserved on existing rows; only unset on NEWLY created orders\n");

// Which omitted columns carry data? Relevant because a NEW order number arrives
// without them and needs re-linking afterwards.
const populated = [];
for (const col of omitted) {
  const { rows } = await c.query(
    `select count(*) filter (where "${col}" is not null) as n from public.projects`);
  if (Number(rows[0].n) > 0) populated.push({ col, n: Number(rows[0].n) });
}

console.log("--- omitted columns holding data (a NEW order arrives without these)\n");
console.table(populated);

/*
 * The real hazards. Each is a specific thing a re-import does that the roadmap's
 * bare "then re-import" does not warn about.
 */
console.log("--- hazard 1: assignments are DELETEd and re-INSERTed, not upserted\n");

const { rows: [asg] } = await c.query(`
  select count(*) as total,
         count(*) filter (where project_id is null) as no_project,
         count(*) filter (where logged_hours is not null and logged_hours > 0) as with_hours
    from public.person_assignments`);
console.log(`  ${asg.total} assignments, ${asg.no_project} with no project_id, ${asg.with_hours} carrying logged hours`);

/*
 * The delete is scoped `.in("project_id", ids)`, so rows with a NULL project_id
 * survive -- those are the 8 mockup internal-work rows. Fine. But any assignment
 * on a REAL project that was created outside the importer is destroyed, and the
 * importer only recreates responsible/replacement rows from the workbook.
 */
const { rows: [outside] } = await c.query(`
  select count(*) as n from public.person_assignments a
   where a.project_id is not null
     and a.share_percent not in (0, 100)`);
check("no assignment carries a share the importer cannot reproduce",
  Number(outside.n) === 0,
  Number(outside.n) > 0
    ? `${outside.n} assignment(s) have a share_percent other than 0 or 100, which the `
      + "importer only writes as 100 (responsible) or 0 (replacement). A re-import would flatten them."
    : "the importer writes only 100 (responsible) and 0 (replacement)");

/* ------------------------------------------------- the project_responsibility table */

const { rows: hasResp } = await c.query(`
  select count(*) as n from information_schema.tables
   where table_schema='public' and table_name='project_responsibility'`);
if (Number(hasResp[0].n) > 0) {
  const { rows: [resp] } = await c.query("select count(*) as n from public.project_responsibility");
  const importerTouches = /project_responsibility/.test(src);
  console.log(`\n--- public.project_responsibility holds ${resp.n} rows`);
  check("the importer maintains project_responsibility, or provably does not touch it",
    !importerTouches,
    importerTouches
      ? "it references the table; verify the re-import keeps it consistent"
      : "the importer never writes it, so a re-import leaves it STALE relative to the "
        + "workbook it just re-read. scripts/import-project-responsibility.mjs owns that table "
        + "and must be re-run too.");
}

await c.end();

/* ------------------------- the gate's real assertion: is the advice qualified? */

console.log("\n--- is the roadmap's \"then re-import\" advice qualified?\n");

const doc = readFileSync("C:/Supabase/docs/next-steps-2026-08-26.md", "utf8");
check("the roadmap warns that a re-import rewrites person_assignments",
  /person_assignments/.test(doc) && /re-import/.test(doc),
  "a bare \"then re-import\" hides a DELETE/INSERT over 352 assignment rows");
check("the roadmap names project_responsibility as needing its own re-run",
  /project_responsibility/.test(doc),
  "the importer never writes that table, so it goes stale against the workbook "
  + "it just re-read; import-project-responsibility.mjs owns it");

console.log(failures === 0
  ? "\nRE-IMPORT HAZARDS ARE DOCUMENTED. The advice is safe to follow as written."
  : `\n${failures} problem(s): the re-import advice is not adequately qualified.`);
process.exit(failures === 0 ? 0 : 1);
