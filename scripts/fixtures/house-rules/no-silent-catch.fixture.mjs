/*
 * Fixture for house/no-silent-catch.
 *
 * Never executed. No eslint-disable: that would switch off the rule under test.
 */

const risky = () => {};
const log = () => {};

/* ── must be flagged ─────────────────────────────────────────────────────── */

export function swallowsBare() {
  try {
    risky();
  } catch {} // VIOLATION
}

export function swallowsBound() {
  try {
    risky();
  } catch (e) {} // VIOLATION
}

/* ── must NOT be flagged ─────────────────────────────────────────────────── */

// Handled.
export function logsIt() {
  try {
    risky();
  } catch (e) {
    log(e);
  }
}

// Deliberately discarded, and the line says why. This is the whole suppression
// mechanism: a sentence is the cheapest possible proof that the empty block is
// a decision rather than an omission.
export function explainedDiscard(child) {
  try {
    child.kill();
  } catch {
    // Already exited between the timeout firing and this line. Nothing to do,
    // and rethrowing would turn a clean timeout into a crash.
  }
}

// Rethrown after annotation.
export function rethrows() {
  try {
    risky();
  } catch (e) {
    throw new Error(`while reading the roster: ${e.message}`);
  }
}

// A `finally` with an empty body is not a swallowed failure -- nothing is
// caught here at all.
export function emptyFinallyIsNotACatch() {
  try {
    risky();
  } finally {
    log("done");
  }
}
