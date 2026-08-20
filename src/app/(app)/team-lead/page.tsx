import { SyncBar } from "@/components/SyncBar";
import { createClient } from "@/utils/supabase/server";
import { requirePermission } from "@/utils/supabase/require-profile";
import { PERMISSIONS } from "@/lib/permissions";
import { getPendingTimesheetApprovals, getApprovalDecisions } from "@/lib/queries/hse";
import { getLiveTeamLeadBoard } from "@/lib/queries/team-lead-live";
import { TeamLeadBoard } from "./TeamLeadBoard";
import { TeamLeadCharts } from "./TeamLeadCharts";
import { PendingTimesheetApprovals } from "./PendingTimesheetApprovals";
import PageTransition from "@/components/animations/PageTransition";

export default async function TeamLeadPage() {
  // NOTE this WIDENS access: workload:read is held by exec, dept_head AND
  // project_manager, where the old ["exec", "dept_head"] list excluded the last.
  // That is the intended reading of the permission — a project manager who holds
  // "View Workload Board" should see it — and approving is a separate key
  // (workload:approve) that project_manager does not hold, so the board is
  // visible to them but not actionable.
  await requirePermission("/team-lead", PERMISSIONS.WORKLOAD_READ);
  const supabase = await createClient();
  const [board, decisions, pendingTimesheets] = await Promise.all([
    getLiveTeamLeadBoard(supabase),
    getApprovalDecisions(supabase),
    getPendingTimesheetApprovals(supabase),
  ]);

  return (
    <PageTransition>
      <div className="flex flex-col">
        <SyncBar />
        <TeamLeadBoard board={board} initialDecisions={decisions} />
        {/* The figures under the board, derived from the same board data so the
            two can never disagree: the team's weekly total as an area, and the
            last completed week's workload as a donut. */}
        <TeamLeadCharts board={board} />
        <div className="flex flex-col gap-4 px-4 pb-6 sm:px-6">
          <PendingTimesheetApprovals initialWeeks={pendingTimesheets} />
        </div>
      </div>
    </PageTransition>
  );
}
