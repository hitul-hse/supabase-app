import { SyncBar } from "@/components/SyncBar";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { createClient } from "@/utils/supabase/server";
import { requireUser } from "@/utils/supabase/require-user";
import { getTimesheetWeek, currentWeekStart } from "@/lib/queries/timesheets";
import { TimesheetGrid } from "./TimesheetGrid";
import PageTransition from "@/components/animations/PageTransition";
import { RecordsTabs } from "../RecordsTabs";
import { enforceRoleRouteAccess, userHasPermission } from "@/utils/supabase/require-profile";
import { PERMISSIONS } from "@/lib/permissions";

/** Only ever trust a well-formed YYYY-MM-DD from the URL; anything else falls back to the current week. */
function parseWeekParam(raw: string | undefined): string {
  if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return currentWeekStart();
}

/**
 * The Hub's editable weekly grid over public.timesheet_entries, in hours.
 *
 * Distinct from /time, which reads the `time` schema in seconds and shows the
 * intervals TrackingTime imported. Both tabs are offered by RecordsTabs above the
 * grid; see src/lib/queries/timesheets.ts for why this page was NOT repointed at
 * time.entry when the 28 seeded mockup rows were removed from this table.
 */
export default async function TimesheetsPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  await requireUser("/timesheets");
  /*
    This grid has no permission gate of its own -- an authenticated session and
    a linked person row is all it has ever asked for, deliberately, because
    logging your own hours is not a privilege. A role restricted to a fixed
    route list therefore reaches it unless the allow-list is consulted here.
  */
  await enforceRoleRouteAccess("/timesheets");
  // Whether to offer the dashboard tab. Asked as a permission rather than a role so
  // the toggle in /admin/roles actually decides it.
  const canReadAll = await userHasPermission(PERMISSIONS.TIMESHEETS_READ_ALL);
  const supabase = await createClient();
  const weekStart = parseWeekParam((await searchParams).week);
  const week = await getTimesheetWeek(supabase, weekStart);

  return (
    <PageTransition>
      <div className="flex flex-col">
        <SyncBar />
        {/* The grid renders its own header, so the tabs go above it rather than
            below -- keeping them in the same position relative to the page title as
            on the two TrackingTime surfaces. */}
        <RecordsTabs canReadAll={canReadAll} />
        {/* An account with no linked person cannot log time at all: every write
            action here resolves the person first and returns "No linked person
            profile" without it. Rendering the grid would offer an Add-entry
            button that can only ever fail, so the state is named instead. */}
        {week.state === "no-person" ? (
          <>
            <PageHeader category="HSE HUB / RECORDS" title="Timesheets" meta="NOT LINKED" />
            <div className="page-shell">
              <EmptyState
                title="Your account is not linked to a person record"
                description="Timesheet rows are stored against a person, so nothing can be logged here until an administrator links your account. Your tracked time in TrackingTime is unaffected — see the TrackingTime tab above."
              />
            </div>
          </>
        ) : (
          <TimesheetGrid initialEntries={week.entries} weekStart={weekStart} />
        )}
      </div>
    </PageTransition>
  );
}
