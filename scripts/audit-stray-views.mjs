// Two oddities from the pipeline report worth chasing before assigning anyone:
//
//  1. FOUR netflix_* views in an HSE consulting app. Almost certainly leftovers
//     from a tutorial or a template, sitting in the same schema as real business
//     data. Harmless if unused, but they are in `public`, so PostgREST exposes
//     them to any authenticated caller unless RLS says otherwise.
//  2. Two views return ZERO rows: person_week_metrics and weekly_billable_trend.
//     Either they are dead, or they are broken and something upstream is showing
//     blanks because of it.
import { readFileSync } from "node:fs";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (l, s) => { try { const r = await c.query(s); console.log(`\n### ${l}`); console.table(r.rows.slice(0, 14)); return r.rows; } catch (e) { console.log(`\n### ${l} FAILED: ${e.message.slice(0,120)}`); return []; } };

await q("netflix_* objects: what are they and what do they read?", `
  select table_name, table_type from information_schema.tables
  where table_schema='public' and table_name like 'netflix%'
  order by 1`);

await q("what do the netflix views depend on?", `
  select distinct dependent_view.relname as view, source_table.relname as reads
  from pg_depend d
  join pg_rewrite r on d.objid = r.oid
  join pg_class dependent_view on r.ev_class = dependent_view.oid
  join pg_class source_table on d.refobjid = source_table.oid
  where dependent_view.relname like 'netflix%' and source_table.relname <> dependent_view.relname
  order by 1,2`);

await q("is netflix_users real data or a demo table?", `
  select count(*)::int rows from public.netflix_users`);

await q("RLS on the netflix objects - can any signed-in user read them?", `
  select c.relname, c.relrowsecurity,
         (select count(*) from pg_policy p where p.polrelid = c.oid)::int policies
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname like 'netflix%'`);

// The two empty views.
await q("person_week_metrics definition", `
  select definition from pg_views where schemaname='public' and viewname='person_week_metrics'`);

await q("weekly_billable_trend definition", `
  select definition from pg_views where schemaname='public' and viewname='weekly_billable_trend'`);

// Do those two read a table that is empty, the way the budget views did?
await q("do the empty views depend on public.timesheet_entries (the empty table)?", `
  select distinct dependent_view.relname as view, source_table.relname as reads
  from pg_depend d
  join pg_rewrite r on d.objid = r.oid
  join pg_class dependent_view on r.ev_class = dependent_view.oid
  join pg_class source_table on d.refobjid = source_table.oid
  where dependent_view.relname in ('person_week_metrics','weekly_billable_trend')
    and source_table.relname <> dependent_view.relname
  order by 1,2`);

await c.end();
