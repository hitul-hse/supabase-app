"use client";

import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import type { TimesheetDayEntry } from "@/lib/queries/types";

const DAY_LABELS = ["MO 27", "TU 28", "WE 29", "TH 30", "FR 31", "SA 1"];

export function TimesheetGrid({ initialEntries }: { initialEntries: TimesheetDayEntry[] }) {
  const [entries] = useState(initialEntries);
  const [submitted, setSubmitted] = useState(false);

  const dayTotals = [0, 1, 2, 3, 4, 5, 6].map((dayIdx) =>
    entries.reduce((sum, item) => sum + item.hours[dayIdx], 0),
  );
  const grandTotal = dayTotals.reduce((a, b) => a + b, 0);

  return (
    <>
      <PageHeader
        category="HSE HUB / RECORDS"
        title="Week 31 · 27 Jul – 2 Aug"
        meta={submitted ? "SUBMITTED · AWAITING APPROVAL" : "DRAFT · DUE MONDAY 09:00"}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <div className="hidden flex-col items-end sm:flex">
              <span className="font-mono text-[9.5px] text-[var(--text-muted)]">LOGGED / CONTRACT</span>
              <span className="font-mono text-[16px] font-semibold text-[var(--critical)]">
                {grandTotal.toFixed(1)} / 40.0 h
              </span>
            </div>
            <div className="hidden flex-col items-end sm:flex">
              <span className="font-mono text-[9.5px] text-[var(--text-muted)]">BILLABLE</span>
              <span className="font-mono text-[16px] font-semibold text-[var(--text-primary)]">
                39.5 h · 86%
              </span>
            </div>
            <button className="border border-[var(--border-strong)] px-3 py-1.5 text-[11.5px] font-medium text-[var(--text-primary)] hover:bg-[var(--surface-hover)]">
              Add entry
            </button>
            <button
              onClick={() => setSubmitted(true)}
              disabled={submitted}
              className="bg-[var(--accent)] px-3 py-1.5 text-[11.5px] font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)] disabled:opacity-60"
            >
              {submitted ? "Submitted ✓" : "Submit week"}
            </button>
          </div>
        }
      />

      {/* Mobile summary strip */}
      <div className="flex gap-4 border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-2.5 sm:hidden">
        <div className="flex flex-col">
          <span className="font-mono text-[9.5px] text-[var(--text-muted)]">LOGGED</span>
          <span className="font-mono text-[15px] font-semibold text-[var(--critical)]">
            {grandTotal.toFixed(1)} h
          </span>
        </div>
        <div className="flex flex-col">
          <span className="font-mono text-[9.5px] text-[var(--text-muted)]">BILLABLE</span>
          <span className="font-mono text-[15px] font-semibold text-[var(--text-primary)]">86%</span>
        </div>
      </div>

      <div className="flex flex-col gap-4 p-4 sm:gap-5 sm:p-6">
        {/* Mobile card list — shown below sm */}
        <div className="flex flex-col gap-3 sm:hidden">
          {entries.map((entry, idx) => {
            const rowTotal = entry.hours.reduce((a, b) => a + b, 0);
            return (
              <div
                key={idx}
                className={`flex flex-col gap-2 border p-3.5 ${
                  entry.warning
                    ? "border-l-2 border-l-[var(--warning)] border-[var(--border)] bg-[#3d4550]"
                    : "border-[var(--border)] bg-[var(--surface)]"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[13px] font-medium text-[var(--text-primary)]">
                      {entry.taskName}
                    </span>
                    <span className="font-mono text-[10px] text-[var(--text-faint)]">
                      {entry.projectName}
                      {entry.isBillable ? " · BILLABLE" : ""}
                      {entry.customer ? ` · ${entry.customer}` : ""}
                    </span>
                  </div>
                  <span className="font-mono text-[16px] font-semibold text-[var(--text-primary)] shrink-0">
                    {rowTotal.toFixed(1)} h
                  </span>
                </div>
                {/* Mini day breakdown */}
                <div className="grid grid-cols-6 gap-1">
                  {DAY_LABELS.map((label, hIdx) => (
                    <div key={hIdx} className="flex flex-col items-center gap-0.5">
                      <span className="font-mono text-[8.5px] text-[var(--text-faint)]">
                        {label.slice(0, 2)}
                      </span>
                      <span
                        className={`font-mono text-[11px] font-medium ${
                          entry.hours[hIdx] > 0
                            ? "text-[var(--text-primary)]"
                            : "text-[#616a75]"
                        }`}
                      >
                        {entry.hours[hIdx] > 0 ? entry.hours[hIdx].toFixed(1) : "–"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {/* Mobile day total */}
          <div className="flex flex-col gap-2 border border-[var(--border)] bg-[var(--surface-2)] p-3.5">
            <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--text-faint)]">DAY TOTAL</span>
            <div className="grid grid-cols-6 gap-1">
              {dayTotals.slice(0, 6).map((t, idx) => (
                <div key={idx} className="flex flex-col items-center gap-0.5">
                  <span className="font-mono text-[8.5px] text-[var(--text-faint)]">
                    {DAY_LABELS[idx].slice(0, 2)}
                  </span>
                  <span
                    className={`font-mono text-[12px] font-semibold ${
                      t > 9.5 ? "text-[var(--critical)]" : "text-[var(--text-primary)]"
                    }`}
                  >
                    {t.toFixed(1)}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex justify-between border-t border-[var(--border)] pt-2">
              <span className="font-mono text-[10px] text-[var(--text-faint)]">WEEK TOTAL</span>
              <span className="font-mono text-[15px] font-bold text-[var(--critical)]">
                {grandTotal.toFixed(1)} h
              </span>
            </div>
          </div>
        </div>

        {/* Desktop table — shown from sm up */}
        <div className="hidden border border-[var(--border)] bg-[var(--surface)] sm:block">
          <div className="overflow-x-auto">
            <div className="grid min-w-[760px] grid-cols-12 gap-2 border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-2 font-mono text-[10px] tracking-[0.1em] text-[var(--text-faint)]">
              <span className="col-span-3">PROJECT / TASK</span>
              <span className="col-span-2">CUSTOMER</span>
              {DAY_LABELS.map((d) => (
                <span key={d} className="col-span-1 text-center">{d}</span>
              ))}
              <span className="col-span-1 text-right">TOTAL</span>
            </div>

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

        {/* Footer: Validation / Split / Recent Weeks */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="flex flex-col gap-3 border border-[var(--border)] bg-[var(--surface)] p-4">
            <span className="text-[12.5px] font-semibold text-[var(--text-primary)]">
              Before you submit
            </span>
            <div className="flex flex-col gap-2 text-[12px]">
              {[
                { color: "var(--warning)", text: "2.0 h travel not assigned to a project" },
                { color: "var(--critical)", text: "6.0 h over contracted week – lead approval required" },
                { color: "var(--critical)", text: "Thursday exceeds 10 h daily limit (ArbZG)" },
                { color: "var(--accent)", text: "All billable entries carry a customer" },
              ].map((item) => (
                <div key={item.text} className="flex items-start gap-2">
                  <span
                    className="mt-1.5 h-1.5 w-1.5 flex-none"
                    style={{ background: item.color }}
                  />
                  <span className="text-[var(--text-secondary)]">{item.text}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-3 border border-[var(--border)] bg-[var(--surface)] p-4">
            <span className="text-[12.5px] font-semibold text-[var(--text-primary)]">
              Split this week
            </span>
            <div className="flex h-3 w-full">
              <div className="h-full w-[86%] bg-[var(--accent)]" />
              <div className="h-full w-[14%] bg-[#8a9197]" />
            </div>
            <div className="flex flex-col gap-1.5 text-[12px]">
              {[
                { label: "Billable", value: "39.5 h", color: undefined },
                { label: "Non-billable", value: "6.5 h", color: undefined },
                { label: "Target billable", value: "75%", color: "var(--accent)" },
              ].map((row) => (
                <div key={row.label} className="flex justify-between">
                  <span className="text-[var(--text-secondary)]">{row.label}</span>
                  <span
                    className="font-mono font-medium"
                    style={{ color: row.color || "var(--text-primary)" }}
                  >
                    {row.value}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-3 border border-[var(--border)] bg-[var(--surface)] p-4 sm:col-span-2 lg:col-span-1">
            <span className="text-[12.5px] font-semibold text-[var(--text-primary)]">
              Recent weeks
            </span>
            <div className="flex flex-col gap-2 text-[12px]">
              {[
                { week: "W30", hours: "46.0 h", status: "AWAITING", color: "var(--warning)" },
                { week: "W29", hours: "40.5 h", status: "APPROVED", color: "var(--accent)" },
                { week: "W28", hours: "38.0 h", status: "APPROVED", color: "var(--accent)" },
                { week: "W27", hours: "41.0 h", status: "APPROVED", color: "var(--accent)" },
              ].map((row) => (
                <div key={row.week} className="flex items-center justify-between">
                  <span className="text-[var(--text-secondary)]">{row.week}</span>
                  <span className="font-mono text-[var(--text-primary)]">{row.hours}</span>
                  <span
                    className="font-mono text-[10.5px] font-medium"
                    style={{ color: row.color }}
                  >
                    {row.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
