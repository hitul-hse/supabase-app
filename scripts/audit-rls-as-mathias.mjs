// Impersonate Mathias exactly as PostgREST does (role authenticated + his JWT
// claims) and measure what RLS actually returns. This is the acceptance test:
// the DB is the source of truth, the UI only mirrors it.
import { readFileSync } from "node:fs";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const USER_ID = "4f2d4186-7db9-4684-9b5c-69b137cdcb25"; // mathias@hs-experts.com

const asUser = async (label, sql) => {
  await c.query("begin");
  try {
    await c.query("select set_config('role','authenticated',true)");
    await c.query("select set_config('request.jwt.claims', $1, true)",
      [JSON.stringify({ sub: USER_ID, role: "authenticated", email: "mathias@hs-experts.com" })]);
    const r = await c.query(sql);
    console.log(`  ${label}: ${r.rows[0].n} rows visible`);
  } catch (e) {
    console.log(`  ${label}: ERROR ${e.message}`);
  } finally {
    await c.query("rollback");
  }
};

console.log("=== What Mathias (role=employee) sees through RLS ===");
await asUser("projects           ", "select count(*)::int n from public.projects");
await asUser("people             ", "select count(*)::int n from public.people");
await asUser("person_assignments ", "select count(*)::int n from public.person_assignments");
await asUser("app_user_profile   ", "select count(*)::int n from public.app_user_profile");
await asUser("timesheet_entries  ", "select count(*)::int n from public.timesheet_entries");
await asUser("his own projects   ", `
  select count(*)::int n from public.projects
  where owner_person_id='md-mathias'
     or id in (select project_id from public.person_assignments where person_id='md-mathias')`);

console.log("\n=== Service-role truth (what SHOULD be reachable) ===");
for (const [label, sql] of [
  ["projects total     ", "select count(*)::int n from public.projects"],
  ["his projects       ", `select count(*)::int n from public.projects
     where owner_person_id='md-mathias'
        or id in (select project_id from public.person_assignments where person_id='md-mathias')`],
]) {
  const r = await c.query(sql);
  console.log(`  ${label}: ${r.rows[0].n}`);
}

console.log("\n=== RLS policies on projects ===");
const pol = await c.query(`
  select polname, cmd, qual
  from (
    select p.polname,
           case p.polcmd when 'r' then 'SELECT' when '*' then 'ALL' else p.polcmd::text end cmd,
           pg_get_expr(p.polqual, p.polrelid) qual
    from pg_policy p join pg_class c on c.oid=p.polrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='projects') s`);
for (const r of pol.rows) console.log(`  [${r.cmd}] ${r.polname}\n      ${String(r.qual).slice(0, 300)}`);

await c.end();
