// Gate: nobody carrying responsibility may be silently absent from the
// management views.
//
// PEOPLE in management-contract-hours.ts is an allowlist. Anyone missing is
// dropped from the service grid, the utilisation outlook and the employee
// overview -- and the page still renders a complete-looking table, so the
// omission is invisible. It had drifted: Rency Sebastian, with 62 responsible
// and 62 replacement projects and more logged hours than anyone in the company,
// appeared nowhere, while Serhii (archived, one 3h project) was listed.
//
// A hardcoded list is a legitimate choice here -- ManagementPerson is a union
// type derived from it and the matrix columns are fixed -- so this gate does not
// demand the list be derived from the DB. It demands only that the list not
// silently disagree with the data: if someone holds responsibility and is not
// listed, that is a decision someone must make explicitly, not a default.
//
// READ-ONLY.
import { readFileSync } from "node:fs";
import pg from "pg";
import { loadEnv } from "./lib/gate-env.mjs";

const env = loadEnv();

// Parse the allowlist out of the source rather than duplicating it, so the gate
// cannot drift from the thing it is guarding.
const SOURCE = "src/lib/queries/management-contract-hours.ts";
const src = readFileSync(SOURCE, "utf8");
const block = src.match(/const PEOPLE = \[([\s\S]*?)\] as const;/);
if (!block) {
  console.log(`FAIL: could not find the PEOPLE list in ${SOURCE}.`);
  console.log("If it was renamed or restructured, update this gate deliberately.");
  process.exit(1);
}
const allowlist = [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
if (!allowlist.length) { console.log(`FAIL: parsed an empty PEOPLE list from ${SOURCE}.`); process.exit(1); }

const norm = (v) => String(v ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const allowed = new Set(allowlist.map(norm));

console.log(`check-management-people-complete: does the dashboard show everyone who carries work?\n`);
console.log(`allowlist (${allowlist.length}, parsed from ${SOURCE}): ${allowlist.join(", ")}\n`);

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const failures = [];
const check = (ok, label, detail) => {
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
};

// Scalar subqueries, not joins: joining project_responsibility to
// person_assignments multiplies rows and turned 62 into 8060 while looking
// entirely plausible.
const { rows: holders } = await c.query(`
  select
    pe.name,
    (select count(*) from public.project_responsibility r
      where r.person_id = pe.id and r.role = 'responsible') as responsible_for,
    (select count(*) from public.project_responsibility r
      where r.person_id = pe.id and r.role = 'replacement') as replacement_for,
    (select coalesce(round(sum(pr.contract_hours)::numeric, 1), 0) from public.projects pr
      where pr.owner_person_id = pe.id) as owned_hours
  from public.people pe
  where exists (select 1 from public.project_responsibility r where r.person_id = pe.id)
  order by responsible_for desc`);

const missing = holders.filter((h) => !allowed.has(norm(h.name)));

check(holders.length > 0, "somebody carries responsibility at all", `${holders.length} people`);

check(missing.length === 0,
  "every responsibility holder is on the management allowlist",
  missing.length
    ? `missing: ${missing.map((m) => `${m.name} (${m.responsible_for} responsible, ${m.replacement_for} replacement, ${m.owned_hours}h owned)`).join("; ")}`
    : `all ${holders.length} listed`);

// The reverse direction is a warning, not a failure: keeping a departed person
// on the list shows an honest zero rather than hiding history.
const dbNames = new Set(holders.map((h) => norm(h.name)));
const listedWithoutResponsibility = allowlist.filter((a) => !dbNames.has(norm(a)));
if (listedWithoutResponsibility.length) {
  console.log(`  note  listed but carrying no responsibility: ${listedWithoutResponsibility.join(", ")} (renders an honest 0, not hidden)`);
}

// Every allowlist entry must resolve to a real public.people row, or the column
// exists on screen and can never be populated.
const { rows: peopleRows } = await c.query(`select name from public.people`);
const peopleNames = new Set(peopleRows.map((r) => norm(r.name)));
const phantom = allowlist.filter((a) => !peopleNames.has(norm(a)));
check(phantom.length === 0,
  "every allowlist name resolves to a public.people row",
  phantom.length ? `no such person: ${phantom.join(", ")}` : `all ${allowlist.length} resolve`);

console.log(`\n${failures.length === 0 ? "PASS" : `FAIL (${failures.length})`}`);
if (failures.length) {
  for (const f of failures) console.log(`  - ${f}`);
  console.log(`\nAdd the missing name(s) to PEOPLE in ${SOURCE}, or, if the omission is`);
  console.log("intended, say so in a comment there and surface the excluded count in the UI");
  console.log("instead of letting the table imply it is complete.");
}
await c.end();
process.exit(failures.length ? 1 : 0);
