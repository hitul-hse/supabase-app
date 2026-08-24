import { readFileSync } from "node:fs";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (label, sql) => {
  try { const r = await c.query(sql); console.log(`\n### ${label}`); console.table(r.rows); }
  catch (e) { console.log(`\n### ${label} FAILED: ${e.message}`); }
};

// The chain an operations user needs: auth user -> person -> projects -> customer.
await q("LINK 1: app_user_profile.person_id -> people.id", `
  select
    count(*) total,
    count(*) filter (where p.person_id is null or p.person_id='') as no_person_id,
    count(*) filter (where p.person_id is not null and pe.id is null) as dangling,
    count(*) filter (where pe.id is not null) as linked_ok
  from public.app_user_profile p
  left join public.people pe on pe.id = p.person_id`);

await q("LINK 2: projects.owner_person_id -> people.id", `
  select
    count(*) total,
    count(*) filter (where pr.owner_person_id is null) as no_owner,
    count(*) filter (where pr.owner_person_id is not null and pe.id is null) as dangling,
    count(*) filter (where pe.id is not null) as linked_ok
  from public.projects pr
  left join public.people pe on pe.id = pr.owner_person_id`);

await q("LINK 3: person_assignments -> people / projects", `
  select
    count(*) total,
    count(*) filter (where pe.id is null) as person_dangling,
    count(*) filter (where pa.project_id is null) as no_project_id,
    count(*) filter (where pa.project_id is not null and pr.id is null) as project_dangling,
    count(*) filter (where pe.id is not null and pr.id is not null) as fully_linked
  from public.person_assignments pa
  left join public.people pe on pe.id = pa.person_id
  left join public.projects pr on pr.id = pa.project_id`);

await q("LINK 4: projects.customer -> crm.legal_entity (by name)", `
  select
    count(*) total,
    count(*) filter (where pr.customer is null or pr.customer='') as no_customer,
    count(*) filter (where le.id is null and pr.customer is not null and pr.customer<>'') as unmatched_name,
    count(*) filter (where le.id is not null) as matched
  from public.projects pr
  left join crm.legal_entity le on lower(btrim(le.legal_name)) = lower(btrim(pr.customer))`);

await q("who is Mathias?", `
  select id, name, role, department, is_active, source, manager_id
  from public.people where name ilike '%mathias%' or id ilike '%mathias%'`);

await q("Mathias user account", `
  select aup.user_id, aup.person_id, aup.role_key, aup.department, aup.display_name, aup.is_active, u.email
  from public.app_user_profile aup
  left join auth.users u on u.id = aup.user_id
  where aup.display_name ilike '%mathias%' or u.email ilike '%mathias%' or aup.person_id ilike '%mathias%'`);

await q("all roles in use", `select role_key, count(*) from public.app_user_profile group by 1 order by 2 desc`);

await c.end();
