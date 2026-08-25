// I over-corrected, and the code says so plainly.
//
// hse.ts documents both views as DELIBERATE RLS bypasses, with reasons:
//
//   org_chart_nodes    "deliberately bypasses can_view_person() so every
//                       employee sees the whole reporting line, not just their
//                       own row (see supabase/schema.sql for why that's safe:
//                       only identity/reporting-line columns are exposed)"
//
//   user_display_names "a deliberate RLS-bypass view ... app_user_profile's own
//                       policy only lets you read your own row, so without it
//                       you could see that a comment exists but not who wrote
//                       it unless you happened to be exec"
//
// Both are the intended design: an org chart showing only yourself is not an
// org chart, and a comment thread where every author is "Team member" is worse
// than useless. My change broke both for everyone except exec.
//
// budget_alert_feed is the genuine finding and stays fixed: it exposed customer
// names, staff names, commercial overruns and staff email addresses to
// ANONYMOUS callers, which no comment anywhere claims was intended.
//
// So: keep the real fix, revert the two I got wrong, and verify the columns
// those views expose really are as narrow as the comment claims.
import { readFileSync } from "node:fs";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

// First: is the "only identity/reporting-line columns" claim actually true?
// If these views expose salary or rates, the bypass would NOT be safe and the
// comment would be wrong rather than my change.
for (const v of ["org_chart_nodes", "user_display_names"]) {
  const cols = (await c.query(`
    select column_name, data_type from information_schema.columns
    where table_schema='public' and table_name=$1 order by ordinal_position`, [v])).rows;
  console.log(`\n${v} exposes:`);
  console.log("  " + cols.map((x) => x.column_name).join(", "));
  const sensitive = cols.filter((x) => /rate|salary|cost|billable|eur|holiday|certificate/i.test(x.column_name));
  console.log(`  sensitive columns: ${sensitive.length ? sensitive.map((x) => x.column_name).join(", ") : "none"}`);
}

// Revert the two deliberate ones, keep the anon grant revoked on all three.
await c.query(`
  alter view public.org_chart_nodes set (security_invoker = false);
  alter view public.user_display_names set (security_invoker = false);
`);

// The anon revoke stays regardless - nothing should be reachable without a
// session, deliberate bypass or not. A bypass is for SIGNED-IN users.
await c.query(`
  revoke all on public.org_chart_nodes from anon;
  revoke all on public.user_display_names from anon;
`);

console.log("\nreverted the two deliberate bypasses; anon grants stay revoked\n");

const users = (await c.query(`
  select aup.user_id, u.email, aup.role_key
  from public.app_user_profile aup join auth.users u on u.id=aup.user_id
  where aup.is_active and aup.person_id is not null order by aup.role_key`)).rows;

const seen = new Set();
console.log("per role, after the revert:");
for (const u of users) {
  if (seen.has(u.role_key)) continue;
  seen.add(u.role_key);
  await c.query("begin");
  try {
    await c.query("select set_config('role','authenticated',true)");
    await c.query("select set_config('request.jwt.claims',$1,true)",
      [JSON.stringify({ sub: u.user_id, role: "authenticated", email: u.email })]);
    const chart = (await c.query("select count(*)::int n from public.org_chart_nodes")).rows[0].n;
    const names = (await c.query("select count(*)::int n from public.user_display_names")).rows[0].n;
    const alerts = (await c.query("select count(*)::int n from public.budget_alert_feed")).rows[0].n;
    console.log(`  ${u.role_key.padEnd(15)} org_chart=${String(chart).padStart(3)}  display_names=${String(names).padStart(3)}  budget_alerts=${String(alerts).padStart(3)}`);
  } finally { await c.query("rollback"); }
}

await c.end();

const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
console.log("\nanonymous probe (all three must stay closed):");
for (const v of ["budget_alert_feed", "org_chart_nodes", "user_display_names"]) {
  const r = await fetch(`${URL_}/rest/v1/${v}?select=*&limit=1`, { headers: { apikey: ANON } });
  const body = (await r.text()).trim();
  const leaks = r.status === 200 && body.startsWith("[") && body !== "[]";
  console.log(`  ${r.status} ${leaks ? "*** LEAKING ***" : "closed"}  ${v}`);
}
