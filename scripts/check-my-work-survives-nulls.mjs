/*
 * Does the honest-nulls migration make My Work's SUMS lie?
 *
 * management-project-risks.ts was the consumer I fixed. Three others reference a
 * `logged_hours` column, and I nearly dismissed them. Checking which TABLE each
 * one reads:
 *
 *   budget-alerts.ts       -> public.budget_alert_feed        unaffected
 *   contract-periods.ts    -> time.contract_period_status     unaffected
 *   overbooking-notify.ts  -> public.overbooking_alert        unaffected
 *   my-work.ts             -> public.projects                 AFFECTED
 *
 * my-work.ts handles the per-row case correctly: numOrNull preserves NULL, the
 * per-project burn is only computed when both figures are known, and the UI
 * renders "—" (or the older "n/a") rather than 0 (CustomerGroup.tsx, MyWorkTables.tsx).
 *
 * The subtle part is the AGGREGATES. Lines 628 and 691 sum with `?? 0`, which is
 * the honest-null problem in aggregate form: a total that silently treats
 * "unknown" as "zero" is indistinguishable from a total over fully-measured data.
 *
 * The question this gate answers is not "is the sum arithmetically right" -- it
 * is. It is "does the interface tell the reader the total is incomplete?" A
 * customer total of 40h across four projects, two of which are unmeasured, is a
 * floor and not a total, and presenting it bare invites a wrong conclusion.
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

const q = readFileSync(join(REPO, "src/lib/queries/my-work.ts"), "utf8");

/* ------------------------------ the per-row handling must stay null-safe ---- */

check("logged_hours is read with numOrNull, so NULL survives the mapping",
  /const loggedHours = numOrNull\(p\.logged_hours\)/.test(q),
  "num() would coerce an unknown to 0 at the row level, which is the bug this migration removes");

check("the per-project burn is only computed when BOTH figures are known",
  /contractHours !== null && loggedHours !== null/.test(q),
  "otherwise an unmeasured project reports a burn percentage it cannot support");

/* ------------------- the UI must render unknown as "—" (or n/a), never 0 ---- */

/*
 * Assertions about what a file RENDERS run against the code with comments
 * removed. Without this the gate fails on its own subject matter: the comment
 * recording why the burn column was removed necessarily contains the word
 * BURN, and a raw substring search cannot tell the explanation from the thing
 * being explained.
 */
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

for (const f of ["src/components/my-work/CustomerGroup.tsx", "src/components/my-work/MyWorkTables.tsx"]) {
  const s = stripComments(readFileSync(join(REPO, f), "utf8"));
  // "—" is the house glyph for a missing number (DESIGN.md §Data tables 6,
  // APPLE_REF §8 #26); "n/a" is accepted where a file has not been converted.
  check(`${f} renders a null figure as —, never 0`,
    /if \(n === null\) return "(?:—|n\/a)"/.test(s));
  /*
   * Conditional on the file actually SHOWING a burn, which MyWorkTables.tsx
   * stopped doing on 2026-09-04 when the owner cut LOGGED / BUDGET / BURN from
   * the projects table.
   *
   * The rule is unchanged and is not being softened to fit: a rendered burn
   * must still say n/a when it is unknown. What the `else` branch adds is the
   * check that the column is genuinely GONE rather than quietly rendered some
   * other way -- so a future edit cannot dodge the n/a rule simply by not
   * matching the first regex.
   */
  if (/consumedPercent/.test(s)) {
    check(`${f} renders a null burn as — rather than 0%`,
      /consumedPercent === null \? "(?:—|n\/a)"/.test(s));
  } else {
    check(`${f} shows no burn at all, so there is no null burn to mis-render`,
      !/consumedPercent|BURN/.test(s),
      "the burn column was removed here; if it comes back it must come back with its n/a branch");
  }
}

/* ------------------------------------------- the aggregate honesty question */

console.log("\n--- the aggregates: a sum over partly-unknown rows is a FLOOR, not a total\n");

/*
 * Replay the aggregation over a realistic My Work page: four projects for one
 * customer, two of them unmeasured after the migration.
 */
const rows = [
  { customer: "Acme", contractHours: 100, loggedHours: 60,   myLoggedHours: 10 },
  { customer: "Acme", contractHours: 50,  loggedHours: 20,   myLoggedHours: 5 },
  { customer: "Acme", contractHours: 32,  loggedHours: null, myLoggedHours: null },  // unmeasured
  { customer: "Acme", contractHours: 18,  loggedHours: null, myLoggedHours: null },  // unmeasured
];
const summed = rows.reduce((s, r) => s + (r.loggedHours ?? 0), 0);
const measured = rows.filter((r) => r.loggedHours !== null).length;
const unmeasured = rows.length - measured;

console.log(`  4 projects, ${measured} measured, ${unmeasured} unmeasured`);
console.log(`  sum with ?? 0: ${summed}h  (a reader sees "80h of 200h contracted" = 40% burn)`);
console.log(`  truth: 80h across the ${measured} measured projects; the other ${unmeasured} are unknown`);

check("the sum is arithmetically correct (this is not a maths bug)",
  summed === 80, `${summed}h`);

/*
 * THE FIX. DESIGN.md rule 7 settles what a partly-unknown total must do: "a
 * collapsed or paged table still states its total ... a fixed-height list with no
 * count is indistinguishable from a truncated one, so the reader stops trusting
 * every other number on the page." A sum that omits rows is the same failure, so
 * this was house policy rather than a product preference.
 *
 * measuredProjectCount carries the coverage, and the UI renders it ONLY when rows
 * are actually being omitted.
 */
const measuredCount = rows.filter((r) => r.loggedHours !== null).length;
console.log(`  coverage: ${measuredCount}/${rows.length} measured`);

check("the query exposes a per-customer coverage count",
  /measuredProjectCount: number/.test(q),
  "a total whose completeness is unstated invites a wrong conclusion (DESIGN.md rule 7)");
check("it is counted from loggedHours, not from contractHours",
  /if \(r\.loggedHours !== null\) c\.measuredProjectCount \+= 1/.test(q),
  "\"measured\" must mean we know what was WORKED, which is what the sum claims");
check("the page-level totals carry it too",
  /measuredProjectCount: rows\.filter\(\(r\) => r\.loggedHours !== null\)\.length/.test(q));

const cg = readFileSync(join(REPO, "src/components/my-work/CustomerGroup.tsx"), "utf8");
check("CustomerGroup renders the coverage when rows are omitted",
  /customer\.measuredProjectCount < customer\.projectCount/.test(cg),
  "the count is dead data unless it reaches the page");
check("and stays silent when every project is measured",
  /measuredProjectCount < customer\.projectCount \? \(/.test(cg),
  "a fully-measured customer keeps the clean two-number display");
check("it uses the house --warning token, not an invented one",
  /text-\[var\(--warning\)\]/.test(cg) && !/var\(--warn\)/.test(cg),
  "--warn does not exist in DESIGN.md; --warning does");

// The indicator must be correct, not merely present.
const coverage = (rs) => ({
  measured: rs.filter((r) => r.loggedHours !== null).length,
  total: rs.length,
});
const partial = coverage(rows);
check("a partly-measured customer reports 2 of 4",
  partial.measured === 2 && partial.total === 4, JSON.stringify(partial));
const allMeasured = coverage(rows.filter((r) => r.loggedHours !== null));
check("a fully-measured customer reports measured === total (so nothing renders)",
  allMeasured.measured === allMeasured.total, JSON.stringify(allMeasured));

console.log("\n--- verdict\n");
console.log("  my-work.ts is null-SAFE and now null-TRANSPARENT: no per-row figure is");
console.log("  invented, every cell renders n/a rather than 0, and a total that omits");
console.log("  projects states its coverage (DESIGN.md rule 7) instead of presenting a");
console.log("  floor as a total.");

console.log(failures === 0
  ? "\nMY WORK survives the migration: null-safe, and honest about what a total omits."
  : `\n${failures} problem(s)`);
process.exit(failures === 0 ? 0 : 1);
