// Back the demo data up before dropping it, then apply the migration and prove
// the exposure is closed.
//
// The backup is not because the data is valuable - it is streaming-service demo
// rows - but because "we deleted 25,000 rows from production" should never be an
// irreversible act taken on my own judgement. If it turns out somebody wanted
// it, it is one file away.
import { readFileSync, writeFileSync } from "node:fs";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

// 1. Backup as a re-runnable SQL file.
const rows = (await c.query("select * from public.netflix_users order by user_id")).rows;
const cols = Object.keys(rows[0] ?? {});
const esc = (v) => (v === null ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

const chunks = [];
for (let i = 0; i < rows.length; i += 500) {
  const slice = rows.slice(i, i + 500);
  chunks.push(
    `insert into public.netflix_users (${cols.join(", ")}) values\n` +
    slice.map((r) => `  (${cols.map((k) => esc(r[k])).join(", ")})`).join(",\n") + ";",
  );
}

const backup = [
  "-- Backup of public.netflix_users, taken before dropping it from production.",
  "-- Streaming-service demo data, 25,000 rows, kept only so the drop is reversible.",
  "-- Restore: create the table, then run these inserts.",
  "",
  "create table if not exists public.netflix_users (",
  "  user_id bigint primary key,",
  "  name text, age smallint, country text, subscription_type text,",
  "  watch_time_hours numeric, favorite_genre text, last_login date",
  ");",
  "",
  ...chunks,
].join("\n");

writeFileSync("C:/Supabase/docs/netflix-demo-data-backup-2026-08-25.sql", backup, "utf8");
console.log(`backed up ${rows.length} rows -> docs/netflix-demo-data-backup-2026-08-25.sql`);

// 2. Apply the drop.
const migration = readFileSync("C:/Supabase/supabase/migrations/20260825140000_drop_netflix_demo_data.sql", "utf8");
await c.query(migration);
console.log("migration applied");

// 3. Prove it is gone from the database.
const left = await c.query(`
  select table_name from information_schema.tables
  where table_schema='public' and table_name like 'netflix%'`);
console.log(`netflix objects remaining in the schema: ${left.rows.length}`);

await c.end();

// 4. Prove the anonymous exposure is closed, from outside.
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
console.log("\nunauthenticated probe after the drop:");
for (const t of ["netflix_users", "netflix_overview", "netflix_country_stats", "netflix_genre_stats", "netflix_subscription_stats"]) {
  const r = await fetch(`${URL_}/rest/v1/${t}?select=*&limit=1`, { headers: { apikey: ANON } });
  const body = (await r.text()).slice(0, 90).replace(/\s+/g, " ");
  const gone = r.status === 404 || /does not exist|Could not find/i.test(body);
  console.log(`  ${r.status} ${gone ? "GONE" : "STILL THERE"}  ${t}  ${gone ? "" : body}`);
}

// 5. And that the real tables are untouched.
console.log("\ncontrol - business data still intact and still private:");
const c2 = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c2.connect();
for (const t of ["public.projects", "public.people", "time.entry"]) {
  const n = (await c2.query(`select count(*)::int n from ${t}`)).rows[0].n;
  console.log(`  ${String(n).padStart(6)} rows  ${t}`);
}
await c2.end();
