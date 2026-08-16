"use client";

import { useState } from "react";
import type { LeaveRequestWithPerson } from "@/lib/queries/types";
import { approveLeaveRequestAction, rejectLeaveRequestAction } from "./actions";

export function PendingLeaveApprovals({ initialRequests }: { initialRequests: LeaveRequestWithPerson[] }) {
  const [requests, setRequests] = useState(initialRequests);
  const [error, setError] = useState<string | null>(null);

  const handleDecision = async (request: LeaveRequestWithPerson, decision: "approved" | "rejected") => {
    const previous = requests;
    setError(null);
    setRequests((prev) => prev.filter((r) => r.id !== request.id));

    const result =
      decision === "approved"
        ? await approveLeaveRequestAction(request.id)
        : await rejectLeaveRequestAction(request.id);

    if (!result.ok) {
      setRequests(previous);
      setError(result.message ?? "Could not update that request.");
    }
  };

  if (requests.length === 0 && !error) return null;

  return (
    <div className="flex flex-col gap-3 border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex items-baseline justify-between">
        <span className="text-[12.5px] font-semibold text-[var(--text-primary)]">
          Pending leave approvals
        </span>
        <span className="font-mono text-[10.5px] text-[var(--text-muted)]">{requests.length} REQUESTS</span>
      </div>

      {error && <p className="text-[11.5px] text-[var(--critical)]">{error}</p>}

      {requests.length === 0 ? (
        <p className="text-[12px] text-[var(--text-muted)]">Nothing pending.</p>
      ) : (
        <div className="flex flex-col divide-y divide-[var(--border)]">
          {requests.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="flex flex-col">
                <span className="text-[12.5px] font-medium text-[var(--text-primary)]">{r.personName}</span>
                <span className="font-mono text-[10.5px] text-[var(--text-muted)]">
                  {r.start_date} → {r.end_date} · {r.days} day{Number(r.days) === 1 ? "" : "s"}
                  {r.reason ? ` · ${r.reason}` : ""}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => handleDecision(r, "rejected")}
                  className="border border-[var(--border-strong)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
                >
                  Reject
                </button>
                <button
                  onClick={() => handleDecision(r, "approved")}
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
