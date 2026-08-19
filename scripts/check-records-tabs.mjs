/**
 * The records surfaces are reached by TABS, not by a button in one page's header.
 *
 * THE BUG THIS LOCKS DOWN. The route to the personal time tracker was a
 * "My time tracker →" link in the TrackingTime dashboard's header. The user reported it
 * appearing only sometimes, out of nowhere -- and they were right, for a reason no amount
 * of reading the component could explain: it was an UNCOMMITTED local edit. Present in
 * the working tree, absent from the deployed build, so whether it was on screen depended
 * on which deployment was serving. Verified against production: the header rendered with
 * no actions element at all, and the link was never in the DOM across a 6-second sample.
 *
 * Tabs are the right shape independent of that. Navigation living in one page's header is
 * invisible from everywhere else and disappears the moment that header is edited.
 *
 * WHAT IS ASSERTED, and why each one is load-bearing:
 *
 *  1. The button is gone from the dashboard header, and no equivalent has been
 *     reintroduced. This is the literal request.
 *  2. All three surfaces render the tab row, so the same set of destinations is offered
 *     wherever you are. A tab row on two of three pages is the old problem in a new shape.
 *  3. The dashboard tab is gated on timesheets:read_all. /time/dashboard redirects anyone
 *     else back to /time, so an ungated tab would be a link that returns you to the page
 *     you are already on.
 *  4. The tab labels match what was asked for: "TrackingTime" for the tracker.
 *  5. Active state is computed longest-match-first, or /time/dashboard would light up the
 *     /time tab as well and two tabs would look current at once.
 */
import { readFileSync } from "node:fs";

let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? `\n        ${detail}` : ""}`);
};

/** Source with comments stripped: a claim in prose is not an implementation. */
const code = (path) =>
  readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "");

const tabsSrc = code("src/app/(app)/RecordsTabs.tsx");
const dashSrc = code("src/app/(app)/time/dashboard/page.tsx");
const timeSrc = code("src/app/(app)/time/page.tsx");
const sheetsSrc = code("src/app/(app)/timesheets/page.tsx");

// ── 1. The header button is gone ─────────────────────────────────────────
check(
  "the dashboard header no longer carries a My time tracker button",
  !/My time tracker/i.test(dashSrc),
  "this is the control the user reported as appearing only sometimes",
);
check(
  "the dashboard PageHeader has no actions prop at all",
  !/actions=\{/.test(dashSrc),
  "an actions prop is where the intermittent button lived; navigation belongs in the tabs",
);

// ── 2. Every surface renders the tabs ────────────────────────────────────
for (const [label, src] of [
  ["the TrackingTime dashboard", dashSrc],
  ["the TrackingTime tracker (/time)", timeSrc],
  ["Timesheets", sheetsSrc],
]) {
  check(
    `${label} renders the shared tab row`,
    /<RecordsTabs/.test(src),
    "a tab row missing from one surface recreates the original problem: a destination you can only reach from certain pages",
  );
}

// ── 3. The dashboard tab is permission-gated ─────────────────────────────
check(
  "the tabs component gates the dashboard tab on a flag rather than always showing it",
  /canReadAll/.test(tabsSrc) && /if \(canReadAll\)/.test(tabsSrc),
  "/time/dashboard redirects anyone without timesheets:read_all back to /time",
);
check(
  "/time asks for timesheets:read_all to decide",
  /TIMESHEETS_READ_ALL/.test(timeSrc),
  "asked as a permission, so the /admin/roles toggle decides it",
);
check(
  "Timesheets asks for timesheets:read_all to decide",
  /TIMESHEETS_READ_ALL/.test(sheetsSrc),
);
check(
  "the dashboard passes canReadAll without a lookup, because it already redirected",
  /<RecordsTabs canReadAll\s*\/>/.test(dashSrc),
  "that page returns early for anyone lacking the permission, so a second query would be dead weight",
);

// ── 4. The labels ────────────────────────────────────────────────────────
check(
  'a tab is labelled exactly "TrackingTime"',
  /label: "TrackingTime"/.test(tabsSrc),
  "the name the user asked for",
);
check(
  'the tracker tab points at /time, not /time/dashboard',
  /href: "\/time",\s*\n?\s*label: "TrackingTime"/.test(tabsSrc) ||
    /href: "\/time"[\s\S]{0,80}label: "TrackingTime"/.test(tabsSrc),
  "this is the replacement for the My time tracker button, so it must reach the tracker",
);
check(
  'a tab is labelled "Timesheets" and points at /timesheets',
  /href: "\/timesheets"[\s\S]{0,80}label: "Timesheets"/.test(tabsSrc),
);

// ── 5. Active state cannot light two tabs ────────────────────────────────
check(
  "the active tab is resolved longest-href-first",
  /sort\(\(a, b\) => b\.href\.length - a\.href\.length\)/.test(tabsSrc),
  "on /time/dashboard a naive startsWith would mark both the /time and the dashboard tab current",
);
check(
  "selection is exposed to assistive tech, not only by colour",
  /role="tab"/.test(tabsSrc) && /aria-selected=\{active\}/.test(tabsSrc) && /role="tablist"/.test(tabsSrc),
);

console.log(failed === 0 ? "\nRECORDS TABS: all checks passed" : `\n${failed} check(s) failed`);
process.exitCode = failed === 0 ? 0 : 1;
