import { SyncBar } from "@/components/SyncBar";
import { createClient } from "@/utils/supabase/server";
import { requirePermission } from "@/utils/supabase/require-profile";
import { PERMISSIONS } from "@/lib/permissions";
import { getPendingTimesheetApprovals, getApprovalDecisions } from "@/lib/queries/hse";
import { getLiveTeamLeadBoard } from "@/lib/queries/team-lead-live";
import { TeamLeadBoard } from "./TeamLeadBoard";
import { TeamLeadCharts } from "./TeamLeadCharts";
import { TeamAnalysisSection } from "./TeamAnalysisSection";
import { teamKey, parseBoardWindow, BOARD_WINDOWS } from "@/lib/queries/team-lead-live";
import Link from "next/link";
import { getCurrentProfile } from "@/lib/queries/auth";
import { PendingTimesheetApprovals } from "./PendingTimesheetApprovals";
import PageTransition from "@/components/animations/PageTransition";

export default async function TeamLeadPage({
  searchParams,
}: {
  searchParams: Promise<{ weeks?: string }>;
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
  const windowWeeks = parseBoardWindow((await searchParams).weeks);
  const [board, decisions, pendingTimesheets] = await Promise.all([
    getLiveTeamLeadBoard(supabase, windowWeeks),
    getApprovalDecisions(supabase),
    getPendingTimesheetApprovals(supabase),
  ]);

  return (
    <PageTransition>
      <div className="flex flex-col">
        <SyncBar />
        {/* The window filter: how far back the WHOLE view reads. Analysis, charts
            and grid all derive from one query, so one control moves everything.
            Links, because the window is URL state -- shareable, back-button-safe. */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4 sm:px-6">
          <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--text-faint)]">
            WINDOW
          </span>
          <div className="flex items-center gap-0.5 rounded-full border border-[var(--border)] bg-[var(--surface-2)] p-0.5">
            {BOARD_WINDOWS.map((w) => (
              <Link
                key={w}
                href={w === 4 ? "/team-lead" : `/team-lead?weeks=${w}`}
                aria-current={w === windowWeeks ? "page" : undefined}
                className={`rounded-full px-3 py-1 text-[12px] transition-colors ${
                  w === windowWeeks
                    ? "bg-[var(--accent)] font-medium text-[var(--accent-contrast)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
                }`}
              >
                {w} weeks
              </Link>
            ))}
          </div>
        </div>

        {/* GRAPHS FIRST, per request: per-team analysis leads (execs see every team
            segregated, a dept_head exactly their own), the org-wide pair follows,
            and the grid of raw cells comes after the figures it explains. The grid
            stays unscoped for both roles -- RLS already decides whose HOURS a
            viewer may read; this ordering is presentation, not access control. */}
        <div className="pt-4">
          <TeamAnalysisSection board={board} viewerRole={viewerRole} viewerTeam={viewerTeam} />
        </div>
        <TeamLeadCharts board={board} />
        <TeamLeadBoard board={board} initialDecisions={decisions} />
        <div className="flex flex-col gap-4 px-4 pb-6 sm:px-6">
          <PendingTimesheetApprovals initialWeeks={pendingTimesheets} />
        </div>
      </div>
    </PageTransition>
  );
}
