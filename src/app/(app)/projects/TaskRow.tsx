"use client";

import { updateTaskStatus, deleteTask } from "./actions";

const TASK_STATUSES = ["NOT STARTED", "IN PROGRESS", "OVER 33%", "DONE"] as const;

const STATUS_CLASS: Record<(typeof TASK_STATUSES)[number], string> = {
  DONE: "text-[var(--accent)]",
  "OVER 33%": "text-[var(--critical)]",
  "IN PROGRESS": "text-[var(--warning)]",
  "NOT STARTED": "text-[var(--text-faint)]",
};

export function TaskRow({
  task,
}: {
  task: { id: number; name: string; estimate_hours: number; logged_hours: number; status: string; owner: string };
}) {
  return (
    <div className="grid min-w-[420px] grid-cols-12 items-center border-b border-[#3a414c] px-4 py-2.5 text-[12.5px] hover:bg-[var(--surface-hover)]">
      <span className="col-span-4 font-medium text-[var(--text-primary)]">{task.name}</span>
      <span className="col-span-2 text-right font-mono text-[var(--text-muted)]">
        {task.estimate_hours}
      </span>
      <span className="col-span-2 text-right font-mono text-[var(--text-primary)]">
        {task.logged_hours}
      </span>

      <form action={updateTaskStatus} className="col-span-3 flex flex-col items-end gap-0.5">
        <input type="hidden" name="task_id" value={task.id} />
        <select
          name="status"
          defaultValue={task.status}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          className={`bg-transparent font-mono text-[10px] font-semibold outline-none ${
            STATUS_CLASS[task.status as (typeof TASK_STATUSES)[number]] ?? "text-[var(--text-faint)]"
          }`}
        >
          {TASK_STATUSES.map((s) => (
            <option key={s} value={s} className="bg-[var(--surface)] text-[var(--text-primary)]">
              {s}
            </option>
          ))}
        </select>
        <span className="text-[11px] text-[var(--text-muted)]">{task.owner}</span>
      </form>

      <form action={deleteTask} className="col-span-1 flex justify-end">
        <input type="hidden" name="task_id" value={task.id} />
        <button
          type="submit"
          aria-label={`Delete ${task.name}`}
          className="text-[var(--text-faint)] hover:text-[var(--critical)]"
        >
          ✕
        </button>
      </form>
    </div>
  );
}
