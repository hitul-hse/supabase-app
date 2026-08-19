"use client";

import { useActionState, useState } from "react";
import { addTimesheetEntry } from "./actions";

export function AddEntryForm({ weekStart }: { weekStart: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState(addTimesheetEntry, { status: "idle" });

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="self-start border border-[var(--border-strong)] px-3 py-1.5 text-[11px] font-medium text-[var(--text-primary)] hover:bg-[var(--surface-hover)]"
      >
        Add entry
      </button>
    );
  }

  return (
    <form
      action={(formData) => {
        formAction(formData);
        setOpen(false);
      }}
      className="flex flex-col gap-2 border border-[var(--border)] bg-[var(--surface-2)] p-3"
    >
      <input type="hidden" name="week_start" value={weekStart} />
      <div className="flex flex-wrap items-center gap-2">
        <input
          name="project_name"
          type="text"
          required
          disabled={isPending}
          placeholder="Project"
          className="w-32 border border-[var(--border)] bg-[var(--page)] px-2.5 py-1.5 text-[12px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] disabled:opacity-50"
        />
        <input
          name="task_name"
          type="text"
          required
          disabled={isPending}
          placeholder="Task"
          className="min-w-[140px] flex-1 border border-[var(--border)] bg-[var(--page)] px-2.5 py-1.5 text-[12px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] disabled:opacity-50"
        />
        <input
          name="customer"
          type="text"
          disabled={isPending}
          placeholder="Customer (optional)"
          className="w-36 border border-[var(--border)] bg-[var(--page)] px-2.5 py-1.5 text-[12px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] disabled:opacity-50"
        />
        <label className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
          <input name="is_billable" type="checkbox" defaultChecked disabled={isPending} />
          Billable
        </label>
        <button
          type="submit"
          disabled={isPending}
          className="bg-[var(--accent)] px-3 py-1.5 text-[12px] font-medium text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)] disabled:opacity-50"
        >
          {isPending ? "Adding…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[12px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
        >
          Cancel
        </button>
      </div>
      {state.status === "error" && (
        <p className="text-[11px] text-[var(--critical)]">{state.message}</p>
      )}
    </form>
  );
}
