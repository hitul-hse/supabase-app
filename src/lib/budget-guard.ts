/**
 * The budget guard: refuse a booking that would push a project past its budget.
 *
 * WHY THIS IS A SEPARATE, PURE MODULE. The decision ("may these hours be
 * logged?") is a business rule with edges that matter, and it has to be made
 * identically by three different write paths (createEntry, updateEntry, and
 * stopTimer). Putting it here means one implementation and one place to test,
 * rather than three drifting copies inside server actions.
 *
 * WHAT THE LIVE DATA FORCED INTO THE DESIGN (measured 2026-08-21):
 *
 *   334 projects total, 251 with estimated_hours > 0, but only 109 with >= 10h.
 *       The other 142 carry a placeholder estimate (2h is the common one), so a
 *       naive guard would block almost every booking on a project nobody ever
 *       really budgeted. Hence PLACEHOLDER_BUDGET_HOURS.
 *
 *   3,201h logged on budgeted projects vs 2,602h on UNBUDGETED ones.
 *       Nearly half of all tracked time lands where a budget guard is blind.
 *       That is not a reason to skip the guard, but it IS a reason to never
 *       claim it protects the whole portfolio: a project with no budget is
 *       explicitly ALLOWED here, with a reason saying so.
 *
 *   3 projects are ALREADY over budget (Netto/26 SiFa at 138%, 398h of 288h).
 *       So the guard must not only prevent crossing the line, it has to cope
 *       with work that starts already past it -- otherwise the first person to
 *       touch that project is simply locked out with no explanation.
 *
 * THE RULE, stated once: hours already logged plus the hours being booked must
 * not exceed the budget. Equal to the budget is ALLOWED -- landing exactly on
 * budget is the goal, not a violation.
 */

/** A budget below this is a vendor placeholder, not a real ceiling. */
export const PLACEHOLDER_BUDGET_HOURS = 10;

export type BudgetDecision = {
  /** False when the booking must be refused. */
  allowed: boolean;
  /**
   * Why, in one line, for the user AND for the notification. Always present --
   * an allow needs a reason too, because "no budget set" and "within budget"
   * are different facts and the difference is what a reviewer needs.
   */
  reason: string;
  /** null when the project carries no real budget to judge against. */
  budgetHours: number | null;
  /** Hours already logged against the project, excluding the entry being edited. */
  loggedHours: number;
  /** Hours this booking adds. */
  requestedHours: number;
  /** loggedHours + requestedHours, for the message and the notification. */
  projectedHours: number;
  /** Projected as a share of budget, or null without a budget. */
  projectedPercent: number | null;
  /** How far past the budget this booking would go. 0 when within. */
  overByHours: number;
  /** True when the project was ALREADY over before this booking. */
  alreadyOver: boolean;
};

/**
 * Decide whether a booking may proceed.
 *
 * Pure: the caller fetches the numbers, this weighs them. `budgetHours` is
 * whatever the project records (null/0 both mean "nobody set one").
 */
export function evaluateBudget({
  budgetHours,
  loggedHours,
  requestedHours,
}: {
  budgetHours: number | null;
  loggedHours: number;
  requestedHours: number;
}): BudgetDecision {
  const projectedHours = round1(loggedHours + requestedHours);
  const hasRealBudget = budgetHours !== null && budgetHours >= PLACEHOLDER_BUDGET_HOURS;

  const base = {
    budgetHours: hasRealBudget ? budgetHours : null,
    loggedHours: round1(loggedHours),
    requestedHours: round1(requestedHours),
    projectedHours,
    projectedPercent: hasRealBudget ? Math.round((projectedHours / budgetHours!) * 100) : null,
  };

  // No real budget: allowed, and SAID to be unbudgeted rather than passed off as
  // "within budget". Half the tracked hours in this business land here.
  if (!hasRealBudget) {
    return {
      ...base,
      allowed: true,
      reason:
        budgetHours === null || budgetHours === 0
          ? "This project has no budget set, so there is no ceiling to enforce."
          : `This project's budget (${round1(budgetHours)}h) is below the ${PLACEHOLDER_BUDGET_HOURS}h placeholder floor, so it is treated as unbudgeted.`,
      overByHours: 0,
      alreadyOver: false,
    };
  }

  const budget = budgetHours!;
  const alreadyOver = loggedHours > budget;
  // Equal to budget is fine: hitting the number exactly is success.
  const withinBudget = projectedHours <= budget;

  if (withinBudget) {
    return {
      ...base,
      allowed: true,
      reason: `Within budget: ${projectedHours}h of ${round1(budget)}h after this entry.`,
      overByHours: 0,
      alreadyOver: false,
    };
  }

  const overByHours = round1(projectedHours - budget);
  return {
    ...base,
    allowed: false,
    reason: alreadyOver
      ? `This project is already over its ${round1(budget)}h budget (${round1(loggedHours)}h logged). Adding ${round1(requestedHours)}h would take it to ${projectedHours}h.`
      : `This would take the project past its ${round1(budget)}h budget: ${round1(loggedHours)}h logged plus ${round1(requestedHours)}h is ${projectedHours}h, ${overByHours}h over.`,
    overByHours,
    alreadyOver,
  };
}

/** The message a user sees when a booking is refused. */
export function refusalMessage(d: BudgetDecision, projectName: string): string {
  return (
    `${d.reason} Booking blocked on “${projectName}”. ` +
    "Sales have been notified so the budget can be raised or the work re-scoped. " +
    "Log the time against another project, or ask for the budget to be extended."
  );
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
