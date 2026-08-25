// The timer writes to public.timesheet_entries. Earlier work established that
// this table was mockup data (28 rows, all belonging to an inactive seed
// person) and that the REAL time data lives in time.entry, 5,351 rows from
// TrackingTime and calendar sync.
//
// If that is right, the timer bar is not just unused - it writes into a table
// that no reporting surface reads, so an hour logged with it would never appear
// in utilisation, the dashboards, or any customer's billable total. Check.
import { readFileSync } from "node:fs";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (l, s) => { try { const r = await c.query(s); console.log(`\n### ${l}`); console.table(r.rows.slice(0, 12)); return r.rows; } catch (e) { console.log(`\n### ${l} FAILED: ${e.message.slice(0,110)}`); return []; } };

await q("what is in public.timesheet_entries now", `
  select count(*)::int rows,
         count(distinct person_id)::int people,
         min(week_start) first_week, max(week_start) last_week
  from public.timesheet_entries`);

await q("the single 'manual' time.entry - did the timer write it?", `
  select e.id, e.source_system, e.started_at, e.ended_at, m.display_name, m.hub_person_id
  from time.entry e join time.member m on m.id = e.member_id
  where e.source_system='manual'`);

// Does anything downstream read timesheet_entries? These are the views and
// tables that feed utilisation and the dashboards.
await q("views/matviews whose definition mentions timesheet_entries", `
  select schemaname, viewname
  from pg_views
  where definition ilike '%timesheet_entries%'
  union all
  select schemaname, matviewname
  from pg_matviews where definition ilike '%timesheet_entries%'`);

await q("views that read time.entry (the real source)", `
  select schemaname, viewname from pg_views where definition ilike '%time.entry%' or definition ilike '%from entry%'`);

await c.end();
