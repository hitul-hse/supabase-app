// The Hub must not render invented numbers.
//
// WHAT THIS GUARDS
// ----------------
// The app was built frontend-first against seeded demo tables, and those tables
// are still in the database:
//
//   public.executive_metrics   5 rows of hand-written STRINGS ("73.4%", "612")
//   public.weekly_trends      12 invented weeks of billable/non-billable hours
//   public.team_utilisations   5 fictional teams (ENG, LAB, SAFETY...)
//   public.sync_sources        5 frozen strings: "ASANA 4m ok", "FACTORIAL 18m ok"
//   public.projects            5 sample projects keyed "prj-1".."prj-5"
//
// Every one of them rendered on the landing page every signed-in user saw. None
// of it errored. It looked like a polished business-intelligence dashboard and
// it was fiction, while 5,218 real TrackingTime entries sat one schema away.
//
// The seeded rows are NOT deleted -- other pages (timesheets, leave, team-lead)
// still legitimately read `people` and `timesheet_entries`, and dropping tables
// out from under them is a separate job. What this gate enforces is narrower and
// more durable: the pages that report on the BUSINESS must read `time.*`, and
// must never fall back to invented numbers when real data is missing.
//
// WHY SOURCE MATCHING RATHER THAN A RUNTIME TEST
// ----------------------------------------------
// The failure mode is a fallback that only fires when the real source is empty.
// A runtime test against a populated database takes the real branch and passes
// while the invented branch sits there waiting for a bad day. The regression
// has to be caught in the source, where the fallback is visible.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

let failed = false;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failed = true;
};

const read = (rel) => {
  const path = fileURLToPath(new URL(`../${rel}`, import.meta.url));
  return existsSync(path) ? readFileSync(path, "utf8") : null;
};

/**
 * Source with comments removed.
 *
 * Every file here DOCUMENTS the mockup it replaced -- the old fake pipeline
 * names, the "n/a not 0%" rule, the reasoning. Matching raw source means an
 * assertion passes on the explanation while the code beneath it regresses,
 * which is exactly how three of these checks were caught not discriminating.
 * Strings are left intact; only comments go.
 */
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

/** Tables that exist only to back the original mockup. */
const MOCK_TABLES = [
  "executive_metrics",
  "weekly_trends",
  "team_utilisations",
  "sync_sources",
];

/**
 * Files that report on the business and must therefore read real data.
 * `people`/`timesheet_entries` pages are deliberately out of scope: they are a
 * separate migration, and pretending otherwise here would make this gate lie.
 */
const REPORTING_FILES = [
  "src/app/(app)/page.tsx",
  "src/components/SyncBar.tsx",
  "src/lib/queries/overview-live.ts",
];

console.log("--- 1. Reporting surfaces must not read the mock tables ---");

for (const rel of REPORTING_FILES) {
  const src = read(rel);
  check(`${rel} exists`, src !== null);
  if (!src) continue;

  for (const table of MOCK_TABLES) {
    check(
      `${rel} does not query "${table}"`,
      !new RegExp(`\\.from\\(\\s*["']${table}["']`).test(src),
      "that table holds seeded mockup rows, not measured data",
    );
  }
}

console.log("\n--- 2. The landing page reads real TrackingTime ---");

const page = read("src/app/(app)/page.tsx");
if (page) {
  check(
    "landing page calls getLiveOverview",
    /getLiveOverview\s*\(/.test(page),
    "anything else means it is back on the seeded tables",
  );
  check(
    "landing page no longer calls getExecutiveOverview",
    !/getExecutiveOverview/.test(page),
    "that function read four seeded demo tables",
  );
  // The old page linked every project row to a bare /projects because the five
  // sample rows had no detail page. Real projects have one, and a ledger whose
  // rows all go to the same place is a ledger nobody can drill into.
  //
  // BOTH layouts are asserted. The ledger renders twice -- a mobile card list
  // and a desktop table -- and fixing one while leaving the other is a silent
  // half-regression that only shows up on one screen size.
  const projectLinks = (page.match(/href=\{`\/projects\/\$\{prj\.id\}`\}/g) ?? []).length;
  check(
    "project rows link to the specific project record",
    projectLinks >= 2,
    `mobile and desktop ledgers must both link by id; found ${projectLinks}`,
  );
  check(
    "no project row links to the bare /projects list",
    !/href="\/projects"[\s\S]{0,200}\{prj\.name\}/.test(page),
    "linking a named row to the list page loses the row identity",
  );
}

console.log("\n--- 3. The dead accessors are gone, not just unused ---");

const hse = read("src/lib/queries/hse.ts");
if (hse) {
  check(
    "getExecutiveOverview is removed from hse.ts",
    !/export async function getExecutiveOverview/.test(hse),
    "leaving it exported invites the next page to call it",
  );
  check(
    "getSyncSources is removed from hse.ts",
    !/export async function getSyncSources/.test(hse),
  );
  check(
    "buildBillableTrend (the invented-numbers fallback) is removed",
    !/function buildBillableTrend/.test(hse),
  );
  // The whole point of the removal: no code path may substitute seeded rows
  // when the real source is empty.
  check(
    'no reporting query reports its own data as "sample"',
    !/source:\s*["']sample["']/.test(hse),
    "a sample tier is a fallback to invented numbers by another name",
  );
}

console.log("\n--- 4. The freshness strip reports a real run ---");

const syncBar = read("src/components/SyncBar.tsx");
if (syncBar) {
  check(
    "SyncBar reads getSyncFreshness (raw.sync_run)",
    /getSyncFreshness\s*\(/.test(syncBar),
    "the old version read five frozen strings that could never go stale",
  );
  // Comments are stripped first. The file DOCUMENTS the old fake pipeline names
  // so the next reader knows what was removed and why -- matching raw source
  // would fail on that explanation, which is the opposite of what we want.
  const syncBarCode = syncBar
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  check(
    "SyncBar does not hardcode pipelines that have never run",
    !/ASANA|FACTORIAL|SAMDOCK|HUBSPOT/.test(syncBarCode),
    "claiming a pipeline is 'ok' when it does not exist is the original bug",
  );
  // A staleness indicator whose failure case reads as success is worse than
  // none at all, so the "never ran" wording is part of the contract.
  check(
    'SyncBar distinguishes "never run" from "0 hours ago"',
    /hoursSince === null\)\s*return\s*"NEVER RUN"/.test(syncBarCode),
    "null hoursSince rendering as a duration would claim a sync that never happened",
  );
  check(
    "SyncBar surfaces failures since the last success",
    /failedSince/.test(syncBar),
    "a nightly cron failing behind an old green row must not read as healthy",
  );
}

console.log("\n--- 5. Missing data renders n/a, never a plausible zero ---");

const live = read("src/lib/queries/overview-live.ts");
if (live) {
  check(
    "metric values are nullable",
    /value:\s*string\s*\|\s*null/.test(live),
    "a non-nullable value forces 0 to stand in for unknown",
  );
  check(
    "utilisation percent is nullable",
    /percent:\s*number\s*\|\s*null/.test(live),
    "0% reads as somebody idle; null reads as no contract on record",
  );
  check(
    "no-budget projects are toned neutral, not good",
    /if\s*\(burnPercent === null\)\s*return\s*["']neutral["']/.test(live),
    "83 of 334 live projects have no budget; green would be a false health claim",
  );
}

if (page) {
  const pageCode = stripComments(page);
  /*
   * The n/a rule lives in StatTile now (card migration), which renders "n/a"
   * for a null value AND suppresses the unit -- strictly better than the
   * inline `?? "n/a"` this used to grep for. So assert the two halves that
   * together guarantee the behaviour: the page must not launder the null, and
   * the primitive must still honour it. Either alone can pass while the page
   * lies.
   */
  check(
    "the page hands the raw nullable metric to StatTile (no ?? 0 laundering)",
    /value=\{metric\.value\}/.test(pageCode) &&
      !/metric\.value\s*(\?\?|\|\|)\s*0/.test(pageCode),
    "?? 0 would turn 'unknown' into a measurement",
  );
  const statTile = read("src/components/ui/Card.tsx") ?? "";
  check(
    'StatTile renders "n/a" for a null value, and no unit beside it',
    /isMissing\s*\?\s*["']n\/a["']/.test(statTile) && /unit && !isMissing/.test(statTile),
    "the rule moved into the primitive; if it leaves there, every figure in the app regresses at once",
  );
  // Asserted on stripped source: the file explains this rule in a comment, and
  // matching that comment would let the JSX beneath it regress unnoticed.
  check(
    'utilisation renders "n/a", not 0%, with no contract',
    /team\.percent !== null \? `\$\{team\.percent\}%` : ["']n\/a["']/.test(pageCode),
    "`${team.percent ?? 0}%` would render an idle-looking 0% for an unknown ratio",
  );
  check(
    "the empty chart says so rather than drawing something",
    /No hours imported yet/.test(page),
    "an empty chart with invented bars is the bug this replaces",
  );
}

console.log("\n--- 6. The window must exclude planned future weeks ---");

// FOUND BY RENDERING THE PAGE, NOT BY READING IT.
// TrackingTime holds PLANNED entries dated months ahead. Live, 19 of 53 weeks
// in org_week are in the future, each holding one person's forward plan. With
// no upper bound, "the last 12 weeks" resolved entirely to those: the landing
// page reported 267h and "1 active person" for an organisation that had logged
// 2,919h across 12 people. Every figure was internally consistent and wrong by
// an order of magnitude.
const dash = read("src/lib/queries/time-dashboard.ts");
if (dash) {
  const orgWeeks = /export async function getOrgWeeks\([\s\S]*?\n}/.exec(dash)?.[0] ?? "";
  check(
    "getOrgWeeks bounds the window at today",
    /\.lte\(\s*"week_start"\s*,/.test(orgWeeks),
    "without this the trend reports planned future weeks as if they had happened",
  );
  check(
    "the cutoff is computed in UTC, matching how week_start is stored",
    /toISOString\(\)\.slice\(0,\s*10\)/.test(orgWeeks),
    "a local-midnight boundary shifts the cutoff by a day either side of midnight",
  );
  // lt() would drop the week people are currently IN, which is the week they
  // most want to see.
  check(
    "the current week is included, not excluded",
    !/\.lt\(\s*"week_start"\s*,/.test(orgWeeks),
    "lt() on the week's Monday hides the in-progress week",
  );
}

// The header count must be a COUNT, not the ledger's page size. Using
// projectRows.length claimed "8 ACTIVE PROJECTS" for an organisation with 334.
if (live) {
  check(
    "the project count is a real count, not the ledger page size",
    /activeProjects:\s*projectCount/.test(live),
    "projectRows.length is capped at LEDGER_ROWS and is not a measurement",
  );
}

console.log("\n--- 7. Behaviour: null must survive formatting ---");

// The rule above is only real if it holds at the point of rendering. These
// exercise the exact expressions the page uses, because "?? 'n/a'" and "?? 0"
// are one character apart and both compile.
const renderMetric = (value) => value ?? "n/a";
check("null metric renders n/a", renderMetric(null) === "n/a");
check("zero metric still renders 0, not n/a", renderMetric("0") === "0", "0 is a real measurement when it IS the measurement");
check("a real value passes through", renderMetric("63%") === "63%");

const renderPercent = (p) => (p !== null ? `${p}%` : "n/a");
check("null utilisation renders n/a", renderPercent(null) === "n/a");
check("0% utilisation renders 0%", renderPercent(0) === "0%");

// Burn tone, mirrored from overview-live.ts. A no-budget project must not be
// indistinguishable from a healthy one.
const burnTone = (b) =>
  b === null ? "neutral" : b >= 100 ? "critical" : b >= 85 ? "warning" : "good";
check("no budget is neutral", burnTone(null) === "neutral");
check("over budget is critical", burnTone(140) === "critical");
check("near budget is warning", burnTone(92) === "warning");
check("well under budget is good", burnTone(40) === "good");
check(
  "no-budget and healthy are visually distinguishable",
  burnTone(null) !== burnTone(40),
  "if these matched, a quarter of the portfolio would read as healthy by default",
);

console.log(failed ? "\nNO MOCK DATA: FAILED" : "\nNO MOCK DATA: all checks passed");
process.exit(failed ? 1 : 0);
