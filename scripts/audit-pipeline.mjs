// The data pipeline, end to end, as one runnable report.
//
// The question is "does it work without errors", which is not answerable by
// looking at any single table. The pipeline is a chain, and a chain fails at its
// joins:
//
//   TrackingTime / calendar  ->  time.entry
//   time.entry  -> time.member -> public.people -> app_user_profile -> auth.users
//   time.entry  -> time.project -> public.projects -> crm.legal_entity
//   masterdata workbook -> public.project_responsibility
//   RLS gates every read of the above
//
// Every hop is measured for: rows, orphans (a foreign key pointing at nothing),
// unbridged rows (a nullable link that was never filled), and freshness. An
// orphan is corruption; an unbridged row is silent data loss, which is worse
// because nothing errors.
import { readFileSync } from "node:fs";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

let problems = [];
const note = (severity, text) => problems.push({ severity, text });

const q = async (sql, params) => (await c.query(sql, params)).rows;
const one = async (sql, params) => (await q(sql, params))[0];

console.log("=".repeat(78));
console.log("STAGE 1  INGEST -> time.entry");
console.log("=".repeat(78));

const ingest = await q(`
  select source_system,
         count(*)::int entries,
         min(started_at)::date first_day,
         max(started_at)::date last_day,
         round(sum(duration_seconds)/3600.0,1) hours,
         count(*) filter (where ended_at is null)::int still_running,
         count(*) filter (where duration_seconds is null or duration_seconds < 0)::int bad_duration
  from time.entry group by 1 order by 2 desc`);
console.table(ingest);

const staleDays = await one(`
  select max(started_at)::date last_entry,
         (current_date - max(started_at)::date)::int days_since
  from time.entry where source_system = 'trackingtime'`);
console.log(`last TrackingTime entry: ${staleDays.last_entry} (${staleDays.days_since} days ago)`);
if (staleDays.days_since > 7) note("WARN", `TrackingTime sync is ${staleDays.days_since} days stale`);
for (const r of ingest) if (r.bad_duration > 0) note("ERROR", `${r.bad_duration} ${r.source_system} entries have a null/negative duration`);

console.log("\n" + "=".repeat(78));
console.log("STAGE 2  REFERENTIAL INTEGRITY inside the time schema");
console.log("=".repeat(78));

const timeOrphans = await one(`
  select
    (select count(*) from time.entry e left join time.member m on m.id=e.member_id where m.id is null)::int entry_member,
    (select count(*) from time.entry e left join time.project p on p.id=e.project_id where e.project_id is not null and p.id is null)::int entry_project,
    (select count(*) from time.entry e left join time.customer cu on cu.id=e.customer_id where e.customer_id is not null and cu.id is null)::int entry_customer,
    (select count(*) from time.project p left join time.customer cu on cu.id=p.customer_id where p.customer_id is not null and cu.id is null)::int project_customer`);
console.table([timeOrphans]);
for (const [k, v] of Object.entries(timeOrphans)) if (v > 0) note("ERROR", `${v} orphaned rows: ${k}`);

console.log("\n" + "=".repeat(78));
console.log("STAGE 3  THE HUB BRIDGE (nullable links, where data goes quiet)");
console.log("=".repeat(78));

const bridge = await one(`
  select
    (select count(*) from time.member)::int members,
    (select count(*) from time.member where hub_person_id is not null)::int members_bridged,
    (select count(*) from time.project)::int projects,
    (select count(*) from time.project where hub_project_id is not null)::int projects_bridged,
    (select count(*) from time.entry)::int entries,
    (select count(*) from time.entry e join time.project p on p.id=e.project_id where p.hub_project_id is not null)::int entries_reaching_hub,
    (select round(sum(duration_seconds)/3600.0,1) from time.entry)::numeric total_hours,
    (select round(sum(e.duration_seconds)/3600.0,1) from time.entry e join time.project p on p.id=e.project_id where p.hub_project_id is not null)::numeric hours_reaching_hub`);
console.table([bridge]);

const pctH = Math.round((bridge.hours_reaching_hub / bridge.total_hours) * 100);
console.log(`hours that can be attributed to a hub project: ${bridge.hours_reaching_hub} of ${bridge.total_hours} (${pctH}%)`);
if (pctH < 95) note("WARN", `${100 - pctH}% of tracked hours cannot reach a hub project (hub_project_id unset on ${bridge.projects - bridge.projects_bridged} of ${bridge.projects})`);
if (bridge.members_bridged < bridge.members) {
  const unb = await q(`
    select m.display_name, m.email, count(e.id)::int entries, round(sum(e.duration_seconds)/3600.0,1) hours
    from time.member m join time.entry e on e.member_id = m.id
    where m.hub_person_id is null group by 1,2 having count(e.id) > 0 order by 3 desc`);
  if (unb.length) {
    console.log("\nmembers with tracked time but NO hub person:");
    console.table(unb);
    note("WARN", `${unb.length} people have tracked hours that cannot reach their Hub account`);
  }
}

console.log("\n" + "=".repeat(78));
console.log("STAGE 4  IDENTITY: account -> person -> work");
console.log("=".repeat(78));

const identity = await one(`
  select
    (select count(*) from public.app_user_profile where is_active)::int active_accounts,
    (select count(*) from public.app_user_profile where is_active and person_id is not null)::int with_person,
    (select count(*) from public.app_user_profile a where a.is_active and a.person_id is not null
       and not exists (select 1 from public.people p where p.id = a.person_id))::int dangling_person,
    (select count(*) from public.people)::int people,
    (select count(*) from public.people where is_active)::int people_active`);
console.table([identity]);
if (identity.dangling_person > 0) note("ERROR", `${identity.dangling_person} accounts point at a person row that does not exist`);
if (identity.with_person < identity.active_accounts) note("WARN", `${identity.active_accounts - identity.with_person} active accounts have no person link`);

console.log("\n" + "=".repeat(78));
console.log("STAGE 5  CUSTOMER + PROJECT CANONICALISATION");
console.log("=".repeat(78));

const canon = await one(`
  select
    (select count(*) from public.projects)::int projects,
    (select count(*) from public.projects where customer_legal_entity_id is not null)::int with_entity,
    (select count(*) from public.projects p left join crm.legal_entity le on le.id = p.customer_legal_entity_id
       where p.customer_legal_entity_id is not null and le.id is null)::int dangling_entity,
    (select count(*) from public.projects where department is not null)::int with_department,
    (select count(*) from public.projects where owner_person_id is not null)::int with_owner,
    (select count(*) from public.projects p left join public.people pe on pe.id = p.owner_person_id
       where p.owner_person_id is not null and pe.id is null)::int dangling_owner,
    (select count(*) from crm.legal_entity)::int legal_entities`);
console.table([canon]);
if (canon.dangling_entity > 0) note("ERROR", `${canon.dangling_entity} projects reference a legal entity that does not exist`);
if (canon.dangling_owner > 0) note("ERROR", `${canon.dangling_owner} projects reference a person that does not exist`);

console.log("\n" + "=".repeat(78));
console.log("STAGE 6  MASTERDATA RESPONSIBILITY");
console.log("=".repeat(78));

const resp = await q(`
  select role, count(*)::int rows, count(distinct project_id)::int projects, count(distinct person_id)::int people
  from public.project_responsibility group by 1 order by 1`);
console.table(resp);
const respOrphans = await one(`
  select
    (select count(*) from public.project_responsibility r left join public.projects p on p.id=r.project_id where p.id is null)::int bad_project,
    (select count(*) from public.project_responsibility r left join public.people pe on pe.id=r.person_id where pe.id is null)::int bad_person`);
console.table([respOrphans]);
if (respOrphans.bad_project > 0) note("ERROR", `${respOrphans.bad_project} responsibility rows point at a missing project`);
if (respOrphans.bad_person > 0) note("ERROR", `${respOrphans.bad_person} responsibility rows point at a missing person`);

console.log("\n" + "=".repeat(78));
console.log("STAGE 7  VIEWS: do any of them answer from nothing?");
console.log("=".repeat(78));

const views = await q(`
  select schemaname, viewname from pg_views
  where schemaname in ('public','time') order by 1,2`);
for (const v of views) {
  try {
    const r = await one(`select count(*)::int n from ${v.schemaname}.${v.viewname}`);
    console.log(`  ${String(r.n).padStart(6)}  ${v.schemaname}.${v.viewname}`);
  } catch (e) {
    console.log(`   ERROR  ${v.schemaname}.${v.viewname}: ${e.message.slice(0, 60)}`);
    note("ERROR", `view ${v.schemaname}.${v.viewname} does not execute`);
  }
}

console.log("\n" + "=".repeat(78));
console.log("VERDICT");
console.log("=".repeat(78));
if (!problems.length) console.log("no problems found");
for (const p of problems) console.log(`  ${p.severity}  ${p.text}`);

await c.end();
process.exit(problems.some((p) => p.severity === "ERROR") ? 1 : 0);
