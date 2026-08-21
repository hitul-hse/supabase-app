/**
 * The budget guard's edges, exercised against the SHIPPED module.
 *
 * This gate exists because the guard BLOCKS WRITES. A bug here does not show up
 * as a wrong number on a chart; it shows up as a consultant unable to log the
 * day they worked, which is the worst failure this app can have. So every
 * boundary the rule turns on is pinned:
 *
 *   - exactly on budget must be ALLOWED (hitting the number is success)
 *   - one tenth of an hour over must be REFUSED
 *   - a placeholder budget (the vendor's 2h, 142 live projects) must not block
 *   - no budget at all must not block, and must SAY it is unbudgeted rather
 *     than reporting "within budget", because half the live hours land there
 *   - a project already past its budget (3 live ones) must refuse with the
 *     already-over wording, not the crossing wording
 */
import { evaluateBudget, refusalMessage, PLACEHOLDER_BUDGET_HOURS } from "../src/lib/budget-guard.ts";

let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
};

/* ---------------------------------------------------- the boundary itself */

const onBudget = evaluateBudget({ budgetHours: 100, loggedHours: 90, requestedHours: 10 });
check(
  "landing EXACTLY on budget is allowed",
  onBudget.allowed && onBudget.overByHours === 0,
  `${onBudget.projectedHours}h of 100h -> allowed=${onBudget.allowed}`,
);

const justOver = evaluateBudget({ budgetHours: 100, loggedHours: 90, requestedHours: 10.1 });
check(
  "one tenth of an hour over is refused",
  !justOver.allowed && justOver.overByHours === 0.1,
  `over by ${justOver.overByHours}h`,
);

const wellUnder = evaluateBudget({ budgetHours: 100, loggedHours: 10, requestedHours: 5 });
check("comfortably within budget is allowed", wellUnder.allowed && wellUnder.projectedPercent === 15);

/* ------------------------------------------------- placeholder budgets */

// 142 live projects carry a placeholder estimate; blocking on those would make
// the guard unusable rather than protective.
const placeholder = evaluateBudget({ budgetHours: 2, loggedHours: 1.5, requestedHours: 8 });
check(
  "a 2h placeholder budget does NOT block a real day's work",
  placeholder.allowed,
  placeholder.reason,
);
check(
  "a placeholder budget reports NO budget rather than a fake ceiling",
  placeholder.budgetHours === null && placeholder.projectedPercent === null,
);
check(
  `the placeholder floor is stated as ${PLACEHOLDER_BUDGET_HOURS}h`,
  PLACEHOLDER_BUDGET_HOURS === 10,
);
// The floor itself must be inclusive: a 10h budget is a real one.
const atFloor = evaluateBudget({ budgetHours: 10, loggedHours: 9, requestedHours: 2 });
check(
  "a budget exactly at the floor IS enforced",
  !atFloor.allowed,
  `10h budget, 11h projected -> allowed=${atFloor.allowed}`,
);

/* --------------------------------------------------------- no budget */

for (const [label, value] of [["null", null], ["zero", 0]]) {
  const none = evaluateBudget({ budgetHours: value, loggedHours: 500, requestedHours: 8 });
  check(`a ${label} budget never blocks`, none.allowed);
  check(
    `a ${label} budget says "no budget", not "within budget"`,
    /no budget/i.test(none.reason) && !/within budget/i.test(none.reason),
    none.reason,
  );
}

/* ------------------------------------------------- already over budget */

// Netto / 26 SiFa on live data: 398h logged against a 288h budget.
const already = evaluateBudget({ budgetHours: 288, loggedHours: 398, requestedHours: 4 });
check("an already-over project refuses further bookings", !already.allowed);
check("it is flagged as ALREADY over, not as newly crossing", already.alreadyOver);
check(
  "the message says the project is already over",
  /already over/i.test(already.reason),
  already.reason,
);
check(
  "the overrun is measured from the budget, not from the previous total",
  already.overByHours === 114,
  `398 + 4 - 288 = ${already.overByHours}`,
);

// A booking that crosses for the first time must NOT claim it was already over.
const crossing = evaluateBudget({ budgetHours: 100, loggedHours: 95, requestedHours: 10 });
check("a first crossing is not mislabelled as already-over", !crossing.alreadyOver && !crossing.allowed);
check(
  "the crossing message shows the arithmetic",
  /95/.test(crossing.reason) && /105/.test(crossing.reason),
  crossing.reason,
);

/* ------------------------------------------------------- the user message */

const msg = refusalMessage(justOver, "Netto / 26 SiFa");
check("the refusal names the project", msg.includes("Netto / 26 SiFa"));
check("the refusal tells the user sales were notified", /sales/i.test(msg));
check("the refusal offers a way forward", /another project|extended|re-scoped/i.test(msg));

/* ------------------------------------------------------------ arithmetic */

const rounding = evaluateBudget({ budgetHours: 100, loggedHours: 33.333, requestedHours: 0.667 });
check(
  "hours are reported to one decimal, not floating-point noise",
  String(rounding.projectedHours).length <= 5,
  `projected=${rounding.projectedHours}`,
);

console.log(failed === 0 ? "\nBUDGET GUARD: all checks passed" : `\n${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
