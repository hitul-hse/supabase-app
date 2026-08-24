import { readFileSync } from "node:fs";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (label, sql, params) => {
  try { const r = await c.query(sql, params); console.log(`\n### ${label}  -> ${r.rows.length} rows`); console.table(r.rows.slice(0, 12)); return r.rows; }
  catch (e) { console.log(`\n### ${label} FAILED: ${e.message}`); return []; }
};

const PERSON = "md-mathias";

await q("A. projects Mathias OWNS", `
  select id, name, customer, status, department, budget_hours
  from public.projects where owner_person_id = $1`, [PERSON]);

await q("B. projects Mathias is ASSIGNED to", `
  select pa.project_id, pr.name, pr.customer, pa.logged_hours, pa.share_percent
  from public.person_assignments pa
  left join public.projects pr on pr.id = pa.project_id
  where pa.person_id = $1`, [PERSON]);

await q("C. distinct customers reachable for Mathias", `
  select distinct coalesce(pr.customer,'(none)') customer
  from public.projects pr
  where pr.owner_person_id = $1
     or pr.id in (select project_id from public.person_assignments where person_id = $1)
  order by 1`, [PERSON]);

// The masterdata sheet names a "responsible" and a "replacement" per order.
// Check whether those names ever reached the database.
await q("D. masterdata-style responsibility columns anywhere?", `
  select table_schema, table_name, column_name
  from information_schema.columns
  where column_name ~* 'responsib|replacement|vertretung|betreuer'
  order by 1,2,3`);

await q("E. time.project -> customer link health", `
  select
    count(*) total,
    count(*) filter (where customer_id is null) as no_customer,
    count(*) filter (where customer_id is not null) as linked
  from time.project`);

await q("F. time.member vs public.people", `
  select
    (select count(*) from time.member) time_members,
    (select count(*) from public.people) people_rows,
    (select count(*) from time.member m join public.people p on lower(p.name)=lower(m.name)) name_matches`);

await q("G. RLS enabled on the tables ops users read", `
  select c.relname, c.relrowsecurity
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname in
    ('projects','people','person_assignments','app_user_profile','timesheet_entries')
  order by 1`);

await c.end();
