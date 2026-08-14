"use client";

import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import type { TeamLeadBooking, ApprovalDecisionRow, WeekBooking } from "@/lib/queries/types";
import { approveDecision, approveAllPending } from "./actions";

function weekCell(week: WeekBooking) {
  return week.status === "leave" ? "LEAVE" : week.hours;
}

export function TeamLeadBoard({
  bookings,
  initialDecisions,
  weeks = ["W31", "W32", "W33", "W34"],
}: {
  bookings: TeamLeadBooking[];
  initialDecisions: ApprovalDecisionRow[];
  weeks?: string[];
}) {
  const [decisions, setDecisions] = useState(initialDecisions);
  const [approvedAll, setApprovedAll] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        meta={`${weeks[0]}–${weeks[3] ?? weeks[weeks.length - 1]} · ${bookings.length} PEOPLE`}
        actions={
          <>
            <span className="hidden font-mono text-[11px] text-[var(--text-muted)] border border-[var(--border)] px-3 py-1.5 sm:inline">
              {weeks[0]}–{weeks[3] ?? weeks[weeks.length - 1]}
            </span>
            <button
              onClick={handleApproveAll}
              disabled={approvedAll || decisions.length === 0}
              className="rounded-[var(--radius-sm)] bg-[var(--accent)] px-3 py-1.5 text-[11.5px] font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)] disabled:opacity-50"
            >
              {approvedAll ? "All Approved ✓" : "Approve all clean"}
            </button>
          </>
        }
      />

      <div className="flex flex-col gap-4 p-4 sm:gap-5 sm:p-6">
        {/* 4-KPI Strip — 2×2 on mobile, 4 across on lg */}
        <div className="grid grid-cols-2 border border-[var(--border)] bg-[var(--surface)] lg:grid-cols-4">
          <div className="flex flex-col gap-1 border-b border-r border-[var(--border)] p-3 sm:p-3.5 lg:border-b-0">
            <span className="font-mono text-[9.5px] tracking-[0.1em] text-[var(--text-muted)] sm:text-[10px]">
              TEAM UTILISATION
            </span>
            <span className="font-mono text-[20px] font-semibold text-[var(--text-primary)] sm:text-[23px]">
              76%
            </span>
          </div>

          <div className="flex flex-col gap-1 border-b border-[var(--border)] p-3 sm:p-3.5 lg:border-b-0 lg:border-r">
            <span className="font-mono text-[9.5px] tracking-[0.1em] text-[var(--text-muted)] sm:text-[10px]">
              UNSUBMITTED
            </span>
            <span className="font-mono text-[20px] font-semibold text-[var(--warning)] sm:text-[23px]">
              3
            </span>
          </div>

          <div className="flex flex-col gap-1 border-r border-[var(--border)] p-3 sm:p-3.5 lg:border-r">
            <span className="font-mono text-[9.5px] tracking-[0.1em] text-[var(--text-muted)] sm:text-[10px]">
              OVERDUE TASKS
            </span>
            <span className="font-mono text-[20px] font-semibold text-[var(--critical)] sm:text-[23px]">
              14
            </span>
          </div>

          <div className="flex flex-col gap-1 p-3 sm:p-3.5">
            <span className="font-mono text-[9.5px] tracking-[0.1em] text-[var(--text-muted)] sm:text-[10px]">
              ABSENCE NEXT 2W
            </span>
            <span className="font-mono text-[20px] font-semibold text-[var(--text-primary)] sm:text-[23px]">
              2 <span className="text-[12px] text-[var(--text-muted)] font-normal">PEOPLE</span>
            </span>
          </div>
        </div>

        {/* Workload & Booking Table — horizontally scrollable with sticky name column */}
        <div className="border border-[var(--border)] bg-[var(--surface)]">
          <div className="flex items-baseline gap-2.5 border-b border-[var(--border)] px-4 py-3">
            <span className="text-[12.5px] font-semibold text-[var(--text-primary)]">
              Workload &amp; booking
            </span>
            <span className="hidden font-mono text-[10.5px] text-[var(--text-muted)] sm:inline">
              PLANNED H PER WEEK · CONTRACT H MINUS ABSENCE
            </span>
          </div>

          <div className="overflow-x-auto">
            {/* Fixed-width table with sticky first column */}
            <table className="min-w-[580px] w-full border-collapse">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--surface-2)] font-mono text-[10px] tracking-[0.1em] text-[var(--text-faint)]">
                  <th className="sticky left-0 bg-[var(--surface-2)] px-4 py-2 text-left font-normal">PERSON</th>
                  {weeks.map((w) => (
                    <th key={w} className="px-2 py-2 text-center font-normal">{w}</th>
                  ))}
                  <th className="px-4 py-2 text-right font-normal">TIMESHEET</th>
                  <th className="px-4 py-2 text-right font-normal">CERTS</th>
                </tr>
              </thead>
              <tbody>
                {bookings.map((member) => {
                  const weekData = [member.w31, member.w32, member.w33, member.w34];
                  return (
                    <tr
                      key={member.name}
                      className="border-b border-[#3a414c] text-[12.5px] hover:bg-[var(--surface-hover)]"
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
                        </div>
                      </td>

                      {weekData.map((week, idx) => (
                        <td key={idx} className="px-2 py-2 text-center">
                          <span
                            className={`inline-block min-w-[3rem] px-1 py-0.5 font-mono text-[11px] font-medium ${
                              week.status === "over"
                                ? "bg-[var(--critical)] text-black"
                                : week.status === "leave"
                                ? "bg-[#3a414c] text-[var(--text-muted)] text-[10px]"
                                : week.status === "under"
                                ? "bg-[#3a2f11] text-[#e5be6a]"
                                : "bg-[#2a474b] text-[#b4d6ce]"
                            }`}
                          >
                            {weekCell(week)}
                          </span>
                        </td>
                      ))}

                      <td className="px-4 py-2 text-right">
                        <span
                          className={`font-mono text-[11px] font-medium ${
                            member.timesheetStatus === "SUBMITTED"
                              ? "text-[var(--accent)]"
                              : "text-[var(--warning)]"
                          }`}
                        >
                          {member.timesheetStatus}
                        </span>
                      </td>

                      <td className="px-4 py-2 text-right">
                        <span
                          className={`font-mono text-[11px] ${
                            member.certificates.status === "EXPIRING"
                              ? "font-medium text-[var(--critical)]"
                              : "text-[var(--text-muted)]"
                          }`}
                        >
                          {member.certificates.text}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Lower Grid: Decisions & Team Projects */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Decisions Queue */}
          <div className="flex flex-col gap-3 border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="flex items-center justify-between">
              <span className="text-[12.5px] font-semibold text-[var(--text-primary)]">
                Needs your decision
              </span>
              <span className="font-mono text-[10.5px] text-[var(--text-muted)]">
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
                      <span className="font-mono text-[10.5px] text-[var(--text-muted)]">
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
          </div>

          {/* Team Projects */}
          <div className="flex flex-col gap-3 border border-[var(--border)] bg-[var(--surface)] p-4">
            <span className="text-[12.5px] font-semibold text-[var(--text-primary)]">
              Team projects
            </span>

            <div className="flex flex-col gap-3">
              {[
                { name: "Site risk assessment 2026", hours: "1 164 / 1 200 h", pct: 97, color: "var(--critical)", sub: "18 OPEN TASKS · 6 OVERDUE" },
                { name: "Noise mapping – plant 2", hours: "402 / 560 h", pct: 72, color: "var(--accent)", sub: "11 OPEN TASKS · ON PLAN" },
                { name: "Hazardous substances audit", hours: "118 / 320 h", pct: 37, color: "var(--accent)", sub: "KICK-OFF 18 AUG" },
              ].map((project) => (
                <div key={project.name} className="flex flex-col gap-1">
                  <div className="flex flex-wrap justify-between gap-1 text-[12.5px]">
                    <span className="font-medium text-[var(--text-primary)]">{project.name}</span>
                    <span className="font-mono" style={{ color: project.color }}>{project.hours}</span>
                  </div>
                  <div className="h-1.5 w-full bg-[var(--border)]">
                    <div className="h-full" style={{ width: `${project.pct}%`, background: project.color }} />
                  </div>
                  <span className="font-mono text-[10.5px] text-[var(--text-muted)]">{project.sub}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
