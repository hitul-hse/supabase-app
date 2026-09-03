"use client";

/**
 * The Team Lead workload board.
 *
 * Every figure here is measured. The version this replaces rendered, for a
 * company of 49 real people:
 *
 *   - a grid of five mockup names (Anna Brandt, C. Haas, P. Novak, R. Yilmaz,
 *     J. Weiß) with hand-written hours, under fixed "W31"-"W34" headers that were
 *     literal strings and so described the wrong weeks from week 35 onward;
 *   - a KPI strip of four constants: 76%, 3, 14, "2 PEOPLE";
 *   - three invented projects ("Site risk assessment 2026", 1 164/1 200 h);
 *   - TIMESHEET and CERTS columns fed by `people.timesheet_status` and
 *     `people.certificate_text`, i.e. strings like "SIFA EXP 12 SEP" for data no
 *     system in this project holds.
 *
 * The certificate and timesheet columns are GONE rather than rewired. Nothing
 * here tracks certificate expiry, and a board telling a lead "CERTS OK" when
 * nothing is checking is worse than a board that stays quiet about it.
 */

import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import type { ApprovalDecisionRow } from "@/lib/queries/types";
import type { TeamLeadBoardData } from "@/lib/queries/team-lead-live";
import { approveDecision, approveAllPending } from "./actions";
import { Button } from "@/components/ui/Button";
import { IconCheck } from "@/components/nav-icons";
import { Card, StatTile } from "@/components/ui/Card";
import { TeamWorkloadGrid } from "./TeamWorkloadGrid";

export function TeamLeadBoard({
  board,
  initialDecisions,
}: {
  board: TeamLeadBoardData;
  initialDecisions: ApprovalDecisionRow[];
}) {
  const [decisions, setDecisions] = useState(initialDecisions);
  const [approvedAll, setApprovedAll] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { weeks, rows, teamUtilisationPercent, activeCount, idleCount, overBudgetProjects, budgetsWithheld } =
    board;
  const range = weeks.length ? `${weeks[0].label}–${weeks[weeks.length - 1].label}` : "";

  const handleApprove = async (id: string) => {
    const previous = decisions;
    setError(null);
    setDecisions((prev) => prev.filter((d) => d.id !== id));
    const result = await approveDecision(id);
    if (!result.ok) {
      setDecisions(previous);
      setError(result.message ?? "Could not approve that item.");
    }
  };

  const handleApproveAll = async () => {
    const previous = decisions;
    setError(null);
    setApprovedAll(true);
    setDecisions([]);
    const result = await approveAllPending();
    if (!result.ok) {
      setDecisions(previous);
      setApprovedAll(false);
      setError(result.message ?? "Could not approve the pending items.");
    }
  };

  return (
    <>
      <PageHeader
        category="HSE HUB / TEAM LEAD"
        title="Workload board"
        meta={`${range} · ${rows.length} PEOPLE · TRACKINGTIME`}
        actions={
          <>
            <span className="hidden font-mono text-[11px] text-[var(--text-muted)] border border-[var(--border)] px-3 py-1.5 sm:inline">
              {range}
            </span>
            <Button
              variant="primary"
              onClick={handleApproveAll}
              disabled={approvedAll || decisions.length === 0}
            >
              {approvedAll && <IconCheck className="h-3.5 w-3.5" />}
              {approvedAll ? "All approved" : "Approve all clean"}
            </Button>
          </>
        }
      />

      <div className="flex flex-col gap-4 sm:gap-5 page-shell">
        {/* Measured KPIs. Each renders "n/a" rather than 0 when there is no
            basis: "nobody logged anything" and "the value is zero" are
            different claims, and 0% reads as a team sitting idle. */}
        <div className="grid grid-cols-2 gap-[var(--card-gap)] lg:grid-cols-4">
          <StatTile
            label="TEAM UTILISATION"
            value={teamUtilisationPercent}
            unit="%"
            hint={board.weeklyHoursAreNominal ? "VS NOMINAL 40 H WEEK" : "VS CONTRACTED"}
          />
          <StatTile label="LOGGED THIS WINDOW" value={activeCount} hint="PEOPLE" />
          {/* Amber only when somebody is actually idle: a permanently coloured
              zero trains the reader to stop seeing the colour. */}
          <StatTile
            label="NO TIME LOGGED"
            value={idleCount}
            hint="ACTIVE MEMBERS"
            tone={idleCount > 0 ? "warning" : "neutral"}
          />
          {/*
            A count of 0 and a withheld count are different facts. project_manager
            and hr reach this board on workload:read but do not hold
            projects:contracts:read, so for them the list is empty for a reason
            that has nothing to do with the portfolio. Showing "0 PROJECTS OVER
            ESTIMATE" to those readers would be a health claim made out of a
            permission check -- so the tile reports no value and says why.
          */}
          <StatTile
            label="OVER ESTIMATE"
            value={budgetsWithheld ? "n/a" : overBudgetProjects.filter((p) => p.burnPercent >= 100).length}
            hint={budgetsWithheld ? "BUDGETS NOT VISIBLE TO YOUR ROLE" : "PROJECTS"}
            tone={
              !budgetsWithheld && overBudgetProjects.some((p) => p.burnPercent >= 100)
                ? "critical"
                : "neutral"
            }
          />
        </div>

        {/* Workload grid — horizontally scrollable with a sticky name column */}
        {/* The workload grid on the shared primitive. Eight rows today, 49 in
            production and no ceiling anywhere in the query, so it is exactly the
            shape DESIGN.md rule 1 is about: paged, sticky-headered, with the
            name column frozen once the week columns make it scroll sideways. The
            two footnotes below are carried verbatim. */}
        <TeamWorkloadGrid board={board} />

        {/* Lower grid: decisions and the projects worth a lead's attention */}
        <div className="grid grid-cols-1 gap-[var(--card-gap)] lg:grid-cols-2">
          <Card className="flex flex-col gap-3 p-4">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-semibold text-[var(--text-primary)]">
                Needs your decision
              </span>
              <span className="font-mono text-[10px] text-[var(--text-muted)]">
                {decisions.length} PENDING
              </span>
            </div>

            <div className="flex max-h-[11rem] flex-col gap-2 overflow-y-auto">
              {error && (
                <p
                  role="alert"
                  className="border border-[var(--border)] p-2.5 text-[12px] text-[var(--text-primary)]"
                  style={{ background: "var(--warning-wash)" }}
                >
                  {error}
                </p>
              )}

              {decisions.length === 0 ? (
                <div className="p-4 text-center font-mono text-[12px] text-[var(--accent)]">
                  All items approved and up to date!
                </div>
              ) : (
                decisions.map((item) => (
                  <div
                    key={item.id}
                    className="flex flex-col gap-2 border border-[var(--border)] bg-[var(--surface-2)] p-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
                  >
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[12px] font-medium text-[var(--text-primary)]">
                        {item.title}
                      </span>
                      <span className="font-mono text-[10px] text-[var(--text-muted)]">
                        {item.subtitle}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 self-end sm:self-auto">
                      {item.secondary_action && (
                        <button className="border border-[var(--border-strong)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]">
                          {item.secondary_action}
                        </button>
                      )}
                      <button
                        onClick={() => handleApprove(item.id)}
                        className="bg-[var(--accent)] px-2.5 py-1 text-[11px] font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)]"
                      >
                        {item.primary_action}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>

          <Card className="flex flex-col gap-3 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-[12px] font-semibold text-[var(--text-primary)]">
                Projects over estimate
              </span>
              <span className="font-mono text-[10px] text-[var(--text-muted)]">
                LOGGED / ESTIMATED
              </span>
            </div>

            {budgetsWithheld ? (
              <div className="p-4 text-center font-mono text-[12px] text-[var(--text-muted)]">
                PROJECT BUDGETS ARE NOT VISIBLE TO YOUR ROLE
              </div>
            ) : overBudgetProjects.length === 0 ? (
              <div className="p-4 text-center font-mono text-[12px] text-[var(--text-muted)]">
                NO PROJECT WITH AN ESTIMATE HAS LOGGED TIME YET
              </div>
            ) : (
              <div className="flex max-h-[11rem] flex-col gap-3 overflow-y-auto">
                {overBudgetProjects.map((project) => {
                  const tone =
                    project.burnPercent >= 100
                      ? "var(--critical)"
                      : project.burnPercent >= 85
                      ? "var(--warning)"
                      : "var(--accent)";
                  return (
                    <div key={project.projectId} className="flex flex-col gap-1">
                      <div className="flex flex-wrap justify-between gap-1 text-[12px]">
                        <span className="font-medium text-[var(--text-primary)]">
                          {project.name}
                        </span>
                        <span className="font-mono" style={{ color: tone }}>
                          {project.loggedHours} / {project.estimatedHours} h
                        </span>
                      </div>
                      <div className="h-1.5 w-full bg-[var(--border)]">
                        {/* Capped at 100% width so a 422% burn does not overflow
                            the track; the number beside it carries the truth. */}
                        <div
                          className="h-full"
                          style={{
                            width: `${Math.min(100, project.burnPercent)}%`,
                            background: tone,
                          }}
                        />
                      </div>
                      <span className="font-mono text-[10px] text-[var(--text-muted)]">
                        {project.burnPercent}% OF ESTIMATE
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
