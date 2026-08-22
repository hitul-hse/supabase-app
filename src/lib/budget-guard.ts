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
 *   334 projects total, 251 with estimated_hours > 0.
 *
 *   A BUDGET IS A BUDGET, however small. The first version of this guard had a
 *       PLACEHOLDER_BUDGET_HOURS = 10 floor, on the theory that the 142
 *       projects budgeted under 10h carried a meaningless vendor default. That
 *       was wrong, and it silently let a real overbooking through: WorkMotion
 *       GU has a 5h budget with 21.1h logged (422%), and the guard waved the
 *       booking past while the project page showed 422.4% in red.
 *
 *       Re-measured 2026-08-22, the floor failed on every count:
 *         - The values are not one repeated default. They spread across
 *           1.33/2/3/4/5/5.5/6/6.5/7.5/8/9h -- 4h (36) and 6h (26) are more
 *           common than 2h (32). That is a population of small real retainers
 *           (a few hours of DGUV V2 support a year), not junk.
 *         - The floor made the guard blind to 142 of 251 budgeted projects and
 *           156.1h of logged time.
 *         - Small budgets are not treated more loosely in practice: median burn
 *           is 29% on sub-10h projects vs 21% on larger ones.
 *         - Every other budget consumer in the app (projects-live,
 *           team-lead-live, trackingtime-report) already uses "> 0". The floor
 *           existed only here, so the guard disagreed with the dashboards.
 *
 *       Removing it turns on refusals for 7 already-over projects (all live).
 *       That is the guard working, not a regression -- and `alreadyOver` gives
 *       those a distinct, explanatory message.
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
  // Any positive budget counts. 0 and null both mean "nobody set one", which is
  // the only case this guard cannot judge.
  const hasRealBudget = budgetHours !== null && budgetHours > 0;

  const base = {
    budgetHours: hasRealBudget ? budgetHours : null,
    loggedHours: round1(loggedHours),
    requestedHours: round1(requestedHours),
    projectedHours,
    projectedPercent: hasRealBudget ? Math.round((projectedHours / budgetHours!) * 100) : null,
  };

  // No budget at all: allowed, and SAID to be unbudgeted rather than passed off
  // as "within budget". A large share of tracked hours lands here.
  if (!hasRealBudget) {
    return {
      ...base,
      allowed: true,
      // A negative budget is nonsense data rather than a ceiling; say so plainly
      // instead of refusing every booking on it.
      reason:
        budgetHours !== null && budgetHours < 0
          ? `This project's budget is negative (${round1(budgetHours)}h), which cannot be a ceiling, so it is treated as unbudgeted.`
          : "This project has no budget set, so there is no ceiling to enforce.",
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
