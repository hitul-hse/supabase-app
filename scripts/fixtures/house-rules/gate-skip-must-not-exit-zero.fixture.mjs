/*
 * Fixture for house/gate-skip-must-not-exit-zero.
 *
 * NOT named check-*.mjs on purpose. scripts/check-gates-runnable-on-ci.mjs
 * requires every scripts/**\/check-*.[cm]js to be a gate registered in
 * package.json or a workflow, and this is a fixture, not a gate. The rule is
 * scoped to check-* files by eslint.config.mjs rather than by a filename test
 * inside the rule, precisely so this file can exercise it honestly;
 * scripts/check-house-rules.mjs turns the rule on for it explicitly.
 *
 * Never executed. No eslint-disable: that would switch off the rule under test.
 */

const listenOrSkip = async () => false;
const server = {};
const PORT = 3113;
const haveCredentials = false;
const failures = 0;

/* ── must be flagged ─────────────────────────────────────────────────────── */

// The check-time-integration shape: says SKIP, exits 0, asserts nothing.
export async function skipsAndExitsZero() {
  if (!haveCredentials) {
    console.log("SKIP: no .env.local, cannot reach the live database");
    process.exit(0); // VIOLATION
  }
}

// The listenOrSkip shape: the SKIP string is inside the helper, so only the
// guard's own name gives it away.
export async function guardSaysSkip() {
  if (!(await listenOrSkip(server, PORT))) process.exit(0); // VIOLATION
}

/* ── must NOT be flagged ─────────────────────────────────────────────────── */

// The protocol: a gate that cannot run exits 3, having said so.
export function correctNotRun(notRun) {
  if (!haveCredentials) notRun("no SUPABASE_DB_URL — cannot probe the live schema");
}

// An ordinary success exit at the end of a gate that really did assert things.
export function passingExit() {
  process.exit(failures ? 1 : 0);
}

// A plain exit 0 with no SKIP anywhere near it.
export function ordinaryExitZero() {
  console.log("PASS | every policy is present");
  process.exit(0);
}

// SKIP is printed, but the process goes on to fail properly.
export function skipsThenFails() {
  console.log("SKIP: the optional sub-probe had no fixture");
  process.exit(1);
}
