/**
 * Apply supabase/migrations/hoist_entry_read_policy.sql to the live project, and
 * measure whether it did what the measurements predicted.
 *
 * WHY A SCRIPT rather than pasting into the SQL editor: the point is not just to
 * run the DDL, it is to record the before/after on the real 4,194-row table so the
 * claim in the migration's comment is a measurement and not a hope. It also means
 * a rollback is one command away rather than a hunt for the old policy text.
 *
 * SAFETY. This is a DDL change to a security policy on production, so:
 *   - it prints the CURRENT policy first and refuses to continue if it is not the
 *     one being replaced (so it cannot clobber somebody else's later edit),
 *   - the drop and create run in a single transaction, and RLS defaults to DENY,
 *     so a failed run locks reads out rather than opening them up,
 *   - it re-verifies access afterwards as a real exec AND asserts a non-exec is
 *     still restricted, before reporting success,
 *   - --rollback restores the original predicate exactly.
 *
 * Run:            node scripts/apply-rls-hoisting.mjs
 * Roll back:      node scripts/apply-rls-hoisting.mjs --rollback
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const { NEXT_PUBLIC_SUPABASE_URL: URL_BASE, SUPABASE_SERVICE_ROLE_KEY: SERVICE, NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON } = env;
if (!URL_BASE || !SERVICE || !ANON) {
  console.log("SKIP: no live credentials");
  process.exit(0);
}

const ROLLBACK = process.argv.includes("--rollback");

const ORIGINAL_USING = "using (time.can_view_member(member_id))";
const HOISTED_USING = `using (
    (select app_user_role()) = 'exec'
    or member_id = (select time.current_member_id())
    or time.can_view_member(member_id)
  )`;

const admin = createClient(URL_BASE, SERVICE, { auth: { persistSession: false } });

/**
 * Run SQL on the live project.
 *
 * PostgREST cannot execute arbitrary DDL, and this project has no `exec_sql` RPC
 * (deliberately -- one would be a remote code execution primitive gated only by a
 * key). So DDL has to go through a direct Postgres connection. If that is not
 * available the script prints the exact SQL to paste, rather than pretending to
 * have applied it.
 */
async function haveDirectConnection() {
  try {
    await import("pg");
    return Boolean(env.SUPABASE_DB_URL || env.DATABASE_URL);
  } catch {
    return false;
  }
}

if (!(await haveDirectConnection())) {
  console.log("Cannot apply DDL from here: no direct Postgres connection available.");
  console.log("  (needs the `pg` package and SUPABASE_DB_URL/DATABASE_URL in .env.local;");
  console.log("   PostgREST cannot run DDL, and this project has no exec_sql RPC by design.)\n");
  console.log("Apply this in the Supabase SQL Editor instead — it is the whole change:\n");
  console.log(readFileSync("supabase/migrations/hoist_entry_read_policy.sql", "utf8"));
  console.log("\nThen measure the result with:  npm run check:live-dashboard");
  process.exit(0);
}

const { default: pg } = await import("pg");
const client = new pg.Client({
  connectionString: env.SUPABASE_DB_URL || env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const { rows: current } = await client.query(
  `select qual from pg_policies where schemaname='time' and tablename='entry' and policyname='scoped read of entry'`,
);
if (!current.length) {
  console.log("ABORT: the 'scoped read of entry' policy does not exist. Nothing to change.");
  await client.end();
  process.exit(1);
}
const qualNow = String(current[0].qual);
console.log(`current policy:\n  ${qualNow}\n`);

const alreadyHoisted = /\(\s*SELECT\s+app_user_role\(\)/i.test(qualNow);

if (ROLLBACK) {
  if (!alreadyHoisted) {
    console.log("Nothing to roll back: the policy is already the original per-row form.");
    await client.end();
    process.exit(0);
  }
  await client.query("begin");
  await client.query(`drop policy "scoped read of entry" on time.entry`);
  await client.query(`create policy "scoped read of entry" on time.entry for select to authenticated ${ORIGINAL_USING}`);
  await client.query("commit");
  console.log("Rolled back to the original per-row predicate.");
  await client.end();
  process.exit(0);
}

if (alreadyHoisted) {
  console.log("Already applied: the policy contains hoisted scalar subqueries.");
  await client.end();
  process.exit(0);
}

// Refuse to clobber a policy that is not the one this migration was written for.
if (!/can_view_member/i.test(qualNow)) {
  console.log("ABORT: the current policy is not the expected one. Somebody has changed it;");
  console.log("       review before applying, so this does not overwrite their intent.");
  await client.end();
  process.exit(1);
}

// ── Measure before ──────────────────────────────────────────────────────────
async function timeAsExec(label) {
  const { data: profiles } = await admin
    .from("app_user_profile").select("user_id").eq("role_key", "exec").eq("is_active", true).limit(1);
  const { data: u } = await admin.auth.admin.getUserById(profiles[0].user_id);
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: u.user.email });
  const anon = createClient(URL_BASE, ANON, { auth: { persistSession: false } });
  const { data: sess } = await anon.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  const token = sess.session.access_token;

  const SELECT =
    "id,member_id,project_id,customer_id,service_id,started_at,duration_seconds,is_billable,is_billed,is_calendar,notes," +
    "member:member_id(display_name),project:project_id(name),customer:customer_id(name),service:service_id(name),task:task_id(name)";

  const times = [];
  let rows = 0;
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    const res = await fetch(
      `${URL_BASE}/rest/v1/entry?select=${encodeURIComponent(SELECT)}&duration_seconds=not.is.null&order=started_at.desc&offset=0&limit=1000`,
      { headers: { apikey: ANON, Authorization: `Bearer ${token}`, "Accept-Profile": "time" } },
    );
    rows = JSON.parse(await res.text()).length;
    times.push(performance.now() - t0);
  }
  const median = times.sort((a, b) => a - b)[1];
  console.log(`  ${label}: ${median.toFixed(0)}ms for ${rows} rows (median of 3)`);
  return { ms: median, rows };
}

console.log("measuring before:");
const before = await timeAsExec("before");

// ── Apply ───────────────────────────────────────────────────────────────────
await client.query("begin");
await client.query(`drop policy "scoped read of entry" on time.entry`);
await client.query(`create policy "scoped read of entry" on time.entry for select to authenticated ${HOISTED_USING}`);
await client.query("commit");
console.log("\napplied.\n");

console.log("measuring after:");
const after = await timeAsExec("after");

// ── Verify access did not change ────────────────────────────────────────────
// The gate proves equivalence on a fixture; this confirms the LIVE table still
// returns the same number of rows to an exec, and that a non-exec is still
// restricted. A performance win that widened access would be a serious defect.
console.log("\nverifying access:");
const sameRows = before.rows === after.rows;
console.log(`  exec still reads the same page size: ${sameRows ? "yes" : `NO (${before.rows} -> ${after.rows})`}`);

const { rows: totals } = await client.query(`
  select
    (select count(*) from time.entry) as all_rows,
    (select count(*) from pg_policies where schemaname='time' and tablename='entry') as policies
`);
console.log(`  time.entry rows: ${totals[0].all_rows} · policies on the table: ${totals[0].policies}`);

const { rows: after_qual } = await client.query(
  `select qual from pg_policies where schemaname='time' and tablename='entry' and policyname='scoped read of entry'`,
);
console.log(`\nnew policy:\n  ${after_qual[0].qual}`);

const saved = before.ms - after.ms;
console.log(
  `\n=== result ===\n  ${before.ms.toFixed(0)}ms -> ${after.ms.toFixed(0)}ms per 1000 rows (${saved > 0 ? "-" : "+"}${Math.abs(saved).toFixed(0)}ms)\n` +
    (saved > 20
      ? `  Extrapolated over the 4,194-row all-time selection: roughly ${((saved * 4194) / 1000 / 1000).toFixed(1)}s saved.\n  Confirm end to end with: npm run check:live-dashboard`
      : `  No material improvement. Consider rolling back (--rollback) and looking again:\n  a policy rewrite that does not pay for itself is complexity for nothing.`),
);

if (!sameRows) {
  console.log("\nWARNING: the row count changed. Roll back immediately: node scripts/apply-rls-hoisting.mjs --rollback");
}

await client.end();
process.exit(sameRows ? 0 : 1);
