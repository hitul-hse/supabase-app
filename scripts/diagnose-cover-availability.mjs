// "All of their projects have a named cover" is not the same as "someone is
// available to do the work". Thorsten and Stephan are both out sick RIGHT NOW,
// and each covers projects for other people. So the real questions are:
//
//   1. Do Thorsten and Stephan cover for EACH OTHER? Then both being off means
//      those projects have nobody, and the "named cover" reassures falsely.
//   2. Are the people covering THEIR projects also absent?
//   3. What happens to the 16 projects they cover for others while they are out?
//
// A lead reading "has a named cover" would stop looking. This checks whether
// that reassurance survives contact with who is actually at their desk.
// READ-ONLY. No name, reason or note read from Factorial.
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
  fetchAll("timeoff/leaves"), fetchAll("timeoff/leave_types"), fetchAll("employees/employees"),
]);
const typeName = new Map(types.map((t) => [String(t.id), t.name ?? t.translated_name ?? "?"]));
const emailOf = new Map(employees.map((e) => [String(e.id), String(e.email ?? e.login_email ?? "").trim().toLowerCase()]));

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

// Map every currently-absent Factorial employee to a hub person, exact email only.
const absentPersonIds = new Map(); // personId -> {type, until, days}
for (const l of leaves) {
  if (l.approved !== true) continue;
  if (!(String(l.start_on) <= today && String(l.finish_on) >= today)) continue;
  const email = emailOf.get(String(l.employee_id)) ?? "";
  if (!email) continue;
  const { rows: [p] } = await c.query(
    `select pe.id, pe.name from time.member m join public.people pe on pe.id = m.hub_person_id
     where lower(trim(m.email)) = $1`, [email]);
  if (p) absentPersonIds.set(p.id, { name: p.name, type: typeName.get(String(l.leave_type_id)) ?? "?", until: l.finish_on, days: l.days_taken });
}

console.log(`Does "has a named cover" survive contact with who is actually here?\n`);
console.log(`  absent today: ${[...absentPersonIds.values()].map((a) => `${a.name} (${a.type}, until ${a.until})`).join(", ")}\n`);

// For every OPEN project led by an absent person, who covers it and are THEY in?
const absentIds = [...absentPersonIds.keys()];
if (!absentIds.length) { console.log("nobody absent"); await c.end(); process.exit(0); }

const { rows: projects } = await c.query(`
  select r.project_id, r.person_id as lead_id, pl.name as lead_name,
         p.contract_hours, left(p.name, 38) as project_name,
         cov.person_id as cover_id, pc.name as cover_name
  from public.project_responsibility r
  join public.projects p on p.id = r.project_id
  join public.people pl on pl.id = r.person_id
  left join public.project_responsibility cov
    on cov.project_id = r.project_id and cov.role = 'replacement' and cov.person_id <> r.person_id
  left join public.people pc on pc.id = cov.person_id
  where r.role = 'responsible' and r.person_id = any($1)
    and (p.status is null or p.status not ilike '%abgeschlossen%')
  order by p.contract_hours desc nulls last`, [absentIds]);

let bothOut = 0, coveredOk = 0, noCover = 0;
console.log("  projects led by someone who is off today:");
for (const p of projects) {
  const coverAbsent = p.cover_id && absentPersonIds.has(p.cover_id);
  const state = !p.cover_id ? "NO COVER NAMED" : coverAbsent ? "COVER IS ALSO OFF" : "covered";
  if (!p.cover_id) noCover += 1; else if (coverAbsent) bothOut += 1; else coveredOk += 1;
  if (!p.cover_id || coverAbsent) {
    console.log(`    ${state.padEnd(18)} ${p.project_id}  ${String(p.contract_hours ?? "n/a").padStart(6)}h  ` +
      `lead ${p.lead_name}${p.cover_name ? ` / cover ${p.cover_name}` : ""}  "${p.project_name}"`);
  }
}
console.log(`\n    covered by someone present : ${coveredOk}`);
console.log(`    COVER IS ALSO ABSENT       : ${bothOut}`);
console.log(`    no cover named at all      : ${noCover}`);

// And the reverse exposure: what do the absent people cover for OTHERS? If the
// person they cover for goes off too, that project has nobody either.
const { rows: covering } = await c.query(`
  select r.project_id, pc.name as cover_name, pl.name as lead_name, lead.person_id as lead_id,
         left(p.name, 38) as project_name, p.contract_hours
  from public.project_responsibility r
  join public.projects p on p.id = r.project_id
  join public.people pc on pc.id = r.person_id
  left join public.project_responsibility lead
    on lead.project_id = r.project_id and lead.role = 'responsible'
  left join public.people pl on pl.id = lead.person_id
  where r.role = 'replacement' and r.person_id = any($1)
    and (p.status is null or p.status not ilike '%abgeschlossen%')`, [absentIds]);

const doubleOut = covering.filter((r) => r.lead_id && absentPersonIds.has(r.lead_id));
console.log(`\n  projects where an ABSENT person is the named cover: ${covering.length}`);
console.log(`    of those, the lead is ALSO absent: ${doubleOut.length}`);
for (const d of doubleOut) {
  console.log(`      ${d.project_id}  lead ${d.lead_name} + cover ${d.cover_name}, BOTH OFF  "${d.project_name}"`);
}

console.log("\n  VERDICT:");
if (bothOut || doubleOut.length) {
  console.log(`    ${bothOut + doubleOut.length} project(s) have nobody available despite showing a named cover.`);
  console.log("    'Has a named cover' is exactly the reassurance that hides this, which is");
  console.log("    why the picker needs absence data rather than just a name.");
} else {
  console.log("    Every project led by an absent person has a cover who is at their desk.");
  console.log("    The named-cover reassurance holds today -- but only because the sync now");
  console.log("    lets us check rather than assume.");
}

console.log("\nREAD-ONLY: nothing written.");
await c.end();
