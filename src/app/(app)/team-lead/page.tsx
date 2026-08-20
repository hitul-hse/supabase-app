import { SyncBar } from "@/components/SyncBar";
import { createClient } from "@/utils/supabase/server";
import { requirePermission } from "@/utils/supabase/require-profile";
import { PERMISSIONS } from "@/lib/permissions";
import { getPendingTimesheetApprovals, getApprovalDecisions } from "@/lib/queries/hse";
import { getLiveTeamLeadBoard } from "@/lib/queries/team-lead-live";
import { TeamLeadBoard } from "./TeamLeadBoard";
import { TeamLeadCharts } from "./TeamLeadCharts";
import { TeamAnalysisSection } from "./TeamAnalysisSection";
import { teamKey } from "@/lib/queries/team-lead-live";
import { getCurrentProfile } from "@/lib/queries/auth";
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

  /*
   * Who is looking decides what the analysis section shows: an exec gets every team
   * segregated, a dept_head gets their own team only. The viewer's team is read from
   * their profile's department first (the field admins actually maintain in Users &
   * Roles), then from their linked roster row -- both normalised through teamKey so
   * "Operations" and "OPERATIONS" compare equal.
   */
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const profile = user ? await getCurrentProfile(supabase, user.id, user.email ?? null) : null;
  const viewerRole = profile?.roleKey ?? "employee";
  let viewerTeam = teamKey(profile?.department);
  if (!viewerTeam && user) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: memberRow } = await (supabase as any)
      .schema("time")
      .from("member")
      .select("team")
      .eq("user_id", user.id)
      .maybeSingle();
    viewerTeam = teamKey(memberRow?.team ?? null);
  }
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
        {/* Per-team analysis. Execs see every team segregated; a dept_head sees
            exactly their own. The board grid above stays unscoped for both --
            RLS already decides whose HOURS a viewer may read, and this section
            is an analysis lens over the same rows, not an access control. */}
        <TeamAnalysisSection board={board} viewerRole={viewerRole} viewerTeam={viewerTeam} />
        <div className="flex flex-col gap-4 px-4 pb-6 sm:px-6">
          <PendingTimesheetApprovals initialWeeks={pendingTimesheets} />
        </div>
      </div>
    </PageTransition>
  );
}
