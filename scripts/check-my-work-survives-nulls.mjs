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
 * renders "n/a" rather than 0 (CustomerGroup.tsx, MyWorkTables.tsx).
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

let failures = 0;
const check = (l, ok, d = "") => { console.log(`${ok ? "PASS" : "FAIL"}: ${l}${d ? `\n        ${d}` : ""}`); if (!ok) failures += 1; };

const q = readFileSync("C:/Supabase/src/lib/queries/my-work.ts", "utf8");

/* ------------------------------ the per-row handling must stay null-safe ---- */

check("logged_hours is read with numOrNull, so NULL survives the mapping",
  /const loggedHours = numOrNull\(p\.logged_hours\)/.test(q),
  "num() would coerce an unknown to 0 at the row level, which is the bug this migration removes");

check("the per-project burn is only computed when BOTH figures are known",
  /contractHours !== null && loggedHours !== null/.test(q),
  "otherwise an unmeasured project reports a burn percentage it cannot support");

/* -------------------------- the UI must render unknown as n/a, never 0 ------ */

for (const f of ["src/components/my-work/CustomerGroup.tsx", "src/components/my-work/MyWorkTables.tsx"]) {
  const s = readFileSync(`C:/Supabase/${f}`, "utf8");
  check(`${f} renders a null figure as n/a`,
    /if \(n === null\) return "n\/a"/.test(s));
  check(`${f} renders a null burn as n/a rather than 0%`,
    /consumedPercent === null \? "n\/a"/.test(s));
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
 * THE FINDING. The number is right and the presentation is not: nothing on the
 * page distinguishes "80h, complete" from "80h, plus two projects we are not
 * measuring". `myHoursUnpopulated` already exists for exactly this shape of
 * problem on a different column, which is the precedent for flagging it.
 */
const hasUnmeasuredFlag = /unmeasuredProjects|projectsUnmeasured|loggedHoursPartial|myHoursUnpopulated/.test(q);
check("the query surfaces SOME signal that a total may be incomplete",
  hasUnmeasuredFlag,
  "myHoursUnpopulated is the existing precedent: a total whose completeness is "
  + "unstated invites a wrong conclusion");

/*
 * Whether that existing flag COVERS this case is the real question, and it does
 * not: myHoursUnpopulated is about person_assignments.logged_hours being
 * unbackfilled, not about projects.logged_hours being deliberately NULL. So the
 * gate records the gap rather than pretending the precedent already solves it.
 */
const flagIsAboutAssignments = /myHoursUnpopulated:[\s\S]{0,200}myLoggedHours/.test(q);
check("the existing flag is about ASSIGNMENT hours, a different column",
  flagIsAboutAssignments,
  "so it does not tell a reader that a CUSTOMER total omits unmeasured projects");

console.log("\n--- verdict\n");
console.log("  my-work.ts is null-SAFE: nothing crashes, no per-row figure is invented,");
console.log("  and every cell renders n/a rather than 0.");
console.log("");
console.log("  It is not null-TRANSPARENT at the aggregate level: a customer or page");
console.log("  total silently omits unmeasured projects, so it is a floor presented as");
console.log("  a total. That is a presentation gap, not a correctness bug, and it only");
console.log("  becomes visible once 20260826120000 is pasted.");
console.log("");
console.log("  Recorded rather than fixed here, deliberately: changing what a total MEANS");
console.log("  on a page people use daily is a product decision, and the honest options");
console.log("  differ (annotate the total, exclude unmeasured projects from the");
console.log("  denominator, or show a count alongside). See docs/next-steps-2026-08-26.md.");

console.log(failures === 0
  ? "\nMY WORK survives the migration: null-safe throughout, with one presentation gap recorded."
  : `\n${failures} problem(s)`);
process.exit(failures === 0 ? 0 : 1);
