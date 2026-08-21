import { SyncBar } from "@/components/SyncBar";
import { createClient } from "@/utils/supabase/server";
import { requirePermission } from "@/utils/supabase/require-profile";
import { PERMISSIONS } from "@/lib/permissions";
import { getPendingTimesheetApprovals, getApprovalDecisions } from "@/lib/queries/hse";
import { getLiveTeamLeadBoard } from "@/lib/queries/team-lead-live";
import { TeamLeadBoard } from "./TeamLeadBoard";
import { TeamLeadCharts } from "./TeamLeadCharts";
import { TeamAnalysisSection } from "./TeamAnalysisSection";
import { TeamDeepAnalysis } from "./TeamDeepAnalysis";
import { BoardRangeFilter } from "./BoardRangeFilter";
import { teamKey, parseBoardRange } from "@/lib/queries/team-lead-live";
import { getCurrentProfile } from "@/lib/queries/auth";
import { PendingTimesheetApprovals } from "./PendingTimesheetApprovals";
import PageTransition from "@/components/animations/PageTransition";

export default async function TeamLeadPage({
  searchParams,
}: {
  searchParams: Promise<{ weeks?: string; range?: string; from?: string; to?: string }>;
}) {
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
  const range = parseBoardRange(await searchParams);
  const [board, decisions, pendingTimesheets] = await Promise.all([
    getLiveTeamLeadBoard(supabase, range),
    getApprovalDecisions(supabase),
    getPendingTimesheetApprovals(supabase),
  ]);

  return (
    <PageTransition>
      <div className="flex flex-col">
        <SyncBar />
        {/* The period filter: how far back the WHOLE view reads. Analysis, charts
            and grid all derive from one query, so one control moves everything.
            Presets plus real from/to dates; the range is URL state -- shareable
            and back-button-safe. */}
        <BoardRangeFilter range={board.range} />

        {/* GRAPHS FIRST, per request: per-team analysis leads (execs see every team
            segregated, a dept_head exactly their own), the org-wide pair follows,
            and the grid of raw cells comes after the figures it explains. The grid
            stays unscoped for both roles -- RLS already decides whose HOURS a
            viewer may read; this ordering is presentation, not access control. */}
        <div className="pt-4">
          <TeamAnalysisSection board={board} viewerRole={viewerRole} viewerTeam={viewerTeam} />
        </div>
        {/* The deep-analysis figures (month-over-month movement, utilisation
            heatmap, travel burden) sit between the per-team blocks and the
            org-wide trend: they answer the questions the grid below raises. */}
        <TeamDeepAnalysis board={board} />
        <TeamLeadCharts board={board} />
        <TeamLeadBoard board={board} initialDecisions={decisions} />
        <div className="flex flex-col gap-4 px-4 pb-6 sm:px-6">
          <PendingTimesheetApprovals initialWeeks={pendingTimesheets} />
        </div>
      </div>
    </PageTransition>
  );
}
