// Deploy-safety question: is it safe to deploy the 20 unpushed commits WITHOUT
// first applying migration 20260826120000?
//
// The migration makes billable_hours / consumed_percent / status nullable so the
// importer can write an honest null. The code that writes those nulls is already
// committed. If the deployed code writes null into a NOT NULL column, the import
// fails at runtime -- that is the hazard worth checking before telling the user
// "deploying is safe".
//
// The distinction that matters: does the WEB APP write these columns, or only the
// importer script? A script is run deliberately by a human; a web request is not.
// READ-ONLY.
import { readFileSync, readdirSync } from "node:fs";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const { rows: cols } = await c.query(`
  select column_name, is_nullable
  from information_schema.columns
  where table_schema='public' and table_name='projects'
    and column_name in ('logged_hours','billable_hours','consumed_percent','remaining_hours','status')
  order by column_name`);

console.log("Current LIVE nullability on public.projects:\n");
const notNull = [];
for (const r of cols) {
  const ok = r.is_nullable === "YES";
  console.log(`  ${ok ? "nullable" : "NOT NULL"}  ${r.column_name}`);
  if (!ok) notNull.push(r.column_name);
}
await c.end();

if (!notNull.length) {
  console.log("\nAll nullable: migration 20260826120000 is applied. No deploy hazard here.");
  process.exit(0);
}

console.log(`\nStill NOT NULL: ${notNull.join(", ")}`);
console.log("So any code path writing null into one of those fails at runtime.\n");

// Which files write these columns? Separate src/ (serves web requests) from
// scripts/ (run by a human on purpose).
const hits = { src: [], scripts: [] };
const walk = (dir, bucket) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) { if (e.name !== "node_modules") walk(p, bucket); continue; }
    if (!/\.(ts|tsx|mjs|js)$/.test(e.name)) continue;
    let text;
    try { text = readFileSync(p, "utf8"); } catch { continue; }
    // A write to public.projects: an insert/update/upsert naming the table.
    const writesProjects = /from\("projects"\)[\s\S]{0,200}?\.(insert|update|upsert)\(/.test(text)
      || /(insert\s+into|update)\s+public\.projects/i.test(text);
    if (!writesProjects) continue;
    const touchesCol = notNull.some((col) => text.includes(col));
    if (touchesCol) hits[bucket].push(p);
  }
};
walk("src", "src");
walk("scripts", "scripts");

console.log("Files that WRITE public.projects and mention a still-NOT-NULL column:");
console.log(`\n  src/ (serves live web requests) -- ${hits.src.length}`);
for (const f of hits.src) console.log(`      ${f}`);
console.log(`\n  scripts/ (run deliberately by a human) -- ${hits.scripts.length}`);
for (const f of hits.scripts) console.log(`      ${f}`);

console.log("\nVERDICT:");
if (hits.src.length === 0) {
  console.log("  No src/ path writes these columns, so deploying the web app cannot hit");
  console.log("  the NOT NULL constraint. The hazard is confined to the importer, which");
  console.log("  a human runs on purpose. DEPLOY IS SAFE WITHOUT THE MIGRATION;");
  console.log("  the migration is required before the next import run, not before deploy.");
} else {
  console.log("  A src/ path writes these columns. Deploying BEFORE applying");
  console.log("  20260826120000 risks a runtime failure on a live request.");
  console.log("  APPLY THE MIGRATION FIRST.");
}
