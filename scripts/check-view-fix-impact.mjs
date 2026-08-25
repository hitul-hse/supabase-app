// The privilege fix changed what employees can see: org_chart_nodes went 26 -> 1
// and user_display_names 20 -> 1. That is RLS finally being enforced, but it
// raises the real question: is that CORRECT, or has a page just gone blank?
//
// An org chart that shows you only yourself is not an org chart. Find out which
// pages read these, what an employee is supposed to see, and whether the
// underlying policy is right or merely restrictive.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const walk = (d, out = []) => {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) { if (!/node_modules|\.next/.test(n)) walk(p, out); }
    else out.push(p);
  }
  return out;
};

console.log("=== who reads these views in the app? ===");
const files = walk("C:/Supabase/src").filter((f) => /\.(ts|tsx)$/.test(f) && !/database\.types/.test(f));
for (const v of ["budget_alert_feed", "org_chart_nodes", "user_display_names"]) {
  const hits = [];
  for (const f of files) {
    const s = readFileSync(f, "utf8");
    if (s.includes(v)) s.split("\n").forEach((l, i) => { if (l.includes(v)) hits.push(`${f.replace("C:/Supabase/", "")}:${i + 1}`); });
  }
  console.log(`  ${v}: ${hits.length ? hits.join(", ") : "(no app code reads it)"}`);
}

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));
const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

console.log("\n=== what the underlying tables allow ===");
const pol = await c.query(`
  select c.relname, p.polname,
         case p.polcmd when 'r' then 'SELECT' when '*' then 'ALL' else p.polcmd::text end cmd,
         pg_get_expr(p.polqual, p.polrelid) using_expr
  from pg_policy p join pg_class c on c.oid=p.polrelid
  join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname in ('people','app_user_profile','overbooking_alert')
  order by 1,2`);
for (const r of pol.rows) console.log(`  ${r.relname}.${r.polname} [${r.cmd}]\n      ${String(r.using_expr).slice(0, 150)}`);

console.log("\n=== per role, through RLS, on the SOURCE tables ===");
const users = (await c.query(`
  select aup.user_id, u.email, aup.role_key
  from public.app_user_profile aup join auth.users u on u.id=aup.user_id
  where aup.is_active and aup.person_id is not null order by aup.role_key`)).rows;

const seen = new Set();
for (const u of users) {
  if (seen.has(u.role_key)) continue;
  seen.add(u.role_key);
  await c.query("begin");
  try {
    await c.query("select set_config('role','authenticated',true)");
    await c.query("select set_config('request.jwt.claims',$1,true)",
      [JSON.stringify({ sub: u.user_id, role: "authenticated", email: u.email })]);
    const people = (await c.query("select count(*)::int n from public.people")).rows[0].n;
    const profiles = (await c.query("select count(*)::int n from public.app_user_profile")).rows[0].n;
    const chart = (await c.query("select count(*)::int n from public.org_chart_nodes")).rows[0].n;
    const names = (await c.query("select count(*)::int n from public.user_display_names")).rows[0].n;
    const timeChart = (await c.query("select count(*)::int n from time.org_chart")).rows[0].n;
    console.log(`  ${u.role_key.padEnd(15)} people=${String(people).padStart(3)} profiles=${String(profiles).padStart(3)} org_chart_nodes=${String(chart).padStart(3)} display_names=${String(names).padStart(3)} time.org_chart=${String(timeChart).padStart(3)}`);
  } finally { await c.query("rollback"); }
}

await c.end();
