/**
 * The budget guard's edges, exercised against the SHIPPED module.
 *
 * This gate exists because the guard BLOCKS WRITES. A bug here does not show up
 * as a wrong number on a chart; it shows up as a consultant unable to log the
 * day they worked, which is the worst failure this app can have. Every boundary
 * the rule turns on is pinned.
 *
 * Two real bugs this file now guards against, both of which shipped:
 *
 *   1. A 10h "placeholder floor" ignored small budgets, so a booking landed on
 *      a 5h project already at 21.1h (422%) while the project page showed it in
 *      red. Any positive budget is now a budget.
 *
 *   2. Budgets were summed over ALL time, so a renewal was meaningless: last
 *      year's hours would eat this year's budget the moment the new contract
 *      started. Hours are now scoped to the contract period.
 */
import {
  evaluateBudget,
  refusalMessage,
  warningMessage,
  DEFAULT_WARN_AT_PERCENT,
} from "../src/lib/budget-guard.ts";

let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
};

/* ---------------------------------------------------- the ceiling boundary */

const onBudget = evaluateBudget({ budgetHours: 100, loggedHours: 90, requestedHours: 10 });
check(
  "landing EXACTLY on budget is allowed",
  onBudget.allowed && onBudget.overByHours === 0,
  `level=${onBudget.level} projected=${onBudget.projectedHours}h`,
);
check(
  "and is called out as exhausted, because nothing remains after it",
  onBudget.level === "exhausted" && onBudget.warn && onBudget.remainingHours === 0,
  onBudget.reason,
);

const justOver = evaluateBudget({ budgetHours: 100, loggedHours: 90, requestedHours: 10.1 });
check(
  "one tenth of an hour over is refused",
  !justOver.allowed && justOver.overByHours === 0.1 && justOver.level === "over",
  `over by ${justOver.overByHours}h`,
);

const wellUnder = evaluateBudget({ budgetHours: 100, loggedHours: 10, requestedHours: 5 });
check(
  "comfortably within budget is allowed silently",
  wellUnder.allowed && !wellUnder.warn && wellUnder.level === "within" && wellUnder.projectedPercent === 15,
  `level=${wellUnder.level} percent=${wellUnder.projectedPercent}%`,
);
check(
  "and reports the hours remaining",
  wellUnder.remainingHours === 85,
  `remaining=${wellUnder.remainingHours}h`,
);

/* ------------------------------------------- THE NEW FEATURE: approaching */

// The user asked to be told BEFORE hitting the wall, not only at it.
const approaching = evaluateBudget({ budgetHours: 100, loggedHours: 78, requestedHours: 4 });
check(
  "at 82% of budget the booking is ALLOWED but warns",
  approaching.allowed && approaching.warn && approaching.level === "approaching",
  approaching.reason,
);
check(
  "the default warning threshold is 80%",
  DEFAULT_WARN_AT_PERCENT === 80 && approaching.warnAtPercent === 80,
  `threshold=${approaching.warnAtPercent}%`,
);

// Just below the threshold must NOT warn, or the warning becomes noise.
const belowThreshold = evaluateBudget({ budgetHours: 100, loggedHours: 70, requestedHours: 5 });
check(
  "75% does not warn — a warning that fires always is ignored always",
  belowThreshold.allowed && !belowThreshold.warn && belowThreshold.level === "within",
  `percent=${belowThreshold.projectedPercent}%`,
);

// Exactly on the threshold warns: "at 80%" should mean at.
const atThreshold = evaluateBudget({ budgetHours: 100, loggedHours: 75, requestedHours: 5 });
check(
  "exactly 80% warns (the threshold is inclusive)",
  atThreshold.warn && atThreshold.level === "approaching",
  `percent=${atThreshold.projectedPercent}%`,
);

// A per-period threshold overrides the default: a 5h retainer and a 1200h
// programme should not warn at the same point.
const custom = evaluateBudget({
  budgetHours: null,
  loggedHours: 5,
  requestedHours: 1,
  period: {
    id: 1, periodNo: 1, budgetHours: 10, startsOn: "2026-01-01", endsOn: "2026-12-31",
    warnAtPercent: 50, daysRemaining: 100,
  },
});
check(
  "a period's own warn threshold is respected",
  custom.level === "approaching" && custom.warnAtPercent === 50,
  custom.reason,
);

/* ------------------------------------------- the WorkMotion regression case */

const workMotion = evaluateBudget({ budgetHours: 5, loggedHours: 21.1, requestedHours: 2 });
check(
  "WorkMotion GU (5h budget, 21.1h logged) is REFUSED, not waved through",
  !workMotion.allowed && workMotion.level === "already_over",
  workMotion.reason,
);
check(
  "it reports the real 5h ceiling and a percentage",
  workMotion.budgetHours === 5 && workMotion.projectedPercent === 462,
  `budget=${workMotion.budgetHours}h percent=${workMotion.projectedPercent}%`,
);
check(
  "remaining hours never goes negative",
  workMotion.remainingHours === 0,
  `remaining=${workMotion.remainingHours}`,
);

const smallWithRoom = evaluateBudget({ budgetHours: 2, loggedHours: 0.5, requestedHours: 1 });
check(
  "a 2h budget with room left still allows a booking",
  smallWithRoom.allowed && smallWithRoom.budgetHours === 2,
  smallWithRoom.reason,
);
const smallest = evaluateBudget({ budgetHours: 1.33, loggedHours: 1.3, requestedHours: 0.5 });
check("the smallest live budget (1.33h) is enforced", !smallest.allowed, smallest.reason);

/* ------------------------------------------------ contract periods & renewal */

/*
 * THE RENEWAL REQUIREMENT, as a test. The old period is over budget, the new
 * one is fresh. A booking in the NEW period must be judged against the NEW
 * budget and the NEW period's hours only -- otherwise renewing a contract would
 * change nothing and the guard would refuse work on a contract with 8h free.
 */
const renewed = evaluateBudget({
  budgetHours: 5, // the stale vendor estimate, which must be ignored
  loggedHours: 0, // hours INSIDE the new period
  requestedHours: 3,
  period: {
    id: 2, periodNo: 2, budgetHours: 8, startsOn: "2026-07-01", endsOn: "2027-06-30",
    warnAtPercent: 80, daysRemaining: 300, contractReference: "WM-2026",
  },
  hasAnyPeriod: true,
});
check(
  "after a renewal, a booking in the new period is ALLOWED",
  renewed.allowed && renewed.level === "within",
  renewed.reason,
);
check(
  "the period's budget overrides the stale vendor estimate",
  renewed.budgetHours === 8,
  `budget=${renewed.budgetHours}h (estimated_hours said 5h)`,
);
check(
  "the decision carries the contract context for the UI and the alert",
  renewed.contract?.periodNo === 2 && renewed.contract?.endsOn === "2027-06-30",
  JSON.stringify(renewed.contract),
);

// A booking judged against the OLD period still refuses: history is preserved,
// not rewritten by the renewal.
const oldPeriod = evaluateBudget({
  budgetHours: 5,
  loggedHours: 21.1,
  requestedHours: 1,
  period: {
    id: 1, periodNo: 1, budgetHours: 5, startsOn: "2025-07-01", endsOn: "2026-06-30",
    warnAtPercent: 80, daysRemaining: -50,
  },
  hasAnyPeriod: true,
});
check(
  "backdating into the OLD, over-budget period is still refused",
  !oldPeriod.allowed && oldPeriod.level === "already_over",
  oldPeriod.reason,
);
check(
  "and the message says the contract had already ended",
  /ended on 2026-06-30/.test(oldPeriod.reason),
  oldPeriod.reason,
);

/* --------------------------------------- outside any contract: warn, allow */

/*
 * The case that must never block. If sales are late renewing, the consultant
 * still worked those hours; refusing them pushes the time onto another project
 * and corrupts the data the whole app reports on.
 */
const outside = evaluateBudget({
  budgetHours: 5,
  loggedHours: 0,
  requestedHours: 2,
  period: null,
  hasAnyPeriod: true,
});
check(
  "a date outside every contract period is ALLOWED, never blocked",
  outside.allowed && outside.level === "outside_contract",
  outside.reason,
);
check(
  "but it warns, and says the contract likely needs renewing",
  outside.warn && /renew/i.test(outside.reason),
  outside.reason,
);
check(
  "it claims no ceiling, because none applies to that date",
  outside.budgetHours === null && outside.projectedPercent === null,
);

// A project with NO contracts at all is the pre-feature world: quiet fallback.
const noContract = evaluateBudget({
  budgetHours: 100,
  loggedHours: 10,
  requestedHours: 5,
  period: null,
  hasAnyPeriod: false,
});
check(
  "a project with no contract recorded falls back to the estimate silently",
  noContract.allowed && !noContract.warn && noContract.budgetHours === 100,
  `level=${noContract.level} — nothing regresses for projects without contracts`,
);

/* ------------------------------------------------------------- no budget */

for (const [label, value] of [["null", null], ["zero", 0]]) {
  const none = evaluateBudget({ budgetHours: value, loggedHours: 500, requestedHours: 8 });
  check(`a ${label} budget never blocks`, none.allowed && none.level === "unbudgeted");
  check(
    `a ${label} budget says "no budget", not "within budget"`,
    /no agreed budget/i.test(none.reason) && !/within budget/i.test(none.reason),
    none.reason,
  );
}

const negative = evaluateBudget({ budgetHours: -5, loggedHours: 10, requestedHours: 2 });
check(
  "a negative budget is treated as unbudgeted rather than blocking everything",
  negative.allowed && negative.budgetHours === null && /negative/i.test(negative.reason),
  negative.reason,
);

/* ------------------------------------------------- already over vs crossing */

const already = evaluateBudget({ budgetHours: 288, loggedHours: 398, requestedHours: 4 });
check("an already-over project refuses further bookings", !already.allowed);
check("it is flagged as ALREADY over, not as newly crossing", already.level === "already_over");
check(
  "the overrun is measured from the budget, not the previous total",
  already.overByHours === 114,
  `398 + 4 - 288 = ${already.overByHours}`,
);

const crossing = evaluateBudget({ budgetHours: 100, loggedHours: 95, requestedHours: 10 });
check(
  "a first crossing is not mislabelled as already-over",
  crossing.level === "over" && !crossing.allowed,
);
check(
  "the crossing message shows the arithmetic",
  /95/.test(crossing.reason) && /105/.test(crossing.reason),
  crossing.reason,
);

/* --------------------------------------------------------- the user messages */

const msg = refusalMessage(justOver, "Netto / 26 SiFa");
check("the refusal names the project", msg.includes("Netto / 26 SiFa"));
check("the refusal tells the user sales were notified", /sales/i.test(msg));
check("the refusal offers a way forward", /another project|extended|re-scoped/i.test(msg));

// A warning must read as a caution, NOT as a refusal: no "blocked", no "log it
// elsewhere". Getting this wrong would make people think work was rejected.
const warn = warningMessage(approaching, "Arden University / 25/26 SiFa");
check("a warning is produced for an approaching booking", Boolean(warn), String(warn));
check(
  "the warning does NOT claim the booking was blocked",
  warn !== null && !/blocked|refused/i.test(warn),
  String(warn),
);
check(
  "the warning names the project so it is actionable",
  warn !== null && warn.includes("Arden University / 25/26 SiFa"),
);
check(
  "no warning is produced when there is nothing to say",
  warningMessage(wellUnder, "Anything") === null,
);
const outsideWarn = warningMessage(outside, "Lapsed Project");
check(
  "the outside-contract warning tells the user to chase the renewal",
  outsideWarn !== null && /sales|renewal/i.test(outsideWarn),
  String(outsideWarn),
);

/* ------------------------------------------------------------- arithmetic */

const rounding = evaluateBudget({ budgetHours: 100, loggedHours: 33.333, requestedHours: 0.667 });
check(
  "hours are reported to one decimal, not floating-point noise",
  String(rounding.projectedHours).length <= 5,
  `projected=${rounding.projectedHours}`,
);

// A threshold outside 1..100 must be clamped rather than producing nonsense.
const silly = evaluateBudget({
  budgetHours: 100, loggedHours: 10, requestedHours: 1, warnAtPercent: 900,
});
check(
  "an out-of-range warn threshold is clamped, not obeyed",
  silly.warnAtPercent !== null && silly.warnAtPercent <= 100,
  `threshold=${silly.warnAtPercent}%`,
);

console.log(
  failed === 0
    ? "\nBUDGET GUARD: contract-scoped, warns before the ceiling, and never blocks work it cannot judge"
    : `\n${failed} check(s) failed`,
);
process.exit(failed === 0 ? 0 : 1);
