// What already exists for "team lead reassigns the responsible person, and it
// shows up in that person's My Work"?
//
// A two-person-approval flow was built in 20260823090000. Before designing
// anything, establish which parts are live and which are missing, because the
// wrong assumption here means rebuilding something that works.
//
// The chain the user described:
//   1. click a project -> see services + who is responsible for what
//   2. team lead reassigns the responsible person (e.g. sick leave)
//   3. that person sees the project in their My Work
// READ-ONLY.
import { readFileSync } from "node:fs";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (label, sql) => {
  try { const r = await c.query(sql); console.log(`\n### ${label}`); console.table(r.rows); return r.rows; }
  catch (e) { console.log(`\n### ${label} FAILED: ${e.message}`); return null; }
};

console.log("=== 1. Is the change-control machinery actually deployed? ===");

await q("the change-control tables and functions", `
  select 'table' as kind, table_name as name
    from information_schema.tables
   where table_schema = 'public' and table_name like 'project_change%'
  union all
  select 'function', routine_name
    from information_schema.routines
   where routine_schema = 'public'
     and routine_name in ('request_project_responsible_change','decide_project_responsible_change')
  order by 1, 2`);

await q("has anyone ever used it?", `
  select status, count(*) as requests
  from public.project_change_request group by status order by 1`);

console.log("\n=== 2. What does a project row actually carry for the detail view? ===");

await q("columns available on public.projects", `
  select column_name, data_type
  from information_schema.columns
  where table_schema = 'public' and table_name = 'projects'
  order by ordinal_position`);

console.log("\n=== 3. Can we tell what SERVICE a project is? ===");

// The user asked "what kinda services that customer is asking". Services live
// in time.service, reachable only via time.project.hub_project_id per ADR-001.
await q("service coverage across the order book", `
  select
    count(*) as projects,
    count(*) filter (where tp.hub_project_id is not null) as linked_to_trackingtime,
    count(*) filter (where s.name is not null) as with_a_named_service
  from public.projects p
  left join time.project tp on tp.hub_project_id = p.id
  left join time.service s on s.id = tp.service_id`);

await q("the services actually in use", `
  select s.name as service, count(distinct p.id) as projects
  from public.projects p
  join time.project tp on tp.hub_project_id = p.id
  join time.service s on s.id = tp.service_id
  group by s.name order by 2 desc`);

console.log("\n=== 4. Does a person have the capacity signal a lead would need? ===");

await q("what we know about capacity per person", `
  select pe.name,
         (select count(*) from public.projects pr where pr.owner_person_id = pe.id) as owns,
         (select coalesce(round(sum(pr.contract_hours)::numeric,1),0) from public.projects pr where pr.owner_person_id = pe.id) as contract_hours,
         m.weekly_hours as tt_weekly_hours,
         m.is_archived
  from public.people pe
  left join time.member m on m.hub_person_id = pe.id
  where exists (select 1 from public.projects pr where pr.owner_person_id = pe.id)
  order by contract_hours desc`);

console.log("\n=== 5. THE CRITICAL GAP: is leave visible at all? ===");

await q("leave_requests shape and volume", `
  select
    (select count(*) from public.leave_requests) as rows,
    (select count(*) from public.leave_requests where status = 'approved') as approved,
    (select count(*) from public.leave_requests
      where status = 'approved' and current_date between start_date and end_date) as absent_today`);

await q("is anyone absent right now, and do they own projects?", `
  select pe.name, lr.start_date, lr.end_date, lr.status,
         (select count(*) from public.projects pr where pr.owner_person_id = pe.id) as owns_projects
  from public.leave_requests lr
  join public.people pe on pe.id = lr.person_id
  where lr.status = 'approved' and lr.end_date >= current_date
  order by lr.start_date`);

console.log("\nREAD-ONLY: nothing was written.");
await c.end();
