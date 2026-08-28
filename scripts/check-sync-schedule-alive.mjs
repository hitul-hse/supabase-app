// Gate: is the scheduled TrackingTime sync actually running?
//
// WHY THIS EXISTS
// ---------------
// check-sync-freshness reports how old the data is. It does NOT say whether the
// SCHEDULE is alive, and those fail differently: stale data after a failed run
// is loud, but a scheduler that silently stopped looks identical to a quiet week
// until someone reconciles a report by hand.
//
// On 2026-08-28 the data was 50 hours stale. raw.sync_run showed a run every
// morning at ~05:50 UTC from 17 to 26 August and then nothing, with every one of
// those 17 runs status='ok'. Nothing failed. The scheduler simply stopped firing,
// which no existing check would have surfaced.
//
// GitHub disables a repository's scheduled workflows after 60 days without
// activity, and separately does not run them on a fork or when Actions is
// disabled for the repo. The gap here starts the day the last commit was PUSHED
// to origin, which is the detail worth noticing: local commits do not keep a
// schedule alive.
//
// WHAT THIS ASSERTS
// -----------------
// The cadence, not the freshness. If runs used to happen daily and have not
// happened for more than two expected cycles, say so and name the likely cause,
// because "run it manually" is a workaround rather than a fix.
//
// READ-ONLY.
import { readFileSync, existsSync } from "node:fs";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

console.log("check-sync-schedule-alive: is the cron still firing, or only manual runs?\n");

// The workflow must exist and declare a schedule at all.
const WF = ".github/workflows/sync-trackingtime.yml";
check(existsSync(WF), "the sync workflow exists", WF);
let cron = null;
if (existsSync(WF)) {
  const wf = readFileSync(WF, "utf8");
  const m = wf.match(/-\s*cron:\s*["']([^"']+)["']/);
  cron = m?.[1] ?? null;
  check(Boolean(cron), "it declares a cron schedule", cron ?? "no cron: line found");
}

const { rows: runs } = await c.query(`
  select started_at, status, record_count, cursor_ref
  from raw.sync_run where source = 'trackingtime'
  order by started_at desc limit 40`);

check(runs.length > 0, "the sync has ever run", `${runs.length} recorded run(s)`);
if (!runs.length) { await c.end(); process.exit(1); }

const hoursSince = (d) => (Date.now() - new Date(d).getTime()) / 3600000;

/*
 * CRITICAL: separate SCHEDULED runs from MANUAL ones before measuring anything.
 *
 * The first version of this gate did not, and it passed immediately after a
 * human ran `npm run sync:year` by hand — the manual row became "the last run"
 * and the dead schedule looked healthy. A gate that a manual workaround can
 * silence is worse than no gate, because it now reports green over the exact
 * problem it exists to find.
 *
 * The two are distinguishable in the data. The workflow syncs a small trailing
 * window (cursor_ref days=4 or days=5) and lands in the small hours UTC, since
 * GitHub runs cron late by 30-90 minutes. Manual reconciliation runs use a wide
 * window (days=180, days=14) at whatever hour the human was working.
 */
const isScheduled = (r) => {
  const days = Number(/days=(\d+)/.exec(r.cursor_ref ?? "")?.[1] ?? NaN);
  const hourUtc = new Date(r.started_at).getUTCHours();
  return Number.isFinite(days) && days <= 7 && hourUtc >= 3 && hourUtc <= 9;
};

const scheduled = runs.filter(isScheduled);
const manual = runs.filter((r) => !isScheduled(r));

console.log(`  ${runs.length} run(s): ${scheduled.length} match the schedule's signature, ${manual.length} look manual\n`);

check(scheduled.length > 0,
  "the schedule has ever fired",
  scheduled.length ? "" : "every run looks manual — the cron may never have worked");

if (!scheduled.length) { console.log("\nFAIL"); await c.end(); process.exit(1); }

const lastRun = scheduled[0];
const sinceLast = hoursSince(lastRun.started_at);

// Cadence is measured across SCHEDULED runs only, so clustered manual retries
// cannot stretch the tolerance and hide a missed cycle.
const gaps = [];
for (let i = 0; i + 1 < scheduled.length; i += 1) {
  const g = (new Date(scheduled[i].started_at) - new Date(scheduled[i + 1].started_at)) / 3600000;
  if (g > 0.5) gaps.push(g);
}
gaps.sort((a, b) => a - b);
const medianGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : null;

const lastAny = runs[0];
console.log(`  last SCHEDULED run  ${new Date(lastRun.started_at).toISOString()} (${sinceLast.toFixed(1)}h ago, ${lastRun.status})`);
console.log(`  last run of any kind ${new Date(lastAny.started_at).toISOString()} (${hoursSince(lastAny.started_at).toFixed(1)}h ago)`);
console.log(`  cadence     median gap between scheduled runs: ${medianGap ? `${medianGap.toFixed(1)}h` : "unknown"}`);
console.log(`  cron        ${cron ?? "(none)"}\n`);

// Say plainly when fresh data is being propped up by hand, because freshness
// checks will read green while the automation stays dead.
if (hoursSince(lastAny.started_at) < sinceLast - 1) {
  console.log("  NOTE: the most recent run was manual. Data freshness is currently");
  console.log("  being maintained by hand, which no freshness check can distinguish");
  console.log("  from working automation.\n");
}

/*
 * Threshold, reasoned rather than picked:
 *
 * one cycle late  = medianGap + grace. GitHub runs cron on a best-effort queue
 *                   and is routinely 30-90 minutes late, so a single late run is
 *                   normal and must not alert.
 * two cycles late = 2 * medianGap + grace. The schedule has now skipped a slot it
 *                   should have hit. That is not queue jitter.
 *
 * A 2.5x multiplier (the first version) put the line at 60h, which would have
 * stayed green through the real 50.5h outage. The threshold has to be derived
 * from the cadence, not from a round number that feels safe.
 */
const GRACE_H = 2;
const tolerance = medianGap ? medianGap * 2 + GRACE_H : 50;
check(sinceLast <= tolerance,
  "the schedule is still firing on its established cadence",
  `${sinceLast.toFixed(1)}h since the last scheduled run, tolerance ${tolerance.toFixed(1)}h `
  + `(${medianGap ? Math.floor(sinceLast / medianGap) : "?"} cycle(s) missed)`);

const recentFailures = scheduled.slice(0, 10).filter((r) => r.status !== "ok").length;
if (sinceLast > tolerance && recentFailures === 0) {
  console.log("\n  DIAGNOSIS: every recent run succeeded and then they simply stopped.");
  console.log("  That is a scheduler problem, not a sync problem. Most likely causes:");
  console.log("    1. GitHub disables scheduled workflows after 60 days of repository");
  console.log("       inactivity. Pushing any commit re-enables them.");
  console.log("    2. Actions disabled for the repository, or the workflow manually");
  console.log("       disabled in the Actions tab.");
  console.log("    3. A billing or runner-minutes limit on the account.");
  console.log("  Check: GitHub > Actions > Sync TrackingTime. A disabled schedule shows");
  console.log("  a banner there rather than a failed run, which is why nothing alerted.");
}

// The parity check is the thing that catches silent drift, so it must be wired
// into the same workflow rather than left to a human.
if (existsSync(WF)) {
  const wf = readFileSync(WF, "utf8");
  check(/check-vendor-parity/.test(wf),
    "the workflow verifies vendor parity after syncing",
    "a sync that succeeds while drifting is the failure mode this catches");
  check(/check-sync-freshness/.test(wf),
    "the workflow reports freshness even when the sync fails");
}

console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`}`);
if (failures) {
  console.log("\nA manual `npm run sync:year` fixes the DATA but not the SCHEDULE.");
}
await c.end();
process.exit(failures ? 1 : 0);
