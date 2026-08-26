// Which read paths still refuse to show the replacement, and is there a
// canonical project_responsibility table that already carries the roles?
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

await q("project_responsibility roles", `
  select role, count(*) as rows, count(distinct project_id) as projects, count(distinct person_id) as people
  from public.project_responsibility group by role order by role`);

await q("does it agree with person_assignments?", `
  with pa_repl as (
    select distinct project_id from public.person_assignments
    where share_percent = 0 and sort_order = 1 and project_id is not null),
  pr_repl as (
    select distinct project_id from public.project_responsibility where role = 'replacement')
  select
    (select count(*) from pa_repl) as person_assignments_says,
    (select count(*) from pr_repl) as project_responsibility_says,
    (select count(*) from pa_repl a join pr_repl b using (project_id)) as agree,
    (select count(*) from pa_repl a left join pr_repl b using (project_id) where b.project_id is null) as only_in_assignments,
    (select count(*) from pr_repl b left join pa_repl a using (project_id) where a.project_id is null) as only_in_responsibility`);

await q("open projects lacking a named replacement (the real number)", `
  with repl as (
    select distinct project_id from public.project_responsibility where role = 'replacement')
  select
    count(*) filter (where pr.status is null or pr.status not ilike '%abgeschlossen%') as open_projects,
    count(*) filter (where (pr.status is null or pr.status not ilike '%abgeschlossen%') and r.project_id is null) as open_without_replacement
  from public.projects pr
  left join repl r on r.project_id = pr.id`);

console.log("\nREAD-ONLY: nothing was written.");
await c.end();
