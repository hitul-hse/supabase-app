"use client";

/**
 * The alert list.
 *
 * THE DESIGN CONSTRAINT THAT MATTERS. This screen exists because an email did
 * not arrive, so it must never repeat that failure by implying something was
 * sent. Every row states its delivery state explicitly -- including "no email
 * sent (no mail transport configured)", which is the current state of this
 * deployment and is a configuration fact rather than an error.
 *
 * Refusals and warnings are shown together but visibly distinguished: "your
 * booking was blocked" and "you are near the limit" need different reactions,
 * and a list that flattens them trains people to ignore both.
 */

import { useState, useTransition } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import {
  alertKindLabel,
  emailStateLabel,
  type BudgetAlertRow,
} from "@/lib/queries/budget-alerts";
import { acknowledgeAlert, type AlertActionResult } from "./actions";

const BUTTON =
  "border px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] transition-colors disabled:cursor-not-allowed disabled:opacity-50";

function h(n: number): string {
  return n.toLocaleString("en-GB", { maximumFractionDigits: 1 });
}

function when(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // Europe/Berlin: the business reads its own clock, and an alert timestamp in
  // UTC invites "that is not when it happened".
  return d.toLocaleString("en-GB", {
    timeZone: "Europe/Berlin",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Tone per kind: a refusal is critical, a warning is a caution. */
function tone(row: BudgetAlertRow): string {
  if (row.blockedTheBooking) return "var(--critical)";
  if (row.kind === "outside_contract") return "var(--warning, #d99b3d)";
  return "var(--accent)";
}

function AlertCard({ row, canAck }: { row: BudgetAlertRow; canAck: boolean }) {
  const [result, setResult] = useState<AlertActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const colour = tone(row);

  return (
    <Card as="li">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-[var(--divider)] px-4 py-2.5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span
            className="font-mono text-[10px] uppercase tracking-[0.1em]"
            style={{ color: colour }}
          >
            {alertKindLabel(row.kind)}
          </span>
          {row.projectId !== null ? (
            <Link
              href={`/projects/${row.projectId}`}
              className="text-[13px] font-medium text-[var(--text-primary)] underline-offset-2 hover:underline"
            >
              {row.projectName}
            </Link>
          ) : (
            <span className="text-[13px] font-medium text-[var(--text-primary)]">
              {row.projectName}
            </span>
          )}
        </div>
        <span className="font-mono text-[10.5px] text-[var(--text-faint)]">
          {when(row.createdAt)} · {row.actorName}
        </span>
      </div>

      <div className="flex flex-col gap-2 px-4 py-3">
        {/* The arithmetic, so the row justifies itself without a recompute. */}
        <div className="flex flex-wrap gap-x-5 gap-y-1 font-mono text-[11.5px] tabular-nums text-[var(--text-secondary)]">
          <span>
            budget <span className="text-[var(--text-primary)]">{h(row.budgetHours)} h</span>
          </span>
          <span>
            logged <span className="text-[var(--text-primary)]">{h(row.loggedHours)} h</span>
          </span>
          <span>
            attempted <span className="text-[var(--text-primary)]">{h(row.requestedHours)} h</span>
          </span>
          <span>
            would be <span style={{ color: colour }}>{h(row.projectedHours)} h</span>
          </span>
          {row.overByHours > 0 && (
            <span>
              over by <span style={{ color: colour }}>{h(row.overByHours)} h</span>
            </span>
          )}
          {row.thresholdPercent !== null && (
            <span>
              threshold <span className="text-[var(--text-primary)]">{row.thresholdPercent}%</span>
            </span>
          )}
        </div>

        {/* Verbatim: if somebody says "it would not let me book", this is what
            they saw, word for word. */}
        <p className="text-[12px] leading-relaxed text-[var(--text-secondary)]">{row.reason}</p>

        <p className="text-[11px] text-[var(--text-faint)]">
          {row.blockedTheBooking
            ? "The booking was refused, so these hours are not recorded."
            : "The hours were recorded; this is a warning, not a refusal."}
        </p>

        {/* Delivery state, always explicit. */}
        <p
          className="font-mono text-[10.5px]"
          style={{
            color:
              row.emailState === "sent" ? "var(--text-faint)" : "var(--warning, #d99b3d)",
          }}
        >
          {emailStateLabel(row.emailState)}
          {row.recipients.length > 0 && row.emailState === "sent"
            ? ` to ${row.recipients.join(", ")}`
            : ""}
          {row.deliveryError ? ` — ${row.deliveryError}` : ""}
          {row.emailState === "not_attempted"
            ? ". Set RESEND_API_KEY to enable mail; the alert is recorded either way."
            : ""}
        </p>

        {row.acknowledgedAt !== null && (
          <p className="text-[11px] text-[var(--text-faint)]">
            Acknowledged {when(row.acknowledgedAt)}
            {row.acknowledgedNote ? `: ${row.acknowledgedNote}` : ""}
          </p>
        )}

        {row.isOpen && canAck && (
          <form
            action={(fd) =>
              startTransition(async () => setResult(await acknowledgeAlert(fd)))
            }
            className="flex flex-wrap items-center gap-2 pt-1"
          >
            <input type="hidden" name="alert_id" value={row.id} />
            <input
              name="note"
              type="text"
              placeholder="What was decided? (optional)"
              disabled={pending}
              className="min-w-0 flex-1 border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1.5 text-[12px] text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={pending}
              className={`${BUTTON} border-[var(--border-strong)] text-[var(--text-muted)] hover:text-[var(--text-primary)]`}
            >
              {pending ? "Saving..." : "Acknowledge"}
            </button>
          </form>
        )}

        {result?.message && (
          <p
            className="text-[11.5px]"
            style={{ color: result.ok ? "var(--accent)" : "var(--critical)" }}
            role={result.ok ? "status" : "alert"}
          >
            {result.message}
          </p>
        )}
      </div>
    </Card>
  );
}

export function AlertList({
  alerts,
  canAck,
  showingOpenOnly,
}: {
  alerts: BudgetAlertRow[];
  canAck: boolean;
  showingOpenOnly: boolean;
}) {
  if (alerts.length === 0) {
    return (
      <Card className="px-4 py-6 text-center text-[12px] text-[var(--text-secondary)]">
        {showingOpenOnly
          ? "No open budget alerts. Bookings that approach or exceed an agreed budget appear here."
          : "No budget alerts recorded yet."}
      </Card>
    );
  }

  const blocking = alerts.filter((a) => a.blockedTheBooking);
  const warnings = alerts.filter((a) => !a.blockedTheBooking);

  return (
    <div className="flex flex-col gap-5">
      {blocking.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-[var(--critical)]">
            Refused bookings ({blocking.length})
          </h2>
          <p className="text-[11.5px] text-[var(--text-faint)]">
            Somebody could not record hours they worked. Each of these needs a budget
            raise, a re-scope, or a decision to absorb the overrun.
          </p>
          <ul className="flex flex-col gap-2">
            {blocking.map((a) => (
              <AlertCard key={a.id} row={a} canAck={canAck} />
            ))}
          </ul>
        </section>
      )}

      {warnings.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-[var(--text-muted)]">
            Warnings ({warnings.length})
          </h2>
          <p className="text-[11.5px] text-[var(--text-faint)]">
            The hours were recorded. These are early signals: a budget nearly used, or
            time logged outside any contract period.
          </p>
          <ul className="flex flex-col gap-2">
            {warnings.map((a) => (
              <AlertCard key={a.id} row={a} canAck={canAck} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
