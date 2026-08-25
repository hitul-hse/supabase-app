// Two findings from the stray-view sweep, both needing a decision rather than a
// reflex:
//
//  1. netflix_users holds 25,000 rows of demo data in the PRODUCTION public
//     schema, with four views over it. Before proposing deletion, establish
//     whether anything reads it, whether it is exposed to signed-in users, and
//     what it costs.
//  2. person_week_metrics and weekly_billable_trend are empty because
//     weekly_employee_summary is empty. That is the FactorialHR feed - one of
//     the four systems PRODUCT.md says this app aggregates. If it has never
//     synced, a documented integration is simply absent.
import { readFileSync } from "node:fs";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (l, s) => { try { const r = await c.query(s); console.log(`\n### ${l}`); console.table(r.rows.slice(0, 12)); return r.rows; } catch (e) { console.log(`\n### ${l} FAILED: ${e.message.slice(0,110)}`); return []; } };

await q("netflix_users: shape and size on disk", `
  select
    pg_size_pretty(pg_total_relation_size('public.netflix_users')) total_size,
    (select count(*)::int from public.netflix_users) rows`);

await q("netflix_users columns - is any of it personal data?", `
  select column_name, data_type from information_schema.columns
  where table_schema='public' and table_name='netflix_users' order by ordinal_position`);

await q("what policy guards netflix_users?", `
  select p.polname, pg_get_expr(p.polqual, p.polrelid) using_expr
  from pg_policy p join pg_class c on c.oid=p.polrelid
  join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname='netflix_users'`);

// The four views have NO rls and no policies. Views run with the definer's
// rights unless security_invoker is set - so check whether they leak the table.
await q("do the netflix VIEWS bypass the table's RLS? (security_invoker)", `
  select c.relname, coalesce(array_to_string(c.reloptions, ','), '(none)') opts
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname like 'netflix%' and c.relkind='v'`);

console.log("\n=== FACTORIAL FEED ===");

await q("weekly_employee_summary: has it ever been populated?", `
  select count(*)::int rows from public.weekly_employee_summary`);

await q("its shape", `
  select column_name, data_type from information_schema.columns
  where table_schema='public' and table_name='weekly_employee_summary' order by ordinal_position`);

await q("do any people carry a factorial id? (the join key)", `
  select
    count(*)::int people,
    count(factorial_employee_id)::int with_factorial_id
  from public.people`);

await q("crm.factorial_person_reference - the documented mapping table", `
  select count(*)::int rows from crm.factorial_person_reference`);

await c.end();
