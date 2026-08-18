// Overview billable-trend window: which 12 weeks reach the chart.
//
// HISTORY OF THIS FILE
// --------------------
// It originally pinned the ordering contract inside getExecutiveOverview():
// Postgres applies ORDER BY before LIMIT, so an ascending sort returns the
// OLDEST weeks and the chart silently pins itself to the start of the dataset
// while still looking entirely plausible.
//
// getExecutiveOverview() is now GONE. The landing page reads real TrackingTime
// through getLiveOverview() (queries/overview-live.ts), which delegates the
// window to getOrgWeeks() in queries/time-dashboard.ts. The bug did not go
// away with the function -- getOrgWeeks has exactly the same ordering hazard,
// and it now feeds both the landing page and the TrackingTime dashboard, so
// getting it wrong is worse than before.
//
// So the assertions follow the code: same contract, new home.
//   1. the query orders DESCENDING, so LIMIT keeps the most recent weeks, and
//   2. the result is reversed back, so the x-axis reads oldest -> newest.
// Get either half right and the other wrong and the chart is wrong, so both
// are asserted rather than trusting one to imply the other.
import { readFileSync } from "node:fs";

let failed = false;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failed = true;
};

const dashboard = readFileSync(
  new URL("../src/lib/queries/time-dashboard.ts", import.meta.url),
  "utf8",
);
const overview = readFileSync(
  new URL("../src/lib/queries/overview-live.ts", import.meta.url),
  "utf8",
);

// --- 1. The query must not silently revert to ascending order -------------
// Matched as source text on purpose: the bug is invisible at runtime until the
// view holds more than the limit, which it may not in a fresh environment, so
// a behavioural test would pass against a short table.
const trendQuery = /\.from\("org_week"\)[\s\S]{0,400}?\.limit\(/.exec(dashboard);
check("getOrgWeeks queries org_week with a limit", Boolean(trendQuery));

if (trendQuery) {
  check(
    "org_week query orders week_start DESCENDING (so LIMIT keeps the newest weeks)",
    /\.order\(\s*"week_start"\s*,\s*\{\s*ascending:\s*false\s*\}\s*\)/.test(trendQuery[0]),
    "ascending order would return the OLDEST weeks and the chart would never show the current week",
  );
}

// --- 2. getOrgWeeks must reverse the rows back to oldest-first ------------
const getter = /export async function getOrgWeeks\([\s\S]*?\n}/.exec(dashboard);
check("getOrgWeeks exists", Boolean(getter));

if (getter) {
  const body = getter[0];
  check(
    "getOrgWeeks reverses the rows back to oldest-first",
    /rows\.reverse\(\)/.test(body),
    "without this the chart plots newest-to-oldest left-to-right",
  );
  // `rows` is built by .map() immediately above, so it is already a fresh
  // array -- reversing it in place cannot reach the caller. The hazard worth
  // pinning is reversing the RAW `data` from PostgREST, which is shared.
  check(
    "the reverse is not applied to the raw PostgREST payload",
    !/\bdata\.reverse\(\)/.test(body),
    "mutating the fetched array in place is a React 19 render-mutation hazard",
  );
}

// --- 3. The landing page actually uses that window ------------------------
check(
  "getLiveOverview fetches its weeks through getOrgWeeks",
  /getOrgWeeks\(\s*supabase\s*,\s*OVERVIEW_WEEKS\s*\)/.test(overview),
  "a second, hand-rolled query would not inherit the ordering fix",
);

// --- 4. The window logic itself, on data big enough to expose it ----------
// 30 weeks of history, oldest first, as the view would return with ORDER BY asc.
const weeks = [];
for (let i = 0; i < 30; i += 1) {
  const monday = new Date(Date.UTC(2026, 0, 5 + i * 7));
  weeks.push({ week_start: monday.toISOString().slice(0, 10) });
}
const WEEKS_ON_CHART = 12;
const newest = weeks[weeks.length - 1].week_start;

const ascending = [...weeks].sort((a, b) => a.week_start.localeCompare(b.week_start));
const oldWindow = ascending.slice(0, WEEKS_ON_CHART);
const newWindow = [...weeks]
  .sort((a, b) => b.week_start.localeCompare(a.week_start))
  .slice(0, WEEKS_ON_CHART)
  .reverse();

// The negative control: assert the OLD behaviour was genuinely broken. Without
// this, the assertions below could pass for the wrong reason and nobody would
// know the test had stopped discriminating.
check(
  "negative control: ascending+limit really does drop the newest week",
  !oldWindow.some((r) => r.week_start === newest),
  "if this fails the fixture no longer has enough history to expose the bug",
);

check(
  "descending+limit+reverse includes the newest week",
  newWindow.some((r) => r.week_start === newest),
);
check(
  `window is exactly ${WEEKS_ON_CHART} weeks`,
  newWindow.length === WEEKS_ON_CHART,
  `got ${newWindow.length}`,
);
check(
  "window reads oldest -> newest for the chart's x-axis",
  newWindow.every((r, i) => i === 0 || r.week_start >= newWindow[i - 1].week_start),
);
check(
  "window is the most recent slice, not an arbitrary one",
  newWindow[newWindow.length - 1].week_start === newest,
  `last point ${newWindow[newWindow.length - 1].week_start}, newest ${newest}`,
);

// Fewer rows than the limit must still work -- org_week starts short in a
// fresh environment and grows a week at a time.
const shortWindow = [...weeks.slice(0, 3)]
  .sort((a, b) => b.week_start.localeCompare(a.week_start))
  .slice(0, WEEKS_ON_CHART)
  .reverse();
check("fewer weeks than the limit returns them all, oldest-first", shortWindow.length === 3);
check(
  "short window still ascending",
  shortWindow.every((r, i) => i === 0 || r.week_start >= shortWindow[i - 1].week_start),
);

const emptyWindow = [].slice(0, WEEKS_ON_CHART).reverse();
check("empty view yields an empty window without throwing", emptyWindow.length === 0);

console.log(failed ? "\nTREND WINDOW: FAILED" : "\nTREND WINDOW: all checks passed");
process.exit(failed ? 1 : 0);
