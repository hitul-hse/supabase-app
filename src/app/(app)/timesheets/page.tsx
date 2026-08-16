import { SyncBar } from "@/components/SyncBar";
import { createClient } from "@/utils/supabase/server";
import { requireUser } from "@/utils/supabase/require-user";
import { getTimesheetEntries, currentWeekStart } from "@/lib/queries/hse";
import { TimesheetGrid } from "./TimesheetGrid";
import PageTransition from "@/components/animations/PageTransition";

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
  const supabase = await createClient();
  const weekStart = parseWeekParam((await searchParams).week);
  const entries = await getTimesheetEntries(supabase, weekStart);

  return (
    <PageTransition>
      <div className="flex flex-col">
        <SyncBar />
        <TimesheetGrid initialEntries={entries} weekStart={weekStart} />
      </div>
    </PageTransition>
  );
}
