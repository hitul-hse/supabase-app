"use client";

import { useState } from "react";
import { updateTaskStatus, deleteTask, addComment, deleteComment, addSubtask } from "./actions";
import type { TaskComment, ProjectTaskRow, BoardParent } from "@/lib/queries/types";

const TASK_STATUSES = ["NOT STARTED", "IN PROGRESS", "OVER 33%", "DONE"] as const;

const STATUS_CLASS: Record<(typeof TASK_STATUSES)[number], string> = {
  DONE: "text-[var(--accent)]",
  "OVER 33%": "text-[var(--critical)]",
  "IN PROGRESS": "text-[var(--warning)]",
  "NOT STARTED": "text-[var(--text-faint)]",
};

function SubtaskRow({ task }: { task: ProjectTaskRow }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1 text-[11.5px]">
      <span className="text-[var(--text-secondary)]">{task.name}</span>
      <div className="flex items-center gap-2">
        <form action={updateTaskStatus}>
          <input type="hidden" name="task_id" value={task.id} />
          <select
            name="status"
            defaultValue={task.status}
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
            className={`bg-transparent font-mono text-[9.5px] font-semibold outline-none ${
              STATUS_CLASS[task.status as (typeof TASK_STATUSES)[number]] ?? "text-[var(--text-faint)]"
            }`}
          >
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s} className="bg-[var(--surface)] text-[var(--text-primary)]">
                {s}
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

export function TaskRow({
  task,
  parent,
  subtasks,
  comments,
  currentUserId,
}: {
  task: { id: number; name: string; estimate_hours: number; logged_hours: number; status: string; owner: string };
  parent: BoardParent;
  subtasks: ProjectTaskRow[];
  comments: TaskComment[];
  currentUserId: string | null;
}) {
  const [commentsExpanded, setCommentsExpanded] = useState(false);
  const [subtasksExpanded, setSubtasksExpanded] = useState(false);
  const doneSubtasks = subtasks.filter((t) => t.status === "DONE").length;

  return (
    <div className="border-b border-[#3a414c]">
      <div className="grid min-w-[420px] grid-cols-12 items-center px-4 py-2.5 text-[12.5px] hover:bg-[var(--surface-hover)]">
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

        <div className="col-span-1 flex items-center justify-end gap-2">
          <button
            onClick={() => setSubtasksExpanded((v) => !v)}
            aria-label={`${subtasks.length} subtasks on ${task.name}`}
            className={`font-mono text-[10.5px] ${
              subtasksExpanded ? "text-[var(--accent)]" : "text-[var(--text-faint)] hover:text-[var(--text-primary)]"
            }`}
          >
            ☰{subtasks.length > 0 ? `${doneSubtasks}/${subtasks.length}` : ""}
          </button>
          <button
            onClick={() => setCommentsExpanded((v) => !v)}
            aria-label={`${comments.length} comments on ${task.name}`}
            className={`font-mono text-[10.5px] ${
              commentsExpanded ? "text-[var(--accent)]" : "text-[var(--text-faint)] hover:text-[var(--text-primary)]"
            }`}
          >
            💬{comments.length > 0 ? comments.length : ""}
          </button>
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

      {subtasksExpanded && (
        <div className="flex flex-col gap-1 bg-[var(--surface-2)] px-4 py-3 pl-8">
          {subtasks.length === 0 && (
            <p className="text-[11.5px] text-[var(--text-faint)]">No subtasks yet.</p>
          )}
          {subtasks.map((s) => (
            <SubtaskRow key={s.id} task={s} />
          ))}
          <form action={addSubtask} className="mt-1 flex gap-2">
            <input type="hidden" name={parent.field} value={String(parent.id)} />
            <input type="hidden" name="parent_task_id" value={task.id} />
            <input
              name="name"
              type="text"
              required
              placeholder="Add a subtask…"
              className="flex-1 border border-[var(--border)] bg-[var(--page)] px-2.5 py-1.5 text-[11.5px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--accent)]"
            />
            <button
              type="submit"
              className="bg-[var(--accent)] px-3 py-1.5 text-[11px] font-medium text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)]"
            >
              Add
            </button>
          </form>
        </div>
      )}

      {commentsExpanded && (
        <div className="flex flex-col gap-2 bg-[var(--surface-2)] px-4 py-3">
          {comments.length === 0 && (
            <p className="text-[11.5px] text-[var(--text-faint)]">No comments yet.</p>
          )}
          {comments.map((c) => (
            <div key={c.id} className="flex items-start justify-between gap-2 text-[11.5px]">
              <div>
                <span className="font-medium text-[var(--text-primary)]">{c.authorName}</span>{" "}
                <span className="text-[var(--text-secondary)]">{c.body}</span>
              </div>
              {c.authorId === currentUserId && (
                <form action={deleteComment}>
                  <input type="hidden" name="comment_id" value={c.id} />
                  <button
                    type="submit"
                    aria-label="Delete comment"
                    className="shrink-0 text-[var(--text-faint)] hover:text-[var(--critical)]"
                  >
                    ✕
                  </button>
                </form>
              )}
            </div>
          ))}
          <form action={addComment} className="mt-1 flex gap-2">
            <input type="hidden" name="task_id" value={task.id} />
            <input
              name="body"
              type="text"
              required
              placeholder="Add a comment…"
              className="flex-1 border border-[var(--border)] bg-[var(--page)] px-2.5 py-1.5 text-[11.5px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--accent)]"
            />
            <button
              type="submit"
              className="bg-[var(--accent)] px-3 py-1.5 text-[11px] font-medium text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)]"
            >
              Post
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
