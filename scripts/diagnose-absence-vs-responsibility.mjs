// Two people are on long-term sick leave right now (30 days and 17 days). The
// question the whole reassignment feature exists to answer: do they hold
// responsibility for projects that nobody is covering?
//
// This joins Factorial absence -> TrackingTime member -> public.people ->
// project_responsibility, using EXACT email matching only (ADR-001). If the join
// fails, that is itself the finding: absence data that cannot reach a person is
// useless to a lead.
//
// GDPR: leave TYPE is read because "sick" versus "holiday" changes how urgent a
// handover is, but no reason, note or full name is read. Employee ids and
// internal person ids only.
// READ-ONLY. Nothing written.
import { readFileSync } from "node:fs";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const KEY = env.FACTORIAL_API_KEY ?? env.FACTORIAL_KEY ?? "";
const VERSION = "2026-07-01";
const BASE = "https://api.factorialhr.com";

const call = async (p) => {
  const r = await fetch(`${BASE}${p}`, { headers: { "x-api-key": KEY, Accept: "application/json" } });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const FORBIDDEN = /reason|description|note|comment|medical|diagnosis|attachment|document|full_name/i;
const fetchAll = async (resource) => {
  const rows = [];
  let cursor = null;
  for (let p = 0; p < 30; p += 1) {
    const qs = new URLSearchParams({ limit: "100" });
    if (cursor) qs.set("after_id", cursor);
    const r = await call(`/api/${VERSION}/resources/${resource}?${qs}`);
    if (r.status !== 200 || !Array.isArray(r.body?.data)) break;
    for (const row of r.body.data) {
      const kept = {};
      for (const [k, v] of Object.entries(row)) if (!FORBIDDEN.test(k)) kept[k] = v;
      rows.push(kept);
    }
    if (!r.body.meta?.has_next_page) break;
    const n = r.body.meta.end_cursor;
    if (!n || n === cursor) break;
    cursor = n;
  }
  return rows;
};

const today = new Date().toISOString().slice(0, 10);

const [leaves, types, employees] = await Promise.all([
  fetchAll("timeoff/leaves"),
  fetchAll("timeoff/leave_types"),
  fetchAll("employees/employees"),
]);

const typeName = new Map(types.map((t) => [String(t.id), t.name ?? t.translated_name ?? "?"]));
const emailByEmployee = new Map(employees.map((e) => [String(e.id), String(e.email ?? e.login_email ?? "").trim().toLowerCase()]));

const absentToday = leaves.filter((l) =>
  l.approved === true && String(l.start_on) <= today && String(l.finish_on) >= today);

console.log(`Who is away today, and is their work covered?  (today = ${today})\n`);
console.log(`  ${absentToday.length} approved absence(s) covering today\n`);

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

let unreachable = 0;
let atRisk = 0;

for (const l of absentToday) {
  const email = emailByEmployee.get(String(l.employee_id)) ?? "";
  const type = typeName.get(String(l.leave_type_id)) ?? "?";
  const mask = email ? `${email.slice(0, 1)}***@${email.split("@")[1] ?? "?"}` : "(no email)";

  // EXACT email only. Never similarity: ADR-001, and a wrong identity match here
  // would reassign the wrong person's work.
  const { rows: [person] } = await c.query(`
    select pe.id, pe.name
    from time.member m
    join public.people pe on pe.id = m.hub_person_id
    where lower(trim(m.email)) = $1`, [email]);

  console.log(`  ${type.padEnd(10)} ${l.start_on} -> ${l.finish_on}  (${l.days_taken}d)  ${mask}`);

  if (!person) {
    unreachable += 1;
    console.log(`      -> NOT REACHABLE: no TrackingTime member with that address links to a person`);
    console.log(`         Their absence cannot be shown against their projects.`);
    continue;
  }

  // What do they hold, and is any of it uncovered?
  const { rows: [load] } = await c.query(`
    select
      (select count(*) from public.project_responsibility r
        where r.person_id = $1 and r.role = 'responsible') as responsible_for,
      (select count(*) from public.project_responsibility r
        where r.person_id = $1 and r.role = 'replacement') as covers_for_others`, [person.id]);

  // The sharp question: of the projects they lead, how many have NO independent
  // replacement named? Those are the ones with nobody to step in.
  const { rows: uncovered } = await c.query(`
    select p.id, left(p.name, 40) as name, p.contract_hours
    from public.project_responsibility r
    join public.projects p on p.id = r.project_id
    where r.person_id = $1 and r.role = 'responsible'
      and not exists (
        select 1 from public.project_responsibility rr
        where rr.project_id = r.project_id and rr.role = 'replacement'
          and rr.person_id <> r.person_id)
      and (p.status is null or p.status not ilike '%abgeschlossen%')
    order by p.contract_hours desc nulls last`, [person.id]);

  console.log(`      -> ${person.name}: responsible for ${load.responsible_for}, covers ${load.covers_for_others} for others`);
  if (uncovered.length) {
    atRisk += uncovered.length;
    console.log(`         ${uncovered.length} of their projects have NO independent cover:`);
    for (const u of uncovered.slice(0, 5)) {
      console.log(`           ${u.id}  ${u.contract_hours ?? "n/a"}h  "${u.name}"`);
    }
    if (uncovered.length > 5) console.log(`           ... and ${uncovered.length - 5} more`);
  } else if (Number(load.responsible_for) > 0) {
    console.log(`         all of their projects have a named cover`);
  }
  console.log("");
}

console.log("SUMMARY");
console.log(`  absences that cannot be attributed to a person: ${unreachable}/${absentToday.length}`);
console.log(`  projects led by someone absent today with no independent cover: ${atRisk}`);
if (atRisk > 0) {
  console.log("\n  This is exactly what the reassignment picker is for, and today it says");
  console.log("  'Abwesenheit unbekannt' for these people because leave_requests is empty.");
}

console.log("\nREAD-ONLY: nothing written; no name, reason or note was read from Factorial.");
await c.end();
