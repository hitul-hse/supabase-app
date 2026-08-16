"use client";

import { useActionState } from "react";
import { requestLeave, cancelLeaveRequest } from "./actions";
import type { LeaveRequestRow, LeaveBalanceRow } from "@/lib/queries/types";

const STATUS_CLASS: Record<string, string> = {
  pending: "bg-[#3a414c] text-[var(--text-muted)]",
  approved: "bg-[#2a474b] text-[#b4d6ce]",
  rejected: "bg-[#4a251d] text-[#f0a08c]",
};

export function MyLeavePanel({
  balance,
  requests,
}: {
  balance: LeaveBalanceRow | null;
  requests: LeaveRequestRow[];
}) {
  const [state, formAction, isPending] = useActionState(requestLeave, { status: "idle" });

  return (
    <div className="flex flex-col gap-4 border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-[var(--border)] pb-4">
        <div className="flex flex-col gap-1">
          <span className="text-[13px] font-semibold text-[var(--text-primary)]">My leave balance</span>
          <span className="font-mono text-[10.5px] text-[var(--text-muted)]">FACTORIALHR-EQUIVALENT</span>
        </div>
        <span className="font-mono text-[26px] font-semibold text-[var(--text-primary)]">
          {balance?.holiday_left ?? "—"}{" "}
          <span className="text-[13px] font-normal text-[var(--text-muted)]">
            / {balance?.total_holiday ?? "—"} D LEFT
          </span>
        </span>
      </div>

      <form action={formAction} className="flex flex-col gap-2 border-b border-[var(--border)] pb-4">
        <span className="text-[12.5px] font-semibold text-[var(--text-primary)]">Request leave</span>
        <div className="flex flex-wrap items-center gap-2">
          <input
            name="start_date"
            type="date"
            required
            disabled={isPending}
            className="border border-[var(--border)] bg-[var(--page)] px-2.5 py-1.5 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
          />
          <input
            name="end_date"
            type="date"
            required
            disabled={isPending}
            className="border border-[var(--border)] bg-[var(--page)] px-2.5 py-1.5 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
          />
          <input
            name="days"
            type="number"
            min="0.5"
            step="0.5"
            required
            disabled={isPending}
            placeholder="Days"
            className="w-20 border border-[var(--border)] bg-[var(--page)] px-2.5 py-1.5 text-[12px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] disabled:opacity-50"
          />
          <input
            name="reason"
            type="text"
            disabled={isPending}
            placeholder="Reason (optional)"
            className="min-w-[140px] flex-1 border border-[var(--border)] bg-[var(--page)] px-2.5 py-1.5 text-[12px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={isPending}
            className="bg-[var(--accent)] px-3 py-1.5 text-[11.5px] font-medium text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)] disabled:opacity-50"
          >
            {isPending ? "Requesting…" : "Request leave"}
          </button>
        </div>
        {state.status === "error" && <p className="text-[11.5px] text-[var(--critical)]">{state.message}</p>}
        {state.status === "success" && <p className="text-[11.5px] text-[var(--accent)]">{state.message}</p>}
      </form>

      <div className="flex flex-col gap-2">
        <span className="text-[12.5px] font-semibold text-[var(--text-primary)]">My requests</span>
        {requests.length === 0 && (
          <p className="text-[11.5px] text-[var(--text-faint)]">No leave requests yet.</p>
        )}
        {requests.map((r) => (
          <div
            key={r.id}
            className="flex items-center justify-between gap-2 border-b border-[#3a414c] pb-2 text-[12px]"
          >
            <div className="flex flex-col">
              <span className="text-[var(--text-primary)]">
                {r.start_date} → {r.end_date}
              </span>
              <span className="font-mono text-[10.5px] text-[var(--text-muted)]">
                {r.days} DAY{Number(r.days) === 1 ? "" : "S"}
                {r.reason ? ` · ${r.reason}` : ""}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`px-2 py-0.5 font-mono text-[10px] font-medium uppercase ${
                  STATUS_CLASS[r.status] ?? STATUS_CLASS.pending
                }`}
              >
                {r.status}
              </span>
              {r.status === "pending" && (
                <form action={cancelLeaveRequest}>
                  <input type="hidden" name="request_id" value={r.id} />
                  <button
                    type="submit"
                    aria-label="Cancel leave request"
                    className="text-[var(--text-faint)] hover:text-[var(--critical)]"
                  >
                    ✕
                  </button>
                </form>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
