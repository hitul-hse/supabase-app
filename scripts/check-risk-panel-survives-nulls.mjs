/*
 * Will the management risk panel still be honest AFTER 20260826120000 nulls the
 * unmeasured orders?
 *
 * The migration sets logged_hours / billable_hours / remaining_hours /
 * consumed_percent / status to NULL for the 54 orders with no TrackingTime link.
 * management-project-risks.ts is the only consumer of those columns, and it was
 * written against a world where they were NOT NULL. So the migration and the
 * reader are another untested seam -- and this one is user-visible, not a crash.
 *
 * The specific concern, from reading the reader: `withoutStatus` filters on
 * `!project.status` and surfaces those rows as a named risk. After the migration
 * 54 rows have status = NULL by design, so a panel that means "somebody forgot to
 * set a status" would suddenly accuse 54 orders of an omission that is actually
 * the honest-nulls fix working correctly.
 *
 * This replays the reader's exact filter predicates over BEFORE and AFTER data,
 * in plain JS -- no database, no server -- so the behavioural change is measured
 * rather than discovered by a user.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Repo root resolved from this file, so these paths work on any machine and
// from any working directory. They were previously hardcoded to C:/Supabase,
// which existed on exactly one developer's laptop and nowhere else.
const REPO = fileURLToPath(new URL("..", import.meta.url));


let failures = 0;
const check = (l, ok, d = "") => { console.log(`${ok ? "PASS" : "FAIL"}: ${l}${d ? `\n        ${d}` : ""}`); if (!ok) failures += 1; };

const src = readFileSync(join(REPO, "src/lib/queries/management-project-risks.ts"), "utf8");

/*
 * The predicates, lifted from the reader by regex so they cannot drift from it
 * silently. If the shape changes, the extraction fails loudly rather than testing
 * a stale copy.
 */
const hasOverBudget = /\(project\.contract_hours \?\? 0\) > 0 &&\s*\(project\.logged_hours \?\? 0\) > 0 &&\s*\(project\.consumed_percent \?\? 0\) > 100/.test(src);
check("the over-budget predicate is where this gate thinks it is", hasOverBudget,
  "if this fails the reader was refactored and this gate must be re-read against it");

const hasWithoutStatus = /\.filter\(\(project\) => !project\.status && project\.logged_hours !== null\)/.test(src);
check("the missing-status predicate excludes unmeasured orders", hasWithoutStatus,
  hasWithoutStatus
    ? "so a NULL status caused by the honest-nulls migration is not reported as an omission"
    : "the reader still uses a bare !project.status, which will accuse 54 orders after the migration");

if (!hasOverBudget || !hasWithoutStatus) {
  console.log("\nAborting: cannot test predicates that no longer exist as written.");
  process.exit(1);
}

// The reader's own logic, replicated exactly.
const overBudget = (p) => (p.contract_hours ?? 0) > 0 && (p.logged_hours ?? 0) > 0 && (p.consumed_percent ?? 0) > 100;
// The FIXED predicate: statusless AND measured. An unmeasured order (NULL hours)
// is not an omission.
const withoutStatus = (p) => !p.status && p.logged_hours !== null;

/*
 * Three populations that mirror the live database exactly (measured 26 Aug):
 *   54  unlinked, currently 0/0/NORMAL, becoming NULL
 *  113  linked but genuinely 0h, staying 0/0/NORMAL
 *   64  linked with real hours, untouched (11 of them over budget)
 */
const before = [];
const after = [];
for (let i = 0; i < 54; i += 1) {
  before.push({ id: `u${i}`, contract_hours: 32, logged_hours: 0, consumed_percent: 0, status: "NORMAL" });
  after.push({ id: `u${i}`, contract_hours: 32, logged_hours: null, consumed_percent: null, status: null });
}
for (let i = 0; i < 113; i += 1) {
  const r = { id: `z${i}`, contract_hours: 29, logged_hours: 0, consumed_percent: 0, status: "NORMAL" };
  before.push(r); after.push({ ...r });        // untouched by the migration
}
for (let i = 0; i < 64; i += 1) {
  const pct = i < 11 ? 140 : 60;
  const r = { id: `m${i}`, contract_hours: 100, logged_hours: pct, consumed_percent: pct,
              status: pct > 95 ? "CRITICAL" : "NORMAL" };
  before.push(r); after.push({ ...r });
}

const count = (rows, fn) => rows.filter(fn).length;

console.log("\n--- over-budget risk: must be IDENTICAL, the migration touches no measured row\n");
const obBefore = count(before, overBudget);
const obAfter = count(after, overBudget);
check("the same orders are flagged over budget before and after",
  obBefore === obAfter && obAfter === 11, `before ${obBefore}, after ${obAfter}`);
check("a NULL consumed_percent is never treated as over budget",
  count(after.filter((p) => p.consumed_percent === null), overBudget) === 0,
  "?? 0 makes an unknown burn read as 0%, which is the correct direction here: "
  + "an unmeasured order must not be accused of an overrun");

console.log("\n--- missing-status risk: the case this gate was written to catch\n");
const wsBefore = count(before, withoutStatus);
const wsAfter = count(after, withoutStatus);
console.log(`  orders reported as "no status set": before ${wsBefore}, after ${wsAfter}`);

/*
 * With the bare `!project.status` predicate this jumped 0 -> 54: the panel would
 * have accused every unmeasured order of an omission that is really the
 * honest-nulls fix working. The fixed predicate requires the hours to be KNOWN,
 * so a deliberate NULL is silent and a genuine lapse is still caught.
 */
check("the migration does NOT inflate the missing-status risk",
  wsAfter === wsBefore && wsAfter === 0,
  `before ${wsBefore}, after ${wsAfter} — a bare !status predicate would report 54 here`);

// And prove the check still has teeth: a measured order that lost its status.
const lapse = { id: "lapse", contract_hours: 10, logged_hours: 5, consumed_percent: 50, status: null };
check("a MEASURED order with no status is still flagged",
  withoutStatus(lapse) === true,
  "the fix narrows the predicate; it does not delete the check");
check("an UNMEASURED order with no status is not flagged",
  withoutStatus({ id: "u", contract_hours: 10, logged_hours: null, consumed_percent: null, status: null }) === false);

/*
 * What the reader should distinguish, and cannot today: "no status because
 * nobody set one" versus "no status because there is nothing to measure". The
 * second is knowable from the same row -- an unmeasured order has NULL
 * logged_hours too.
 */
const genuinelyForgotten = (p) => !p.status && p.logged_hours !== null;
const unmeasured = (p) => !p.status && p.logged_hours === null;

console.log("\n--- the distinction the reader needs\n");
check("after the migration, every statusless order is explained by NULL hours",
  count(after, unmeasured) === 54 && count(after, genuinelyForgotten) === 0,
  `unmeasured ${count(after, unmeasured)}, genuinely missing ${count(after, genuinelyForgotten)}`);
check("and a row that really has lost its status is still catchable",
  genuinelyForgotten({ id: "x", contract_hours: 10, logged_hours: 5, consumed_percent: 50, status: null }) === true,
  "so the fix is to split the panel, not to delete the check");

console.log(failures === 0
  ? "\nREADER SURVIVES THE MIGRATION, with one reporting change that must land first."
  : `\n${failures} problem(s)`);
process.exit(failures === 0 ? 0 : 1);
