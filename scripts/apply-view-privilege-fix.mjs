// Apply the view-privilege fix, then prove BOTH halves:
//   - the anonymous leak is closed
//   - authenticated users can still read what they legitimately should
//
// The second half is the one that matters. Turning on security_invoker means
// RLS now actually evaluates, and if a policy is missing or wrong, a page that
// worked yesterday returns nothing today. A security fix that silently breaks a
// feature is not a fix.
import { readFileSync } from "node:fs";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const VIEWS = ["budget_alert_feed", "org_chart_nodes", "user_display_names"];

// Baseline: what each role can see BEFORE, so a regression is visible.
const asRole = async (userId, email, sql) => {
  await c.query("begin");
  try {
    await c.query("select set_config('role','authenticated',true)");
    await c.query("select set_config('request.jwt.claims',$1,true)",
      [JSON.stringify({ sub: userId, role: "authenticated", email })]);
    return (await c.query(sql)).rows[0].n;
  } catch (e) { return `ERR ${e.message.slice(0, 40)}`; }
  finally { await c.query("rollback"); }
};

const users = (await c.query(`
  select aup.user_id, u.email, aup.role_key
  from public.app_user_profile aup join auth.users u on u.id = aup.user_id
  where aup.is_active and aup.person_id is not null
    and aup.role_key in ('exec','employee') order by aup.role_key limit 2`)).rows;

console.log("BEFORE (views run as their postgres owner, RLS bypassed):");
const before = {};
for (const u of users) {
  before[u.email] = {};
  for (const v of VIEWS) before[u.email][v] = await asRole(u.user_id, u.email, `select count(*)::int n from public.${v}`);
  console.log(`  ${u.role_key.padEnd(9)} ${u.email.padEnd(38)} ${VIEWS.map((v) => `${v}=${before[u.email][v]}`).join("  ")}`);
}

await c.query(readFileSync("C:/Supabase/supabase/migrations/20260825141000_views_must_not_bypass_rls.sql", "utf8"));
console.log("\nmigration applied\n");

console.log("AFTER (caller's own RLS decides):");
for (const u of users) {
  const after = {};
  for (const v of VIEWS) after[v] = await asRole(u.user_id, u.email, `select count(*)::int n from public.${v}`);
  console.log(`  ${u.role_key.padEnd(9)} ${u.email.padEnd(38)} ${VIEWS.map((v) => `${v}=${after[v]} (was ${before[u.email][v]})`).join("  ")}`);
}

const opts = await c.query(`
  select c.relname, coalesce(array_to_string(c.reloptions,','),'(none)') opts
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname = any($1)`, [VIEWS]);
console.log("\nview options now:");
console.table(opts.rows);

await c.end();

// The outside view: is the leak closed?
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
console.log("\nunauthenticated probe:");
for (const v of VIEWS) {
  const r = await fetch(`${URL_}/rest/v1/${v}?select=*&limit=1`, { headers: { apikey: ANON } });
  const body = (await r.text()).trim();
  const leaks = r.status === 200 && body.startsWith("[") && body !== "[]";
  console.log(`  ${r.status} ${leaks ? "*** STILL LEAKING ***" : "closed"}  ${v}  ${leaks ? body.slice(0, 80) : ""}`);
}
