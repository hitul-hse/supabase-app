// The detail page will show contract hours next to logged hours. On
// 10110_00358_104_01 the stored logged_hours is 0 while time.entry sums to
// 390.4h. If the page renders the stored column it lies; if it renders the live
// sum it disagrees with every other page. Establish which is right before
// building anything on top of either.
//
// This is the same class as the 54 unmeasured orders (e7cfac3) and matters more
// here, because a detail page is where someone checks a number they distrust.
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

await q("how often does the stored logged_hours disagree with time.entry?", `
  with live as (
    select p.id,
           p.logged_hours as stored,
           round(coalesce(sum(e.duration_seconds),0)/3600.0, 1) as actual
    from public.projects p
    join time.project t on t.hub_project_id = p.id
    left join time.entry e on e.project_id = t.id and e.started_at <= now()
    group by p.id, p.logged_hours)
  select
    count(*) as linked_orders,
    count(*) filter (where stored is null) as stored_is_null,
    count(*) filter (where stored is not null and abs(stored - actual) < 0.05) as agree,
    count(*) filter (where stored is not null and abs(stored - actual) >= 0.05) as disagree,
    round(max(abs(coalesce(stored,0) - actual))::numeric, 1) as worst_gap
  from live`);

await q("the worst disagreements", `
  with live as (
    select p.id, p.name, p.logged_hours as stored,
           round(coalesce(sum(e.duration_seconds),0)/3600.0, 1) as actual
    from public.projects p
    join time.project t on t.hub_project_id = p.id
    left join time.entry e on e.project_id = t.id and e.started_at <= now()
    group by p.id, p.name, p.logged_hours)
  select id, left(name, 40) as name, stored, actual, round((actual - coalesce(stored,0))::numeric,1) as gap
  from live
  where stored is not null and abs(stored - actual) >= 0.05
  order by abs(actual - coalesce(stored,0)) desc limit 10`);

// Which does the existing UI trust? refresh-order-hours.mjs exists, so the
// stored column is a SNAPSHOT that must be refreshed rather than a live value.
await q("is there a fresher signal: does any order carry a refresh timestamp?", `
  select column_name from information_schema.columns
  where table_schema='public' and table_name='projects'
    and (column_name like '%refresh%' or column_name like '%updated%' or column_name like '%_at')`);

console.log("\nVERDICT GUIDE:");
console.log("  If `disagree` is large, the stored column is a stale snapshot and the");
console.log("  detail page must either recompute from time.entry or say when it was");
console.log("  last refreshed. Showing a stale number without saying so is the same");
console.log("  dishonesty as the plausible zeros e7cfac3 removed.");

console.log("\nREAD-ONLY: nothing was written.");
await c.end();
