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
}: {
  bookings: TeamLeadBooking[];
  initialDecisions: ApprovalDecisionRow[];
}) {
  const [decisions, setDecisions] = useState(initialDecisions);
  const [approvedAll, setApprovedAll] = useState(false);

  const handleApprove = (id: string) => {
    setDecisions((prev) => prev.filter((d) => d.id !== id));
    void approveDecision(id);
  };

  const handleApproveAll = () => {
    setApprovedAll(true);
    setDecisions([]);
    void approveAllPending();
  };

  return (
    <>
      <PageHeader
        category="HSE HUB / TEAM LEAD"
        title="Safety consulting – week 31"
        meta="LEAD S. OTT · 8 PEOPLE · 3 PROJECTS"
        actions={
          <>
            <button className="rounded-[var(--radius-sm)] border border-[var(--border-strong)] px-3 py-1.5 text-[11.5px] font-medium text-[var(--text-primary)] hover:bg-[var(--surface-hover)]">
              Week 31
            </button>
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

      <div className="flex flex-col gap-5 p-6">
        {/* 4-KPI Strip */}
        <div className="grid grid-cols-1 border border-[var(--border)] bg-[var(--surface)] sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col gap-1 border-b border-[var(--border)] p-3.5 sm:border-r lg:border-b-0">
            <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--text-muted)]">
              TEAM UTILISATION
            </span>
            <span className="font-mono text-[23px] font-semibold text-[var(--text-primary)]">
              76%
            </span>
          </div>

          <div className="flex flex-col gap-1 border-b border-[var(--border)] p-3.5 lg:border-b-0 lg:border-r">
            <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--text-muted)]">
              UNSUBMITTED TIMESHEETS
            </span>
            <span className="font-mono text-[23px] font-semibold text-[var(--warning)]">
              3
            </span>
          </div>

          <div className="flex flex-col gap-1 border-b border-[var(--border)] p-3.5 sm:border-r sm:border-b-0 lg:border-r">
            <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--text-muted)]">
              OVERDUE TASKS
            </span>
            <span className="font-mono text-[23px] font-semibold text-[var(--critical)]">
              14
            </span>
          </div>

          <div className="flex flex-col gap-1 p-3.5">
            <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--text-muted)]">
              ABSENCE NEXT 2 WEEKS
            </span>
            <span className="font-mono text-[23px] font-semibold text-[var(--text-primary)]">
              2 <span className="text-[12px] text-[var(--text-muted)] font-normal">PEOPLE</span>
            </span>
          </div>
        </div>

        {/* Workload & Booking Table */}
        <div className="border border-[var(--border)] bg-[var(--surface)]">
          <div className="flex items-baseline gap-2.5 border-b border-[var(--border)] px-4 py-3">
            <span className="text-[12.5px] font-semibold text-[var(--text-primary)]">
              Workload &amp; booking
            </span>
            <span className="font-mono text-[10.5px] text-[var(--text-muted)]">
              PLANNED H PER WEEK · CONTRACT H MINUS ABSENCE
            </span>
          </div>

          <div className="overflow-x-auto">
            {/* Table Header */}
            <div className="grid min-w-[700px] grid-cols-12 gap-3 border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-2 font-mono text-[10px] tracking-[0.1em] text-[var(--text-faint)]">
              <span className="col-span-3">PERSON</span>
              <span className="col-span-1 text-center">W31</span>
              <span className="col-span-1 text-center">W32</span>
              <span className="col-span-1 text-center">W33</span>
              <span className="col-span-1 text-center">W34</span>
              <span className="col-span-2 text-right">TIMESHEET</span>
              <span className="col-span-3 text-right">CERTIFICATES</span>
            </div>

            {/* Rows */}
            {bookings.map((member) => (
              <div
                key={member.name}
                className="grid min-w-[700px] grid-cols-12 items-center gap-3 border-b border-[#3a414c] px-4 py-2 text-[12.5px] hover:bg-[var(--surface-hover)]"
              >
                <div className="col-span-3 flex items-center gap-2.5">
                  <div
                    className="h-6 w-6 flex-none rounded-full"
                    style={{
                      background:
                        "repeating-linear-gradient(45deg, #4a525d, #4a525d 3px, #3c434e 3px, #3c434e 6px)",
                    }}
                  />
                  <span className="font-medium text-[var(--text-primary)]">{member.name}</span>
                </div>

                {/* W31 */}
                <div className="col-span-1 text-center">
                  <span
                    className={`inline-block w-full py-0.5 font-mono text-[11px] font-medium ${
                      member.w31.status === "over"
                        ? "bg-[var(--critical)] text-black"
                        : "bg-[#2a474b] text-[#b4d6ce]"
                    }`}
                  >
                    {weekCell(member.w31)}
                  </span>
                </div>

                {/* W32 */}
                <div className="col-span-1 text-center">
                  <span
                    className={`inline-block w-full py-0.5 font-mono text-[11px] font-medium ${
                      member.w32.status === "over"
                        ? "bg-[#4a251d] text-[#f0a08c]"
                        : member.w32.status === "under"
                        ? "bg-[#3a2f11] text-[#e5be6a]"
                        : "bg-[#2a474b] text-[#b4d6ce]"
                    }`}
                  >
                    {weekCell(member.w32)}
                  </span>
                </div>

                {/* W33 */}
                <div className="col-span-1 text-center">
                  <span
                    className={`inline-block w-full py-0.5 font-mono text-[11px] font-medium ${
                      member.w33.status === "leave"
                        ? "bg-[#3a414c] text-[var(--text-muted)] text-[10px]"
                        : member.w33.status === "under"
                        ? "bg-[#3a2f11] text-[#e5be6a]"
                        : "bg-[#2a474b] text-[#b4d6ce]"
                    }`}
                  >
                    {weekCell(member.w33)}
                  </span>
                </div>

                {/* W34 */}
                <div className="col-span-1 text-center">
                  <span
                    className={`inline-block w-full py-0.5 font-mono text-[11px] font-medium ${
                      member.w34.status === "leave"
                        ? "bg-[#3a414c] text-[var(--text-muted)] text-[10px]"
                        : member.w34.status === "under"
                        ? "bg-[#3a2f11] text-[#e5be6a]"
                        : "bg-[#2a474b] text-[#b4d6ce]"
                    }`}
                  >
                    {weekCell(member.w34)}
                  </span>
                </div>

                {/* Timesheet */}
                <div className="col-span-2 text-right">
                  <span
                    className={`font-mono text-[11px] font-medium ${
                      member.timesheetStatus === "SUBMITTED"
                        ? "text-[var(--accent)]"
                        : "text-[var(--warning)]"
                    }`}
                  >
                    {member.timesheetStatus}
                  </span>
                </div>

                {/* Certificates */}
                <div className="col-span-3 text-right">
                  <span
                    className={`font-mono text-[11px] ${
                      member.certificates.status === "EXPIRING"
                        ? "font-medium text-[var(--critical)]"
                        : "text-[var(--text-muted)]"
                    }`}
                  >
                    {member.certificates.text}
                  </span>
                </div>
              </div>
            ))}
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
              {decisions.length === 0 ? (
                <div className="p-4 text-center font-mono text-[12px] text-[var(--accent)]">
                  All items approved and up to date!
                </div>
              ) : (
                decisions.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-3 border border-[var(--border)] bg-[var(--surface-2)] p-2.5"
                  >
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[12px] font-medium text-[var(--text-primary)]">
                        {item.title}
                      </span>
                      <span className="font-mono text-[10.5px] text-[var(--text-muted)]">
                        {item.subtitle}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
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
              <div className="flex flex-col gap-1">
                <div className="flex justify-between text-[12.5px]">
                  <span className="font-medium text-[var(--text-primary)]">Site risk assessment 2026</span>
                  <span className="font-mono text-[var(--critical)]">1 164 / 1 200 h</span>
                </div>
                <div className="h-1.5 w-full bg-[var(--border)]">
                  <div className="h-full w-[97%] bg-[var(--critical)]" />
                </div>
                <span className="font-mono text-[10.5px] text-[var(--text-muted)]">
                  18 OPEN TASKS · 6 OVERDUE
                </span>
              </div>

              <div className="flex flex-col gap-1">
                <div className="flex justify-between text-[12.5px]">
                  <span className="font-medium text-[var(--text-primary)]">Noise mapping – plant 2</span>
                  <span className="font-mono text-[var(--text-secondary)]">402 / 560 h</span>
                </div>
                <div className="h-1.5 w-full bg-[var(--border)]">
                  <div className="h-full w-[72%] bg-[var(--accent)]" />
                </div>
                <span className="font-mono text-[10.5px] text-[var(--text-muted)]">
                  11 OPEN TASKS · ON PLAN
                </span>
              </div>

              <div className="flex flex-col gap-1">
                <div className="flex justify-between text-[12.5px]">
                  <span className="font-medium text-[var(--text-primary)]">Hazardous substances audit</span>
                  <span className="font-mono text-[var(--text-secondary)]">118 / 320 h</span>
                </div>
                <div className="h-1.5 w-full bg-[var(--border)]">
                  <div className="h-full w-[37%] bg-[var(--accent)]" />
                </div>
                <span className="font-mono text-[10.5px] text-[var(--text-muted)]">
                  KICK-OFF 18 AUG
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
