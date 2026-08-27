/*
 * Run the REAL getReassignmentCandidates against the live database.
 *
 * The specific thing this must catch: my first draft of this query joined
 * project_responsibility to person_assignments and reported 85,593 contract
 * hours for one person, because the join fans out. A plausible-looking inflated
 * number is the failure mode here, so the assertions below bound the values
 * against independently-computed truth rather than just checking they are
 * non-empty.
 */
import { join, resolve } from "node:path";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { loadBindings, transform } from "next/dist/build/swc/index.js";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

await loadBindings();
const dir = resolve(mkdtempSync(join("node_modules", ".candidates-check-")));
const posix = (p) => p.replace(/\\/g, "/");
const require = createRequire(import.meta.url);

async function compile(srcPath, outName, rewrites = {}) {
  let code = readFileSync(srcPath, "utf8").replace(/^import "server-only";\r?\n/m, "");
  for (const [from, to] of Object.entries(rewrites)) {
    code = code.split(`from "${from}"`).join(`from "${to}"`);
  }
  const out = await transform(code, {
    filename: srcPath,
    jsc: { parser: { syntax: "typescript", tsx: false }, target: "es2022" },
    module: { type: "commonjs" },
  });
  const file = join(dir, outName);
  writeFileSync(file, out.code);
  return file;
}

const serverOnly = join(dir, "server-only.cjs");
writeFileSync(serverOnly, "module.exports = {};");
const modFile = await compile("src/lib/queries/reassignment-candidates.ts", "candidates.cjs", {
  "@/lib/database.types": posix(serverOnly),
  "server-only": posix(serverOnly),
});
const { getReassignmentCandidates } = require(modFile);

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

const PROJECT = "10110_00358_104_01";
const rows = await getReassignmentCandidates(supabase, PROJECT);

console.log(`check-reassignment-candidates-live: who could take over ${PROJECT}?\n`);
console.log("PERSON            RESP  COVER  CONTRACT-H  LOGGED-30D  ON-PROJECT  ABSENCE");
for (const r of [...rows].sort((a, b) => (b.contractHours ?? -1) - (a.contractHours ?? -1))) {
  console.log(
    `${r.personName.padEnd(17)} ${String(r.responsibleFor).padStart(4)} ${String(r.coversAsReplacement).padStart(6)} ` +
    `${String(r.contractHours ?? "n/a").padStart(11)} ${String(r.loggedLast30Days).padStart(11)} ` +
    `${String(r.alreadyOnProject).padStart(11)}  ${r.absence === null ? "unknown" : JSON.stringify(r.absence)}`,
  );
}

check("candidates are returned", rows.length > 0, `${rows.length} active people`);

// Independent truth, computed with scalar subqueries so no join can inflate it.
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const { rows: truth } = await c.query(`
  select pe.id, pe.name,
    (select count(*) from public.project_responsibility r
      where r.person_id = pe.id and r.role = 'responsible') as responsible_for,
    (select count(*) from public.project_responsibility r
      where r.person_id = pe.id and r.role = 'replacement') as covers,
    (select round(sum(pr.contract_hours)::numeric, 1) from public.projects pr
      where pr.owner_person_id = pe.id and pr.contract_hours is not null) as contract_hours
  from public.people pe where pe.is_active`);
const truthById = new Map(truth.map((t) => [t.id, t]));

let mismatches = 0;
for (const r of rows) {
  const t = truthById.get(r.personId);
  if (!t) continue;
  if (Number(t.responsible_for) !== r.responsibleFor) { mismatches += 1; console.log(`   MISMATCH resp ${r.personName}: query ${r.responsibleFor} vs truth ${t.responsible_for}`); }
  if (Number(t.covers) !== r.coversAsReplacement) { mismatches += 1; console.log(`   MISMATCH cover ${r.personName}: query ${r.coversAsReplacement} vs truth ${t.covers}`); }
  const expected = t.contract_hours === null ? null : Math.round(Number(t.contract_hours) * 10) / 10;
  if (expected !== r.contractHours) { mismatches += 1; console.log(`   MISMATCH hours ${r.personName}: query ${r.contractHours} vs truth ${expected}`); }
}
check("every count matches an independent scalar-subquery computation", mismatches === 0, `${mismatches} mismatches`);

// The fan-out guard: total contract hours across all people cannot exceed the
// contract hours that exist. 85,593 for one person failed exactly this.
const { rows: [total] } = await c.query(
  `select round(sum(contract_hours)::numeric,1) as all_contract_hours from public.projects where contract_hours is not null`);
const summed = rows.reduce((s, r) => s + (r.contractHours ?? 0), 0);
check("summed candidate hours do not exceed the hours that exist (fan-out guard)",
  summed <= Number(total.all_contract_hours) + 0.5,
  `candidates sum to ${summed.toFixed(1)}h, the whole order book is ${total.all_contract_hours}h`);

// Honest nulls survive the aggregation.
const { rows: [unmeasured] } = await c.query(`
  select count(*) as n from public.people pe
  where pe.is_active
    and exists (select 1 from public.projects pr where pr.owner_person_id = pe.id)
    and not exists (select 1 from public.projects pr
                     where pr.owner_person_id = pe.id and pr.contract_hours is not null)`);
const nulls = rows.filter((r) => r.contractHours === null && r.responsibleFor + r.coversAsReplacement > 0);
console.log(`\n  ${unmeasured.n} people own only unmeasured orders; ${nulls.length} candidates report n/a hours`);
check("absence is UNKNOWN, never silently 'available'",
  rows.every((r) => r.absence === null), "all null, and the UI must render that as unknown");

// The project's current holders must be flagged, or a lead could 'reassign' to
// the person already responsible.
const onProject = rows.filter((r) => r.alreadyOnProject);
check("people already on the project are flagged", onProject.length > 0,
  onProject.map((r) => r.personName).join(", ") || "none flagged");

await c.end();
console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`}`);
rmSync(dir, { recursive: true, force: true });
process.exit(failures ? 1 : 0);
