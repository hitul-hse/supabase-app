// The management dashboard's PEOPLE allowlist
// (management-contract-hours.ts:7) hardcodes 7 names. Anyone absent is dropped
// from the service grid, the utilisation outlook and the employee overview --
// silently, because the page renders a complete-looking table either way.
//
// Rency Sebastian holds 65 project_responsibility rows. Is the omission
// deliberate (not an employee / not in scope) or is it a stale list?
// READ-ONLY.
import { readFileSync } from "node:fs";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const ALLOWLIST = ["Thorsten", "Mathias", "Ousmane", "Hendryk", "Stephan", "Serhii", "Mustafa"];
const norm = (v) => String(v ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const allowed = new Set(ALLOWLIST.map(norm));

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

// Each aggregate is computed in its own scalar subquery. Joining
// project_responsibility and person_assignments in one query multiplies the rows
// (8060 = 62 x 130), which is exactly the kind of plausible-looking inflated
// number this repo's house rules exist to prevent.
const { rows } = await c.query(`
  select
    pe.id,
    pe.name,
    pe.source,
    (select count(*) from public.project_responsibility r
      where r.person_id = pe.id and r.role = 'responsible') as responsible_for,
    (select count(*) from public.project_responsibility r
      where r.person_id = pe.id and r.role = 'replacement') as replacement_for,
    (select count(distinct pa.project_id) from public.person_assignments pa
      where pa.person_id = pe.id) as assignments,
    (select coalesce(round(sum(pr.contract_hours)::numeric, 1), 0) from public.projects pr
      where pr.owner_person_id = pe.id) as owned_contract_hours
  from public.people pe
  where exists (select 1 from public.project_responsibility r where r.person_id = pe.id)
     or exists (select 1 from public.person_assignments pa where pa.person_id = pe.id)
  order by responsible_for desc, replacement_for desc`);

console.log("People who carry responsibility or assignments:\n");
console.log("IN?  NAME                 SOURCE      RESP  REPL  ASSIGN  OWNED-H");
let excludedResp = 0, excludedRepl = 0, excludedHours = 0;
const excluded = [];
for (const r of rows) {
  const inList = allowed.has(norm(r.name));
  if (!inList) {
    excludedResp += Number(r.responsible_for);
    excludedRepl += Number(r.replacement_for);
    excludedHours += Number(r.owned_contract_hours);
    excluded.push(r);
  }
  console.log(
    `${inList ? " ok " : "OUT "} ${String(r.name).padEnd(20)} ${String(r.source ?? "").padEnd(11)}` +
    `${String(r.responsible_for).padStart(5)} ${String(r.replacement_for).padStart(5)} ` +
    `${String(r.assignments).padStart(7)} ${String(r.owned_contract_hours).padStart(8)}`,
  );
}

console.log("\nAllowlist entries that match nobody in public.people:");
const dbNames = new Set(rows.map((r) => norm(r.name)));
const phantom = ALLOWLIST.filter((a) => !dbNames.has(norm(a)));
console.log(phantom.length ? `  ${phantom.join(", ")}` : "  (none)");

console.log("\nEXCLUDED BY THE ALLOWLIST:");
if (!excluded.length) console.log("  nobody");
else {
  for (const r of excluded) console.log(`  ${r.name} (source=${r.source}) — responsible for ${r.responsible_for}, replacement on ${r.replacement_for}`);
  console.log(`\n  totals hidden from the dashboard: ${excludedResp} responsible, ${excludedRepl} replacement, ${excludedHours}h owned contract hours`);
}

console.log("\nREAD-ONLY: nothing was written.");
await c.end();
