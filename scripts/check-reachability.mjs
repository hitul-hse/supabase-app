/**
 * Can a person actually GET to the thing, and are they TOLD what happened?
 *
 * WHAT THIS GUARDS
 * ----------------
 * Two defects of the same shape: code that runs, writes, and passes every other
 * check, while the human on the other side sees nothing. A build cannot catch
 * either, because nothing is broken -- something is merely unreachable.
 *
 *  1. /time HAD NO ROUTE. SidebarNav links /time/dashboard and never /time, on
 *     the reasoning that the tracker is "reached from" the dashboard. Nothing on
 *     the dashboard linked to it. The other three roles land there by redirect
 *     when they lack timesheets:read_all, so the gap was invisible in testing --
 *     it hit exactly one group, the execs, who hold every permission and so are
 *     never redirected anywhere. The live timer was reachable only by typing a
 *     URL.
 *
 *     The first fix was a link in the dashboard header, and it failed in an
 *     instructive way: it was never committed, so it existed locally and in no
 *     deployed build, and the user reported the button "appearing sometimes".
 *     The route is now a tab in RecordsTabs, rendered on all three records
 *     surfaces -- which is why this check also insists the row is MOUNTED, not
 *     merely that the component exists.
 *
 *  2. THE REJECTION NOTE WAS WRITE-ONLY. A lead cannot reject a week without
 *     typing a reason -- team-lead/actions.ts refuses an empty one, citing why
 *     an unexplained rejection is worse than none. That reason reached the
 *     database and stopped there: getTimesheetEntries never selected the column
 *     and the grid never rendered it, so the employee saw their week become
 *     editable again with nothing to act on.
 *
 * Both are asserted at the source level, which is the honest level for them:
 * the question is not whether a function returns the right value, it is whether
 * one part of the app is connected to another. Each check has a negative control
 * proving it can see the disconnected version.
 *
 * Run: node scripts/check-reachability.mjs
 */
import { readFileSync } from "node:fs";

let failed = false;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed = true;
};

const read = (p) => readFileSync(p, "utf8");

console.log("\nEvery page has a way in:\n");
{
  const nav = read("src/components/SidebarNav.tsx");
  const dash = read("src/app/(app)/time/dashboard/page.tsx");
  const tabs = read("src/app/(app)/RecordsTabs.tsx");
  const timesheets = read("src/app/(app)/timesheets/page.tsx");

  /*
   * A COMPLETE tag, not a substring.
   *
   * `includes("<RecordsTabs")` also matches `<RecordsTabsDisabled`, so renaming the
   * component away would leave this check passing while nothing rendered the tabs. Found
   * by injecting exactly that rename and watching the gate stay green.
   */
  const mountsTabs = (src) => /<RecordsTabs[\s/>]/.test(src);

  const inNav = nav.includes(`href: "/time"`);
  const fromDashboardHeader = dash.includes(`href="/time"`);

  // The current answer: a tab in the shared records row. It only counts if that row is
  // actually MOUNTED somewhere -- a component nobody renders is as unreachable as the
  // header link that turned out never to be deployed.
  const tabExists = tabs.includes(`href: "/time"`);
  const tabMounted = mountsTabs(dash) || mountsTabs(timesheets);

  check(
    "/time is reachable — from the sidebar, a records tab, or the dashboard",
    inNav || (tabExists && tabMounted) || fromDashboardHeader,
    inNav
      ? "linked in SidebarNav"
      : tabExists && tabMounted
        ? "a TrackingTime tab in RecordsTabs, mounted on the records surfaces"
        : fromDashboardHeader
          ? "linked from the dashboard header"
          : "NOTHING links it",
  );

  // The redirect is not a route. It only fires for people who LACK
  // timesheets:read_all, so it cannot serve the execs who hold it.
  check(
    "and not only via the permission-denied redirect",
    inNav || (tabExists && tabMounted) || fromDashboardHeader,
    "an exec is never redirected, so that path does not reach them",
  );

  // The route must survive being on the tracker itself, or someone who lands on /time
  // has no way back to the two report surfaces.
  check(
    "the tab row is mounted on /time too, so the trip is not one-way",
    mountsTabs(read("src/app/(app)/time/page.tsx")),
  );

  check(
    "negative control: a dashboard with no link and no tabs WOULD be caught",
    !`<PageHeader title="x" />`.includes(`href="/time"`) &&
      !mountsTabs(`<PageHeader title="x" />`) &&
      // And a renamed component must not satisfy it either.
      !mountsTabs(`<RecordsTabsDisabled />`),
  );
}

console.log("\nA mandatory explanation is shown to the person it is about:\n");
{
  const actions = read("src/app/(app)/team-lead/actions.ts");
  const query = read("src/lib/queries/hse.ts");
  const types = read("src/lib/queries/types.ts");
  const grid = read("src/app/(app)/timesheets/TimesheetGrid.tsx");

  check(
    "rejecting still REQUIRES a note (the premise of the rest)",
    actions.includes("rejection_note"),
  );
  check("the type carries it", types.includes("rejectionNote"));
  check("the query maps it", query.includes("rejectionNote: row.rejection_note"));
  check("the grid renders it", grid.includes("rejectionNote"));
  check(
    "and only when there is one — an approved week gets no empty box",
    grid.includes("rejections.length > 0"),
  );
  check(
    "negative control: a grid that ignores the note WOULD be caught",
    !`<div>{entry.status}</div>`.includes("rejectionNote"),
  );
}

console.log(
  failed
    ? "\nREACHABILITY: something works but nobody can get to it\n"
    : "\nREACHABILITY: the tracker has a route, and a sent-back week says why\n",
);

process.exitCode = failed ? 1 : 0;
