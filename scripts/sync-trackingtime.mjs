/**
 * The scheduled refresh for the TrackingTime API Dashboard — the thing that
 * stops it being a snapshot frozen at whenever someone last ran the import by
 * hand.
 *
 * WHY THIS EXISTS AS A SEPARATE SCRIPT
 *
 * Before this, refreshing the dashboard was two commands that had to be run in
 * the right order by someone who knew both existed:
 *
 *     node scripts/import-trackingtime.mjs
 *     node scripts/link-time-members.mjs --apply
 *
 * Skipping the second is silent and nasty: the import happily creates new
 * time.member rows for colleagues who joined since the last run, those rows
 * have user_id NULL, time.current_member_id() returns NULL for them, and /time
 * tells them "no time-tracking record linked to your account" while their hours
 * sit in the database. The link step is not an optional extra, so it is not an
 * optional command.
 *
 * WHAT "INCREMENTAL" MEANS HERE
 *
 * The window, not the write. Every row still upserts on source_id, so a re-run
 * cannot duplicate an hour -- what changes is how far back we ask the vendor to
 * look. A daily run pulls a short window (default 14 days) instead of re-reading
 * 180 days of history, which is roughly a tenth of the API calls against a
 * vendor that rate-limits us.
 *
 * The window deliberately OVERLAPS rather than resuming from the last run's
 * end. TrackingTime entries are editable after the fact: someone correcting
 * Tuesday's hours on Friday changes a record whose date is already behind a
 * naive high-water mark. An overlapping window re-reads and re-upserts those,
 * which is exactly what idempotency is for. `--since-last` sizes the overlap
 * from the last successful run rather than assuming the schedule held.
 *
 * FAILURE IS RECORDED, NOT SWALLOWED
 *
 * If the import fails, that failure is already written to raw.sync_run by the
 * importer itself, and this script exits non-zero. The dashboard's freshness
 * indicator reads the last SUCCESSFUL run, so a string of failures shows up as
 * ageing data rather than as a green light -- the opposite of a cron job whose
 * only evidence of health is that nobody complained.
 *
 * Usage:
 *   node scripts/sync-trackingtime.mjs                 # last 14 days, then link
 *   node scripts/sync-trackingtime.mjs --days 30
 *   node scripts/sync-trackingtime.mjs --since-last    # size the window from raw.sync_run
 *   node scripts/sync-trackingtime.mjs --full          # 180 days, the original behaviour
 *   node scripts/sync-trackingtime.mjs --dry-run       # fetch + transform, no writes
 *   node scripts/sync-trackingtime.mjs --no-link       # import only (diagnosing the link step)
 */
import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

const args = process.argv.slice(2);
const has = (f) => args.includes(f);

const DRY_RUN = has("--dry-run");
const NO_LINK = has("--no-link");
const FULL = has("--full");
const SINCE_LAST = has("--since-last");

const explicitDays = args.indexOf("--days") >= 0 ? Number(args[args.indexOf("--days") + 1]) : null;

/**
 * Default window for a scheduled run. Two weeks, not two days: it has to
 * survive a weekend plus a bank holiday plus one failed run without leaving a
 * hole, and the cost of overlap is only vendor API calls, while the cost of a
 * gap is hours that never arrive.
 */
const DEFAULT_DAYS = 14;

/** Slack added to a `--since-last` window, for the after-the-fact edit case. */
const OVERLAP_DAYS = 3;

function loadEnv() {
  const env = { ...process.env };
  if (existsSync(".env.local")) {
    for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && !env[m[1]]) env[m[1]] = m[2].trim();
    }
  }
  return env;
}
const ENV = loadEnv();

/**
 * Sizes the window from the last successful run rather than trusting that the
 * schedule actually fired. If cron was down for a week, `--since-last` pulls a
 * week; a fixed `--days 2` would silently lose five days of hours.
 */
async function daysSinceLastSuccess() {
  const url = ENV.NEXT_PUBLIC_SUPABASE_URL;
  const key = ENV.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;

  const res = await fetch(
    `${url}/rest/v1/sync_run?select=finished_at&source=eq.trackingtime&status=eq.ok` +
      `&finished_at=not.is.null&order=finished_at.desc&limit=1`,
    {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Accept-Profile": "raw",
      },
    },
  );
  if (res.status !== 200) return null;

  const [last] = await res.json();
  if (!last?.finished_at) return null;

  const elapsedDays = (Date.now() - new Date(last.finished_at).getTime()) / 86_400_000;
  return { lastAt: last.finished_at, days: Math.ceil(elapsedDays) + OVERLAP_DAYS };
}

/** Runs a child script, streaming its output, and resolves with its exit code. */
function run(script, scriptArgs) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...scriptArgs], {
      stdio: "inherit",
      // Windows: spawning node directly (not through a shell) avoids the quoting
      // problems that silently mangle arguments in PowerShell.
      shell: false,
    });
    child.on("close", (code) => resolve(code ?? 1));
  });
}

// --- decide the window ------------------------------------------------------

let days = explicitDays || DEFAULT_DAYS;
let windowReason = explicitDays ? "--days" : `default ${DEFAULT_DAYS}d`;

if (FULL) {
  days = 180;
  windowReason = "--full";
} else if (SINCE_LAST) {
  const last = await daysSinceLastSuccess();
  if (last) {
    days = last.days;
    windowReason = `${last.days}d since last ok run (${last.lastAt.slice(0, 16).replace("T", " ")}, +${OVERLAP_DAYS}d overlap)`;
  } else {
    // No successful run on record. That is the first-ever sync, or every run so
    // far has failed; either way a short window would be wrong.
    days = 180;
    windowReason = "no previous successful run — falling back to a full 180d pull";
  }
}

console.log("TrackingTime sync");
console.log(`window: ${days} days (${windowReason})`);
console.log(`mode:   ${DRY_RUN ? "DRY RUN — no writes" : "writing"}${NO_LINK ? ", link step skipped" : ""}`);
console.log("");

// --- 1. import --------------------------------------------------------------

const importArgs = ["--days", String(days)];
if (DRY_RUN) importArgs.push("--dry-run");

const importCode = await run("scripts/import-trackingtime.mjs", importArgs);
if (importCode !== 0) {
  // The importer has already written a 'failed' row to raw.sync_run, so the
  // dashboard will show data ageing rather than claiming freshness.
  console.error("\nSYNC FAILED at the import step — data left as it was.");
  process.exit(importCode);
}

// --- 2. link ----------------------------------------------------------------

// Skipped on a dry run for the obvious reason, and skippable explicitly when
// someone is diagnosing the link step on its own.
if (DRY_RUN || NO_LINK) {
  console.log(`\nlink step skipped (${DRY_RUN ? "dry run" : "--no-link"}).`);
} else {
  console.log("\n--- linking members to Hub identities ---\n");
  const linkCode = await run("scripts/link-time-members.mjs", ["--apply"]);
  if (linkCode !== 0) {
    // Deliberately distinguished from an import failure: the hours ARE in the
    // database and the dashboard is correct. What is broken is that some
    // colleague's own /time page will look empty to them.
    console.error(
      "\nSYNC PARTIAL: the import succeeded but linking failed.\n" +
        "The dashboard totals are correct; some individuals may see an empty /time.",
    );
    process.exit(linkCode);
  }
}

console.log("\nSYNC COMPLETE");
