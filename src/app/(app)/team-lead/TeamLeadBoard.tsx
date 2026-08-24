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
import type { TeamLeadBoardData, BoardCell } from "@/lib/queries/team-lead-live";
import { approveDecision, approveAllPending } from "./actions";
import { Button } from "@/components/ui/Button";
import { IconCheck } from "@/components/nav-icons";
import { Card, StatTile } from "@/components/ui/Card";

/** Hours to one decimal, or an em dash when the person logged nothing. */
function cellText(cell: BoardCell): string {
  if (cell.hours === null) return "–";
  return cell.hours % 1 === 0 ? String(cell.hours) : cell.hours.toFixed(1);
}

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

  const { weeks, rows, teamUtilisationPercent, activeCount, idleCount, overBudgetProjects } = board;
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
          <StatTile
            label="OVER ESTIMATE"
            value={overBudgetProjects.filter((p) => p.burnPercent >= 100).length}
            hint="PROJECTS"
            tone={
              overBudgetProjects.some((p) => p.burnPercent >= 100) ? "critical" : "neutral"
            }
          />
        </div>

        {/* Workload grid — horizontally scrollable with a sticky name column */}
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-baseline gap-2.5 border-b border-[var(--divider)] px-4 py-3">
            <span className="text-[12px] font-semibold text-[var(--text-primary)]">
              Hours logged per week
            </span>
            <span className="hidden font-mono text-[10px] text-[var(--text-muted)] sm:inline">
              FROM TRACKINGTIME ENTRIES · BOUNDED AT TODAY
            </span>
          </div>

          {rows.length === 0 ? (
            <div className="p-8 text-center font-mono text-[12px] text-[var(--text-muted)]">
              NO TIME LOGGED IN THE LAST {weeks.length} WEEKS
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-[560px] w-full border-collapse">
                <thead>
                  <tr className="border-b border-[var(--border)] bg-[var(--surface-2)] font-mono text-[10px] tracking-[0.1em] text-[var(--text-faint)]">
                    <th className="sticky left-0 bg-[var(--surface-2)] px-4 py-2 text-left font-normal">
                      PERSON
                    </th>
                    {weeks.map((w) => (
                      <th key={w.weekStart} className="px-2 py-2 text-center font-normal">
                        {w.label}
                        {/* The current week is only partly elapsed, so a low
                            number there is not the same signal as a low number
                            in a finished week. */}
                        {w.isCurrent && (
                          <span className="ml-1 text-[var(--text-muted)]">·</span>
                        )}
                      </th>
                    ))}
                    <th className="px-4 py-2 text-right font-normal">TOTAL</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((member) => (
                    <tr
                      key={member.memberId}
                      className="border-b border-[var(--divider)] text-[12px] hover:bg-[var(--surface-hover)]"
                    >
                      <td className="sticky left-0 bg-[var(--surface)] px-4 py-2 hover:bg-[var(--surface-hover)]">
                        <div className="flex items-center gap-2">
                          <div
                            className="h-5 w-5 flex-none rounded-full"
                            style={{
                              background:
                                "repeating-linear-gradient(45deg, #4a525d, #4a525d 3px, #3c434e 3px, #3c434e 6px)",
                            }}
                          />
                          <span className="font-medium text-[var(--text-primary)] whitespace-nowrap">
                            {member.name}
                          </span>
                          {member.isArchived && (
                            <span className="font-mono text-[9px] tracking-[0.08em] text-[var(--text-faint)]">
                              ARCHIVED
                            </span>
                          )}
                        </div>
                      </td>

                      {member.cells.map((cell, idx) => (
                        <td key={weeks[idx]?.weekStart ?? idx} className="px-2 py-2 text-center">
                          <span
                            className={`inline-block min-w-[3rem] px-1 py-0.5 font-mono text-[11px] font-medium ${
                              cell.status === "over"
                                ? "bg-[var(--critical)] text-black"
                                : cell.status === "none"
                                ? "bg-transparent text-[var(--text-faint)]"
                                : cell.status === "under"
                                ? "bg-[#3a2f11] text-[#e5be6a]"
                                : "bg-[#2a474b] text-[#b4d6ce]"
                            }`}
                          >
                            {cellText(cell)}
                          </span>
                        </td>
                      ))}

                      <td className="px-4 py-2 text-right font-mono text-[11px] text-[var(--text-secondary)]">
                        {member.totalHours} h
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="border-t border-[var(--divider)] px-4 py-2 font-mono text-[10px] text-[var(--text-faint)]">
            {board.weeklyHoursAreNominal
              ? "OVER / UNDER IS AGAINST A NOMINAL 40 H WEEK — TRACKINGTIME'S ACCOUNT DEFAULT, NOT A CONTRACT"
              : "OVER / UNDER IS AGAINST CONTRACTED HOURS"}
            {weeks.some((w) => w.isCurrent) && " · THE LAST COLUMN IS THE WEEK IN PROGRESS"}
          </div>
        </Card>

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

            <div className="flex flex-col gap-2">
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

            {overBudgetProjects.length === 0 ? (
              <div className="p-4 text-center font-mono text-[12px] text-[var(--text-muted)]">
                NO PROJECT WITH AN ESTIMATE HAS LOGGED TIME YET
              </div>
            ) : (
              <div className="flex flex-col gap-3">
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
