"use client";

import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import type { TimesheetDayEntry } from "@/lib/queries/types";
import { updateDayHours, deleteTimesheetRow, submitWeek, withdrawWeek, copyLastWeek } from "./actions";
import { AddEntryForm } from "./AddEntryForm";
import { shiftWeekStart, currentWeekStart } from "@/lib/queries/hse";

const DAY_NAMES = ["MO", "TU", "WE", "TH", "FR", "SA"];

function dayLabels(weekStart: string): string[] {
  const start = new Date(weekStart + "T00:00:00Z");
  return DAY_NAMES.map((name, i) => {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    return `${name} ${d.getUTCDate()}`;
  });
}

function HourCell({ rowId, hours, disabled }: { rowId: number | null; hours: number; disabled: boolean }) {
  if (rowId === null) {
    return <span className="col-span-1 text-center font-mono text-[12px] text-[#616a75]">–</span>;
  }
  return (
    <form action={updateDayHours} className="col-span-1 flex justify-center">
      <input type="hidden" name="row_id" value={rowId} />
      <input
        name="hours"
        // Text rather than number: a number input rejects "1:30" and "90m"
        // outright, which is the friction the duration parser exists to
        // remove. inputMode keeps a numeric keypad on mobile.
        type="text"
        inputMode="decimal"
        defaultValue={hours || ""}
        title="Plain numbers are hours (8 = 8h). Also accepts 1:30, 1.5, 90m, 1h30m"
        disabled={disabled}
        placeholder="–"
        onBlur={(e) => e.currentTarget.form?.requestSubmit()}
        className="w-14 bg-transparent text-center font-mono text-[12px] text-[var(--text-primary)] outline-none disabled:opacity-60"
      />
    </form>
  );
}

export function TimesheetGrid({
  initialEntries,
  weekStart,
}: {
  initialEntries: TimesheetDayEntry[];
  weekStart: string;
}) {
  const entries = initialEntries;
  const labels = dayLabels(weekStart);
  const weekSubmitted = entries.length > 0 && entries.every((e) => e.status !== "draft");
  const rejections = entries.filter((e) => e.rejectionNote);

  const dayTotals = [0, 1, 2, 3, 4, 5].map((dayIdx) =>
    entries.reduce((sum, item) => sum + item.hours[dayIdx], 0),
  );
  const grandTotal = entries.reduce((sum, item) => sum + item.hours.reduce((a, b) => a + b, 0), 0);

  return (
    <>
      <PageHeader
        category="HSE HUB / RECORDS"
        title={`Week of ${weekStart}`}
        meta={weekSubmitted ? "SUBMITTED · AWAITING APPROVAL" : "DRAFT"}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1">
              <Link
                href={`/timesheets?week=${shiftWeekStart(weekStart, -1)}`}
                className="border border-[var(--border-strong)] px-2.5 py-1.5 text-[11.5px] font-medium text-[var(--text-primary)] hover:bg-[var(--surface-hover)]"
                aria-label="Previous week"
              >
                ←
              </Link>
              {weekStart !== currentWeekStart() && (
                <Link
                  href="/timesheets"
                  className="border border-[var(--border-strong)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
                >
                  Today
                </Link>
              )}
              <Link
                href={`/timesheets?week=${shiftWeekStart(weekStart, 1)}`}
                className="border border-[var(--border-strong)] px-2.5 py-1.5 text-[11.5px] font-medium text-[var(--text-primary)] hover:bg-[var(--surface-hover)]"
                aria-label="Next week"
              >
                →
              </Link>
            </div>
            <div className="hidden flex-col items-end sm:flex">
              <span className="font-mono text-[9.5px] text-[var(--text-muted)]">LOGGED</span>
              <span className="font-mono text-[16px] font-semibold text-[var(--text-primary)]">
                {grandTotal.toFixed(1)} h
              </span>
            </div>
            {/* Rebuilding last week's rows beats retyping them; hours are
                deliberately not copied, only the shape of the week. */}
            <form action={copyLastWeek}>
              <input type="hidden" name="week_start" value={weekStart} />
              <button
                type="submit"
                disabled={weekSubmitted}
                title="Recreate last week's rows here, without their hours"
                className="border border-[var(--border-strong)] px-2.5 py-1.5 text-[11.5px] font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-hover)] disabled:opacity-50"
              >
                Copy last week
              </button>
            </form>
            {weekSubmitted ? (
              <form action={withdrawWeek}>
                <input type="hidden" name="week_start" value={weekStart} />
                <button
                  type="submit"
                  title="Pull this week back to draft so you can change it"
                  className="border border-[var(--border-strong)] px-3 py-1.5 text-[11.5px] font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-hover)]"
                >
                  Withdraw
                </button>
              </form>
            ) : (
              <form action={submitWeek}>
                <input type="hidden" name="week_start" value={weekStart} />
                <button
                  type="submit"
                  disabled={entries.length === 0}
                  className="bg-[var(--accent)] px-3 py-1.5 text-[11.5px] font-semibold text-[var(--accent-contrast)] transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-60"
                >
                  Submit week
                </button>
              </form>
            )}
          </div>
        }
      />

      <div className="flex flex-col gap-4 p-4 sm:gap-5 sm:p-6">
        {/* Why the week came back.
            The note is mandatory when a lead rejects, and it reached the
            database, but nothing read it -- the employee saw the grid become
            editable again and had to guess. Rendered above the rows because
            that is the first thing to read, and only when a note exists, so an
            approved week is not decorated with an empty box. */}
        {rejections.length > 0 && (
          <div className="border border-[var(--critical)] bg-[var(--surface)] px-4 py-3">
            <p className="font-mono text-[10px] tracking-[0.1em] text-[var(--critical)]">
              SENT BACK FOR CHANGES
            </p>
            <ul className="mt-1.5 flex flex-col gap-1">
              {rejections.map((r) => (
                <li key={r.entryGroup} className="text-[12.5px] text-[var(--text-primary)]">
                  <span className="text-[var(--text-secondary)]">{r.projectName}:</span>{" "}
                  {r.rejectionNote}
                </li>
              ))}
            </ul>
          </div>
        )}

        <AddEntryForm weekStart={weekStart} />

        {/* Desktop table */}
        <div className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] card-elev">
          <div className="overflow-x-auto">
            <div className="grid min-w-[800px] grid-cols-[repeat(13,minmax(0,1fr))] gap-2 border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-2 font-mono text-[10px] tracking-[0.1em] text-[var(--text-faint)]">
              <span className="col-span-3">PROJECT / TASK</span>
              <span className="col-span-2">CUSTOMER</span>
              {labels.map((d) => (
                <span key={d} className="col-span-1 text-center">
                  {d}
                </span>
              ))}
              <span className="col-span-1 text-right">TOTAL</span>
              <span className="col-span-1" />
            </div>

            {entries.length === 0 && (
              <div className="px-4 py-6 text-center text-[12.5px] text-[var(--text-muted)]">
                No entries this week yet. Use &quot;Add entry&quot; to log hours.
              </div>
            )}

            {entries.map((entry) => {
              const rowTotal = entry.hours.reduce((a, b) => a + b, 0);
              const rowDisabled = entry.status !== "draft";
              return (
                <div
                  key={entry.entryGroup}
                  className={`grid min-w-[800px] grid-cols-[repeat(13,minmax(0,1fr))] items-center gap-2 border-b border-[#3a414c] px-4 py-2.5 text-[12.5px] ${
                    entry.warning ? "border-l-2 border-l-[var(--warning)] bg-[#3d4550]" : "hover:bg-[var(--surface-hover)]"
                  }`}
                >
                  <div className="col-span-3 flex flex-col">
                    <span className="font-medium text-[var(--text-primary)]">{entry.taskName}</span>
                    <span className="font-mono text-[10px] text-[var(--text-faint)]">
                      {entry.projectName} {entry.isBillable ? "· BILLABLE" : ""}
                    </span>
                  </div>
                  <span className="col-span-2 text-[var(--text-secondary)]">{entry.customer || "–"}</span>
                  {entry.hours.slice(0, 6).map((h, hIdx) => (
                    <HourCell key={hIdx} rowId={entry.dayRowIds[hIdx]} hours={h} disabled={rowDisabled} />
                  ))}
                  <span className="col-span-1 text-right font-mono text-[13px] font-semibold text-[var(--text-primary)]">
                    {rowTotal.toFixed(1)}
                  </span>
                  <form action={deleteTimesheetRow} className="col-span-1 flex justify-end">
                    <input type="hidden" name="entry_group" value={entry.entryGroup} />
                    <button
                      type="submit"
                      disabled={rowDisabled}
                      aria-label={`Delete ${entry.taskName}`}
                      className="text-[var(--text-faint)] hover:text-[var(--critical)] disabled:opacity-40"
                    >
                      ✕
                    </button>
                  </form>
                </div>
              );
            })}

            {entries.length > 0 && (
              <div className="grid min-w-[800px] grid-cols-[repeat(13,minmax(0,1fr))] items-center gap-2 bg-[var(--surface-2)] px-4 py-2.5 text-[12.5px]">
                <span className="col-span-3 font-mono text-[10px] tracking-[0.1em] text-[var(--text-faint)]">
                  DAY TOTAL
                </span>
                <span className="col-span-2" />
                {dayTotals.map((t, idx) => (
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
                <span className="col-span-1" />
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
