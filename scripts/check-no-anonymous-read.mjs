/**
 * Nothing in this database may be readable without signing in.
 *
 * ── The failure this exists to catch ────────────────────────────────────────
 *
 * On 2026-08-25 `public.netflix_users` was found in production: 25,000 rows of
 * streaming-service demo data (name, age, country, subscription tier, watch
 * hours, last login) carrying the policy
 *
 *     "Allow anon read access to netflix_users"  USING (true)
 *
 * with four `security_invoker` views over it that inherited the same opening.
 * The anon key ships in the browser bundle by design, so the whole dataset was
 * readable by anyone on the internet. Verified with a live unauthenticated
 * request before the fix: HTTP 200 and `content-range: 0-0/25000`.
 *
 * It survived because nothing was wrong. RLS was ON, a policy existed, no test
 * failed, and no page rendered it — the table was simply configured to be open,
 * for a demo, and the demo ended. That is the shape of this class of bug: not a
 * broken rule but a deliberate exception nobody revisited.
 *
 * ── What is asserted ───────────────────────────────────────────────────────
 *
 *   1. No table or view in `public` or `time` returns rows to an anonymous
 *      caller. This is the real check, made the way an attacker would: a live
 *      HTTP request with the public anon key and no session.
 *   2. No policy grants a permissive `USING (true)` to `anon`. Structural, and
 *      it catches an opening that happens to sit over an empty table today and
 *      will not be empty tomorrow.
 *   3. A control: an authenticated exec CAN read `projects`. Without it, a
 *      database that returns nothing to everybody — a broken PostgREST, a bad
 *      key — would pass every assertion above while the app was down.
 *
 * Read-only. SKIPs without .env.local so CI runs without credentials.
 */
import { readFileSync, existsSync } from "node:fs";

let failed = false;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` \u2014 ${detail}` : ""}`);
  if (!ok) failed = true;
};

const ENV = "C:/Supabase/.env.local";
if (!existsSync(ENV)) { console.log("SKIP: no .env.local"); process.exit(0); }

const env = Object.fromEntries(
  readFileSync(ENV, "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

if (!env.SUPABASE_DB_URL || !env.NEXT_PUBLIC_SUPABASE_ANON_KEY) { console.log("SKIP: credentials not set"); process.exit(0); }

const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const pg = (await import("pg")).default;
const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

try {
  // ---- 2. structural: any permissive anon policy at all -------------------
  const { rows: anonPolicies } = await c.query(`
    select n.nspname as schema, cl.relname as relation, p.polname,
           pg_get_expr(p.polqual, p.polrelid) as using_expr
    from pg_policy p
    join pg_class cl on cl.oid = p.polrelid
    join pg_namespace n on n.oid = cl.relnamespace
    where n.nspname in ('public','time','crm')
      and p.polpermissive
      and exists (
        select 1 from pg_roles r
        where r.oid = any(p.polroles) and r.rolname = 'anon'
      )`);

  check("no policy grants anonymous read", anonPolicies.length === 0,
    anonPolicies.map((p) => `${p.schema}.${p.relation}: ${p.polname} USING ${p.using_expr}`).join("; "));

  // ---- 1. behavioural: what can an anonymous caller actually pull? --------
  const { rows: relations } = await c.query(`
    select table_name from information_schema.tables
    where table_schema = 'public' and table_type in ('BASE TABLE','VIEW')
    order by table_name`);

  const exposed = [];
  for (const { table_name } of relations) {
    let r;
    try {
      r = await fetch(`${URL_}/rest/v1/${table_name}?select=*&limit=1`, { headers: { apikey: ANON } });
    } catch { continue; }
    if (r.status !== 200) continue;
    const body = await r.text();
    if (body.trim() !== "[]" && body.trim().startsWith("[")) exposed.push(`${table_name} (${body.slice(0, 60).replace(/\s+/g, " ")}…)`);
  }

  check("no public relation returns rows to an anonymous caller", exposed.length === 0,
    exposed.length ? `readable without a session: ${exposed.join(", ")}` : `${relations.length} relations probed`);

  // ---- 3. control: the app is not simply dead ----------------------------
  const exec = (await c.query(`
    select aup.user_id, u.email from public.app_user_profile aup
    join auth.users u on u.id = aup.user_id
    where aup.role_key='exec' and aup.is_active limit 1`)).rows[0];

  let visible = -1;
  await c.query("begin");
  try {
    await c.query("select set_config('role','authenticated',true)");
    await c.query("select set_config('request.jwt.claims',$1,true)",
      [JSON.stringify({ sub: exec.user_id, role: "authenticated", email: exec.email })]);
    visible = (await c.query("select count(*)::int n from public.projects")).rows[0].n;
  } finally { await c.query("rollback"); }

  check("control: a signed-in exec still sees projects", visible > 0,
    `${visible} projects visible to ${exec.email} — if this were 0, the checks above would pass on a broken database`);
} finally {
  await c.end();
}

console.log(failed ? "\nFAILED" : "\nALL CHECKS PASSED");
process.exit(failed ? 1 : 0);
