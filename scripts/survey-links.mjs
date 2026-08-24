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

await q("row counts", `
  select 'time.customer' t, count(*) n from time.customer
  union all select 'time.project', count(*) from time.project
  union all select 'time.member', count(*) from time.member
  union all select 'public.people', count(*) from public.people
  union all select 'public.projects', count(*) from public.projects
  union all select 'public.person_assignments', count(*) from public.person_assignments
  union all select 'public.app_user_profile', count(*) from public.app_user_profile
  union all select 'crm.legal_entity', count(*) from crm.legal_entity
  order by 1`);

await q("app_user_profile columns", `
  select column_name, data_type from information_schema.columns
  where table_schema='public' and table_name='app_user_profile' order by ordinal_position`);

await q("people columns", `
  select column_name, data_type from information_schema.columns
  where table_schema='public' and table_name='people' order by ordinal_position`);

await q("projects columns", `
  select column_name, data_type from information_schema.columns
  where table_schema='public' and table_name='projects' order by ordinal_position`);

await q("person_assignments columns", `
  select column_name, data_type from information_schema.columns
  where table_schema='public' and table_name='person_assignments' order by ordinal_position`);

await c.end();
