/**
 * Remove the probe accounts that check-admin-user-writes.mjs leaked.
 *
 * WHY THIS EXISTS. `check-admin-user-writes` creates a REAL auth account to edit,
 * and until 2026-08-27 its cleanup sat at the end of a linear script with no
 * `try`/`finally`. It therefore ran only when every check above it had already
 * passed; any throw stranded the account in production. Measured on 2026-08-27:
 * 391 such accounts, all created on 2026-08-26, against 20 real ones. That is why
 * /admin/users renders 411 rows for a company of twenty, and why
 * `check:table-scroll-budget` reads 22.97 screens (desktop, budget 3) and 84.25
 * (390px, budget 5.5) on that route.
 *
 * The leak itself is fixed. This removes what already leaked.
 *
 * WHAT IT WILL AND WILL NOT TOUCH. The match is an exact shape, not a similarity:
 *
 *     admin.write.probe.<digits>@example.invalid
 *
 * `example.invalid` is reserved by RFC 2606 and can never be a real mailbox, and
 * the local part is the literal prefix this one gate builds at line 72. A row that
 * does not match that regex is never considered, whatever else is true of it.
 *
 * Three guards refuse to run at all rather than proceed on a surprise, because the
 * failure mode here is deleting a colleague's account:
 *
 *   1. Every candidate must match the regex above. Anything the SQL prefilter
 *      returns that the regex rejects aborts the run.
 *   2. No candidate may hold `exec` or `dept_head`. The leak was measured to be
 *      only `employee` and `project_manager`; a privileged row under this name
 *      means something other than the leak produced it.
 *   3. No candidate may be a `people`-linked profile. A probe is never a colleague.
 *
 * Dry run by default, in the house convention -- pass --apply to write.
 *
 * Run: node scripts/purge-probe-accounts.mjs            (shows what it would do)
 *      node scripts/purge-probe-accounts.mjs --apply    (deletes)
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");

const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
if (!env.SUPABASE_SERVICE_ROLE_KEY) {
  console.log("SKIP: no service-role key");
  process.exit(0);
}
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

/** The only shape this script will ever delete. */
const PROBE = /^admin\.write\.probe\.\d+@example\.invalid$/;

console.log(`MODE: ${APPLY ? "APPLY -- rows will be deleted" : "dry run (pass --apply to delete)"}\n`);

// listUsers is paged; walk it rather than trusting one page to hold 400+ rows.
const users = [];
for (let page = 1; ; page += 1) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
  if (error) { console.log(`FAIL: could not list users -- ${error.message}`); process.exit(1); }
  users.push(...data.users);
  if (data.users.length < 200) break;
}

const candidates = users.filter((u) => PROBE.test(u.email ?? ""));
const real = users.filter((u) => !PROBE.test(u.email ?? ""));

console.log(`auth.users total          : ${users.length}`);
console.log(`match the probe shape     : ${candidates.length}`);
console.log(`everything else (kept)    : ${real.length}\n`);

if (candidates.length === 0) {
  console.log("Nothing to purge.");
  process.exit(0);
}

// ── Guards ────────────────────────────────────────────────────────────────────
const ids = candidates.map((u) => u.id);

/*
 * Batched, because a single `.in()` with 410 UUIDs builds a query string longer
 * than PostgREST will accept and the request dies as a bare "TypeError: fetch
 * failed" -- no status, no message, nothing pointing at URL length.
 *
 * That mattered here: the failure aborted the run at the guard stage, so the
 * script that exists to clean up 410 accounts could not read the profiles it
 * needed to clear them safely. It only worked when the leak was smaller than
 * the URL limit, which is exactly backwards.
 *
 * 200 per batch keeps the URL well inside the limit.
 */
const profiles = [];
for (let i = 0; i < ids.length; i += 200) {
  const { data, error } = await admin
    .from("app_user_profile")
    .select("user_id, role_key, person_id")
    .in("user_id", ids.slice(i, i + 200));
  if (error) {
    console.log(`FAIL: could not read profiles (batch at ${i}) -- ${error.message}`);
    process.exit(1);
  }
  profiles.push(...(data ?? []));
}

const privileged = (profiles ?? []).filter((p) => p.role_key === "exec" || p.role_key === "dept_head");
if (privileged.length) {
  console.log(`ABORT: ${privileged.length} candidate(s) hold exec/dept_head. The measured leak held`);
  console.log("       only employee and project_manager, so this is not the leak. Investigate by hand.");
  process.exit(1);
}
const linked = (profiles ?? []).filter((p) => p.person_id != null);
if (linked.length) {
  console.log(`ABORT: ${linked.length} candidate(s) are linked to a public.people row. A probe never is.`);
  process.exit(1);
}

const byRole = {};
for (const p of profiles ?? []) byRole[p.role_key] = (byRole[p.role_key] ?? 0) + 1;
console.log("candidate roles           :", JSON.stringify(byRole));
console.log(`candidates with a profile : ${profiles?.length ?? 0}`);
console.log(`candidates auth-only      : ${candidates.length - (profiles?.length ?? 0)}\n`);

const dates = candidates.map((u) => String(u.created_at).slice(0, 10)).sort();
console.log(`created between           : ${dates[0]} and ${dates[dates.length - 1]}`);
console.log(`ever signed in            : ${candidates.filter((u) => u.last_sign_in_at).length}\n`);

console.log("sample of what would go (first 5):");
for (const u of candidates.slice(0, 5)) console.log(`   ${u.email}   created ${String(u.created_at).slice(0, 19)}`);
console.log("\nsample of what is KEPT (first 5):");
for (const u of real.slice(0, 5)) console.log(`   ${u.email}`);

if (!APPLY) {
  console.log(`\ndry run -- nothing deleted. --apply would remove ${candidates.length} auth user(s)`);
  console.log(`and their ${profiles?.length ?? 0} profile row(s), leaving ${real.length} real account(s).`);
  process.exit(0);
}

// ── Delete ────────────────────────────────────────────────────────────────────
// Profile first, then the auth row: the reverse order can leave an orphan profile
// pointing at a user_id that no longer exists.
let profileDeleted = 0, userDeleted = 0;
const failures = [];
for (const [i, u] of candidates.entries()) {
  const { error: dpErr } = await admin.from("app_user_profile").delete().eq("user_id", u.id);
  if (dpErr) { failures.push(`${u.email}: profile -- ${dpErr.message}`); continue; }
  profileDeleted += 1;
  const { error: duErr } = await admin.auth.admin.deleteUser(u.id);
  if (duErr) { failures.push(`${u.email}: auth -- ${duErr.message}`); continue; }
  userDeleted += 1;
  if ((i + 1) % 50 === 0) console.log(`  ${i + 1}/${candidates.length}`);
}

console.log(`\ndeleted ${userDeleted} auth user(s) and ${profileDeleted} profile row(s).`);
if (failures.length) {
  console.log(`${failures.length} failure(s):`);
  for (const f of failures.slice(0, 10)) console.log(`   ${f}`);
}

// Re-assert the outcome rather than trusting the loop's own counters.
const after = [];
for (let page = 1; ; page += 1) {
  const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
  after.push(...data.users);
  if (data.users.length < 200) break;
}
const leftover = after.filter((u) => PROBE.test(u.email ?? "")).length;
console.log(`\npost-delete verification  : ${after.length} auth users remain, ${leftover} still match the probe shape`);
process.exit(leftover === 0 && failures.length === 0 ? 0 : 1);
