// The new gate found a second anonymous exposure on its first run:
// public.budget_alert_feed returns rows with no session. Unlike netflix_users
// this is REAL business data - budget alerts - so establish exactly what leaks
// before touching it.
//
// It has no anon policy (assertion 1 passed), so the opening is elsewhere. Most
// likely: it is a view WITHOUT security_invoker, which therefore runs with its
// owner's rights and bypasses the RLS on the tables underneath it. That is the
// classic Postgres view-privilege trap and worth confirming precisely.
import { readFileSync } from "node:fs";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (l, s) => { try { const r = await c.query(s); console.log(`\n### ${l}`); console.table(r.rows.slice(0, 12)); return r.rows; } catch (e) { console.log(`\n### ${l} FAILED: ${e.message.slice(0,110)}`); return []; } };

await q("what is budget_alert_feed?", `
  select c.relname, c.relkind, c.relrowsecurity,
         coalesce(array_to_string(c.reloptions, ','), '(no options)') opts,
         pg_get_userbyid(c.relowner) owner
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname='budget_alert_feed'`);

await q("its definition", `
  select definition from pg_views where schemaname='public' and viewname='budget_alert_feed'`);

await q("what does it read, and is THAT protected?", `
  select distinct source_table.relname as reads,
         source_table.relrowsecurity as rls_on,
         (select count(*) from pg_policy p where p.polrelid = source_table.oid)::int policies
  from pg_depend d
  join pg_rewrite r on d.objid = r.oid
  join pg_class dv on r.ev_class = dv.oid
  join pg_class source_table on d.refobjid = source_table.oid
  where dv.relname = 'budget_alert_feed' and source_table.relname <> 'budget_alert_feed'
    and source_table.relkind in ('r','v')`);

await q("who is granted select on it?", `
  select grantee, privilege_type
  from information_schema.role_table_grants
  where table_schema='public' and table_name='budget_alert_feed'
  order by grantee`);

// How many other views in public lack security_invoker? Same trap, same class.
await q("OTHER views without security_invoker (same trap)", `
  select c.relname,
         coalesce(array_to_string(c.reloptions, ','), '(none)') opts
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind='v'
    and (c.reloptions is null or not (array_to_string(c.reloptions,',') like '%security_invoker=true%'))
  order by 1`);

await q("what does the leak actually expose?", `
  select * from public.budget_alert_feed limit 3`);

await c.end();
