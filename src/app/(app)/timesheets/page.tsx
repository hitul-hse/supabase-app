import { SyncBar } from "@/components/SyncBar";
import { createClient } from "@/utils/supabase/server";
import { requireUser } from "@/utils/supabase/require-user";
import { getTimesheetEntries } from "@/lib/queries/hse";
import { TimesheetGrid } from "./TimesheetGrid";

export default async function TimesheetsPage() {
  await requireUser("/timesheets");
  const supabase = await createClient();
  const entries = await getTimesheetEntries(supabase);

  return (
    <div className="flex flex-col">
      <SyncBar />
      <TimesheetGrid initialEntries={entries} />
    </div>
  );
}
