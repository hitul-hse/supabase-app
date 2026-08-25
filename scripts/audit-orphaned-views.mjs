// public.timesheet_entries is now empty (its 28 mockup rows were deleted), yet
// two views still read from it: billable_value_by_person and
// project_budget_status. Find out what they actually return now, and whether
// anything a user sees depends on them.
//
// The failure mode to look for is a silent zero: a view that returns 0 rows, or
// rows whose numbers are all 0, feeding a page that then reports "0 h billable"
// as though it were a fact rather than an absence.
import { readFileSync } from "node:fs";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (l, s) => { try { const r = await c.query(s); console.log(`\n### ${l}`); console.table(r.rows.slice(0, 14)); return r.rows; } catch (e) { console.log(`\n### ${l} FAILED: ${e.message.slice(0,120)}`); return []; } };

await q("the two views: how many rows do they return now?", `
  select 'billable_value_by_person' v, count(*)::int rows from public.billable_value_by_person
  union all
  select 'project_budget_status', count(*)::int from public.project_budget_status`);

await q("billable_value_by_person - sample", `select * from public.billable_value_by_person limit 8`);

await q("project_budget_status - sample", `select * from public.project_budget_status limit 8`);

// Are the numbers actually zero, or do they come from elsewhere?
await q("project_budget_status: are the hour columns all zero?", `
  select
    count(*)::int rows,
    count(*) filter (where coalesce(logged_hours,0) = 0)::int zero_logged,
    count(*) filter (where coalesce(logged_hours,0) > 0)::int nonzero_logged
  from public.project_budget_status`);

await q("full definitions - which parts read timesheet_entries", `
  select viewname, definition from pg_views
  where schemaname='public' and viewname in ('billable_value_by_person','project_budget_status')`);

await c.end();
