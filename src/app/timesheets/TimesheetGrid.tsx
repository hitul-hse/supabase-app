"use client";

import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import type { TimesheetDayEntry } from "@/lib/queries/types";

export function TimesheetGrid({ initialEntries }: { initialEntries: TimesheetDayEntry[] }) {
  const [entries] = useState(initialEntries);
  const [submitted, setSubmitted] = useState(false);

  // Compute column totals
  const dayTotals = [0, 1, 2, 3, 4, 5, 6].map((dayIdx) =>
    entries.reduce((sum, item) => sum + item.hours[dayIdx], 0)
  );

  const grandTotal = dayTotals.reduce((a, b) => a + b, 0);

  const handleSubmit = () => {
    setSubmitted(true);
  };

  return (
    <>
      <PageHeader
        category="HSE HUB / RECORDS"
        title="Week 31 · 27 Jul – 2 Aug"
        meta={submitted ? "SUBMITTED · AWAITING APPROVAL" : "DRAFT · DUE MONDAY 09:00"}
        actions={
          <div className="flex flex-wrap items-center gap-4">
            <div className="hidden sm:flex flex-col items-end">
              <span className="font-mono text-[9.5px] text-[var(--text-muted)]">
                LOGGED / CONTRACT
              </span>
              <span className="font-mono text-[16px] font-semibold text-[var(--critical)]">
                {grandTotal.toFixed(1)} / 40.0 h
              </span>
            </div>

            <div className="hidden sm:flex flex-col items-end">
              <span className="font-mono text-[9.5px] text-[var(--text-muted)]">BILLABLE</span>
              <span className="font-mono text-[16px] font-semibold text-[var(--text-primary)]">
                39.5 h · 86%
              </span>
            </div>

            <button className="border border-[var(--border-strong)] px-3 py-1.5 text-[11.5px] font-medium text-[var(--text-primary)] hover:bg-[var(--surface-hover)]">
              Add entry
            </button>

            <button
              onClick={handleSubmit}
              disabled={submitted}
              className="bg-[var(--accent)] px-3 py-1.5 text-[11.5px] font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)] disabled:opacity-60"
            >
              {submitted ? "Submitted ✓" : "Submit week"}
            </button>
          </div>
        }
      />

      <div className="flex flex-col gap-5 p-6">
        {/* Timesheet Main Table */}
        <div className="border border-[var(--border)] bg-[var(--surface)]">
          <div className="overflow-x-auto">
            {/* Table Header */}
            <div className="grid min-w-[760px] grid-cols-12 gap-2 border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-2 font-mono text-[10px] tracking-[0.1em] text-[var(--text-faint)]">
              <span className="col-span-3">PROJECT / TASK</span>
              <span className="col-span-2">CUSTOMER</span>
              <span className="col-span-1 text-center">MO 27</span>
              <span className="col-span-1 text-center">TU 28</span>
              <span className="col-span-1 text-center">WE 29</span>
              <span className="col-span-1 text-center">TH 30</span>
              <span className="col-span-1 text-center">FR 31</span>
              <span className="col-span-1 text-center">SA 1</span>
              <span className="col-span-1 text-right">TOTAL</span>
            </div>

            {/* Rows */}
            {entries.map((entry, idx) => {
              const rowTotal = entry.hours.reduce((a, b) => a + b, 0);
              return (
                <div
                  key={idx}
                  className={`grid min-w-[760px] grid-cols-12 items-center gap-2 border-b border-[#3a414c] px-4 py-2.5 text-[12.5px] ${
                    entry.warning
                      ? "border-l-2 border-l-[var(--warning)] bg-[#3d4550]"
                      : "hover:bg-[var(--surface-hover)]"
                  }`}
                >
                  <div className="col-span-3 flex flex-col">
                    <span className="font-medium text-[var(--text-primary)]">{entry.taskName}</span>
                    <span className="font-mono text-[10px] text-[var(--text-faint)]">
                      {entry.projectName} {entry.isBillable ? "· BILLABLE" : ""}
                    </span>
                  </div>

                  <span className="col-span-2 text-[var(--text-secondary)]">
                    {entry.customer || "–"}
                  </span>

                  {entry.hours.slice(0, 6).map((h, hIdx) => (
                    <span
                      key={hIdx}
                      className={`col-span-1 text-center font-mono text-[12px] ${
                        h > 0 ? "font-medium text-[var(--text-primary)]" : "text-[#616a75]"
                      }`}
                    >
                      {h > 0 ? h.toFixed(1) : "–"}
                    </span>
                  ))}

                  <span className="col-span-1 text-right font-mono text-[13px] font-semibold text-[var(--text-primary)]">
                    {rowTotal.toFixed(1)}
                  </span>
                </div>
              );
            })}

            {/* Day Total Summary Row */}
            <div className="grid min-w-[760px] grid-cols-12 items-center gap-2 bg-[var(--surface-2)] px-4 py-2.5 text-[12.5px]">
              <span className="col-span-3 font-mono text-[10px] tracking-[0.1em] text-[var(--text-faint)]">
                DAY TOTAL
              </span>
              <span className="col-span-2" />
              {dayTotals.slice(0, 6).map((t, idx) => (
                <span
                  key={idx}
                  className={`col-span-1 text-center font-mono text-[12.5px] font-semibold ${
                    t > 9.5 ? "text-[var(--critical)]" : "text-[var(--text-primary)]"
                  }`}
                >
                  {t.toFixed(1)}
                </span>
              ))}
              <span className="col-span-1 text-right font-mono text-[14px] font-bold text-[var(--critical)]">
                {grandTotal.toFixed(1)}
              </span>
            </div>
          </div>
        </div>

        {/* 3-Column Footer Grid: Validation / Split / Recent Weeks */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* Validation Warnings */}
          <div className="flex flex-col gap-3 border border-[var(--border)] bg-[var(--surface)] p-4">
            <span className="text-[12.5px] font-semibold text-[var(--text-primary)]">
              Before you submit
            </span>
            <div className="flex flex-col gap-2 text-[12px]">
              <div className="flex items-start gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 flex-none bg-[var(--warning)]" />
                <span className="text-[var(--text-secondary)]">
                  2.0 h travel not assigned to a project
                </span>
              </div>
              <div className="flex items-start gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 flex-none bg-[var(--critical)]" />
                <span className="text-[var(--text-secondary)]">
                  6.0 h over contracted week – lead approval required
                </span>
              </div>
              <div className="flex items-start gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 flex-none bg-[var(--critical)]" />
                <span className="text-[var(--text-secondary)]">
                  Thursday exceeds 10 h daily limit (ArbZG)
                </span>
              </div>
              <div className="flex items-start gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 flex-none bg-[var(--accent)]" />
                <span className="text-[var(--text-secondary)]">
                  All billable entries carry a customer
                </span>
              </div>
            </div>
          </div>

          {/* Split This Week */}
          <div className="flex flex-col gap-3 border border-[var(--border)] bg-[var(--surface)] p-4">
            <span className="text-[12.5px] font-semibold text-[var(--text-primary)]">
              Split this week
            </span>
            <div className="flex h-3 w-full">
              <div className="h-full w-[86%] bg-[var(--accent)]" />
              <div className="h-full w-[14%] bg-[#8a9197]" />
            </div>
            <div className="flex flex-col gap-1.5 text-[12px]">
              <div className="flex justify-between">
                <span className="text-[var(--text-secondary)]">Billable</span>
                <span className="font-mono text-[var(--text-primary)]">39.5 h</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-secondary)]">Non-billable</span>
                <span className="font-mono text-[var(--text-primary)]">6.5 h</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-secondary)]">Target billable</span>
                <span className="font-mono text-[var(--accent)] font-medium">75%</span>
              </div>
            </div>
          </div>

          {/* Recent Weeks */}
          <div className="flex flex-col gap-3 border border-[var(--border)] bg-[var(--surface)] p-4">
            <span className="text-[12.5px] font-semibold text-[var(--text-primary)]">
              Recent weeks
            </span>
            <div className="flex flex-col gap-2 text-[12px]">
              <div className="flex items-center justify-between">
                <span className="text-[var(--text-secondary)]">W30</span>
                <span className="font-mono text-[var(--text-primary)]">46.0 h</span>
                <span className="font-mono text-[10.5px] font-medium text-[var(--warning)]">
                  AWAITING
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--text-secondary)]">W29</span>
                <span className="font-mono text-[var(--text-primary)]">40.5 h</span>
                <span className="font-mono text-[10.5px] font-medium text-[var(--accent)]">
                  APPROVED
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--text-secondary)]">W28</span>
                <span className="font-mono text-[var(--text-primary)]">38.0 h</span>
                <span className="font-mono text-[10.5px] font-medium text-[var(--accent)]">
                  APPROVED
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--text-secondary)]">W27</span>
                <span className="font-mono text-[var(--text-primary)]">41.0 h</span>
                <span className="font-mono text-[10.5px] font-medium text-[var(--accent)]">
                  APPROVED
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
