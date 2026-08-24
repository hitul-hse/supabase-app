"use client";

import { useActionState } from "react";
import { requestLeave, cancelLeaveRequest } from "./actions";
import type { LeaveRequestRow, LeaveBalanceRow } from "@/lib/queries/types";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardDivider } from "@/components/ui/Card";
import { TextInput } from "@/components/ui/Field";
import { IconArrowRight, IconCross } from "@/components/nav-icons";

export function MyLeavePanel({
  balance,
  requests,
}: {
  balance: LeaveBalanceRow | null;
  requests: LeaveRequestRow[];
}) {
  const [state, formAction, isPending] = useActionState(requestLeave, { status: "idle" });

  return (
    // MyLeavePanel is a top-level leave section — aggregates balance, request
    // form, and history list; all belong to one logical card boundary.
    <Card className="flex flex-col">
      <div className="flex flex-wrap items-baseline justify-between gap-3 px-5 pt-5 pb-4">
        <div className="flex flex-col gap-1">
          <span className="text-[13px] font-semibold text-[var(--text-primary)]">My leave balance</span>
          <span className="font-mono text-[10px] text-[var(--text-muted)]">FACTORIALHR-EQUIVALENT</span>
        </div>
        <span className="font-mono text-[26px] font-semibold text-[var(--text-primary)]">
          {balance?.holiday_left ?? "—"}{" "}
          <span className="text-[13px] font-normal text-[var(--text-muted)]">
            / {balance?.total_holiday ?? "—"} D LEFT
          </span>
        </span>
      </div>

      <CardDivider />
      <form action={formAction} className="flex flex-col gap-2 px-5 pt-4 pb-4">
        <span className="text-[12px] font-semibold text-[var(--text-primary)]">Request leave</span>
        <div className="flex flex-wrap items-center gap-2">
          <TextInput label="Leave start date" name="start_date" type="date" required disabled={isPending} />
          <TextInput label="Leave end date" name="end_date" type="date" required disabled={isPending} />
          <TextInput
            label="Number of days"
            name="days"
            type="number"
            min="0.5"
            step="0.5"
            required
            disabled={isPending}
            placeholder="Days"
            className="w-20"
          />
          <TextInput
            label="Reason (optional)"
            name="reason"
            type="text"
            disabled={isPending}
            placeholder="Reason (optional)"
            className="min-w-[140px] flex-1"
          />
          <Button type="submit" variant="primary" busy={isPending}>
            Request leave
          </Button>
        </div>
        {/*
          role="status" on both: a Server Action result that only changes colour
          is invisible to a screen reader, and the failure case is the one a
          user most needs told rather than left to notice.
        */}
        {state.status === "error" && (
          <p role="status" className="text-[11px] text-[var(--critical)]">
            {state.message}
          </p>
        )}
        {state.status === "success" && (
          <p role="status" className="text-[11px] text-[var(--accent)]">
            {state.message}
          </p>
        )}
      </form>

      <CardDivider />
      <div className="flex flex-col gap-2 px-5 pt-4 pb-5">
        <span className="text-[12px] font-semibold text-[var(--text-primary)]">My requests</span>
        {requests.length === 0 && (
          <EmptyState
            title="No leave requests yet"
            description="Requests you submit appear here with their approval status, and your balance updates once a request is approved."
          />
        )}
        {requests.map((r) => (
          <div
            key={r.id}
            className="flex items-center justify-between gap-2 border-b border-[var(--divider)] pb-2 text-[12px]"
          >
            <div className="flex flex-col">
              <span className="flex items-center gap-1.5 text-[var(--text-primary)]">
                {r.start_date}
                <IconArrowRight className="h-3 w-3 text-[var(--text-faint)]" />
                {r.end_date}
              </span>
              <span className="font-mono text-[10px] text-[var(--text-muted)]">
                {r.days} DAY{Number(r.days) === 1 ? "" : "S"}
                {r.reason ? ` · ${r.reason}` : ""}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge status={r.status} />
              {r.status === "pending" && (
                <form action={cancelLeaveRequest}>
                  <input type="hidden" name="request_id" value={r.id} />
                  <Button
                    type="submit"
                    variant="ghost"
                    size="sm"
                    aria-label={`Cancel leave request for ${r.start_date}`}
                    className="hover:text-[var(--critical)]"
                  >
                    <IconCross className="h-3.5 w-3.5" />
                  </Button>
                </form>
              )}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
