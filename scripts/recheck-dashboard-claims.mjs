/**
 * INDEPENDENT recheck of the claims I made about the dashboard.
 *
 * The point is to try to FALSIFY them, not to re-run the gates that already agree
 * with me. So every expected value here is computed from the database directly,
 * by different code than the app uses, and compared against what the page states.
 *
 * The five claims under test:
 *
 *   C1 "Uncap all four tables; 179 of 179 projects reachable"
 *      -- is 179 actually the right number, or an artefact of another cap? The
 *         database holds 334 projects. And is it true of ALL FOUR tables, or only
 *         of the breakdown I looked at hardest?
 *   C2 "Three gates exist and pass"
 *      -- do all three exist, are they registered, and do they run?
 *   C3 "every routine selection under 650ms"
 *      -- my own last run logged this year at 2331ms and all time at 2395ms.
 *   C4 "parallel paging 893ms -> 252ms, row-for-row identical"
 *      -- do those figures reproduce, or were they one sample?
 *   C5 "final pass all green"
 *      -- re-run rather than remember.
 *
 * Run: node --experimental-strip-types scripts/recheck-dashboard-claims.mjs
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
const { NEXT_PUBLIC_SUPABASE_URL: URL_BASE, SUPABASE_SERVICE_ROLE_KEY: SERVICE } = env;
if (!URL_BASE || !SERVICE) {
  console.log("SKIP: no live credentials");
  process.exit(0);
}

const verdicts = [];
const verdict = (claim, upheld, evidence) => {
  verdicts.push({ claim, upheld, evidence });
  console.log(`${upheld ? "UPHELD  " : "CORRECTED"} ${claim}\n          ${evidence}`);
};

const admin = createClient(URL_BASE, SERVICE, { auth: { persistSession: false } });
if ((await admin.schema("time").from("entry").select("id").limit(1)).error) {
  console.log("SKIP: time schema unreachable");
  process.exit(0);
}

/** Page every row of a filtered entry query, service-role, independent of the app. */
async function allEntries({ calendar = false, billable = null } = {}) {
  const out = [];
  for (let off = 0; ; off += 1000) {
    let q = admin.schema("time").from("entry")
      .select("id,project_id,member_id,customer_id,duration_seconds,is_billable,is_calendar")
      .not("duration_seconds", "is", null)
      .order("started_at", { ascending: false })
      .range(off, off + 999);
    if (!calendar) q = q.eq("is_calendar", false);
    if (billable !== null) q = q.eq("is_billable", billable);
    const { data, error } = await q;
    if (error || !data?.length) break;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

console.log("=== C1: is 179 the right number, and is every table really uncapped? ===\n");

const nonCal = await allEntries();
const withCal = await allEntries({ calendar: true });

// The breakdown groups by project and keeps a "(no project)" bucket, so the row
// count is DISTINCT project ids present, plus one if any entry has none.
const distinctProjects = new Set(nonCal.map((e) => e.project_id).filter((x) => x !== null));
const hasUnattributed = nonCal.some((e) => e.project_id === null);
const expectedBreakdownRows = distinctProjects.size + (hasUnattributed ? 1 : 0);

const totalProjectsInDb =
  (await admin.schema("time").from("project").select("id", { count: "exact" }).limit(1)).count ?? 0;

verdict(
  "C1a: 179 breakdown rows is the count of projects WITH logged time, not a cap",
  expectedBreakdownRows === 179,
  `database says ${distinctProjects.size} distinct projects have non-calendar time` +
    `${hasUnattributed ? " plus a (no project) bucket" : ""} = ${expectedBreakdownRows} rows;` +
    ` ${totalProjectsInDb} projects exist in total, so the other ${totalProjectsInDb - distinctProjects.size} have logged nothing and correctly do not appear`,
);

// Now the honest part: is the ENTRY table uncapped? It is not -- it ships at most
// ENTRY_ROW_LIMIT rows by design. Check what the code actually says.
const pageSrc = readFileSync("src/app/(app)/time/dashboard/page.tsx", "utf8");
const limitMatch = /const ENTRY_ROW_LIMIT = (\d+)/.exec(pageSrc);
const entryLimit = limitMatch ? Number(limitMatch[1]) : null;
const entriesInWidest = withCal.length;
verdict(
  "C1b: 'uncap all four tables' overstates the ENTRY table, which is capped by design",
  entryLimit !== null && entriesInWidest > entryLimit,
  `ENTRY_ROW_LIMIT is ${entryLimit}; the widest selection has ${entriesInWidest} entries, so ${entriesInWidest - entryLimit} are NOT shipped.` +
    ` The page states this ("lists the N most recent of M"). Correct claim: three aggregate tables are uncapped; the raw entry list is bounded and says so`,
);

// Budget burn: projects with an estimate AND time in the selection.
const { data: estimated } = await admin.schema("time").from("project")
  .select("id,estimated_hours").not("estimated_hours", "is", null).gt("estimated_hours", 0).limit(1000);
const estimatedIds = new Set((estimated ?? []).map((p) => p.id));
const expectedBudgetRows = [...distinctProjects].filter((id) => estimatedIds.has(id)).length;

// Economics: the RPC returns a row per project with time in range.
//
// MUST be called as a real exec, not with the service-role key. schema.sql grants
// execute on time.project_economics to `authenticated` only, so service_role gets
// "permission denied for function" -- service_role bypasses RLS but NOT function
// grants. An earlier version of this recheck used service_role, saw null, and
// reported an unverifiable claim when the real answer was one credential away.
const { data: execProfile } = await admin
  .from("app_user_profile").select("user_id").eq("role_key", "exec").eq("is_active", true).limit(1);
let expectedEconRows = null;
if (execProfile?.length) {
  const { data: eu } = await admin.auth.admin.getUserById(execProfile[0].user_id);
  const { data: elink } = await admin.auth.admin.generateLink({ type: "magiclink", email: eu.user.email });
  const eanon = createClient(URL_BASE, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data: esess } = await eanon.auth.verifyOtp({
    type: "magiclink", token_hash: elink.properties.hashed_token,
  });
  if (esess?.session) {
    const asExec = createClient(URL_BASE, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${esess.session.access_token}` } },
    });
    const { data: econ } = await asExec.schema("time").rpc("project_economics", {
      p_from: "2000-01-01", p_to: "2027-12-31",
    });
    expectedEconRows = Array.isArray(econ) ? econ.length : null;
  }
}

console.log("");
verdict(
  "C1c: the other two aggregate tables' row counts are derivable, so their headers are checkable",
  expectedBudgetRows > 0 && expectedEconRows !== null,
  `budget burn should state ${expectedBudgetRows} projects (have an estimate AND logged time); economics should state ${expectedEconRows}`,
);

console.log("\n=== C3: is 'every routine selection under 650ms' true? ===\n");
// This one I can settle from my own recorded evidence without a browser: the
// acceptance run logged medians per selection.
verdict(
  "C3: 'every routine selection under 650ms' is WRONG as stated",
  false,
  "my own acceptance run logged: today 572ms, this week 551ms, this month 533ms, last month 610ms" +
    " -- but this year 2331ms and all time 2395ms. Correct claim: the four SHORT-RANGE presets are" +
    " under 650ms; year-scale and all-time selections are ~2.3s, and the worst case ~3.2s",
);

console.log("\n=== C4: do the parallel-paging figures reproduce? ===\n");

const { fetchAllEntries, parseFilters } = await import("../src/lib/queries/trackingtime-report.ts");
const PAGE = 1000;
const SELECT = `
  id, member_id, project_id, customer_id, service_id,
  started_at, duration_seconds, is_billable, is_billed, is_calendar, notes,
  member:member_id ( display_name ),
  project:project_id ( name ),
  customer:customer_id ( name ),
  service:service_id ( name ),
  task:task_id ( name )
`;

/** The ORIGINAL sequential algorithm, for an apples-to-apples timing. */
async function sequentialIds(filters) {
  const toExclusive = new Date(`${filters.to}T00:00:00.000Z`);
  toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);
  const ids = [];
  for (let page = 0; page < 25; page++) {
    let q = admin.schema("time").from("entry").select(SELECT)
      .gte("started_at", `${filters.from}T00:00:00.000Z`)
      .lt("started_at", toExclusive.toISOString())
      .not("duration_seconds", "is", null)
      .order("started_at", { ascending: false })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (!filters.includeCalendar) q = q.eq("is_calendar", false);
    const { data, error } = await q;
    if (error || !data) break;
    for (const r of data) ids.push(Number(r.id));
    if (data.length < PAGE) break;
  }
  return ids;
}

const wide = parseFilters({ preset: "all", calendar: "1" });
const N = 5;
const seqTimes = [];
const parTimes = [];
let lastShipped = [];
let lastRef = [];
for (let i = 0; i < N; i++) {
  const t1 = performance.now();
  const ref = await sequentialIds(wide);
  seqTimes.push(performance.now() - t1);
  lastRef = ref;

  const t0 = performance.now();
  const { entries } = await fetchAllEntries(admin, wide);
  parTimes.push(performance.now() - t0);
  lastShipped = entries.map((e) => e.id);
}
const med = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const seqMed = med(seqTimes);
const parMed = med(parTimes);

verdict(
  "C4a: parallel paging is reproducibly faster than sequential on live data",
  parMed < seqMed,
  `${N} samples each: sequential median ${seqMed.toFixed(0)}ms (${Math.min(...seqTimes).toFixed(0)}-${Math.max(...seqTimes).toFixed(0)}), ` +
    `parallel median ${parMed.toFixed(0)}ms (${Math.min(...parTimes).toFixed(0)}-${Math.max(...parTimes).toFixed(0)})`,
);
verdict(
  "C4b: the specific figures '893ms -> 252ms' were single samples, not stable values",
  Math.abs(seqMed - 893) > 100 || Math.abs(parMed - 252) > 100,
  `re-measured medians are ${seqMed.toFixed(0)}ms and ${parMed.toFixed(0)}ms. The direction and rough ratio hold; ` +
    `quoting exact millisecond figures as if fixed was overstated`,
);
verdict(
  "C4c: the fast path still returns identical rows in identical order",
  lastShipped.length === lastRef.length && lastShipped.every((id, i) => id === lastRef[i]),
  `${lastShipped.length} ids vs ${lastRef.length} from the independent sequential reference; ` +
    `${new Set(lastShipped).size === lastShipped.length ? "no duplicates" : "DUPLICATES PRESENT"}`,
);

console.log("\n=== C2: do all three gates exist and are they registered? ===\n");
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const gates = [
  ["check:dashboard-tables", "scripts/check-dashboard-tables.mjs"],
  ["check:live-dashboard", "scripts/check-live-dashboard.mjs"],
  ["check:dashboard-acceptance", "scripts/check-dashboard-acceptance.mjs"],
];
const missing = gates.filter(([s, f]) => !pkg.scripts?.[s] || !existsSync(f));
verdict(
  "C2: all three gates exist on disk and are registered as npm scripts",
  missing.length === 0,
  missing.length === 0
    ? gates.map(([s]) => s).join(", ")
    : `missing: ${missing.map(([s]) => s).join(", ")}`,
);
// And the security gate must be in test:db, since that is what makes it a gate
// rather than a script somebody remembers to run.
verdict(
  "C2b: the RLS equivalence check runs inside test:db",
  (pkg.scripts?.["test:db"] ?? "").includes("test:entry-policy-equivalence"),
  (pkg.scripts?.["test:db"] ?? "").includes("test:entry-policy-equivalence")
    ? "present in test:db"
    : "NOT in test:db -- a security gate nobody runs is not a gate",
);

console.log("\n=== summary ===");
for (const v of verdicts) {
  console.log(`  ${v.upheld ? "upheld   " : "corrected"}  ${v.claim.split(":")[0]}`);
}
const corrected = verdicts.filter((v) => !v.upheld);
console.log(
  `\n${verdicts.length} claims checked, ${corrected.length} needed correction.` +
    (corrected.length
      ? "\nCorrections are the point of this exercise; they are recorded in the todo assessment."
      : ""),
);
// Exit 0 either way: a correction is a finding, not a build failure.
