/*
 * The machine-readable verdict every gate owes its runner.
 *
 * WHY THIS EXISTS
 * ---------------
 * The most expensive recurring bug in this repo is not a wrong assertion. It is
 * an absent one read as a right one -- "silence read as success". Three
 * instances, all real:
 *
 *   check-time-integration.mjs crashed on the next-intl components, printed
 *     SKIP, exited 0 having asserted NOTHING, and a pull request was opened on
 *     that green. (2026-09-04)
 *
 *   check-sync-schedule-alive.mjs -- the gate written to catch a scheduler that
 *     died silently -- exited 0 with "SKIP: no .env.local" on every runner. It
 *     was itself silent for nine days after the incident it existed to catch.
 *     (fixed in PR #46)
 *
 *   `npm run test:db` is an && chain; the first non-zero exit hides every gate
 *     after it. On 26 Aug it stopped at gate 20 of 75 and the output still
 *     ended in PASS lines. (that one is why run-all-gates.mjs exists)
 *
 * Measured on master on 2026-09-06, before this file: 0 of 207 gates emitted a
 * machine-readable result, 0 used a distinct "did not run" exit code, and
 * run-all-gates.mjs had no rule about assertion counts. A gate that asserted
 * nothing and a gate that asserted forty things both printed `pass`.
 *
 * THE PROTOCOL
 * ------------
 * 1. Every scripts/check-*.mjs ends with exactly one line of the form
 *
 *        RESULT pass=<n> fail=<m> notrun=<k>
 *
 *    counted from the gate's own check() calls. Never hard-coded, never
 *    derived from parsing its own output.
 *
 * 2. Exit codes carry three meanings:
 *
 *        0  ran, and every assertion passed
 *        1  ran, and something failed
 *        3  did NOT run -- missing credentials, absent build artefact,
 *           unreachable dependency
 *
 * 3. Exit 0 with zero assertions is RED, not green. run-all-gates.mjs enforces
 *    that; this file only has to make the counts truthful enough to enforce it
 *    against.
 *
 * WHY THE RESULT LINE IS PRINTED FROM AN exit HOOK
 * ------------------------------------------------
 * Because the failure this protocol exists to catch is a gate that does NOT
 * reach its own last line. check-time-integration crashed halfway; the version
 * of this idea where each gate calls finish() at the bottom would have printed
 * nothing there, which is precisely the case that must not be silent. A
 * process.on("exit") handler fires on the ordinary end, on process.exit() from
 * a credential guard forty lines in, and on an uncaught throw. So:
 *
 *   - a gate that crashes early prints RESULT pass=0 fail=0 and exits non-zero
 *   - a gate that SKIPs and exits 0 prints RESULT pass=0 fail=0 -- and the
 *     runner calls that RED, which is the whole point
 *   - a gate that declares itself not-run prints notrun>=1 and is reported as
 *     NOT RUN rather than as either green or red
 *
 * writeSync(1) rather than console.log: when stdout is a pipe -- which it
 * always is under run-all-gates and under CI -- Node's console.log is
 * asynchronous, and a write queued inside an "exit" handler is dropped. The
 * RESULT line would then be missing exactly when a machine is reading it and
 * present whenever a human runs the gate in a terminal. That is the worst
 * possible way for this to fail, so the write is synchronous.
 *
 * THE ONE PLACE THE PROTOCOL IS DELIBERATELY NOT ENFORCED BY EXIT CODE
 * --------------------------------------------------------------------
 * Twenty gates sit inside the `test:db` && chain AND abort wholesale on a
 * missing credential. CI runs that chain with no credentials on purpose (the
 * schema and RLS suite is PGlite-backed and must not be given live keys), so
 * those twenty legitimately do not run there. If they exited 3, npm would stop
 * the chain at the first one and the 114 gates after it would not run at all --
 * re-creating, in the name of honesty, the exact defect run-all-gates.mjs was
 * written to expose.
 *
 * So they call notRunInChain() and keep their exit 0. They are not silent: their
 * RESULT line says notrun>=1, and run-all-gates reports them as NOT RUN and
 * never counts them green. The residual gap is the raw exit code alone, and it
 * closes the day `test:db` stops being an && chain and runs its gates
 * independently -- at which point notRun() can be used there too, unchanged.
 */
import { writeSync } from "node:fs";

let pass = 0;
let fail = 0;
let notrun = 0;
let printed = false;

/**
 * Count one assertion outcome. Called from inside each gate's own check()
 * helper, so the counts are the gate's real verdicts rather than a second,
 * drifting bookkeeping of them.
 *
 * Truthiness, not strict equality: gates routinely pass expressions like
 * `lookups && keys.every(...)`, whose value is an object or undefined rather
 * than a boolean. Requiring `=== true` there would have silently counted
 * genuine passes as failures.
 */
export function record(ok) {
  if (ok) pass += 1;
  else fail += 1;
  return ok;
}

/**
 * Count assertions that could not be evaluated -- a live probe with no
 * credentials, a sub-section whose fixture is absent.
 *
 * This is NOT a pass. The distinction is the entire subject of this file: a
 * skipped assertion recorded as a pass is how a suite reports 127 green while
 * a seventh of it proved nothing.
 *
 * `n` is how many assertions were skipped, when the gate knows; the default of
 * 1 means "this section did not run" and is honest without requiring the gate
 * to count assertions it never wrote.
 */
export function recordNotRun(reason = "", n = 1) {
  notrun += n;
  if (reason) console.log(`NOTRUN: ${reason}`);
  return false;
}

/**
 * The gate as a whole cannot run: exit 3, having said so.
 *
 * Exit 3 rather than 0 because a missing credential is not a passing test, and
 * rather than 1 because it is not a failing one either -- a runner that cannot
 * tell those apart must either cry wolf on every unconfigured environment or
 * swallow real regressions, and this suite has done both.
 */
export function notRun(reason) {
  recordNotRun(reason);
  process.exit(3);
}

/**
 * notRun for a gate that sits inside the `test:db` && chain: records the
 * not-run, prints it in the RESULT line, and exits 0 anyway.
 *
 * READ THE HEADER BEFORE USING THIS. It exists for exactly one situation and
 * is a compromise, not an alternative style:
 *
 *   `test:db` is "npm run a && npm run b && ..." across 134 gates, and CI runs
 *   it deliberately without live credentials. A gate that exited 3 there would
 *   stop npm at the first missing secret and the remaining gates would not run
 *   at all -- trading one dishonest green for a hundred and fourteen silent
 *   ones.
 *
 * What it does NOT do is let the gate look like it passed. Its RESULT line
 * carries notrun>=1, and run-all-gates.mjs reports NOT RUN, never green. Only
 * the raw exit code is compromised, and only until `test:db` stops chaining on
 * &&, at which point every call site here becomes a plain notRun().
 *
 * check-gates-runnable-on-ci.mjs FAILS if this appears in a gate outside that
 * chain, so the compromise cannot spread to the gates that have no excuse.
 */
export function notRunInChain(reason) {
  recordNotRun(reason);
  process.exit(0);
}

/**
 * Emit the RESULT line exactly once. Idempotent because the hook can in
 * principle fire more than once, and two RESULT lines would make the runner's
 * parse ambiguous. Deliberately NOT exported: a gate able to print its own
 * RESULT line is a gate able to print a second, more flattering one.
 */
function emitResult() {
  if (printed) return;
  printed = true;
  try {
    writeSync(1, `RESULT pass=${pass} fail=${fail} notrun=${notrun}\n`);
  } catch {
    // A closed or full stdout must not turn a passing gate into a crash. The
    // runner treats a missing RESULT line as red on its own.
  }
}

process.on("exit", emitResult);
