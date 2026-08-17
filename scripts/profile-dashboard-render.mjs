/**
 * Where does the widest dashboard selection actually spend its 3.2 seconds?
 *
 * Two hypotheses have already been tested and killed by measurement:
 *
 *   1. "The database is slow." No: every query the page issues, timed against the
 *      live project, totals ~220ms, and they run under Promise.all so the floor is
 *      the slowest one (~218ms).
 *   2. "The RSC payload is too big." No: halving the entry rows took the HTML from
 *      1049kb to 515kb and the server time went 3198ms -> 3217ms. No effect.
 *
 * So the cost is CPU between those two points: the aggregation this module does in
 * TypeScript (because PostgREST refuses aggregate functions on this project), plus
 * React rendering. This times each stage over the real 4,194-row dataset, so the
 * next change is aimed at something measured rather than assumed.
 *
 * Run: node --experimental-strip-types scripts/profile-dashboard-render.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const root = process.cwd();
registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith("@/")) {
      const base = join(root, "src", spec.slice(2));
      const t = existsSync(`${base}.ts`) ? `${base}.ts` : `${base}.tsx`;
      return { url: pathToFileURL(t).href, shortCircuit: true };
    }
    return next(spec, ctx);
  },
});

const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.log("SKIP: no live credentials");
  process.exit(0);
}

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const probe = await supabase.schema("time").from("entry").select("id").limit(1);
if (probe.error) {
  console.log(`SKIP: time schema unreachable — ${probe.error.message}`);
  process.exit(0);
}

const mod = await import("../src/lib/queries/trackingtime-report.ts");
const { fetchAllEntries, parseFilters, summarise, groupBy, trend, budgets, getFilterOptions } = mod;

// The exact widest selection the live gate flagged: all time, calendar included,
// grouped by customer, bucketed monthly.
const filters = parseFilters({ preset: "all", calendar: "1" });

const t = (label, fn) => {
  const t0 = performance.now();
  const out = fn();
  const ms = performance.now() - t0;
  console.log(`  ${label.padEnd(38)} ${ms.toFixed(1).padStart(8)}ms`);
  return { out, ms };
};

console.log("=== fetch ===");
const t0 = performance.now();
const { entries } = await fetchAllEntries(supabase, filters);
const fetchMs = performance.now() - t0;
console.log(`  fetchAllEntries (${entries.length} rows)`.padEnd(41) + `${fetchMs.toFixed(1).padStart(7)}ms`);

const t1 = performance.now();
const options = await getFilterOptions(supabase);
const optMs = performance.now() - t1;
console.log(`  getFilterOptions (${options.projects.length} projects)`.padEnd(41) + `${optMs.toFixed(1).padStart(7)}ms`);

console.log("\n=== TypeScript aggregation (PostgREST refuses aggregates here) ===");
const totals = t("summarise", () => summarise(entries));
const grouped = t("groupBy(customer)", () => groupBy(entries, "customer"));
t("groupBy(project)", () => groupBy(entries, "project"));
t("groupBy(task)  <- keys by NAME", () => groupBy(entries, "task"));
const points = t("trend(month)", () => trend(entries, "month"));
const ids = new Set(entries.map((e) => e.projectId).filter((x) => x !== null));
t("budgets", () => budgets(entries, options.projects.filter((p) => ids.has(p.id))));

// The per-row mapping the page does to build the entry table's props.
t("entryRows map (2000 rows)", () =>
  entries.slice(0, 2000).map((e) => ({
    id: e.id,
    startedAt: e.startedAt,
    memberName: e.memberName,
    projectName: e.projectName,
    customerName: e.customerName,
    taskName: e.taskName,
    serviceName: e.serviceName,
    durationSeconds: e.durationSeconds,
    isBillable: e.isBillable,
    isCalendar: e.isCalendar,
    notes: e.notes,
  })),
);

// Serialisation, as a proxy for what React does building the RSC payload.
const ser = t("JSON.stringify(2000 entry rows)", () =>
  JSON.stringify(entries.slice(0, 2000)).length,
);

const cpu = totals.ms + grouped.ms + points.ms;
console.log("\n=== verdict ===");
console.log(`  network (fetch + options, they run in parallel): ~${Math.max(fetchMs, optMs).toFixed(0)}ms`);
console.log(`  TypeScript aggregation for THIS view:            ~${cpu.toFixed(0)}ms`);
console.log(`  payload of 2000 entry rows:                      ~${(ser.out / 1024).toFixed(0)}kb`);
console.log(
  `\nThe live browser gate measures ~3200ms of server time for this selection.\n` +
    `If the lines above account for only a few hundred ms, the remainder is React\n` +
    `rendering ~180 table rows plus the framework's own RSC work -- which is a\n` +
    `RENDERING problem (fewer rows rendered per request), not a query or an\n` +
    `aggregation problem. That distinction decides the next change.`,
);

// ── How many ROWS does one request actually render? ─────────────────────────
// With the cost isolated to React, the only lever is how many row components are
// built per request. Counting them makes the next change arithmetic instead of
// intuition.
console.log("\n=== rows rendered per request (the remaining lever) ===");

const breakdownRows = Math.min(grouped.out.length, 25);
const budgetAll = budgets(entries, options.projects.filter((p) => ids.has(p.id)));
const entryRowsShipped = Math.min(entries.length, 2000);

console.log(`  breakdown rows RENDERED (page 1 of ${grouped.out.length})   ${String(breakdownRows).padStart(6)}`);
console.log(`  budget rows      (collapsed, ${budgetAll.length} available)  ${String(0).padStart(6)}`);
console.log(`  entry rows       (collapsed, ${entryRowsShipped} shipped) ${String(0).padStart(6)}`);
console.log(`  trend bars                                  ${String(Math.min(points.out.length, 90)).padStart(6)}`);

// The filter pickers are the surprise candidate: they are Client Components, so
// every option becomes a <button> with a checkbox span and up to two text spans,
// SERVER-RENDERED into the payload for all four pickers whether opened or not.
const pickerOptions =
  options.members.length + options.projects.length + options.customers.length + options.services.length;
console.log(`  filter picker options (all four pickers)     ${String(pickerOptions).padStart(6)}  <- rendered even while closed`);
console.log(
  `\n  total row-ish components: ~${breakdownRows + Math.min(points.out.length, 90) + pickerOptions}\n` +
    `  Of that, ${pickerOptions} are picker options nobody has opened. Each is a button with\n` +
    `  3-4 child elements, so that is roughly ${pickerOptions * 4} elements of DOM built on every\n` +
    `  request for controls that are closed -- and it is INDEPENDENT of the date\n` +
    `  range, which is why even "this month" pays it.`,
);

// ── The variable my profiling had silently held constant: RLS ──────────────
// Everything above ran with the SERVICE ROLE key, which bypasses row-level
// security. The app does not: it queries as the signed-in user, so Postgres
// evaluates the `time.entry` policies for every candidate row. That is the one
// difference between "441ms" here and the seconds the browser sees, and it also
// explains why the cost tracks the ENTRY COUNT (138 -> 2,244 -> 4,194 entries maps
// onto 492ms -> 1,739ms -> 3,337ms) while being indifferent to payload size.
console.log("\n=== the same fetch, but under RLS as a real user ===");

const { data: execProfile } = await supabase
  .from("app_user_profile")
  .select("user_id")
  .eq("role_key", "exec")
  .eq("is_active", true)
  .limit(1);

if (!execProfile?.length) {
  console.log("  SKIP: no exec profile to impersonate");
} else {
  const { data: u } = await supabase.auth.admin.getUserById(execProfile[0].user_id);
  const email = u?.user?.email;
  const { data: link } = await supabase.auth.admin.generateLink({ type: "magiclink", email });
  const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });
  const { data: sess } = await anon.auth.verifyOtp({
    type: "magiclink",
    token_hash: link.properties.hashed_token,
  });

  if (!sess?.session) {
    console.log("  SKIP: could not mint a user session");
  } else {
    const asUser = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${sess.session.access_token}` } },
    });

    for (const [label, f] of [
      ["this month", parseFilters({ preset: "this_month" })],
      ["all time", parseFilters({ preset: "all" })],
      ["all time + calendar", parseFilters({ preset: "all", calendar: "1" })],
    ]) {
      const tSvc = performance.now();
      const svc = await fetchAllEntries(supabase, f);
      const svcMs = performance.now() - tSvc;

      const tUsr = performance.now();
      const usr = await fetchAllEntries(asUser, f);
      const usrMs = performance.now() - tUsr;

      console.log(
        `  ${label.padEnd(22)} service-role ${svcMs.toFixed(0).padStart(5)}ms (${svc.entries.length} rows) · under RLS ${usrMs.toFixed(0).padStart(5)}ms (${usr.entries.length} rows) · RLS costs ${(usrMs - svcMs).toFixed(0)}ms`,
      );
    }

    console.log(
      "\n  If the RLS column is several times the service-role column, the page's time\n" +
        "  is being spent in POLICY EVALUATION, not in React. The fix is then a SQL one\n" +
        "  (a security-definer function or an index the policy can use), and no amount\n" +
        "  of front-end work would have helped.",
    );
  }
}
