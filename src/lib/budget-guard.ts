/**
 * The budget guard: decide whether hours may be logged against a project, and
 * warn before the ceiling rather than only at it.
 *
 * WHY THIS IS A SEPARATE, PURE MODULE. The decision ("may these hours be
 * logged?") is a business rule with edges that matter, and three write paths
 * (startTimer, createEntry, updateEntry) have to make it identically. One
 * implementation, one place to test, rather than three drifting copies.
 *
 * WHAT A BUDGET *IS*, and the two bugs that taught us
 * ---------------------------------------------------
 *
 * 1. A BUDGET IS A CONTRACT TERM, not a number a time tracker guessed.
 *    Sales agree hours with the customer; the app records them with the
 *    contract's start and end dates. That is why the ceiling now comes from
 *    time.project_contract_period rather than time.project.estimated_hours --
 *    the vendor sync upserts estimated_hours on every run, so a budget stored
 *    there is silently overwritten (import-trackingtime.mjs:448).
 *
 * 2. EVERY POSITIVE BUDGET COUNTS. An earlier version ignored budgets under
 *    10h as "vendor placeholders", which let a booking onto a 5h project
 *    already at 21.1h (422%) while the project page showed it in red. The live
 *    spread (1.33/2/3/4/5/5.5/6/6.5/7.5/8/9h, with 4h and 6h each more common
 *    than 2h) is small real retainers, not junk.
 *
 * WHY LEVELS RATHER THAN A BOOLEAN. "Allowed or refused" cannot express "you
 * are at 85% of a contract that ends in three weeks", which is the thing people
 * actually need to know in time to do something about it. So the decision
 * carries a level, and two of the levels allow the write while still warning.
 *
 * WHAT MUST NEVER BLOCK. This guard stops writes, so a wrong refusal means
 * somebody cannot record work they really did -- which pushes them to log it
 * against the wrong project and corrupts the data the whole app reports on.
 * Hence: no contract never blocks, an expired or un-renewed contract never blocks,
 * and landing exactly on budget is success rather than a violation.
 */

/** How close to the ceiling counts as "approaching" when no period says. */
export const DEFAULT_WARN_AT_PERCENT = 80;

/**
 * The verdict. Ordered roughly by severity, and deliberately explicit about
 * the difference between "no ceiling exists" and "within the ceiling" -- a
 * distinction the old boolean silently collapsed.
 */
export type BudgetLevel =
  /** No contract period and no fallback estimate: nothing to judge against. */
  | "unbudgeted"
  /** Comfortably inside the budget. */
  | "within"
  /** At or past the warning threshold, still inside the budget. */
  | "approaching"
  /** This booking lands exactly on the budget. Allowed: hitting it is success. */
  | "exhausted"
  /** This booking would cross the budget. */
  | "over"
  /** The budget was already spent before this booking. */
  | "already_over"
  /** The date falls outside every contract period on the project. */
  | "outside_contract";

export type BudgetDecision = {
  level: BudgetLevel;
  /** Whether the write may proceed. */
  allowed: boolean;
  /**
   * Whether the user should be told something even though it proceeded. Kept
   * separate from `allowed` so a caller cannot accidentally treat a warning as
   * a refusal (or drop it silently).
   */
  warn: boolean;
  /** Plain-language explanation. Always set, for allows as well as refusals. */
  reason: string;

  /** The ceiling in force, or null when there is none to judge against. */
  budgetHours: number | null;
  /** Hours already logged in the period being judged. */
  loggedHours: number;
  requestedHours: number;
  projectedHours: number;
  /** Projected share of budget, or null without a budget. */
  projectedPercent: number | null;
  /** How far past the budget this booking would go. 0 when within. */
  overByHours: number;
  /** Hours still available, or null without a budget. Never negative. */
  remainingHours: number | null;

  /** The threshold that classified this as approaching, when one applied. */
  warnAtPercent: number | null;

  /** Contract context, when the ceiling came from a contract period. */
  contract: {
    periodId: number | null;
    periodNo: number | null;
    startsOn: string | null;
    endsOn: string | null;
    /** Days until the contract ends; negative once it has lapsed. */
    daysRemaining: number | null;
    reference: string | null;
  } | null;
};

/** The contract period a booking is judged against. */
export type ContractPeriodInput = {
  id: number;
  periodNo: number;
  budgetHours: number;
  startsOn: string;
  endsOn: string;
  warnAtPercent: number | null;
  contractReference?: string | null;
  /** Days until ends_on. Supplied by the caller so this stays pure. */
  daysRemaining?: number | null;
};

export function evaluateBudget({
  budgetHours,
  loggedHours,
  requestedHours,
  period = null,
  hasAnyPeriod = false,
  warnAtPercent,
}: {
  /**
   * The ceiling. When `period` is given this is ignored in favour of the
   * period's own budget; standalone it is the legacy/fallback estimate, which
   * keeps projects with no contract recorded working exactly as before.
   */
  budgetHours: number | null;
  loggedHours: number;
  requestedHours: number;
  /** The contract period covering the entry's date, when there is one. */
  period?: ContractPeriodInput | null;
  /**
   * Whether the project has ANY contract period. This is what separates "this
   * project has no contract recorded" (fall back quietly) from "this project
   * has contracts but none covers this date" (warn: a renewal is probably
   * missing). Without it both look identical and the second goes unnoticed.
   */
  hasAnyPeriod?: boolean;
  /** Override threshold when no period supplies one. */
  warnAtPercent?: number | null;
}): BudgetDecision {
  const projected = round1(loggedHours + requestedHours);
  const effectiveBudget = period ? period.budgetHours : budgetHours;
  const hasRealBudget = effectiveBudget !== null && effectiveBudget > 0;

  const contract = period
    ? {
        periodId: period.id,
        periodNo: period.periodNo,
        startsOn: period.startsOn,
        endsOn: period.endsOn,
        daysRemaining: period.daysRemaining ?? null,
        reference: period.contractReference ?? null,
      }
    : null;

  const base = {
    loggedHours: round1(loggedHours),
    requestedHours: round1(requestedHours),
    projectedHours: projected,
    budgetHours: hasRealBudget ? effectiveBudget : null,
    projectedPercent: hasRealBudget
      ? Math.round((projected / effectiveBudget!) * 100)
      : null,
    /*
     * What is left AFTER this booking, not before it. The number somebody acts
     * on is the one that will be true once they save, and reporting the
     * pre-booking figure made "1h left" appear next to an entry that consumed
     * it. Floored at zero: a refused overrun has nothing remaining, and a
     * negative "remaining" is a contradiction rather than information (the
     * overrun itself is reported by overByHours).
     */
    remainingHours: hasRealBudget
      ? Math.max(0, round1(effectiveBudget! - projected))
      : null,
    warnAtPercent: null as number | null,
    contract,
  };

  /*
   * The entry's date falls outside every contract period, and the project DOES
   * have contracts. Almost always a renewal that has not been recorded yet.
   *
   * This must not block. If sales are late confirming, the consultant still
   * worked those hours, and refusing them would push the time onto some other
   * project -- corrupting exactly the data this feature is meant to protect.
   * So it is allowed and flagged loudly.
   */
  if (!period && hasAnyPeriod) {
    return {
      ...base,
      level: "outside_contract",
      allowed: true,
      warn: true,
      budgetHours: null,
      projectedPercent: null,
      remainingHours: null,
      reason:
        "This date is not covered by any contract period on this project. The hours are recorded, " +
        "but the contract likely needs renewing before they can be billed.",
      overByHours: 0,
    };
  }

  // Nothing to judge against. Allowed, and SAID to be unbudgeted rather than
  // reported as "within budget", which would imply a ceiling that is not there.
  if (!hasRealBudget) {
    return {
      ...base,
      level: "unbudgeted",
      allowed: true,
      warn: false,
      reason:
        effectiveBudget !== null && effectiveBudget < 0
          ? `This project's budget is negative (${round1(effectiveBudget)}h), which cannot be a ceiling, so it is treated as unbudgeted.`
          : "This project has no agreed budget, so there is no ceiling to enforce.",
      overByHours: 0,
    };
  }

  const budget = effectiveBudget!;
  const threshold = clampPercent(
    period?.warnAtPercent ?? warnAtPercent ?? DEFAULT_WARN_AT_PERCENT,
  );
  const withThreshold = { ...base, warnAtPercent: threshold };
  const contractSuffix = describeContract(contract);

  // Already spent before this booking. A distinct state from "this booking
  // crosses the line": the person about to be refused may have had nothing to
  // do with the overrun, so the message must not imply they caused it.
  if (loggedHours > budget) {
    return {
      ...withThreshold,
      level: "already_over",
      allowed: false,
      warn: false,
      reason:
        `This project is already over its ${round1(budget)}h budget (${round1(loggedHours)}h logged). ` +
        `Adding ${round1(requestedHours)}h would take it to ${projected}h.${contractSuffix}`,
      overByHours: round1(projected - budget),
    };
  }

  if (projected > budget) {
    return {
      ...withThreshold,
      level: "over",
      allowed: false,
      warn: false,
      reason:
        `This would take the project past its ${round1(budget)}h budget: ${round1(loggedHours)}h logged ` +
        `plus ${round1(requestedHours)}h is ${projected}h, ${round1(projected - budget)}h over.${contractSuffix}`,
      overByHours: round1(projected - budget),
    };
  }

  // Landing exactly on budget is the goal, not a violation -- but it is worth
  // saying, because there is nothing left after it.
  if (projected === budget) {
    return {
      ...withThreshold,
      level: "exhausted",
      allowed: true,
      warn: true,
      reason:
        `This uses the last of the ${round1(budget)}h budget: ${projected}h of ${round1(budget)}h. ` +
        `Nothing remains after this entry.${contractSuffix}`,
      overByHours: 0,
    };
  }

  const percent = (projected / budget) * 100;
  if (percent >= threshold) {
    return {
      ...withThreshold,
      level: "approaching",
      allowed: true,
      warn: true,
      reason:
        `Approaching the budget: ${projected}h of ${round1(budget)}h (${Math.round(percent)}%) after this entry, ` +
        `${round1(budget - projected)}h left.${contractSuffix}`,
      overByHours: 0,
    };
  }

  return {
    ...withThreshold,
    level: "within",
    allowed: true,
    warn: false,
    reason:
      `Within budget: ${projected}h of ${round1(budget)}h after this entry, ` +
      `${round1(budget - projected)}h left.${contractSuffix}`,
    overByHours: 0,
  };
}

/**
 * Contract context worth appending to a message: which period, and whether it
 * is about to end. Only mentioned when it adds something -- a period number on
 * its own is noise, but "ends in 12 days" changes what somebody does next.
 */
function describeContract(contract: BudgetDecision["contract"]): string {
  if (!contract) return "";
  const bits: string[] = [];
  if (contract.periodNo !== null) {
    bits.push(`contract period ${contract.periodNo}`);
  }
  if (contract.endsOn) {
    const d = contract.daysRemaining;
    if (d !== null && d < 0) bits.push(`which ended on ${contract.endsOn}`);
    else if (d !== null && d <= 30) bits.push(`ending ${contract.endsOn} (${d} days)`);
    else bits.push(`to ${contract.endsOn}`);
  }
  return bits.length ? ` (${bits.join(", ")})` : "";
}

/** The message a user sees when a booking is REFUSED. */
export function refusalMessage(d: BudgetDecision, projectName: string): string {
  return (
    `${d.reason} Booking blocked on “${projectName}”. ` +
    "Sales have been notified so the budget can be raised or the work re-scoped. " +
    "Log the time against another project, or ask for the budget to be extended."
  );
}

/**
 * The message a user sees when a booking is ALLOWED but worth flagging.
 *
 * Separate from refusalMessage because the advice differs: a refusal needs a
 * way out, a warning needs a heads-up and no interruption. Returns null when
 * there is nothing to say, so callers can pass any decision through.
 */
export function warningMessage(d: BudgetDecision, projectName: string): string | null {
  if (!d.warn) return null;
  if (d.level === "outside_contract") {
    return (
      `${d.reason} Recorded against “${projectName}”. ` +
      "Ask sales to confirm the renewal so these hours sit inside a contract period."
    );
  }
  if (d.level === "exhausted") {
    return `${d.reason} Recorded against “${projectName}”. Further work needs the budget extending.`;
  }
  return `${d.reason} Recorded against “${projectName}”.`;
}

function clampPercent(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_WARN_AT_PERCENT;
  return Math.min(100, Math.max(1, Math.round(n)));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
