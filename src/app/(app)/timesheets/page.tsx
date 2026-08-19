import { SyncBar } from "@/components/SyncBar";
import { createClient } from "@/utils/supabase/server";
import { requireUser } from "@/utils/supabase/require-user";
import { getTimesheetEntries, currentWeekStart } from "@/lib/queries/hse";
import { TimesheetGrid } from "./TimesheetGrid";
import PageTransition from "@/components/animations/PageTransition";
import { RecordsTabs } from "../RecordsTabs";
import { userHasPermission } from "@/utils/supabase/require-profile";
import { PERMISSIONS } from "@/lib/permissions";

/** Only ever trust a well-formed YYYY-MM-DD from the URL; anything else falls back to the current week. */
function parseWeekParam(raw: string | undefined): string {
  if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return currentWeekStart();
}

export default async function TimesheetsPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  await requireUser("/timesheets");
  // Whether to offer the dashboard tab. Asked as a permission rather than a role so
  // the toggle in /admin/roles actually decides it.
  const canReadAll = await userHasPermission(PERMISSIONS.TIMESHEETS_READ_ALL);
  const supabase = await createClient();
  const weekStart = parseWeekParam((await searchParams).week);
  const entries = await getTimesheetEntries(supabase, weekStart);

  return (
    <PageTransition>
      <div className="flex flex-col">
        <SyncBar />
        {/* The grid renders its own header, so the tabs go above it rather than
            below -- keeping them in the same position relative to the page title as
            on the two TrackingTime surfaces. */}
        <RecordsTabs canReadAll={canReadAll} />
        <TimesheetGrid initialEntries={entries} weekStart={weekStart} />
      </div>
    </PageTransition>
  );
}
