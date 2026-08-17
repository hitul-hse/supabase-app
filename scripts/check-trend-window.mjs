// Overview billable-trend window: which 12 weeks reach the chart.
//
// `getExecutiveOverview` reads `weekly_billable_trend` with a LIMIT, and the
// ordering decides which end of the history that limit keeps. Postgres applies
// ORDER BY before LIMIT, so ascending order returns the OLDEST rows -- the
// chart then silently pins itself to the start of the dataset and never shows
// the current week, while still looking entirely plausible. That is the failure
// mode worth a test: nothing errors, the numbers are simply the wrong weeks.
//
// This pins the two halves of the contract that have to stay in agreement:
//   1. the query orders DESCENDING, so LIMIT keeps the most recent weeks, and
//   2. buildBillableTrend reverses them back, so the x-axis still reads
//      oldest -> newest.
// Get either half right and the other wrong and the chart is wrong, so both
// are asserted here rather than trusting one to imply the other.
import { readFileSync } from "node:fs";

let failed = false;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failed = true;
};

const source = readFileSync(new URL("../src/lib/queries/hse.ts", import.meta.url), "utf8");

// --- 1. The query must not silently revert to ascending order -------------
// Matched as source text on purpose: the bug is invisible at runtime until the
// view holds more than WEEKS_ON_TREND_CHART rows, which it does not in a fresh
// environment, so a behavioural test would pass against an empty view.
const trendQuery = /\.from\("weekly_billable_trend"\)[\s\S]{0,400}?\.limit\(/.exec(source);
check("getExecutiveOverview queries weekly_billable_trend with a limit", Boolean(trendQuery));

if (trendQuery) {
  const block = trendQuery[0];
  check(
    "trend query orders period_start DESCENDING (so LIMIT keeps the newest weeks)",
    /\.order\(\s*"period_start"\s*,\s*\{\s*ascending:\s*false\s*\}\s*\)/.test(block),
    "ascending order would return the OLDEST weeks and the chart would never show the current week",
  );
}

// --- 2. buildBillableTrend must reverse the synced rows back --------------
const builder = /function buildBillableTrend\([\s\S]*?\n}/.exec(source);
check("buildBillableTrend exists", Boolean(builder));

if (builder) {
  const body = builder[0];
  check(
    "buildBillableTrend reverses the synced rows back to oldest-first",
    /\[\s*\.\.\.\s*synced\s*\]\s*\.reverse\(\)/.test(body),
    "without this the chart plots newest-to-oldest left-to-right",
  );
  // A bare `synced.reverse()` mutates the caller's array in place. Under React
  // 19 that is a render-time mutation of a value derived from server data, the
  // exact class of bug that produced wrong odometer digits elsewhere in this
  // codebase, so the copy is part of the contract rather than a style choice.
  check(
    "the reverse is on a copy, not the caller's array",
    !/[^.\]]\bsynced\.reverse\(\)/.test(body),
    "mutating the input array in place is a React 19 render-mutation hazard",
  );
}

// --- 3. The window logic itself, on data big enough to expose it ----------
// 30 weeks of history, oldest first, as the view would return with ORDER BY asc.
const weeks = [];
for (let i = 0; i < 30; i += 1) {
  const monday = new Date(Date.UTC(2026, 0, 5 + i * 7));
  weeks.push({ period_start: monday.toISOString().slice(0, 10) });
}
const WEEKS_ON_CHART = 12;
const newest = weeks[weeks.length - 1].period_start;

const ascending = [...weeks].sort((a, b) => a.period_start.localeCompare(b.period_start));
const oldWindow = ascending.slice(0, WEEKS_ON_CHART);
const newWindow = [...weeks]
  .sort((a, b) => b.period_start.localeCompare(a.period_start))
  .slice(0, WEEKS_ON_CHART)
  .reverse();

// The negative control: assert the OLD behaviour was genuinely broken. Without
// this, the assertions below could pass for the wrong reason and nobody would
// know the test had stopped discriminating.
check(
  "negative control: ascending+limit really does drop the newest week",
  !oldWindow.some((r) => r.period_start === newest),
  "if this fails the fixture no longer has enough history to expose the bug",
);

check(
  "descending+limit+reverse includes the newest week",
  newWindow.some((r) => r.period_start === newest),
);
check(
  `window is exactly ${WEEKS_ON_CHART} weeks`,
  newWindow.length === WEEKS_ON_CHART,
  `got ${newWindow.length}`,
);
check(
  "window reads oldest -> newest for the chart's x-axis",
  newWindow.every((r, i) => i === 0 || r.period_start >= newWindow[i - 1].period_start),
);
check(
  "window is the most recent slice, not an arbitrary one",
  newWindow[newWindow.length - 1].period_start === newest,
  `last point ${newWindow[newWindow.length - 1].period_start}, newest ${newest}`,
);

// Fewer rows than the limit must still work. weekly_billable_trend is empty in
// this deployment (the Factorial sync has never run), so the TrackingTime tier
// added in section 4 is what actually feeds the chart -- and it starts short
// too, growing a week at a time.
const shortWindow = [...weeks.slice(0, 3)]
  .sort((a, b) => b.period_start.localeCompare(a.period_start))
  .slice(0, WEEKS_ON_CHART)
  .reverse();
check("fewer weeks than the limit returns them all, oldest-first", shortWindow.length === 3);
check(
  "short window still ascending",
  shortWindow.every((r, i) => i === 0 || r.period_start >= shortWindow[i - 1].period_start),
);

const emptyWindow = [].slice(0, WEEKS_ON_CHART).reverse();
check("empty view yields an empty window without throwing", emptyWindow.length === 0);

// --- 4. The home page must not fall through to invented numbers -----------
//
// THE BUG THIS EXISTS TO PREVENT COMING BACK
// ------------------------------------------
// buildBillableTrend used to try exactly two sources: weekly_billable_trend
// (Factorial) and then the seeded `weekly_trends` demo table. The Factorial
// pipeline has never run in this deployment -- weekly_employee_summary, the
// base table behind that view, holds 0 rows -- so the first tier always
// returned nothing and EVERY signed-in user's home page silently rendered 12
// weeks of invented hours. Meanwhile time.org_week held 27 weeks of real
// imported TrackingTime, one schema away and unread.
//
// Nothing errored. The chart looked entirely plausible; it was labelled
// "SAMPLE DATA" in 10.5px mono and read as real by anyone glancing at it.
// That is the failure mode: a confident wrong number on the landing page of a
// business-intelligence app.
//
// The assertions below pin the three-tier order. They are deliberately
// structural rather than behavioural: a runtime test needs a populated
// database, and the whole point is that this broke precisely BECAUSE the
// upstream table was empty.
const builderBody = /function buildBillableTrend\([\s\S]*?\n}/.exec(source)?.[0] ?? "";

check(
  "buildBillableTrend takes a TrackingTime tier between synced and seeded",
  /function buildBillableTrend\(\s*synced[^)]*?tracked[^)]*?seeded/s.test(source),
  "without the middle tier the page falls straight through to the demo rows",
);

check(
  "getExecutiveOverview actually fetches the TrackingTime weeks",
  /getOrgWeeks\(\s*supabase\s*,\s*WEEKS_ON_TREND_CHART\s*\)/.test(source),
  "the tier is useless if nothing populates it",
);

check(
  "the TrackingTime tier is tried BEFORE the seeded fallback",
  builderBody.indexOf("tracked.length > 0") > -1 &&
    builderBody.indexOf("tracked.length > 0") < builderBody.indexOf('source: "sample"'),
  "order matters: real data must win over invented data",
);

check(
  'the TrackingTime tier reports itself as "synced", not "sample"',
  /tracked\.length > 0[\s\S]{0,120}source:\s*"synced"/.test(builderBody),
  "mislabelling real data as sample would make the page disclaim numbers that are true",
);

// The seeded tier must still EXIST -- a fix that deleted it would break the
// first-run experience, and "delete the fallback" is the tempting wrong fix.
check(
  "the seeded fallback still exists for a genuinely empty deployment",
  /source:\s*"sample"/.test(builderBody),
  "removing it would leave a blank chart before any sync has run",
);

console.log(failed ? "\nTREND WINDOW: FAILED" : "\nTREND WINDOW: all checks passed");
process.exit(failed ? 1 : 0);
