// Coverage for the three things added around the TrackingTime API Dashboard:
// the scheduled sync, the freshness indicator, and breakdown drill-down.
//
// Static analysis plus a PGlite check on the app_module state, deliberately in
// that order: the expensive part of these features is not the SQL, it is a set
// of decisions that are easy to undo by accident later --
//
//   * started_at written explicitly (the reversed-timestamp bug),
//   * freshness read from the last SUCCESSFUL run, not the last run,
//   * the sync chaining the link step rather than leaving it manual,
//   * drill-down composing filters instead of replacing them.
//
// Each of those reads as a harmless simplification to someone tidying up, and
// each produces a confidently wrong dashboard rather than an error.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

let failures = 0;
function check(label, ok, detail) {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

const read = (p) => readFileSync(p, "utf8");

const IMPORT = read("scripts/import-trackingtime.mjs");
const SYNC = read("scripts/sync-trackingtime.mjs");
const FRESHNESS = read("scripts/check-sync-freshness.mjs");
const QUERIES = read("src/lib/queries/time-dashboard.ts");
// The dashboard's presentation is split across several files and the split
// MOVES: BreakdownTable and BudgetTable began in ReportPanels.tsx and were
// lifted into ReportTables.tsx once they gained sorting and paging state.
// Pinning a filename here made this gate fail on a legitimate refactor that had
// faithfully preserved every behaviour it checks — a gate that cries wolf on a
// file move is one people learn to skip. Read the whole directory and assert on
// the BEHAVIOUR, wherever it now lives.
const DASHBOARD_DIR = "src/app/(app)/time/dashboard";
const PANELS = readdirSync(DASHBOARD_DIR)
  .filter((f) => f.endsWith(".tsx"))
  .map((f) => read(join(DASHBOARD_DIR, f)))
  .join("\n");
const PAGE = read("src/app/(app)/time/dashboard/page.tsx");
const WORKFLOW = read(".github/workflows/sync-trackingtime.yml");
const PKG = JSON.parse(read("package.json"));

// ── 1. The reversed-timestamp bug ──────────────────────────────────────────
// raw.sync_run.started_at DEFAULTS to now(), which Postgres evaluates when the
// row is inserted -- i.e. after the run has finished. The first live row has
// finished_at 254ms BEFORE started_at. Any duration computed from that pair is
// negative, and a dashboard reporting "last sync took -0.3s" has a column that
// does not mean what its name says.
check(
  "recordRun writes started_at explicitly rather than leaving it to now()",
  /started_at:\s*RUN_STARTED_AT/.test(IMPORT),
  "without this, started_at is stamped at INSERT — after finished_at",
);
check(
  "the start time is captured at module load, not inside recordRun",
  /const RUN_STARTED_AT = new Date\(\);/.test(IMPORT) &&
    IMPORT.indexOf("const RUN_STARTED_AT") < IMPORT.indexOf("async function recordRun"),
  "capturing it inside the function would reintroduce the same bug",
);
check(
  "a failed sync_run insert is reported, not swallowed",
  /could not record the sync run/.test(IMPORT),
  "a silent failure here means the dashboard reports data older than it is",
);
check(
  "the run records which window it covered",
  /cursor_ref:\s*`days=/.test(IMPORT),
);

// ── 2. The sync chains the link step ───────────────────────────────────────
// New members import with user_id NULL. current_member_id() then returns NULL,
// RLS correctly shows them nothing, and /time tells them "no record linked"
// while their hours sit in the database. The link step is not optional.
check(
  "the sync runs the member-linking step",
  /link-time-members\.mjs/.test(SYNC) && /--apply/.test(SYNC),
);
check(
  "a link failure is distinguished from an import failure",
  /SYNC PARTIAL/.test(SYNC),
  "the hours are correct; what is broken is one person's own /time page",
);
check(
  "a failed import aborts before the link step",
  SYNC.indexOf("SYNC FAILED at the import step") < SYNC.indexOf("linking members"),
);
check(
  "the default window overlaps rather than resuming from a high-water mark",
  /OVERLAP_DAYS/.test(SYNC),
  "TrackingTime entries are editable after the fact, so a strict cursor loses edits",
);
check(
  "--since-last falls back to a full pull when no successful run exists",
  /no previous successful run/.test(SYNC),
);

// ── 3. Freshness reads the last SUCCESS, not the last run ──────────────────
// A cron job failing every night, with an old green row still on record, is
// exactly the state this must not render as healthy.
check(
  "getSyncFreshness filters on status = ok",
  /\.eq\("status",\s*"ok"\)/.test(QUERIES),
);
check(
  "failures since the last success are counted separately",
  /failedSince/.test(QUERIES),
);
check(
  "a failure since the last success downgrades the status",
  /failedSince > 0/.test(QUERIES) && /"stale"/.test(QUERIES),
);
check(
  "freshness degrades to a shape rather than throwing",
  /catch\s*{\s*\n?\s*return empty;/.test(QUERIES),
  "the raw schema may not be exposed in every environment",
);
check(
  "the freshness banner renders on the happy path too",
  /status === "ok"/.test(PANELS) && /Imported from the TrackingTime API/.test(PANELS),
  "hiding it when fresh trains people to assume freshness from its absence",
);
check(
  "the banner is rendered above the empty-state branch",
  PAGE.indexOf("<FreshnessBanner") < PAGE.indexOf("entries.length === 0"),
  "'no entries match' and 'the import stopped weeks ago' look identical otherwise",
);
check(
  "the freshness reporter flags a negative duration rather than formatting it away",
  /INVALID/.test(FRESHNESS),
);
check(
  "the freshness reporter uses process.exitCode, not process.exit",
  /process\.exitCode\s*=/.test(FRESHNESS) && !/process\.exit\(\s*label/.test(FRESHNESS),
  "process.exit() after fetch trips a libuv assertion on Windows and loses the code",
);

// ── 4. Drill-down composes ─────────────────────────────────────────────────
// These three assert BEHAVIOUR, not shape. The drill-down was refactored from
// an `hrefFor` callback into a precomputed `drillHrefs` map when the tables
// became Client Components — a Server Component cannot pass a function across
// that boundary, so the change was forced and correct. Matching the old
// callback signature would have failed a refactor that preserved every property
// below.
check(
  "the breakdown table receives per-row drill-down hrefs",
  /hrefFor/.test(PANELS) || /drillHrefs|hrefs\s*[:?]/.test(PANELS),
);
check(
  "rows with no id are not linked",
  /row\.id === null\)\s*(return null|continue)/.test(PAGE),
  "task rows are grouped by name and have no id to filter on",
);
check(
  "drilling ADDS to the existing filter rather than replacing it",
  /current\.includes\(row\.id\)\s*\?\s*current\s*:\s*\[\.\.\.current, row\.id\]/.test(PAGE),
  "replacing would reset customer when you click into one of its projects",
);
check(
  "a row that is already the sole selection is not linked",
  /current\.length === 1 && current\[0\] === row\.id/.test(PAGE),
  "a link that appears to do something and does nothing is worse than plain text",
);
check(
  "active filters are shown as removable chips",
  /activeDrills/.test(PAGE) && /Clear all/.test(PAGE),
  "otherwise a drill-down is a one-way door with no explanation of the smaller totals",
);
check(
  "removing the last value drops the parameter instead of sending an empty one",
  /\.join\(","\) \|\| null/.test(PAGE),
);
check(
  "drill links carry the date range and other filters through",
  /buildQuery\(filters,/.test(PAGE),
);

// ── 5. The dashboard gate on the portal tile's destination ─────────────────
// The tile now points here, and the tile is visible to anyone holding ANY time
// permission -- but the page needs read_all, which only exec has.
// requirePermission() sends a failure to "/", which would throw three of four
// roles out of their own module with no explanation.
check(
  "the dashboard sends an under-permissioned user to /time, not to /",
  /redirect\("\/time"\)/.test(PAGE),
  "every role holds timesheets:read_own; only exec holds read_all",
);
check(
  "the permission is still enforced in the page itself",
  /TIMESHEETS_READ_ALL/.test(PAGE) && /userHasPermission/.test(PAGE),
  "middleware is defence in depth, never the auth boundary (CVE-2025-29927)",
);
check(
  'the page title says "TrackingTime API Dashboard"',
  /title="TrackingTime API Dashboard"/.test(PAGE),
);

// ── 6. Wiring ──────────────────────────────────────────────────────────────
check("npm run sync:trackingtime exists", !!PKG.scripts["sync:trackingtime"]);
check("npm run check:sync-freshness exists", !!PKG.scripts["check:sync-freshness"]);
check(
  "the sync workflow is scheduled",
  /schedule:/.test(WORKFLOW) && /cron:/.test(WORKFLOW),
);
check(
  "the sync workflow can be triggered by hand",
  /workflow_dispatch:/.test(WORKFLOW),
);
check(
  "two syncs cannot run at once",
  /concurrency:/.test(WORKFLOW) && /cancel-in-progress:\s*false/.test(WORKFLOW),
  "cancelling mid-import is worse than running late",
);
check(
  "the workflow fails loudly on a missing secret",
  /TRACKINGTIME_AUTH is not set/.test(WORKFLOW),
  "otherwise a credential-less run records a 'successful' sync of zero rows",
);
check(
  "the sync workflow is separate from ci.yml",
  !/TRACKINGTIME_AUTH/.test(read(".github/workflows/ci.yml")),
  "CI must never hold live credentials or touch production data",
);

console.log(
  failures === 0
    ? "\nSYNC + DRILL-DOWN: all checks passed"
    : `\nSYNC + DRILL-DOWN: ${failures} check(s) failed`,
);
process.exitCode = failures === 0 ? 0 : 1;
