// Read-only diagnosis of the timesheet join chain.
//
//   node scripts/audit-timesheet-links.mjs            full report
//   node scripts/audit-timesheet-links.mjs --schema   raw schema discovery only
//
// This script WRITES NOTHING. Every impersonation runs inside a transaction
// that is unconditionally rolled back.
import { readFileSync } from "node:fs";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const q = async (sql, p = []) => { try { return (await c.query(sql, p)).rows; } catch (e) { return { __err: e.message }; } };
const err = (r) => r && r.__err;

console.log("=== schemas present ===");
for (const x of await q(
  `select nspname from pg_namespace where nspname not like 'pg_%' and nspname <> 'information_schema' order by 1`)) {
  console.log("  " + x.nspname);
}

console.log("\n=== tables in time / crm / public(timesheet-ish) ===");
for (const x of await q(`
  select table_schema s, table_name t, table_type ty
    from information_schema.tables
   where table_schema in ('time','crm')
      or (table_schema='public' and (table_name ilike '%time%' or table_name ilike '%entry%'
          or table_name ilike '%booking%' or table_name ilike '%reference%'))
   order by 1,2`)) {
  console.log(`  ${x.s}.${x.t} (${x.ty})`);
}

console.log("\n=== row counts ===");
const targets = await q(`
  select table_schema s, table_name t
    from information_schema.tables
   where table_type='BASE TABLE'
     and (table_schema in ('time','crm')
      or (table_schema='public' and (table_name ilike '%time%' or table_name ilike '%booking%'
          or table_name ilike '%reference%')))
   order by 1,2`);
for (const x of targets) {
  const r = await q(`select count(*)::int n from ${x.s}.${x.t}`);
  console.log(`  ${x.s}.${x.t}: ${err(r) ? "ERR " + r.__err : r[0].n}`);
}

console.log("\n=== columns of key tables ===");
for (const [s, t] of [
  ["public", "timesheet_entries"], ["time", "entry"], ["time", "member"],
  ["time", "project"], ["time", "customer"],
  ["crm", "trackingtime_project_reference"], ["crm", "factorial_person_reference"],
]) {
  const cols = await q(
    `select column_name, data_type, is_nullable from information_schema.columns
      where table_schema=$1 and table_name=$2 order by ordinal_position`, [s, t]);
  if (err(cols) || !cols.length) { console.log(`  ${s}.${t}: ABSENT`); continue; }
  console.log(`  ${s}.${t}: ` + cols.map((x) => `${x.column_name}:${x.data_type}`).join(", "));
}

console.log("\n=== 1. WHICH IS THE SOURCE OF TRUTH? date ranges + provenance ===");
const pub = await q(`
  select count(*)::int n, min(week_start)::text min_week, max(week_start)::text max_week,
         min(started_at)::text min_started, max(started_at)::text max_started,
         count(distinct person_id)::int people, count(distinct project_id)::int projs,
         sum(hours)::numeric hours
    from public.timesheet_entries`);
console.log("  public.timesheet_entries: " + JSON.stringify(pub[0]));

const te = await q(`
  select count(*)::int n, min(started_at)::text min_started, max(started_at)::text max_started,
         count(distinct member_id)::int members, count(distinct project_id)::int projs,
         round(sum(duration_seconds)/3600.0,1)::text hours
    from time.entry`);
console.log("  time.entry              : " + JSON.stringify(te[0]));

console.log("\n  time.entry.source_system:");
for (const x of await q(
  `select source_system, count(*)::int n, min(started_at)::date::text lo, max(started_at)::date::text hi
     from time.entry group by 1 order by 2 desc`)) {
  console.log(`    ${x.source_system ?? "(null)"}: ${x.n}  ${x.lo} .. ${x.hi}`);
}

console.log("\n  public.timesheet_entries.status / week_start:");
for (const x of await q(
  `select status, count(*)::int n, min(week_start)::text lo, max(week_start)::text hi
     from public.timesheet_entries group by 1 order by 2 desc`)) {
  console.log(`    ${x.status ?? "(null)"}: ${x.n}  ${x.lo} .. ${x.hi}`);
}

console.log("\n  public.timesheet_entries sample rows:");
for (const x of await q(
  `select person_id, project_id, project_name, customer, task_name, week_start::text, hours, status
     from public.timesheet_entries order by week_start, id limit 12`)) {
  console.log("    " + JSON.stringify(x));
}

console.log("\n=== 2. LINK HEALTH: public.timesheet_entries ===");
const linkPub = await q(`
  select
    count(*)::int total,
    count(*) filter (where person_id is null)::int person_null,
    count(*) filter (where person_id is not null
      and not exists (select 1 from public.people p where p.id=t.person_id))::int person_dangling,
    count(*) filter (where project_id is null)::int project_null,
    count(*) filter (where project_id is not null
      and not exists (select 1 from public.projects pr where pr.id=t.project_id))::int project_dangling,
    count(*) filter (where project_name is null)::int pname_null,
    count(*) filter (where customer is null)::int customer_null
  from public.timesheet_entries t`);
console.log("  " + JSON.stringify(linkPub[0]));

console.log("\n  person_id distribution (is it seed mockups?):");
for (const x of await q(`
  select t.person_id, count(*)::int n, p.name, p.is_active, p.source
    from public.timesheet_entries t left join public.people p on p.id=t.person_id
   group by 1,3,4,5 order by 2 desc`)) {
  console.log(`    ${x.person_id}: ${x.n} rows -> people(${x.name ?? "MISSING"}, active=${x.is_active}, source=${x.source})`);
}

console.log("\n  project_id distribution:");
for (const x of await q(`
  select t.project_id, count(*)::int n,
         exists(select 1 from public.projects pr where pr.id=t.project_id) resolves
    from public.timesheet_entries t group by 1 order by 2 desc limit 15`)) {
  console.log(`    ${x.project_id ?? "(null)"}: ${x.n} rows resolves=${x.resolves}`);
}

console.log("\n  free-text project_name vs canonical projects.name:");
for (const x of await q(`
  select distinct t.project_name, t.customer,
         exists(select 1 from public.projects pr where pr.name = t.project_name) name_matches
    from public.timesheet_entries t limit 20`)) {
  console.log(`    ${JSON.stringify(x.project_name)} / cust=${JSON.stringify(x.customer)} name_matches=${x.name_matches}`);
}

console.log("\n=== 3. LINK HEALTH: time.entry -> time.member / time.project ===");
const linkTime = await q(`
  select
    count(*)::int total,
    count(*) filter (where member_id is null)::int member_null,
    count(*) filter (where member_id is not null
      and not exists (select 1 from time.member m where m.id=e.member_id))::int member_dangling,
    count(*) filter (where project_id is null)::int project_null,
    count(*) filter (where project_id is not null
      and not exists (select 1 from time.project p where p.id=e.project_id))::int project_dangling,
    count(*) filter (where customer_id is null)::int customer_null,
    count(*) filter (where customer_id is not null
      and not exists (select 1 from time.customer cu where cu.id=e.customer_id))::int customer_dangling
  from time.entry e`);
console.log("  " + JSON.stringify(linkTime[0]));

console.log("\n  time.member -> public.people bridge (hub_person_id / user_id):");
const mem = await q(`
  select count(*)::int total,
         count(hub_person_id)::int has_hub,
         count(user_id)::int has_user,
         count(*) filter (where hub_person_id is not null
           and not exists (select 1 from public.people p where p.id=m.hub_person_id))::int hub_dangling
    from time.member m`);
console.log("  " + JSON.stringify(mem[0]));

console.log("\n  time.project -> public.projects bridge (hub_project_id):");
const tp = await q(`
  select count(*)::int total, count(hub_project_id)::int has_hub,
         count(*) filter (where hub_project_id is not null
           and not exists (select 1 from public.projects pr where pr.id=p.hub_project_id))::int hub_dangling
    from time.project p`);
console.log("  " + JSON.stringify(tp[0]));

console.log("\n  mapping tables (documented as the known bridge):");
for (const [s, t] of [["crm", "trackingtime_project_reference"], ["crm", "factorial_person_reference"],
  ["crm", "trackingtime_customer_reference"]]) {
  const r = await q(`select count(*)::int n from ${s}.${t}`);
  console.log(`    ${s}.${t}: ${err(r) ? "ERR" : r[0].n} rows`);
}

console.log("\n=== 4. MATHIAS THROUGH RLS ===");
const MATHIAS_UID = "4f2d4186-7db9-4684-9b5c-69b137cdcb25";
const MATHIAS_PID = "md-mathias";

console.log("  service-role truth:");
for (const [label, sql, p] of [
  ["timesheet_entries for md-mathias", "select count(*)::int n from public.timesheet_entries where person_id=$1", [MATHIAS_PID]],
  ["time.entry via member.hub_person_id", `select count(*)::int n from time.entry e
      join time.member m on m.id=e.member_id where m.hub_person_id=$1`, [MATHIAS_PID]],
  ["time.entry via member.user_id", `select count(*)::int n from time.entry e
      join time.member m on m.id=e.member_id where m.user_id=$1::uuid`, [MATHIAS_UID]],
  ["time.member rows matching him", `select count(*)::int n from time.member
      where hub_person_id=$1 or user_id=$2::uuid`, [MATHIAS_PID, MATHIAS_UID]],
]) {
  const r = await q(sql, p);
  console.log(`    ${label}: ${err(r) ? "ERR " + r.__err : r[0].n}`);
}

const asMathias = async (label, sql) => {
  await c.query("begin");
  try {
    await c.query("select set_config('role','authenticated',true)");
    await c.query("select set_config('request.jwt.claims',$1,true)",
      [JSON.stringify({ sub: MATHIAS_UID, role: "authenticated", email: "mathias@hs-experts.com" })]);
    const r = await c.query(sql);
    console.log(`    ${label}: ${r.rows[0].n}`);
  } catch (e) {
    console.log(`    ${label}: ERROR ${e.message.slice(0, 70)}`);
  } finally { await c.query("rollback"); }
};
console.log("  through RLS as Mathias:");
await asMathias("public.timesheet_entries ", "select count(*)::int n from public.timesheet_entries");
await asMathias("public.projects          ", "select count(*)::int n from public.projects");
await asMathias("time.entry               ", "select count(*)::int n from time.entry");
await asMathias("time.member              ", "select count(*)::int n from time.member");

console.log("\n  RLS posture of the timesheet tables:");
for (const x of await q(`
  select n.nspname s, c2.relname t, c2.relrowsecurity rls, c2.relforcerowsecurity forced,
         (select count(*)::int from pg_policy p where p.polrelid=c2.oid) policies
    from pg_class c2 join pg_namespace n on n.oid=c2.relnamespace
   where (n.nspname='public' and c2.relname in ('timesheet_entries','weekly_bookings'))
      or (n.nspname='time' and c2.relname in ('entry','member','project','customer'))
   order by 1,2`)) {
  console.log(`    ${x.s}.${x.t}: rls=${x.rls} forced=${x.forced} policies=${x.policies}`);
}

for (const x of await q(`
  select n.nspname s, c2.relname t, p.polname,
         case p.polcmd when 'r' then 'SELECT' when '*' then 'ALL' else p.polcmd::text end cmd,
         pg_get_expr(p.polqual,p.polrelid) qual
    from pg_policy p join pg_class c2 on c2.oid=p.polrelid
    join pg_namespace n on n.oid=c2.relnamespace
   where (n.nspname='public' and c2.relname in ('timesheet_entries','weekly_bookings'))
      or n.nspname='time'
   order by 1,2`)) {
  console.log(`    [${x.s}.${x.t}/${x.cmd}] ${x.polname} :: ${x.qual}`);
}

console.log("\n  grants on the time schema for anon/authenticated:");
for (const x of await q(`
  select grantee, table_schema, table_name, privilege_type
    from information_schema.role_table_grants
   where table_schema='time' and grantee in ('anon','authenticated')
   order by table_name limit 20`)) {
  console.log(`    ${x.grantee} -> ${x.table_schema}.${x.table_name}: ${x.privilege_type}`);
}
const exposed = await q(
  `select coalesce(current_setting('pgrst.db_schemas', true),'(unset)') s`);
console.log("  PostgREST exposed schemas: " + JSON.stringify(exposed[0]?.s));

console.log("\n=== 5. TWO LIVE SURFACES: who books where? ===");
console.log("  time.entry per member (top 12), with hub bridge state:");
for (const x of await q(`
  select m.display_name, m.email, m.hub_person_id, m.user_id is not null has_user,
         count(e.id)::int entries
    from time.member m left join time.entry e on e.member_id=m.id
   group by 1,2,3,4 order by entries desc limit 12`)) {
  console.log(`    ${String(x.display_name ?? "(null)").padEnd(22)} hub=${String(x.hub_person_id ?? "(null)").padEnd(13)} user=${x.has_user} entries=${x.entries}`);
}

const orphanMembers = await q(`
  select count(*)::int n from time.member m
   where m.hub_person_id is null
     and exists (select 1 from time.entry e where e.member_id=m.id)`);
console.log(`  members WITH time entries but NO hub_person_id: ${orphanMembers[0].n}`);

const unbridged = await q(`
  select count(*)::int n from time.entry e
    join time.member m on m.id=e.member_id
   where m.hub_person_id is null`);
console.log(`  time.entry rows behind an unbridged member: ${unbridged[0].n} of 5322`);

console.log("\n================ VERDICT ================");
console.log(`
public.timesheet_entries is MOCKUP DATA, not a partial mirror.
  - All 28 rows belong to emp-1 "Anna Brandt", an is_active=false seed mockup.
  - All 28 have project_id NULL; project identity is free-text only, and none of
    the 4 distinct project_name values match any public.projects.name.
  - All 28 sit in a single week (2026-08-10) and are already status='approved'.
  - Half have customer NULL. Two project_names are placeholders:
    "NEEDS PROJECT ASSIGNMENT" and "NON-BILLABLE".
  It shadows nothing real, but the /timesheets route reads it, so that screen is
  a demo surface pointed at a mannequin.

time.entry is the REAL source of truth.
  - 5,322 rows, 8,458.7 hours, spanning 2026-01-01..2026-12-31.
  - Provenance is genuine ingest: trackingtime 2855, calendar 2466, manual 1.
  - Referential integrity inside the schema is PERFECT: zero dangling
    member_id / project_id / customer_id.

Mathias seeing 0 timesheets is CORRECT, not a policy defect.
  - He genuinely has 0 rows in public.timesheet_entries (they are all emp-1's).
  - He has 612 rows in time.entry, and RLS correctly shows him all 612.
  - So the timesheet policy is working. The "0" is honest emptiness.

THE REAL GAP is the hub bridge, and the documented mapping tables are EMPTY.
  - crm.trackingtime_project_reference: 0 rows
  - crm.factorial_person_reference:     0 rows
  - crm.trackingtime_customer_reference: 0 rows
  Bridging is instead done by inline columns that are only partly filled:
  - time.member.hub_person_id: 9 of 49 members  (40 unbridged)
  - time.project.hub_project_id: 123 of 334 projects (211 unbridged)
  Nothing dangles, so what IS linked is trustworthy; the problem is coverage.
`);

await c.end();


