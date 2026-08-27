// The acceptance check for the whole feature the user asked for, as a user
// experiences it: can someone actually CLICK a project, see who is responsible
// and what services the customer buys, and can a lead see capacity before
// reassigning?
//
// Written BEFORE reviewing the two agents' UI so the bar is set independently of
// what they happened to build. Every other gate here tests a query or a
// migration; this one tests REACHABILITY, which is the thing that was missing
// while the data layer was already correct and fully gated.
//
// WHAT THIS DOES AND DOES NOT PROVE
// ---------------------------------
// It is a STRUCTURAL check: it reads the page sources and asserts the right
// queries are called, the dangerous numeric guard is absent, and the honest-null
// and unknown-absence cases are handled. It does NOT render the pages, so it
// cannot prove the markup looks right or that the data reaches the screen.
//
// That gap is covered elsewhere on purpose: check-order-detail-live.mjs and
// check-reassignment-candidates-live.mjs execute the real query modules against
// the live database, and check-table-scroll-budget drives the deployed pages in
// a browser. Claiming this file renders anything would overstate it.
import { readFileSync, existsSync } from "node:fs";

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

console.log("check-feature-reachable: can a user actually do what was asked?\n");

/*
 * 1. THE PAGE EXISTS AND IS KEYED CORRECTLY.
 *
 * The whole point of a separate /orders/[id] route is that /projects/[id]
 * validates /^\d+$/ against the TrackingTime bigint and therefore cannot show
 * the 54 masterdata orders (1,724h) that have no time.project. A numeric guard
 * copied into the new page would silently reintroduce exactly that hole, so this
 * asserts its ABSENCE.
 */
const PAGE = "src/app/(app)/orders/[id]/page.tsx";
check("the order detail page exists", existsSync(PAGE), PAGE);

if (existsSync(PAGE)) {
  const src = readFileSync(PAGE, "utf8");

  check("it does NOT reject non-numeric ids",
    !/\/\^\\d\+\$\/\.test|\/\^\[0-9\]\+\$\/\.test/.test(src),
    "a numeric guard would hide the 54 orphan orders again");

  check("it reads the order-detail query rather than reimplementing it",
    /getOrderDetail/.test(src));

  // The hours honesty requirement. hoursDisagree exists precisely so the page
  // can show both figures; ignoring it would hide a 196.5h discrepancy.
  check("it handles the stale-snapshot disagreement",
    /hoursDisagree/.test(src),
    "stored vs live hours differ on 4 orders by up to 196.5h");

  check("it renders the responsible AND the replacement",
    /responsible/.test(src) && /replacement/.test(src));

  check("it shows what services the customer buys",
    /customerServices/.test(src));

  // Honest nulls. A page that prints 0 for an unmeasured order is the exact bug
  // migration 20260826120000 was pasted to make impossible.
  check("it renders n/a rather than a fabricated number",
    /n\/a/i.test(src),
    "unmeasured orders must not read as 0");

  // House rule enforced by check-design-system, worth catching here too since
  // this page is new.
  check("no emoji or unicode glyphs (SVG only in app-shell files)",
    !/[\u{1F300}-\u{1FAFF}\u{2190}-\u{21FF}\u{2500}-\u{27BF}]/u.test(src));

  check("permission is checked before rendering",
    /userHasPermission|requirePermission|requireProfile/.test(src));
}

/*
 * 2. THE PAGE IS LINKED FROM SOMEWHERE.
 *
 * An unreachable route is not a feature. Any management component may own the
 * link, so search them all rather than pinning one file.
 */
const linkCandidates = [
  "src/app/(app)/dashboard/management/ManagementCustomerPortfolio.tsx",
  "src/app/(app)/dashboard/management/EmployeeOwnershipOverview.tsx",
  "src/app/(app)/dashboard/management/ManagementProjectRisks.tsx",
  "src/app/(app)/dashboard/management/ManagementMatrix.tsx",
  "src/app/(app)/projects/ProjectsLedger.tsx",
];
const linkedFrom = linkCandidates.filter((f) => existsSync(f) && /\/orders\//.test(readFileSync(f, "utf8")));
check("something links to /orders/", linkedFrom.length > 0,
  linkedFrom.length ? linkedFrom.map((f) => f.split("/").pop()).join(", ") : "the page is unreachable from the UI");

/*
 * 3. THE REASSIGNMENT PICKER SHOWS CAPACITY.
 *
 * The old ResponsibleEditor was a bare list of names, which gave a lead no way
 * to see that Rency Sebastian already holds 62 projects and covers 62 more.
 *
 * This originally pinned ManagementCustomerPortfolio.tsx and reported a false
 * FAIL: the agent correctly extracted the picker into its own
 * ReassignmentPicker.tsx, which is better structure than the inline editor it
 * replaced. A gate that fails a refactor it should welcome is measuring file
 * layout rather than behaviour, so it now searches wherever the picker lives.
 */
const pickerCandidates = [
  "src/app/(app)/dashboard/management/ReassignmentPicker.tsx",
  "src/app/(app)/dashboard/management/ManagementCustomerPortfolio.tsx",
];
const pickerFile = pickerCandidates.find((f) =>
  existsSync(f) && /CandidateLoad|responsibleFor|coversAsReplacement/.test(readFileSync(f, "utf8")));

check("the reassignment picker reads the capacity signal", Boolean(pickerFile),
  pickerFile ? `${pickerFile.split("/").pop()}` : "still a bare dropdown of names");

if (pickerFile) {
  const src = readFileSync(pickerFile, "utf8");

  // absence is ALWAYS null today (leave_requests has 0 rows). Rendering that
  // as "available" would be a confident lie about who can take the work.
  check("an unknown absence is shown as unknown, not as availability",
    /unbekannt|unknown|Abwesenheit/i.test(src),
    "leave_requests has 0 rows, so nobody's availability is known");

  check("people already on the project are distinguishable",
    /alreadyOnProject/.test(src),
    "reassigning to the current holder is a real misclick");

  // The load figures are the whole reason the picker exists.
  check("both load dimensions are surfaced",
    /responsibleFor/.test(src) && /coversAsReplacement/.test(src),
    "covering 62 projects is real work even though none of them is 'theirs'");

  // Honest nulls again: a person whose whole portfolio is unmeasured must not
  // read as having zero contracted work.
  check("a null contract-hours total renders as n/a, not 0",
    /n\/a/i.test(src));

  check("no emoji or unicode glyphs in the picker",
    !/[\u{1F300}-\u{1FAFF}\u{2190}-\u{21FF}\u{2500}-\u{27BF}]/u.test(src));
}

/*
 * The picker is a component, so it must actually be mounted somewhere or it is
 * as unreachable as a page nobody links to.
 */
if (pickerFile?.includes("ReassignmentPicker")) {
  const mounted = [
    "src/app/(app)/dashboard/management/ManagementCustomerPortfolio.tsx",
    "src/app/(app)/dashboard/management/ManagementMatrix.tsx",
    "src/app/(app)/dashboard/management/page.tsx",
  ].filter((f) => existsSync(f) && /ReassignmentPicker/.test(readFileSync(f, "utf8")));
  check("the picker component is mounted", mounted.length > 0,
    mounted.length ? mounted.map((f) => f.split("/").pop()).join(", ") : "the component exists but nothing renders it");
}

/*
 * 4. THE CHAIN STILL COMPLETES.
 *
 * The UI is worthless if the handover it triggers does not reach My Work, so
 * point at the gate that proves it rather than re-testing it here.
 */
check("the handover chain gate exists",
  existsSync("scripts/check-handover-chain-live.mjs"),
  "run it to confirm an approved reassignment reaches the new person's My Work");

console.log(`\n${failures === 0 ? "PASS — the feature is reachable end to end" : `FAIL (${failures}) — the feature is not yet usable`}`);
process.exit(failures ? 1 : 0);
