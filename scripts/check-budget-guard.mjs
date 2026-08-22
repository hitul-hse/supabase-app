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
 *   - ANY positive budget must be enforced, however small. This gate used to
 *     assert the opposite (a 10h "placeholder floor"), and that assertion was
 *     wrong: it let a booking onto WorkMotion GU, a 5h project already at
 *     21.1h, while the project page showed 422%. A regression test for that
 *     exact project is below.
 *   - no budget at all must not block, and must SAY it is unbudgeted rather
 *     than reporting "within budget", because a large share of hours land there
 *   - a project already past its budget (3 live ones) must refuse with the
 *     already-over wording, not the crossing wording
 */
import { evaluateBudget, refusalMessage } from "../src/lib/budget-guard.ts";

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

/* --------------------------------------------- small budgets are real ones */

/*
 * THE REGRESSION THIS SECTION EXISTS FOR.
 *
 * The guard originally ignored any budget under 10h as a "vendor placeholder",
 * so a user added time to "10303_WorkMotion Software GmbH / 25/26 GU" -- 5h
 * budgeted, 21.1h already logged -- and the guard allowed it without comment.
 * The live numbers killed that theory: the sub-10h budgets spread across
 * 1.33/2/3/4/5/5.5/6/6.5/7.5/8/9h (4h and 6h are each more common than 2h),
 * they are burned no more loosely than big ones (29% vs 21% median), and every
 * other budget consumer in the app already used "> 0".
 */
const workMotion = evaluateBudget({ budgetHours: 5, loggedHours: 21.1, requestedHours: 2 });
check(
  "WorkMotion GU (5h budget, 21.1h logged) is REFUSED, not waved through",
  !workMotion.allowed,
  workMotion.reason,
);
check(
  "it is reported as already over, with the real 5h ceiling and a percentage",
  workMotion.alreadyOver && workMotion.budgetHours === 5 && workMotion.projectedPercent === 462,
  `budget=${workMotion.budgetHours}h percent=${workMotion.projectedPercent}%`,
);

// A small budget with room left must still allow the booking: enforcing a
// budget means respecting it, not refusing everything on a small project.
const smallWithRoom = evaluateBudget({ budgetHours: 2, loggedHours: 0.5, requestedHours: 1 });
check(
  "a 2h budget with room left still allows a booking",
  smallWithRoom.allowed && smallWithRoom.budgetHours === 2,
  smallWithRoom.reason,
);

// And the smallest real budget in the live data is enforced too.
const smallest = evaluateBudget({ budgetHours: 1.33, loggedHours: 1.3, requestedHours: 0.5 });
check(
  "the smallest live budget (1.33h) is enforced",
  !smallest.allowed,
  smallest.reason,
);

// A negative budget is corrupt data, not a ceiling: it must not refuse
// everything, and it must not silently masquerade as "within budget".
const negative = evaluateBudget({ budgetHours: -5, loggedHours: 10, requestedHours: 2 });
check(
  "a negative budget is treated as unbudgeted rather than blocking every booking",
  negative.allowed && negative.budgetHours === null,
  negative.reason,
);
check(
  "and it says so explicitly instead of claiming 'within budget'",
  /negative/i.test(negative.reason) && !/within budget/i.test(negative.reason),
  negative.reason,
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
