/*
 * Fixture for house/honest-nulls-not-zero.
 *
 * Marked lines must be flagged; everything under "must NOT be flagged" is a
 * construction that lives in this repo today and is correct. See the rule's
 * header in eslint-rules/house-rules.mjs for why each exclusion exists and how
 * many findings it removed when it was measured against the whole tree.
 *
 * Never executed. No eslint-disable: that would switch off the rule under test.
 */

const status = { hours_logged: null, margin_eur: null, contract_hours: null };
const row = { duration_seconds: null, weekly_hours: null, share_percent: null };
const num = (v) => Number(v);
const totals = new Map();
const rows = [];
const view = { burnPercent: null, remainingHours: null };

/* ── must be flagged: a nullable database column becoming a measured zero ── */

export function reportedBudget() {
  const hoursLogged = Number(status.hours_logged ?? 0); // VIOLATION
  const margin = status.margin_eur ?? 0; // VIOLATION
  const seconds = Number(row.duration_seconds) || 0; // VIOLATION
  const share = num(row.share_percent) ?? 0; // VIOLATION
  return { hoursLogged, margin, seconds, share };
}

/* ── must NOT be flagged ─────────────────────────────────────────────────── */

// A GUARD, not a figure. "Does this project have a contract at all."
export function hasContract(project) {
  return (project.contract_hours ?? 0) > 0;
}

// The accumulator idiom. 0 is the additive identity for a key not yet seen.
export function tally(key, seconds) {
  totals.set(key, (totals.get(key) ?? 0) + seconds);
}

// A comparator: the 0 decides a position and is never printed.
export function worstFirst(list) {
  return list.sort((a, b) => (b.burn_percent ?? 0) - (a.burn_percent ?? 0));
}

// An accumulator over rows the caller already filtered to the known ones.
export function totalKnownHours(known) {
  return known.reduce((sum, r) => sum + (r.contract_hours ?? 0), 0);
}

// A cardinality of a collection in hand, not a measure that could be missing.
export function sectionCount(drill) {
  return (drill.sections?.length ?? 0) > 0;
}

// A position, not a measure.
export function pageStart(params) {
  return rows[params.index ?? 0];
}

// A camelCase view-model field: the unknown/zero decision was taken upstream,
// and this rule deliberately stops at the database boundary. Out of scope, and
// the rule header says why.
export function alreadyDecided() {
  return { burn: view.burnPercent ?? 0, remaining: view.remainingHours ?? 0 };
}
