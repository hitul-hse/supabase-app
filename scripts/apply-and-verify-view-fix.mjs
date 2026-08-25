// Apply the view migration and prove the behaviour changed: zeros become NULL,
// and is_over_budget stops asserting false. Also confirm RLS still filters, so
// the fix does not quietly widen access.
import { readFileSync } from "node:fs";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const before = await c.query(`
  select
    count(*)::int rows,
    count(*) filter (where hours_logged = 0)::int zero_hours,
    count(*) filter (where hours_logged is null)::int null_hours,
    count(*) filter (where is_over_budget = false)::int asserts_within_budget,
    count(*) filter (where is_over_budget is null)::int admits_unknown
  from public.project_budget_status`);
console.log("BEFORE  project_budget_status:");
console.table(before.rows);

const sql = readFileSync("C:/Supabase/supabase/migrations/20260825090000_views_say_unknown_not_zero.sql", "utf8");
await c.query(sql);
console.log("\nmigration applied\n");

const after = await c.query(`
  select
    count(*)::int rows,
    count(*) filter (where hours_logged = 0)::int zero_hours,
    count(*) filter (where hours_logged is null)::int null_hours,
    count(*) filter (where is_over_budget = false)::int asserts_within_budget,
    count(*) filter (where is_over_budget is null)::int admits_unknown
  from public.project_budget_status`);
console.log("AFTER   project_budget_status:");
console.table(after.rows);

const bv = await c.query(`
  select count(*)::int rows,
         count(*) filter (where billable_hours_logged = 0)::int zero,
         count(*) filter (where billable_hours_logged is null)::int null_
  from public.billable_value_by_person`);
console.log("AFTER   billable_value_by_person:");
console.table(bv.rows);

// security_invoker must survive the CREATE OR REPLACE, or RLS stops filtering.
const opts = await c.query(`
  select c.relname, c.reloptions
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname in ('billable_value_by_person','project_budget_status')`);
console.log("view options (security_invoker must be true):");
console.table(opts.rows);

// And prove it with a real non-exec user.
const emp = (await c.query(`
  select aup.user_id, u.email from public.app_user_profile aup
  join auth.users u on u.id=aup.user_id
  where aup.role_key='employee' and aup.is_active and aup.person_id is not null limit 1`)).rows[0];
await c.query("begin");
try {
  await c.query("select set_config('role','authenticated',true)");
  await c.query("select set_config('request.jwt.claims',$1,true)",
    [JSON.stringify({ sub: emp.user_id, role: "authenticated", email: emp.email })]);
  const r = await c.query("select count(*)::int n from public.project_budget_status");
  const all = 231;
  console.log(`\nas ${emp.email} (employee): ${r.rows[0].n} of ${all} projects visible -> RLS ${r.rows[0].n < all ? "still filtering" : "NOT FILTERING"}`);
} finally { await c.query("rollback"); }

await c.end();
