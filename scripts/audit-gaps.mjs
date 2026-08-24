import { readFileSync } from "node:fs";
import pg from "pg";
const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));
const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (l, s, p) => { try { const r = await c.query(s, p); console.log(`\n### ${l} (${r.rows.length})`); console.table(r.rows.slice(0,25)); return r.rows; } catch (e) { console.log(`\n### ${l} FAILED: ${e.message}`); return []; } };

await q("UNLINKED users (see nothing)", `
  select u.email, aup.role_key, aup.department, aup.person_id, aup.is_active
  from public.app_user_profile aup join auth.users u on u.id=aup.user_id
  where aup.person_id is null or aup.person_id=''
  order by aup.role_key, u.email`);

await q("people rows NOT claimed by any user", `
  select pe.id, pe.name, pe.role, pe.department, pe.source, pe.is_active
  from public.people pe
  where not exists (select 1 from public.app_user_profile a where a.person_id = pe.id)
  order by pe.name`);

await q("can_view_project definition", `
  select pg_get_functiondef(p.oid) def from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where p.proname='can_view_project' limit 1`);

await q("timesheet_entries shape + why Mathias sees 0", `
  select column_name, data_type from information_schema.columns
  where table_schema='public' and table_name='timesheet_entries' order by ordinal_position`);

await q("timesheet_entries total", `select count(*)::int n from public.timesheet_entries`);

await c.end();
