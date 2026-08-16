"use client";

import { useState } from "react";
import type { PendingTimesheetWeek } from "@/lib/queries/types";
import { approveTimesheetWeek, rejectTimesheetWeek } from "./actions";

export function PendingTimesheetApprovals({ initialWeeks }: { initialWeeks: PendingTimesheetWeek[] }) {
  const [weeks, setWeeks] = useState(initialWeeks);
  const [error, setError] = useState<string | null>(null);

  const key = (w: PendingTimesheetWeek) => `${w.personId}__${w.weekStart}`;

  const handleDecision = async (week: PendingTimesheetWeek, decision: "approved" | "rejected") => {
    const previous = weeks;
    setError(null);
    setWeeks((prev) => prev.filter((w) => key(w) !== key(week)));

    const result =
      decision === "approved"
        ? await approveTimesheetWeek(week.personId, week.weekStart)
        : await rejectTimesheetWeek(week.personId, week.weekStart);

    if (!result.ok) {
      setWeeks(previous);
      setError(result.message ?? "Could not update that week.");
    }
  };

  if (weeks.length === 0 && !error) return null;

  return (
    <div className="flex flex-col gap-3 border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex items-baseline justify-between">
        <span className="text-[12.5px] font-semibold text-[var(--text-primary)]">
          Pending timesheet approvals
        </span>
        <span className="font-mono text-[10.5px] text-[var(--text-muted)]">{weeks.length} WEEKS</span>
      </div>

      {error && <p className="text-[11.5px] text-[var(--critical)]">{error}</p>}

      {weeks.length === 0 ? (
        <p className="text-[12px] text-[var(--text-muted)]">Nothing pending.</p>
      ) : (
        <div className="flex flex-col divide-y divide-[var(--border)]">
          {weeks.map((w) => (
            <div key={key(w)} className="flex items-center justify-between gap-3 py-2.5">
              <div className="flex flex-col">
                <span className="text-[12.5px] font-medium text-[var(--text-primary)]">{w.personName}</span>
                <span className="font-mono text-[10.5px] text-[var(--text-muted)]">
                  Week of {w.weekStart} · {w.entryCount} entries
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-mono text-[13px] font-semibold text-[var(--text-primary)]">
                  {w.totalHours.toFixed(1)} h
                </span>
                <button
                  onClick={() => handleDecision(w, "rejected")}
                  className="border border-[var(--border-strong)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
                >
                  Reject
                </button>
                <button
                  onClick={() => handleDecision(w, "approved")}
                  className="bg-[var(--accent)] px-2.5 py-1 text-[11px] font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)]"
                >
                  Approve
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
