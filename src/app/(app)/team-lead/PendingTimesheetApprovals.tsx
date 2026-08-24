"use client";

import { useState } from "react";
import type { PendingTimesheetWeek } from "@/lib/queries/types";
import { approveTimesheetWeek, rejectTimesheetWeek } from "./actions";
import { Card } from "@/components/ui/Card";

export function PendingTimesheetApprovals({ initialWeeks }: { initialWeeks: PendingTimesheetWeek[] }) {
  const [weeks, setWeeks] = useState(initialWeeks);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});

  const key = (w: PendingTimesheetWeek) => `${w.personId}__${w.weekStart}`;

  const handleApprove = async (week: PendingTimesheetWeek) => {
    const previous = weeks;
    setError(null);
    setWeeks((prev) => prev.filter((w) => key(w) !== key(week)));

    const result = await approveTimesheetWeek(week.personId, week.weekStart);
    if (!result.ok) {
      setWeeks(previous);
      setError(result.message ?? "Could not update that week.");
    }
  };

  // Rejecting opens an inline reason field rather than sending immediately:
  // a week bounced back with no stated cause just produces another round of
  // guessing about what was wrong with it.
  const handleReject = async (week: PendingTimesheetWeek) => {
    const note = (noteDraft[key(week)] ?? "").trim();
    if (!note) {
      setError("Say what needs fixing before sending the week back.");
      return;
    }

    const previous = weeks;
    setError(null);
    setWeeks((prev) => prev.filter((w) => key(w) !== key(week)));

    const result = await rejectTimesheetWeek(week.personId, week.weekStart, note);
    if (!result.ok) {
      setWeeks(previous);
      setError(result.message ?? "Could not update that week.");
    } else {
      setRejecting(null);
    }
  };

  if (weeks.length === 0 && !error) return null;

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-baseline justify-between">
        <span className="text-[12px] font-semibold text-[var(--text-primary)]">
          Pending timesheet approvals
        </span>
        <span className="font-mono text-[10px] text-[var(--text-muted)]">{weeks.length} WEEKS</span>
      </div>

      {error && <p className="text-[11px] text-[var(--critical)]">{error}</p>}

      {weeks.length === 0 ? (
        <p className="text-[12px] text-[var(--text-muted)]">Nothing pending.</p>
      ) : (
        <div className="flex flex-col divide-y divide-[var(--border)]">
          {weeks.map((w) => (
            <div key={key(w)} className="flex flex-col gap-2 py-2.5">
              <div className="flex items-center justify-between gap-3">
              <div className="flex flex-col">
                <span className="text-[12px] font-medium text-[var(--text-primary)]">{w.personName}</span>
                <span className="font-mono text-[10px] text-[var(--text-muted)]">
                  Week of {w.weekStart} · {w.entryCount} entries
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-mono text-[13px] font-semibold text-[var(--text-primary)]">
                  {w.totalHours.toFixed(1)} h
                </span>
                <button
                  onClick={() => setRejecting(rejecting === key(w) ? null : key(w))}
                  className="border border-[var(--border-strong)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)]"
                >
                  Reject
                </button>
                <button
                  onClick={() => handleApprove(w)}
                  className="bg-[var(--accent)] px-2.5 py-1 text-[11px] font-semibold text-[var(--accent-contrast)] transition-colors hover:bg-[var(--accent-hover)]"
                >
                  Approve
                </button>
                </div>
              </div>

              {rejecting === key(w) && (
                <div className="flex flex-wrap items-center gap-2 pl-1">
                  <input
                    autoFocus
                    value={noteDraft[key(w)] ?? ""}
                    onChange={(e) =>
                      setNoteDraft((prev) => ({ ...prev, [key(w)]: e.target.value }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleReject(w);
                      if (e.key === "Escape") setRejecting(null);
                    }}
                    placeholder="What needs fixing?"
                    aria-label={`Reason for sending ${w.personName}'s week back`}
                    className="min-w-[200px] flex-1 border border-[var(--border)] bg-[var(--page)] px-2.5 py-1.5 text-[12px] text-[var(--text-primary)] outline-none transition-colors placeholder:text-[var(--text-muted)] focus:border-[var(--accent)]"
                  />
                  <button
                    onClick={() => handleReject(w)}
                    className="bg-[var(--critical)] px-2.5 py-1.5 text-[11px] font-semibold text-white transition-colors hover:opacity-90"
                  >
                    Send back
                  </button>
                  <button
                    onClick={() => setRejecting(null)}
                    className="text-[11px] text-[var(--text-faint)] transition-colors hover:text-[var(--text-primary)]"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
