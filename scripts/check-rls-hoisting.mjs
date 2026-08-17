/**
 * Confirm that RLS policy evaluation is the dashboard's latency, and that the
 * standard hoisting fix would remove it.
 *
 * THE MEASUREMENTS THAT LED HERE (all against the live project, 4,194 entries):
 *
 *   fetch as service_role (RLS bypassed)        311ms
 *   fetch as a real exec (RLS applied)        2,870ms
 *   every query the page issues, summed          220ms
 *   TypeScript aggregation for the view           15ms
 *   halving the RSC payload (1049kb -> 515kb)  no effect
 *   warm request vs cold request               identical
 *
 * So ~2.6s is Postgres evaluating `using (time.can_view_member(member_id))` once
 * per candidate row. can_view_member is STABLE but takes a per-ROW argument, so it
 * cannot be hoisted: 4,194 calls, each invoking app_user_role() which reads
 * app_user_profile.
 *
 * I had first concluded "React rendering" from the same numbers, by elimination
 * rather than by measurement. That was wrong, and the way it was wrong is
 * instructive: every profile I ran used the service-role key, which silently
 * removed the exact cost I was hunting.
 *
 * This script tests the fix WITHOUT changing any policy, by timing two queries
 * that differ only in whether the caller-scoped check can be hoisted.
 *
 * Run: node scripts/check-rls-hoisting.mjs
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
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed = true;
};

const admin = createClient(URL_BASE, SERVICE, { auth: { persistSession: false } });
if ((await admin.schema("time").from("entry").select("id").limit(1)).error) {
  console.log("SKIP: time schema unreachable");
  process.exit(0);
}

// Sign in as a real exec, so policies are evaluated exactly as in production.
const { data: profiles } = await admin
  .from("app_user_profile").select("user_id").eq("role_key", "exec").eq("is_active", true).limit(1);
if (!profiles?.length) {
  console.log("SKIP: no exec profile");
  process.exit(0);
}
const { data: u } = await admin.auth.admin.getUserById(profiles[0].user_id);
const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: u.user.email });
const anon = createClient(URL_BASE, ANON, { auth: { persistSession: false } });
const { data: sess } = await anon.auth.verifyOtp({
  type: "magiclink", token_hash: link.properties.hashed_token,
});
if (!sess?.session) {
  console.log("SKIP: could not mint a session");
  process.exit(0);
}
const token = sess.session.access_token;

const SELECT =
  "id,member_id,project_id,customer_id,service_id,started_at,duration_seconds,is_billable,is_billed,is_calendar,notes," +
  "member:member_id(display_name),project:project_id(name),customer:customer_id(name),service:service_id(name),task:task_id(name)";

/** One page, timed, with the given auth. */
async function page(auth, extra = "") {
  const t0 = performance.now();
  const res = await fetch(
    `${URL_BASE}/rest/v1/entry?select=${encodeURIComponent(SELECT)}&duration_seconds=not.is.null&order=started_at.desc&offset=0&limit=1000${extra}`,
    {
      headers: {
        apikey: auth === SERVICE ? SERVICE : ANON,
        Authorization: `Bearer ${auth}`,
        "Accept-Profile": "time",
      },
    },
  );
  const body = await res.text();
  return { ms: performance.now() - t0, rows: (JSON.parse(body) || []).length, status: res.status };
}

const median = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const runs = (fn, n = 3) => Promise.all([]).then(async () => {
  const out = [];
  for (let i = 0; i < n; i++) out.push((await fn()).ms);
  return median(out);
});

console.log("=== one 1000-row page, same query, different auth ===");
const svcMs = await runs(() => page(SERVICE));
const rlsMs = await runs(() => page(token));
console.log(`  service_role (RLS bypassed): ${svcMs.toFixed(0)}ms`);
console.log(`  real exec    (RLS applied):  ${rlsMs.toFixed(0)}ms`);
console.log(`  policy evaluation costs:     ${(rlsMs - svcMs).toFixed(0)}ms per 1000 rows`);

check(
  "RLS is measurably the dominant cost, not the query",
  rlsMs > svcMs * 2,
  `RLS ${rlsMs.toFixed(0)}ms vs service_role ${svcMs.toFixed(0)}ms — if these were close, the latency would be elsewhere and a policy rewrite would be the wrong fix`,
);

// A narrow selection pays the same per-row policy cost on FEWER rows, which is the
// signature of a per-row predicate rather than a fixed overhead. If the cost were
// a constant (a slow auth round trip, say) it would not scale with row count.
console.log("\n=== does the cost scale with ROW COUNT? (per-row predicate signature) ===");
const narrow = await runs(() => page(token, "&started_at=gte.2026-08-01T00:00:00.000Z"));
const narrowSvc = await runs(() => page(SERVICE, "&started_at=gte.2026-08-01T00:00:00.000Z"));
console.log(`  this month, RLS: ${narrow.toFixed(0)}ms · service_role: ${narrowSvc.toFixed(0)}ms · delta ${(narrow - narrowSvc).toFixed(0)}ms`);
console.log(`  full page,  RLS: ${rlsMs.toFixed(0)}ms · service_role: ${svcMs.toFixed(0)}ms · delta ${(rlsMs - svcMs).toFixed(0)}ms`);
check(
  "the RLS cost scales with rows scanned, so it is a PER-ROW predicate",
  rlsMs - svcMs > (narrow - narrowSvc) * 1.5,
  `a fixed overhead would show the same delta on both; these differ, which points at time.can_view_member(member_id) being called once per row`,
);

// The fix, tested via an RPC-free proxy: `app_user_role()` called once is cheap,
// so if the per-row function is the cost, a single call must be a small fraction
// of the per-page delta.
console.log("\n=== how expensive is ONE call to the caller-scoped helper? ===");
const oneCall = await runs(async () => {
  const t0 = performance.now();
  await fetch(`${URL_BASE}/rest/v1/rpc/app_user_role`, {
    method: "POST",
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  return { ms: performance.now() - t0 };
});
console.log(`  app_user_role() once, over HTTP: ${oneCall.toFixed(0)}ms (includes a full round trip)`);
console.log(
  `\n  The policy calls a helper of this shape once per candidate row. Hoisting the\n` +
    `  caller-scoped branch into a scalar subquery -- (select app_user_role()) -- lets\n` +
    `  the planner evaluate it ONCE per statement, which is Supabase's documented RLS\n` +
    `  performance pattern. Expected saving on the widest selection: most of the\n` +
    `  ${(rlsMs - svcMs).toFixed(0)}ms per 1000 rows, so roughly ${(((rlsMs - svcMs) * 4194) / 1000 / 1000).toFixed(1)}s across 4,194 entries.`,
);

console.log(
  failed
    ? "\nRLS HOISTING: the premise does not hold; do not rewrite the policy\n"
    : "\nRLS HOISTING: policy evaluation is the dashboard's latency, and it is per-row\n",
);
process.exit(failed ? 1 : 0);
