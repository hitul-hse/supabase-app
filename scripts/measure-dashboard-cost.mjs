/**
 * Measure the dashboard's server-side data cost against the LIVE database.
 *
 * WHY: the user asked for "quick reponses" and nothing in this module has ever
 * been timed. `fetchAllEntries` pages SEQUENTIALLY at 1000 rows per request, so a
 * wide selection is N serial HTTP round trips before the page can render -- and
 * every filter change re-runs all of them. Whether that is 200ms or 4s is not
 * something reasoning can answer, and I had been asserting "instant" from the
 * shape of the code rather than from a clock.
 *
 * This talks to the real project with the service-role key, so it measures real
 * network and real row counts. It does NOT go through RLS, so the numbers are a
 * lower bound on what a user experiences -- policy evaluation only adds time.
 *
 * Run: node scripts/measure-dashboard-cost.mjs
 */
import { readFileSync } from "node:fs";

// .env.local, parsed directly: this is a measurement script, not part of the app,
// and pulling in a dotenv dependency for four lines would be worse.
const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const URL_BASE = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_BASE || !KEY) {
  console.log("SKIP: no live credentials in .env.local");
  process.exit(0);
}

const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  "Accept-Profile": "time",
};

/** One timed request. Returns ms and the row count. */
async function timed(path) {
  const t0 = performance.now();
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, { headers });
  const body = await res.text();
  const ms = performance.now() - t0;
  let rows = null;
  try {
    const j = JSON.parse(body);
    rows = Array.isArray(j) ? j.length : null;
  } catch {
    /* not an array response */
  }
  return { ms, rows, status: res.status, body: body.slice(0, 160) };
}

// Is the `time` schema even reachable? Every gate so far has used a stub because
// it reportedly is not, and that claim is worth re-checking rather than inheriting.
const probe = await timed("entry?select=id&limit=1");
console.log(`time.entry probe: HTTP ${probe.status} in ${probe.ms.toFixed(0)}ms`);
if (probe.status !== 200) {
  console.log(`  body: ${probe.body}`);
  console.log("\nThe `time` schema is not exposed over REST on this project, so the");
  console.log("dashboard cannot be timed against live data from here. The stub-based");
  console.log("gate remains the only end-to-end check available.");
  process.exit(0);
}

// How much data is actually there? This decides whether sequential paging matters.
const count = await fetch(`${URL_BASE}/rest/v1/entry?select=id`, {
  headers: { ...headers, Prefer: "count=exact", Range: "0-0" },
});
const total = Number((count.headers.get("content-range") ?? "/0").split("/")[1]);
console.log(`time.entry rows: ${total.toLocaleString("en-GB")}`);

// The exact SELECT the dashboard issues, including every embedded relation --
// the joins are most of the cost, so timing a bare `select=id` would flatter it.
const SELECT = [
  "id,member_id,project_id,customer_id,service_id",
  "started_at,duration_seconds,is_billable,is_billed,is_calendar,notes",
  "member:member_id(display_name)",
  "project:project_id(name)",
  "customer:customer_id(name)",
  "service:service_id(name)",
  "task:task_id(name)",
].join(",");

console.log("\n--- one page (1000 rows, the dashboard's real SELECT) ---");
const pageTimes = [];
for (let i = 0; i < 3; i++) {
  const r = await timed(
    `entry?select=${encodeURIComponent(SELECT)}&duration_seconds=not.is.null&order=started_at.desc&offset=0&limit=1000`,
  );
  pageTimes.push(r.ms);
  console.log(`  run ${i + 1}: ${r.ms.toFixed(0)}ms for ${r.rows} rows`);
}
const perPage = pageTimes.reduce((a, b) => a + b, 0) / pageTimes.length;

console.log("\n--- the all-time selection, paged SEQUENTIALLY as the app does ---");
const t0 = performance.now();
let fetched = 0;
for (let page = 0; page < 25; page++) {
  const r = await timed(
    `entry?select=${encodeURIComponent(SELECT)}&duration_seconds=not.is.null&order=started_at.desc&offset=${page * 1000}&limit=1000`,
  );
  fetched += r.rows ?? 0;
  if ((r.rows ?? 0) < 1000) break;
}
const serial = performance.now() - t0;
console.log(`  ${fetched.toLocaleString("en-GB")} rows in ${serial.toFixed(0)}ms`);

console.log("\n--- the same pages fetched in PARALLEL ---");
// The page count is knowable up front from an exact count, so the pages do not
// have to be discovered one at a time. This is the whole question: if parallel is
// materially faster, the sequential loop is costing the user seconds per filter
// change for no reason.
const pages = Math.ceil(fetched / 1000);
const t1 = performance.now();
const results = await Promise.all(
  Array.from({ length: pages }, (_, p) =>
    timed(
      `entry?select=${encodeURIComponent(SELECT)}&duration_seconds=not.is.null&order=started_at.desc&offset=${p * 1000}&limit=1000`,
    ),
  ),
);
const parallel = performance.now() - t1;
const gotParallel = results.reduce((a, r) => a + (r.rows ?? 0), 0);
console.log(`  ${gotParallel.toLocaleString("en-GB")} rows in ${parallel.toFixed(0)}ms across ${pages} parallel requests`);

console.log("\n--- filter option lookups (also on every page load) ---");
for (const q of [
  "member?select=id,display_name&is_archived=eq.false&order=display_name.asc",
  "project?select=id,name,estimated_hours,customer:customer_id(name)&order=name.asc&limit=1000",
  "customer?select=id,name&order=name.asc&limit=1000",
  "service?select=id,name&order=sort_order.asc",
]) {
  const r = await timed(q);
  console.log(`  ${q.split("?")[0].padEnd(9)} ${r.ms.toFixed(0).padStart(5)}ms  ${r.rows} rows`);
}

console.log("\n=== verdict ===");
console.log(`per page (1000 rows, with joins): ${perPage.toFixed(0)}ms`);
console.log(`all-time, sequential:             ${serial.toFixed(0)}ms  <- what ships today`);
console.log(`all-time, parallel:               ${parallel.toFixed(0)}ms`);
const saved = serial - parallel;
console.log(
  saved > 250
    ? `\nParallel paging would save ~${saved.toFixed(0)}ms on every all-time load and every\nfilter change over a wide range. Worth doing.`
    : `\nSequential paging costs ~${saved.toFixed(0)}ms versus parallel, which is not the\nbottleneck. Look elsewhere before adding concurrency.`,
);
