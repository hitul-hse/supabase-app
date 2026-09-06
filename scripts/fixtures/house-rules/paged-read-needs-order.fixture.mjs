/*
 * Fixture for house/paged-read-needs-order.
 *
 * Every line that must be flagged carries a trailing `// VIOLATION` marker, and
 * scripts/check-house-rules.mjs asserts that the rule's findings are exactly
 * that set of lines -- no more, no less -- as well as a total it holds
 * independently. Both halves matter: the count alone would pass if the rule
 * moved to a different line, and the markers alone could be edited to match a
 * broken rule.
 *
 * This file is never executed, and carries NO eslint-disable: a disable
 * comment would switch off the very rule under test, and the gate would then
 * prove nothing while looking green. scripts/check-house-rules.mjs lints it
 * through a config in which exactly one rule is on.
 */

const supabase = {};
const schema = () => ({});
const fetchAllPaged = (fn) => fn(0, 999);

/* ── must be flagged ─────────────────────────────────────────────────────── */

export async function pagedWithoutOrder() {
  return supabase
    .from("entry")
    .select("id, duration_seconds")
    .range(0, 999); // VIOLATION
}

export async function pagedWithoutOrderOneLine() {
  return supabase.from("project").select("hub_project_id").range(0, 999); // VIOLATION
}

// The shape that is actually in src/lib/queries/management-*.ts today: a paging
// helper is handed a builder that never orders.
export async function pagedInsideHelper() {
  return fetchAllPaged((from, to) =>
    schema(supabase, "time")
      .from("project")
      .select("hub_project_id, source_id")
      .not("hub_project_id", "is", null)
      .range(from, to), // VIOLATION
  );
}

/* ── must NOT be flagged ─────────────────────────────────────────────────── */

// The correct construction: ordered on a unique column, then ranged.
export async function orderedThenRanged() {
  return supabase
    .from("entry")
    .select("id")
    .order("id", { ascending: true })
    .range(0, 999);
}

// Order later in the chain. supabase-js builders are order-independent -- one
// sets a Range header, the other a query parameter -- so the pages are ordered
// and this is not the defect.
export async function rangedThenOrdered() {
  return supabase.from("entry").select("id").range(0, 999).order("id");
}

// A one-argument `.range()` is not a paged read. This is the DOM/date shape.
export function notAPagedRead(doc) {
  return doc.createRange().range(3);
}

// Ordered inside the paging helper, which is what my-work.ts does.
export async function orderedInsideHelper() {
  return fetchAllPaged((from, to) =>
    supabase.from("projects").select("id").order("id").range(from, to),
  );
}

// The chain was built elsewhere, so this rule cannot see the `.order()` and
// deliberately says nothing rather than guessing.
export async function receiverIsAVariable(builder) {
  return builder.range(0, 999);
}
