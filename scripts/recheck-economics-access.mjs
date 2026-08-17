/**
 * Why did time.project_economics() return null for service_role?
 *
 * The independent recheck computed every other expected row count from the
 * database successfully, but this RPC came back null. Two very different
 * explanations, and they matter enormously:
 *
 *   A) BENIGN AND CORRECT: the function is gated on
 *      `app_user_has_permission('overview:export')`, which reads the CALLER's
 *      profile. service_role is not a signed-in user, so it has no profile, so the
 *      predicate is false and the function returns no rows. That is the security
 *      model working exactly as designed -- and it means my recheck used the wrong
 *      credential, not that the product is broken.
 *
 *   B) A REAL BUG: the function errors for everyone, and the dashboard's economics
 *      panel is silently empty in production for the execs who are supposed to see
 *      it. That would be a data-visibility defect hiding behind a null.
 *
 * Distinguishing them requires calling it as a real exec, which is exactly what the
 * app does. Anything less leaves the question open.
 *
 * Run: node scripts/recheck-economics-access.mjs
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

let failed = false;
const check = (label, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}\n        ${detail}`);
  if (!ok) failed = true;
};

const admin = createClient(URL_BASE, SERVICE, { auth: { persistSession: false } });

// 1. Reproduce the null, and capture the ERROR rather than just the data. My
//    recheck only looked at `data`, which is how a meaningful error went unseen.
const asService = await admin.schema("time").rpc("project_economics", {
  p_from: "2000-01-01", p_to: "2027-12-31",
});
console.log("as service_role:");
console.log(`  data: ${Array.isArray(asService.data) ? `${asService.data.length} rows` : String(asService.data)}`);
console.log(`  error: ${asService.error ? asService.error.message : "none"}`);

// 2. Now as a real exec, which is the only caller the function is written for.
const { data: profiles } = await admin
  .from("app_user_profile").select("user_id").eq("role_key", "exec").eq("is_active", true).limit(1);
if (!profiles?.length) {
  console.log("SKIP: no active exec");
  process.exit(0);
}
const { data: u } = await admin.auth.admin.getUserById(profiles[0].user_id);
const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: u.user.email });
const anon = createClient(URL_BASE, ANON, { auth: { persistSession: false } });
const { data: sess } = await anon.auth.verifyOtp({
  type: "magiclink", token_hash: link.properties.hashed_token,
});
const execClient = createClient(URL_BASE, ANON, {
  auth: { persistSession: false },
  global: { headers: { Authorization: `Bearer ${sess.session.access_token}` } },
});

const asExec = await execClient.schema("time").rpc("project_economics", {
  p_from: "2000-01-01", p_to: "2027-12-31",
});
console.log("\nas a real exec:");
console.log(`  data: ${Array.isArray(asExec.data) ? `${asExec.data.length} rows` : String(asExec.data)}`);
console.log(`  error: ${asExec.error ? asExec.error.message : "none"}`);

check(
  "the economics RPC returns rows for a real exec",
  Array.isArray(asExec.data) && asExec.data.length > 0,
  `${Array.isArray(asExec.data) ? asExec.data.length : 0} rows — this is the caller the dashboard actually uses, and the panel is only rendered when it is non-empty`,
);

// The answer, and it is the DESIGNED one. schema.sql ends the function definition
// with:
//
//     revoke execute on function time.project_economics(date, date) from public, anon;
//     grant  execute on function time.project_economics(date, date) to authenticated;
//
// service_role is granted neither, so "permission denied for function" is the
// grant model working, not a defect. It is also a useful reminder that
// service_role bypasses RLS but NOT function or table grants -- the same trap
// documented in schema.sql section 9, where missing schema grants made the
// TrackingTime importer fail with 42501.
//
// So my recheck's null was my own wrong credential, and the assertion I first
// wrote here ("no error expected") was wrong about the product rather than the
// product being wrong.
check(
  "service_role is DENIED this function by grant, which is the intended design",
  Boolean(asService.error) && /permission denied/i.test(asService.error.message),
  asService.error
    ? `"${asService.error.message}" — schema.sql grants execute to authenticated only, so a non-user key must be refused`
    : `service_role executed a money function it was never granted; that would be the real defect`,
);

// 3. The distinction that matters for the UI: null vs empty. getProjectEconomics
//    returns null for "may not see money" and [] for "may see, nothing there", and
//    the page renders those differently. Confirm a non-money role gets nothing.
const { data: nonExec } = await admin
  .from("app_user_profile").select("user_id,role_key").neq("role_key", "exec").eq("is_active", true).limit(1);
if (nonExec?.length) {
  const { data: u2 } = await admin.auth.admin.getUserById(nonExec[0].user_id);
  if (u2?.user?.email) {
    const { data: link2 } = await admin.auth.admin.generateLink({ type: "magiclink", email: u2.user.email });
    const anon2 = createClient(URL_BASE, ANON, { auth: { persistSession: false } });
    const { data: sess2 } = await anon2.auth.verifyOtp({
      type: "magiclink", token_hash: link2.properties.hashed_token,
    });
    if (sess2?.session) {
      const other = createClient(URL_BASE, ANON, {
        auth: { persistSession: false },
        global: { headers: { Authorization: `Bearer ${sess2.session.access_token}` } },
      });
      const res = await other.schema("time").rpc("project_economics", {
        p_from: "2000-01-01", p_to: "2027-12-31",
      });
      check(
        `a ${nonExec[0].role_key} gets NO economics rows, so money never leaks`,
        !res.error && Array.isArray(res.data) && res.data.length === 0,
        `${nonExec[0].role_key} saw ${Array.isArray(res.data) ? res.data.length : String(res.data)} rows` +
          `${res.error ? ` (error: ${res.error.message})` : ""} — the RPC is security-definer and gated internally, so this is the real boundary`,
      );
    }
  }
} else {
  console.log("  (no non-exec profile to test the negative case against)");
}

// 4. And the revenue must be a real figure, not a zero that looks like data.
if (Array.isArray(asExec.data) && asExec.data.length) {
  const revenue = asExec.data.reduce((a, r) => a + Number(r.revenue ?? 0), 0);
  check(
    "the exec's economics rows carry real money, not zeros",
    revenue > 0,
    `total revenue across ${asExec.data.length} projects is €${Math.round(revenue).toLocaleString("en-GB")}`,
  );
}

console.log(
  failed
    ? "\nECONOMICS ACCESS: something is genuinely wrong\n"
    : "\nECONOMICS ACCESS: the null was the permission gate working; execs see real figures\n",
);
process.exit(failed ? 1 : 0);
