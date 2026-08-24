// Prove the impact of the permission drift rather than infer it. Six RLS
// policies call app_user_has_permission() with keys that have no row in
// app_role_permission. The function is `select exists(...)`, so it returns
// FALSE for everyone, including exec. If those tables carry data, the feature
// is dark for the entire company.
import { readFileSync } from "node:fs";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const cols = await c.query(`
  select table_name, string_agg(column_name, ', ' order by ordinal_position) cols
  from information_schema.columns
  where table_schema='public' and table_name in ('app_permission','app_role','app_role_permission')
  group by 1`);
console.log("### catalogue table shapes");
console.table(cols.rows);

const perms = await c.query(`select * from public.app_permission limit 3`);
console.log("\n### app_permission sample");
console.table(perms.rows);

// Which keys are actually granted to anyone?
const granted = await c.query(`
  select permission_key, count(*)::int roles
  from public.app_role_permission group by 1 order by 1`);
console.log(`\n### keys granted to at least one role: ${granted.rows.length}`);
console.log(granted.rows.map((r) => r.permission_key).join("\n"));

const MISSING = ["projects:contracts:read", "projects:contracts:write", "projects:alerts:read",
  "projects:alerts:acknowledge", "admin:profiles:read", "admin:profiles:write", "admin:entries:write"];
const grantedKeys = new Set(granted.rows.map((r) => r.permission_key));
console.log(`\n### the 7 keys the app code declares:`);
for (const k of MISSING) console.log(`   ${grantedKeys.has(k) ? "granted" : "NOT GRANTED TO ANY ROLE"}  ${k}`);

// Does the affected data exist? A dark feature over an empty table is a latent
// bug; over a populated one it is a live outage.
console.log("\n### is there data behind the locked policies?");
for (const [label, sql] of [
  ["time.project_contract_period", "select count(*)::int n from time.project_contract_period"],
  ["public.overbooking_alert", "select count(*)::int n from public.overbooking_alert"],
  ["public.app_user_profile", "select count(*)::int n from public.app_user_profile"],
]) {
  const r = await c.query(sql);
  console.log(`   ${String(r.rows[0].n).padStart(5)} rows  ${label}`);
}

// The decisive test: as a real exec, can they read contract periods and alerts?
const execUser = (await c.query(`
  select aup.user_id, u.email from public.app_user_profile aup
  join auth.users u on u.id = aup.user_id
  where aup.role_key='exec' and aup.is_active limit 1`)).rows[0];

console.log(`\n### as a real exec (${execUser.email}), through RLS:`);
for (const [label, sql] of [
  ["time.project_contract_period", "select count(*)::int n from time.project_contract_period"],
  ["public.overbooking_alert", "select count(*)::int n from public.overbooking_alert"],
  ["public.app_user_profile", "select count(*)::int n from public.app_user_profile"],
]) {
  await c.query("begin");
  try {
    await c.query("select set_config('role','authenticated',true)");
    await c.query("select set_config('request.jwt.claims',$1,true)",
      [JSON.stringify({ sub: execUser.user_id, role: "authenticated", email: execUser.email })]);
    const r = await c.query(sql);
    console.log(`   ${String(r.rows[0].n).padStart(5)} visible  ${label}`);
  } catch (e) {
    console.log(`   ERROR ${label}: ${e.message.slice(0, 70)}`);
  } finally { await c.query("rollback"); }
}

await c.end();
