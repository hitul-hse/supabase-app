import { SyncBar } from "@/components/SyncBar";
import { createClient } from "@/utils/supabase/server";
import { requireProfile } from "@/utils/supabase/require-profile";
import { getTeamLeadBoard, getPendingTimesheetApprovals } from "@/lib/queries/hse";
import { TeamLeadBoard } from "./TeamLeadBoard";
import { PendingTimesheetApprovals } from "./PendingTimesheetApprovals";
import PageTransition from "@/components/animations/PageTransition";

export default async function TeamLeadPage() {
  await requireProfile("/team-lead", ["exec", "dept_head"]);
  const supabase = await createClient();
  const [{ bookings, decisions, weeks }, pendingTimesheets] = await Promise.all([
    getTeamLeadBoard(supabase),
    getPendingTimesheetApprovals(supabase),
  ]);

  return (
    <PageTransition>
      <div className="flex flex-col">
        <SyncBar />
        <TeamLeadBoard bookings={bookings} initialDecisions={decisions} weeks={weeks} />
        <div className="flex flex-col gap-4 px-4 pb-6 sm:px-6">
          <PendingTimesheetApprovals initialWeeks={pendingTimesheets} />
        </div>
      </div>
    </PageTransition>
  );
}
