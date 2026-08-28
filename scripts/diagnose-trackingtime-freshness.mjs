// "Why is TrackingTime data not live?" -- measure the staleness before
// explaining it. The answer decides whether this is a broken sync, a sync that
// is not scheduled, or a sync nobody has run today.
//
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

console.log(`Now: ${new Date().toISOString()}\n`);

// How fresh is each time.* table? created_at is when WE ingested the row;
// started_at is when the work happened. Both matter and they answer different
// questions: a stale created_at means the sync has not run, a stale started_at
// means nobody logged time.
await q("ingestion freshness per table (created_at = when we stored it)", `
  select 'entry' as tbl, count(*) as rows,
         max(created_at)::timestamptz(0) as last_ingested,
         round(extract(epoch from (now() - max(created_at)))/3600.0, 1) as hours_stale
  from time.entry
  union all
  select 'project', count(*), max(created_at)::timestamptz(0),
         round(extract(epoch from (now() - max(created_at)))/3600.0, 1) from time.project
  union all
  select 'member', count(*), max(created_at)::timestamptz(0),
         round(extract(epoch from (now() - max(created_at)))/3600.0, 1) from time.member`);

await q("work freshness (started_at = when the work happened)", `
  select
    max(started_at)::timestamptz(0) as latest_entry,
    round(extract(epoch from (now() - max(started_at)))/3600.0, 1) as hours_since_latest,
    count(*) filter (where started_at >= now() - interval '24 hours' and started_at <= now()) as entries_last_24h,
    count(*) filter (where started_at >= now() - interval '7 days' and started_at <= now()) as entries_last_7d,
    count(*) filter (where started_at > now()) as future_dated
  from time.entry`);

// Was the latest work ingested promptly, or did it sit? This separates "nobody
// logged time" from "we did not fetch it".
await q("lag between doing the work and us storing it, last 30 days", `
  select
    count(*) as entries,
    round(avg(extract(epoch from (created_at - started_at))/3600.0)::numeric, 1) as avg_lag_hours,
    round(min(extract(epoch from (created_at - started_at))/3600.0)::numeric, 1) as min_lag_hours,
    round(max(extract(epoch from (created_at - started_at))/3600.0)::numeric, 1) as max_lag_hours
  from time.entry
  where started_at >= now() - interval '30 days' and started_at <= now()`);

// Ingestion history: if every row shares a handful of created_at values, the
// data arrives in BATCHES from a manual run rather than continuously.
await q("distinct ingestion moments (batch runs look like few, large groups)", `
  select date_trunc('hour', created_at)::timestamptz(0) as ingested_hour,
         count(*) as rows_stored
  from time.entry
  group by 1 order by 1 desc limit 12`);

// Is there any raw landing zone with its own timestamps?
await q("does a raw schema record when a sync last ran?", `
  select table_schema, table_name
  from information_schema.tables
  where table_schema in ('raw','time')
  order by 1,2`);

console.log("\nREAD-ONLY: nothing written.");
await c.end();
