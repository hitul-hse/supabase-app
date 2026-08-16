"use client";

import { updateTaskStatus, deleteTask } from "./actions";

const COLUMNS = ["NOT STARTED", "IN PROGRESS", "OVER 33%", "DONE"] as const;

const COLUMN_ACCENT: Record<(typeof COLUMNS)[number], string> = {
  "NOT STARTED": "var(--text-faint)",
  "IN PROGRESS": "var(--warning)",
  "OVER 33%": "var(--critical)",
  DONE: "var(--accent)",
};

type Task = {
  id: number;
  name: string;
  estimate_hours: number;
  logged_hours: number;
  status: string;
  owner: string;
};

function TaskCard({ task }: { task: Task }) {
  return (
    <div className="flex flex-col gap-2 border border-[var(--border)] bg-[var(--surface)] p-3">
      <span className="text-[12.5px] font-medium text-[var(--text-primary)]">{task.name}</span>
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10.5px] text-[var(--text-muted)]">{task.owner}</span>
        <span className="font-mono text-[10.5px] text-[var(--text-secondary)]">
          {task.logged_hours}/{task.estimate_hours}h
        </span>
      </div>
      <div className="flex items-center justify-between border-t border-[var(--border)] pt-2">
        <form action={updateTaskStatus}>
          <input type="hidden" name="task_id" value={task.id} />
          <select
            name="status"
            defaultValue={task.status}
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
            className="bg-transparent font-mono text-[9.5px] text-[var(--text-muted)] outline-none"
          >
            {COLUMNS.map((s) => (
              <option key={s} value={s} className="bg-[var(--surface)] text-[var(--text-primary)]">
                Move to: {s}
              </option>
            ))}
          </select>
        </form>
        <form action={deleteTask}>
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
    </div>
  );
}

export function TaskBoardView({ tasks }: { tasks: Task[] }) {
  return (
    <div className="overflow-x-auto p-3">
      <div className="flex gap-3" style={{ minWidth: `${COLUMNS.length * 220}px` }}>
        {COLUMNS.map((col) => {
          const colTasks = tasks.filter((t) => t.status === col);
          return (
            <div key={col} className="flex w-[220px] flex-none flex-col gap-2">
              <div className="flex items-center justify-between border-b border-[var(--border)] px-1 pb-2">
                <span
                  className="font-mono text-[10px] font-semibold tracking-[0.05em]"
                  style={{ color: COLUMN_ACCENT[col] }}
                >
                  {col}
                </span>
                <span className="font-mono text-[10px] text-[var(--text-faint)]">{colTasks.length}</span>
              </div>
              <div className="flex flex-col gap-2">
                {colTasks.length === 0 ? (
                  <p className="px-1 text-[11px] text-[var(--text-faint)]">No tasks</p>
                ) : (
                  colTasks.map((task) => <TaskCard key={task.id} task={task} />)
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
