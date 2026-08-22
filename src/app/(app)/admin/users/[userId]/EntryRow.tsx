"use client";

/**
 * One correctable time entry, on /admin/users/[userId].
 *
 * THE INVOICED RULE IS RENDERED, NOT JUST ENFORCED. An entry with is_billed is
 * shown as a read-only row with the reason stated. Rendering it as an editable
 * form that fails on submit teaches an admin that the app is broken; stating
 * that the hours have already been billed and the remedy is a credit note tells
 * them what to do instead. The action refuses it either way — this is about not
 * inviting the click.
 *
 * DELETE IS TWO-STEP AND INLINE. Same shape as UserRow.tsx: a REMOVE that arms
 * a CONFIRM / CANCEL pair in the row itself, with the warning naming what is
 * irreversible. Not window.confirm(), which is blocked in some embedded browsers
 * and reads as browser chrome rather than as part of the app — the wrong tone for
 * the only destructive action here.
 *
 * LIVE REGION ROLES ARE STATIC per layout (role="alert" / role="status"), never
 * swapped on a condition. See the note in ProfileEditForms.tsx.
 */

import { useActionState, useState } from "react";
import { adminUpdateEntry, adminDeleteEntry } from "../profile-actions";
import type { AdminActionResult } from "../profile-actions";
import type { AdminEntryRow } from "@/lib/queries/profile-admin";

const IDLE: AdminActionResult = { ok: true };

const cellLabel = "font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--text-faint)]";
const inputClass =
  "w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-[12px] text-[var(--text-primary)] transition-colors hover:border-[var(--text-faint)] focus:border-[var(--accent)] disabled:cursor-not-allowed";

/** Date only, in the format the rest of the app uses. */
function dayLabel(day: string): string {
  if (!day) return "n/a";
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("de-DE");
}

/** What the entry was booked against. Absent parts read as absent. */
function whatLabel(entry: AdminEntryRow): string {
  const parts = [entry.projectName, entry.taskName].filter(Boolean);
  if (parts.length === 0) return "No project recorded";
  return parts.join(" · ");
}

export function EntryRow({ entry, canWrite }: { entry: AdminEntryRow; canWrite: boolean }) {
  const [editResult, editSubmit, editPending] = useActionState(
    (_prev: AdminActionResult, formData: FormData) => adminUpdateEntry(formData),
    IDLE,
  );
  const [deleteResult, deleteSubmit, deletePending] = useActionState(
    (_prev: AdminActionResult, formData: FormData) => adminDeleteEntry(formData),
    IDLE,
  );
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const pending = editPending || deletePending;
  // The most recent outcome. Both start as IDLE (no message), so whichever has
  // a message is the one that ran; a failed delete must not be hidden behind an
  // older successful edit.
  const failure =
    (!deleteResult.ok && deleteResult.message) ||
    (!editResult.ok && editResult.message) ||
    "";
  const success =
    !failure &&
    ((deleteResult.ok && deleteResult.message) || (editResult.ok && editResult.message) || "");

  const header = (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="font-mono text-[12px] text-[var(--text-primary)]">
        {dayLabel(entry.day)}
      </span>
      <span className="text-[12px] text-[var(--text-secondary)]">{whatLabel(entry)}</span>
      {entry.customerName && (
        <span className="font-mono text-[10px] tracking-[0.06em] text-[var(--text-faint)]">
          {entry.customerName}
        </span>
      )}
      <span className="font-mono text-[11px] text-[var(--text-primary)]">{entry.duration}</span>
      <span
        className={`font-mono text-[9px] tracking-[0.1em] ${
          entry.isBillable ? "text-[var(--good)]" : "text-[var(--text-muted)]"
        }`}
      >
        {entry.isBillable ? "BILLABLE" : "NON-BILLABLE"}
      </span>
      {entry.isBilled && (
        <span className="rounded-[var(--radius-sm)] border border-[var(--warning)] px-1.5 py-0.5 font-mono text-[9px] tracking-[0.1em] text-[var(--warning)]">
          INVOICED
        </span>
      )}
      {entry.isCalendar && (
        <span className="font-mono text-[9px] tracking-[0.1em] text-[var(--text-faint)]">
          CALENDAR PLACEHOLDER
        </span>
      )}
    </div>
  );

  /*
   * INVOICED: read-only, with the reason where the form would have been.
   */
  if (entry.isBilled) {
    return (
      <div className="flex flex-col gap-2 border-b border-[var(--divider)] px-4 py-3">
        {header}
        <p className="text-[11px] leading-relaxed text-[var(--text-secondary)]">
          These hours have already been invoiced, so this entry is locked — for
          everyone, whatever their permissions. Correcting billed time means
          raising a credit note in the finance system, not rewriting the record
          here.
        </p>
        {entry.notes && (
          <p className="text-[11px] text-[var(--text-muted)]">{entry.notes}</p>
        )}
      </div>
    );
  }

  /*
   * NO WRITE PERMISSION: the same facts, no controls. Read-only because the
   * viewer cannot act, not because the entry is locked -- so it does not borrow
   * the invoiced wording.
   */
  if (!canWrite) {
    return (
      <div className="flex flex-col gap-2 border-b border-[var(--divider)] px-4 py-3">
        {header}
        {entry.notes ? (
          <p className="text-[11px] text-[var(--text-muted)]">{entry.notes}</p>
        ) : (
          <p className="text-[11px] text-[var(--text-faint)]">No notes</p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 border-b border-[var(--divider)] px-4 py-3">
      {header}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:gap-3">
        <form
          action={editSubmit}
          className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-end sm:gap-3"
        >
          <input type="hidden" name="entry_id" value={entry.id} />

          <span className="flex flex-col gap-1 sm:w-24">
            <label htmlFor={`hours_${entry.id}`} className={cellLabel}>
              Hours
            </label>
            <input
              id={`hours_${entry.id}`}
              name="hours"
              type="number"
              min={0.25}
              max={24}
              step={0.25}
              // Empty rather than 0 when a timer is still running: this entry has
              // no duration yet, and 0 would be a value the admin did not choose.
              defaultValue={entry.hours ?? ""}
              placeholder="n/a"
              disabled={pending}
              className={inputClass}
            />
          </span>

          <span className="flex items-center gap-2 sm:pb-1.5">
            <input
              id={`billable_${entry.id}`}
              name="is_billable"
              type="checkbox"
              defaultChecked={entry.isBillable}
              disabled={pending}
              className="h-4 w-4 accent-[var(--accent)]"
            />
            <label
              htmlFor={`billable_${entry.id}`}
              className="text-[11px] text-[var(--text-secondary)]"
            >
              Billable
            </label>
          </span>

          <span className="flex flex-1 flex-col gap-1">
            <label htmlFor={`notes_${entry.id}`} className={cellLabel}>
              Notes
            </label>
            <input
              id={`notes_${entry.id}`}
              name="notes"
              defaultValue={entry.notes ?? ""}
              placeholder="No notes"
              disabled={pending}
              className={inputClass}
            />
          </span>

          <button
            type="submit"
            disabled={pending}
            aria-label={`Save the entry of ${dayLabel(entry.day)}`}
            className="rounded-[var(--radius-sm)] border border-[var(--border-strong)] px-2 py-1 font-mono text-[10px] font-semibold tracking-[0.06em] text-[var(--text-primary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60 pointer-coarse:min-h-[32px] pointer-coarse:px-3"
          >
            {editPending ? "SAVING…" : "SAVE"}
          </button>
        </form>

        {/* Delete is its own form: a <form> carries one action, and this one
            must not submit the edit fields alongside it. */}
        <form action={deleteSubmit} className="flex flex-wrap items-center gap-1.5">
          <input type="hidden" name="entry_id" value={entry.id} />

          {!confirmingDelete ? (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              disabled={pending}
              aria-label={`Remove the entry of ${dayLabel(entry.day)}`}
              className="rounded-[var(--radius-sm)] border border-[var(--border)] px-2 py-1 font-mono text-[10px] font-semibold tracking-[0.06em] text-[var(--text-muted)] transition-colors hover:border-[var(--critical)] hover:text-[var(--critical)] disabled:cursor-not-allowed pointer-coarse:min-h-[32px] pointer-coarse:px-3"
            >
              REMOVE
            </button>
          ) : (
            <>
              {/* Names what is irreversible, in the row, so the decision can be
                  made without leaving it. */}
              <span className="text-[10px] text-[var(--text-secondary)]">
                Delete {entry.duration} on {dayLabel(entry.day)}? This cannot be
                undone.
              </span>
              <button
                type="submit"
                disabled={pending}
                aria-label={`Confirm removing the entry of ${dayLabel(entry.day)}`}
                className="rounded-[var(--radius-sm)] border border-[var(--critical)] px-2 py-1 font-mono text-[10px] font-semibold tracking-[0.06em] text-[var(--critical)] transition-colors hover:bg-[var(--warning-wash)] disabled:cursor-not-allowed pointer-coarse:min-h-[32px] pointer-coarse:px-3"
              >
                {deletePending ? "REMOVING…" : "CONFIRM"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                disabled={pending}
                className="rounded-[var(--radius-sm)] px-2 py-1 font-mono text-[10px] tracking-[0.06em] text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)] disabled:cursor-not-allowed pointer-coarse:min-h-[32px]"
              >
                CANCEL
              </button>
            </>
          )}
        </form>
      </div>

      {/* This row's OWN live regions, with STATIC roles. A role that changes
          after mount is not reliably announced. */}
      <span role="alert" className="text-[11px] text-[var(--critical)]">
        {failure}
      </span>
      <span role="status" className="text-[11px] text-[var(--good)]">
        {success}
      </span>
    </div>
  );
}
