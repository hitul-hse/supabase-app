/*
 * Fixture for house/no-name-join-across-systems (ADR-001).
 *
 * The lawful half is not hypothetical: every construction under "must NOT be
 * flagged" is one that exists in this repo today and that the rule was tuned
 * not to fire on. The `.ilike("email", email)` case in
 * src/app/(app)/admin/users/actions.ts is the important one -- email is an
 * exact key, matched case-insensitively on purpose, and a rule that called
 * that a violation would be dismissed within a day.
 *
 * Never executed. No eslint-disable: that would switch off the rule under test.
 */

const supabase = { from: () => supabase, select: () => supabase, ilike: () => supabase, eq: () => supabase };
const factorialRow = { fullName: "", email: "", external_id: "" };
const hubPerson = { name: "", id: "" };
const roster = { names: [] };

/* ── must be flagged ─────────────────────────────────────────────────────── */

// A fuzzy match on a NAME column, driven by a value from another system.
export async function joinsOnName() {
  return supabase.from("people").select("id").ilike("name", factorialRow.fullName); // VIOLATION
}

export async function joinsOnDisplayName(pattern) {
  return supabase.from("members").select("id").ilike("display_name", pattern); // VIOLATION
}

// Cross-record name containment used to select.
export function selectsByNameContainment() {
  return roster.names.includes(hubPerson.name); // VIOLATION
}

/* ── must NOT be flagged ─────────────────────────────────────────────────── */

// The correct join: an exact key recorded by the sync.
export async function joinsOnExternalId() {
  return supabase.from("people").select("id").eq("external_id", factorialRow.external_id);
}

// Email IS an exact key. TrackingTime addresses are not case-normalised, so
// ilike is the right operator and the column is not a name.
export async function joinsOnEmailCaseInsensitively(email) {
  return supabase.from("profiles").select("id").ilike("email", email);
}

// A human typing a probe into a one-off diagnostic. A literal pattern is a
// person searching, not code deciding identity.
export async function handTypedProbe() {
  return supabase.from("projects").select("id").ilike("name", "%WorkMotion%");
}

// Same record on both sides: this is a substring test within one entity, not a
// join across two systems.
export function withinOneRecord() {
  return hubPerson.name.includes(hubPerson.namePrefix);
}

// Searching a user's typed query is allowed -- neither side reads a name off
// another system's record.
export function userSearch(query, label) {
  return label.toLowerCase().includes(query.toLowerCase());
}
