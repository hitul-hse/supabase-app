/*
 * Gate: getBrokenCover finds exactly the cover arrangements that cannot work,
 * verified against the live database with independent SQL.
 *
 * The TypeScript walks Maps in JS; this recomputes the same facts in SQL. If
 * the two disagree, the query is wrong, whatever the UI on top of it says.
 */
import { join, resolve } from "node:path";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { loadBindings, transform } from "next/dist/build/swc/index.js";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";

if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.SUPABASE_DB_URL) {
  console.log("SKIP: no Supabase credentials, so there is no live database to check");
  process.exit(0);
}

await loadBindings();

// Compile the real module, not a copy of its logic.
const dir = mkdtempSync(join(process.env.TEMP ?? "/tmp", "broken-cover-"));
const src = readFileSync("src/lib/queries/broken-cover.ts", "utf8")
  .replace(/import type [^;]+;/g, "");
const { code } = await transform(src, {
  jsc: { parser: { syntax: "typescript" }, target: "es2022" },
  module: { type: "commonjs" },
});
const modFile = join(dir, "broken-cover.cjs");
writeFileSync(modFile, code);
const require2 = createRequire(resolve(modFile));
const { getBrokenCover } = require2(modFile);

let failed = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? " ok  " : "FAIL "} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed += 1;
};

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const result = await getBrokenCover(supabase);

// Independent recomputation in SQL.
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const [{ self_n }] = (await c.query(`
  select count(*)::int self_n
  from project_responsibility resp
  join project_responsibility rep
    on rep.project_id = resp.project_id and rep.role = 'replacement'
  where resp.role = 'responsible' and rep.person_id = resp.person_id`)).rows;

const [{ mutual_n }] = (await c.query(`
  with pairs as (
    select resp.project_id, resp.person_id a, rep.person_id b
    from project_responsibility resp
    join project_responsibility rep
      on rep.project_id = resp.project_id and rep.role = 'replacement'
    where resp.role = 'responsible' and rep.person_id <> resp.person_id
  )
  select count(*)::int mutual_n from pairs p
  where exists (select 1 from pairs q where q.a = p.b and q.b = p.a)`)).rows;

check("self-cover count matches independent SQL",
  result.selfCoverCount === self_n, `query ${result.selfCoverCount} vs sql ${self_n}`);
check("mutual-cover count matches independent SQL",
  result.mutualCoverCount === mutual_n, `query ${result.mutualCoverCount} vs sql ${mutual_n}`);

/*
 * Ground truth, corrected by this gate's own first run.
 *
 * I originally asserted 8 mutual and 62 self, the numbers from the manual
 * Thorsten/Stephan investigation. The derived query found 40 mutual and 65
 * self, and the independent SQL AGREED: the investigation had only looked at
 * one pair. Hendryk<->Mathias alone accounts for 18 projects, and Hendryk
 * covers himself on 3 more nobody had noticed.
 *
 * That is the argument for deriving rather than hardcoding, demonstrated on
 * the first execution. So the assertions below check CONTAINMENT of the known
 * cases and exact agreement with SQL, not a frozen total.
 */
const KNOWN_MUTUAL = [
  "10274_00117_104_01", "10303_01091_104_01", "10333_00367_104_01", "10345_00196_104_01",
  "10392_00205_104_01", "10450_00236_104_01", "10476_00265_104_01", "10747_00360_401_01",
];
const mutualIds = new Set(result.projects.filter((p) => p.kind === "mutual").map((p) => p.projectId));
check("the 8 known Thorsten/Stephan projects are among the mutual findings",
  KNOWN_MUTUAL.every((id) => mutualIds.has(id)));

const thorstenStephan = result.projects.filter((p) => p.kind === "mutual"
  && ["Thorsten", "Stephan"].includes(p.responsibleName)
  && ["Thorsten", "Stephan"].includes(p.replacementName));
check("the Thorsten/Stephan pair is exactly the known 8",
  thorstenStephan.length === 8, `${thorstenStephan.length} found`);

check("Rency's 62 self-cover projects are among the self findings",
  result.projects.filter((p) => p.kind === "self" && p.responsibleName === "Rency Sebastian").length === 62);

// pairSize must equal the number of projects in that pair, or the "blast
// radius" the UI shows is a lie.
const mutuals = result.projects.filter((p) => p.kind === "mutual");
check("every mutual row reports the full pair blast radius",
  mutuals.every((p) => p.pairSize === mutuals.length
    || mutuals.filter((q) =>
      [q.responsiblePersonId, q.replacementPersonId].sort().join() ===
      [p.responsiblePersonId, p.replacementPersonId].sort().join()).length === p.pairSize));

// Names resolve — an id shown raw means the people join silently failed.
check("every person name resolved (no raw md-* ids shown)",
  result.projects.every((p) => !/^md-|^ext-/.test(p.responsibleName) && !/^md-|^ext-/.test(p.replacementName)),
  result.peopleAffected.join(", "));

// Ordering claim: mutual (urgent, pair fails together) before self (hygiene).
const firstSelf = result.projects.findIndex((p) => p.kind === "self");
const lastMutual = result.projects.map((p) => p.kind).lastIndexOf("mutual");
check("mutual pairs sort before self-cover rows",
  firstSelf === -1 || lastMutual < firstSelf);

await c.end();
rmSync(dir, { recursive: true, force: true });

console.log(`\n${failed === 0 ? "PASS: broken-cover query agrees with independent SQL" : `FAIL (${failed})`}`);
process.exit(failed ? 1 : 0);
