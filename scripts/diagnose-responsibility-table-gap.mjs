// 28 projects carry a share_percent = 0 / sort_order = 1 assignee in
// person_assignments with NO corresponding role='replacement' row in
// project_responsibility (168 vs 140). Which is right?
//
// This matters because the two tables now feed different things:
// management-employee-ownership reads person_assignments, while
// management-service-overview and my-work read project_responsibility. If the
// 28 are real, one page under-reports cover; if they are noise, the other
// over-reports it.
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

const gap = await q("the 28: share=0 assignee but no replacement role row", `
  with pa as (
    select pa.project_id, pa.person_id
    from public.person_assignments pa
    where pa.share_percent = 0 and pa.sort_order = 1 and pa.project_id is not null),
  pr as (
    select project_id from public.project_responsibility where role = 'replacement')
  select pa.project_id, pe.name as named_cover, p.name as project_name, p.status,
         (select pe2.name from public.people pe2 where pe2.id = p.owner_person_id) as responsible,
         exists (select 1 from public.project_responsibility r
                  where r.project_id = pa.project_id and r.role = 'responsible') as has_responsible_role_row
  from pa
  left join pr on pr.project_id = pa.project_id
  left join public.projects p on p.id = pa.project_id
  left join public.people pe on pe.id = pa.person_id
  where pr.project_id is null
  order by pa.project_id`);

// Key question: do these 28 projects have ANY project_responsibility rows at
// all? If the whole project is absent from the role table, the gap is "the role
// table was never populated for these", not "the replacement was rejected".
await q("do the 28 appear in project_responsibility at all?", `
  with pa as (
    select distinct pa.project_id
    from public.person_assignments pa
    where pa.share_percent = 0 and pa.sort_order = 1 and pa.project_id is not null),
  pr as (
    select project_id from public.project_responsibility where role = 'replacement')
  select
    count(*) as gap_projects,
    count(*) filter (where exists (select 1 from public.project_responsibility r where r.project_id = pa.project_id)) as have_some_role_row,
    count(*) filter (where not exists (select 1 from public.project_responsibility r where r.project_id = pa.project_id)) as absent_from_role_table_entirely
  from pa
  left join pr on pr.project_id = pa.project_id
  where pr.project_id is null`);

// And the reverse sanity check: is the role table simply a subset written by a
// later, narrower import run?
await q("row counts and the widest project set each table knows", `
  select
    (select count(distinct project_id) from public.person_assignments where project_id is not null) as projects_in_assignments,
    (select count(distinct project_id) from public.project_responsibility) as projects_in_responsibility,
    (select count(*) from public.projects) as projects_total`);

if (gap && gap.length) {
  const selfCover = gap.filter((r) => r.named_cover && r.responsible && r.named_cover === r.responsible);
  console.log(`\nOf the ${gap.length} gap projects, ${selfCover.length} name the responsible person as the cover.`);
  console.log("If the role table deliberately dropped self-cover rows, that explains the gap");
  console.log("and person_assignments is the one carrying noise.");
}

console.log("\nREAD-ONLY: nothing was written.");
await c.end();
