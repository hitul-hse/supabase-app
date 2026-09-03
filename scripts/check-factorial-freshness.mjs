// Gate: has the Factorial sync actually run recently, and did it succeed?
//
// WHAT THIS ASSERTS, AND WHY IT IS NOT THE OTHER THING
// ----------------------------------------------------
// It asserts "a SUCCESSFUL run finished within MAX_AGE_HOURS", read from
// raw.sync_run. It deliberately does NOT recompute the identity map from the
// live Factorial API and compare it to the stored one.
//
// That distinction is the lesson from check-order-hours-freshness.mjs, which
// takes the comparison approach with a zero-drift budget (KNOWN_STALE = 0). It
// compares a stored snapshot against a live recomputation, so it goes red the
// moment anyone logs an hour and stays red until the nightly refresh runs
// again. It is red for most of every working day by construction, which trains
// people to ignore it -- and a gate nobody reads is worse than no gate, because
// it looks like coverage.
//
// The thing actually worth alerting on here is not "is the map identical to
// Factorial this second" -- it never will be, and a new joiner SHOULD show as a
// pending review row rather than as a failure. It is "is the pipeline that
// keeps it current still alive". That is a question about runs, not about rows,
// and raw.sync_run is where runs live.
//
// THE HISTORY THIS EXISTS TO PREVENT (measured 2026-09-03)
// --------------------------------------------------------
// raw.sync_run held 26 rows and every one was source='trackingtime'. There was
// no Factorial workflow in .github/workflows/ at all, and the identity map had
// last been touched on 2026-09-01 by a human running the script by hand. The
// data was not stale because a sync was failing; it was stale because no
// scheduled Factorial sync had ever been built. Nothing in the product said so:
// the /admin/factorial-identity page rendered a fully-worked queue and a
// complete mapping table, which is exactly what a healthy pipeline looks like.
//
// READ-ONLY.

import pg from "pg";
import { loadEnv } from "./lib/gate-env.mjs";

// Daily schedule + margin for a missed run and a slow runner. A single skipped
// night is normal GitHub Actions behaviour (the scheduler drops jobs under
// load); two nights in a row is a real signal. 36h fails on the second miss,
// not the first.
const MAX_AGE_HOURS = 36;

// Beyond this the honest word is "never", not "stale". Kept separate so the
// message can say which, because the fixes differ: stale means investigate the
// last failure, missing means the workflow was never switched on.
const NEVER_RAN_HOURS = 24 * 30;

const SOURCE = "factorial";

const env = loadEnv();

// No database URL means no live database to check -- on CI without secrets, or
// on a clean checkout. Skipping says so; passing pg an undefined connection
// string makes it default to localhost:5432 and fail with ECONNREFUSED, which
// reads like a broken gate rather than an absent credential.
if (!env.SUPABASE_DB_URL) {
  console.log("SKIP: no SUPABASE_DB_URL, so there is no live database to check");
  process.exit(0);
}

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const failures = [];
const check = (ok, label, detail) => {
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
};

console.log("check-factorial-freshness: is the Factorial sync still running?\n");

// Read-only for the whole gate. A gate that can write is a gate that can be the
// cause of the thing it reports on.
await c.query("begin read only");

const { rows: runs } = await c.query(
  `select id, entity, started_at, finished_at, status, record_count, error_message, cursor_ref
     from raw.sync_run
    where source = $1
    order by started_at desc
    limit 10`,
  [SOURCE],
);

if (runs.length === 0) {
  console.log("  raw.sync_run holds NO run for source='factorial'.\n");
  console.log("  The identity map is whatever the last hand-run left behind, and nothing");
  console.log("  is keeping it current. Switch on .github/workflows/sync-factorial.yml");
  console.log("  (it needs FACTORIAL_API_KEY, FACTORIAL_COMPANY_ID and SUPABASE_DB_URL as");
  console.log("  repository secrets) or run `npm run sync:factorial-identity -- --write`.\n");
  check(false, "a Factorial sync has ever been recorded", "raw.sync_run has 0 rows for this source");
  console.log(`\nFAIL (${failures.length})`);
  await c.query("rollback");
  await c.end();
  process.exit(1);
}

console.log("recent runs:");
for (const r of runs.slice(0, 5)) {
  const started = r.started_at ? new Date(r.started_at) : null;
  const finished = r.finished_at ? new Date(r.finished_at) : null;

  // A negative duration is not cosmetic: it means started_at/finished_at do not
  // bracket the work, which is the bug the TrackingTime importer shipped
  // (started_at defaulted to now() at INSERT, i.e. after finished_at). Surfaced
  // rather than formatted away, so a regression is visible here first.
  const secs = started && finished ? (finished.getTime() - started.getTime()) / 1000 : null;
  const duration =
    secs === null ? "unfinished" : secs < 0 ? `${secs.toFixed(1)}s (INVALID)` : `${secs.toFixed(1)}s`;

  console.log(
    `  #${String(r.id).padStart(3)} ${String(r.status).padEnd(7)} ${String(r.entity).padEnd(18)} ` +
      `${String(r.started_at?.toISOString() ?? "").slice(0, 19).replace("T", " ")}  ${duration.padStart(14)}  ` +
      `${r.record_count ?? "—"} read${r.cursor_ref ? `  (${r.cursor_ref})` : ""}`,
  );
  if (r.status === "failed" && r.error_message) {
    console.log(`       ↳ ${String(r.error_message).slice(0, 120)}`);
  }
}
console.log("");

const lastOk = runs.find((r) => r.status === "ok" && r.finished_at);

check(
  Boolean(lastOk),
  "at least one Factorial sync has SUCCEEDED",
  lastOk ? "yes" : `${runs.length} run(s) on record, none of them ok — read the error above`,
);

if (lastOk) {
  const hours = (Date.now() - new Date(lastOk.finished_at).getTime()) / 3_600_000;
  const label = hours >= NEVER_RAN_HOURS ? "ABANDONED" : hours >= MAX_AGE_HOURS ? "STALE" : "OK";

  console.log(
    `  last success: ${lastOk.finished_at.toISOString().slice(0, 19).replace("T", " ")} ` +
      `(${hours.toFixed(1)}h ago, ${lastOk.record_count ?? "?"} employees read)\n`,
  );

  check(
    hours < MAX_AGE_HOURS,
    `the last successful Factorial sync is under ${MAX_AGE_HOURS}h old`,
    `${hours.toFixed(1)}h ago — ${label}`,
  );

  /*
   * Reported, never fatal on its own. A run failing AFTER a success means the
   * data is still correct but has stopped moving -- a different and less urgent
   * state than stale data, and one that the age check above will catch on its
   * own timetable. Failing here too would just double-count one problem.
   */
  const failedSince = runs.filter(
    (r) => r.status === "failed" && new Date(r.started_at) > new Date(lastOk.finished_at),
  );
  if (failedSince.length > 0) {
    console.log(
      `  note  ${failedSince.length} failed run(s) since that success — the map is correct but not updating.`,
    );
  }

  /*
   * A run that read zero employees "succeeded" and told us nothing. It is the
   * signature of a credential that authenticates but has lost its scope, or of
   * an endpoint that changed shape and now returns an empty envelope -- both of
   * which would otherwise sit green forever while the roster silently froze.
   */
  if (lastOk.record_count === 0) {
    check(false, "the last successful run actually read employees", "record_count = 0 — an empty roster is not a result");
  }
}

/*
 * The review queue is the other half of the freshness picture and the reason
 * this gate does not stop at run timing. An open row is a colleague whose hours
 * are attributed to nobody until a human decides; that is by design (ADR-001
 * forbids guessing) but it is only safe while somebody is looking.
 *
 * NOT a failure. Open rows are the system working, and a gate that went red on
 * them would push whoever is on call to close them carelessly -- which is the
 * exact wrong incentive for the one queue in this repo that exists to stop bad
 * matches. Counted and named, so it cannot quietly grow.
 */
const { rows: queue } = await c.query(
  `select status, count(*)::int as n
     from crm.factorial_identity_review
    group by status
    order by 2 desc`,
);
const MACHINE_STATUSES = new Set(["unmatched", "bridged_unlinked", "ambiguous"]);
const open = queue.filter((q) => MACHINE_STATUSES.has(q.status)).reduce((s, q) => s + q.n, 0);
const total = queue.reduce((s, q) => s + q.n, 0);

console.log(`\n  identity review queue: ${total} row(s), ${open} awaiting a human`);
for (const q of queue) console.log(`    ${String(q.n).padStart(3)}  ${q.status}`);
if (open > 0) {
  console.log(`  note  ${open} employee(s) are unattributed until someone decides at /admin/factorial-identity.`);
}

await c.query("rollback");
await c.end();

console.log(`\n${failures.length === 0 ? "PASS" : `FAIL (${failures.length})`}`);
if (failures.length) for (const f of failures) console.log(`  - ${f}`);
process.exit(failures.length ? 1 : 0);
