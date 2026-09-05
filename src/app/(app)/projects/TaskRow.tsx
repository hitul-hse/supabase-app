"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { updateTaskStatus, deleteTask, addComment, deleteComment, addSubtask } from "./actions";
import type { TaskComment, ProjectTaskRow, BoardParent } from "@/lib/queries/types";
import { fmtNum } from "@/lib/locale-format";

/**
 * The stored status values. These are what `project_tasks.status` holds and
 * what `updateTaskStatus` validates against, so they stay English in every
 * locale and only the option TEXT is translated -- the same split as the
 * `data-tile` handles on the totals strip.
 */
const TASK_STATUSES = ["NOT STARTED", "IN PROGRESS", "OVER 33%", "DONE"] as const;

type TaskStatus = (typeof TASK_STATUSES)[number];

const STATUS_KEY: Record<TaskStatus, string> = {
  "NOT STARTED": "status.notStarted",
  "IN PROGRESS": "status.inProgress",
  "OVER 33%": "status.over33",
  DONE: "status.done",
};

const STATUS_CLASS: Record<TaskStatus, string> = {
  DONE: "text-[var(--good)]",
  "OVER 33%": "text-[var(--critical)]",
  "IN PROGRESS": "text-[var(--warning)]",
  "NOT STARTED": "text-[var(--text-faint)]",
};

function SubtaskRow({ task }: { task: ProjectTaskRow }) {
  const t = useTranslations("projects.tasks");
  return (
    <div className="flex items-center justify-between gap-2 py-1 t-callout">
      <span className="text-[var(--text-secondary)]">{task.name}</span>
      <div className="flex items-center gap-2">
        <form action={updateTaskStatus}>
          <input type="hidden" name="task_id" value={task.id} />
          <select
            name="status"
            defaultValue={task.status}
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
            className={`bg-transparent t-label outline-none ${
              STATUS_CLASS[task.status as (typeof TASK_STATUSES)[number]] ?? "text-[var(--text-faint)]"
            }`}
          >
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s} className="bg-[var(--surface)] text-[var(--text-primary)]">
                {t(STATUS_KEY[s])}
              </option>
            ))}
          </select>
        </form>
        <form action={deleteTask}>
          <input type="hidden" name="task_id" value={task.id} />
          <button
            type="submit"
            aria-label={t("deleteTask", { name: task.name })}
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
  locale,
}: {
  task: { id: number; name: string; estimate_hours: number; logged_hours: number; status: string; owner: string };
  parent: BoardParent;
  subtasks: ProjectTaskRow[];
  comments: TaskComment[];
  currentUserId: string | null;
  /** The request locale, handed down by the page. Absent means en-GB. */
  locale?: string;
}) {
  const t = useTranslations("projects.tasks");
  const [commentsExpanded, setCommentsExpanded] = useState(false);
  const [subtasksExpanded, setSubtasksExpanded] = useState(false);
  const doneSubtasks = subtasks.filter((t) => t.status === "DONE").length;

  return (
    <div className="border-b border-[#3a414c]">
      <div className="grid min-w-[420px] grid-cols-12 items-center px-4 py-2.5 t-callout hover:bg-[var(--surface-hover)]">
        <span className="col-span-4 font-medium text-[var(--text-primary)]">{task.name}</span>
        <span className="col-span-2 text-right fig text-[var(--text-muted)]">
          {fmtNum(task.estimate_hours, locale, 1)}
        </span>
        <span className="col-span-2 text-right fig text-[var(--text-primary)]">
          {fmtNum(task.logged_hours, locale, 1)}
        </span>

        <form action={updateTaskStatus} className="col-span-3 flex flex-col items-end gap-0.5">
          <input type="hidden" name="task_id" value={task.id} />
          <select
            name="status"
            defaultValue={task.status}
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
            className={`bg-transparent t-label outline-none ${
              STATUS_CLASS[task.status as (typeof TASK_STATUSES)[number]] ?? "text-[var(--text-faint)]"
            }`}
          >
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s} className="bg-[var(--surface)] text-[var(--text-primary)]">
                {t(STATUS_KEY[s])}
              </option>
            ))}
          </select>
          <span className="t-subhead text-[var(--text-muted)]">{task.owner}</span>
        </form>

        <div className="col-span-1 flex items-center justify-end gap-2">
          <button
            onClick={() => setSubtasksExpanded((v) => !v)}
            aria-label={t("subtaskCount", {
              done: doneSubtasks,
              total: subtasks.length,
              name: task.name,
            })}
            className={`t-label ${
              subtasksExpanded ? "text-[var(--accent)]" : "text-[var(--text-faint)] hover:text-[var(--text-primary)]"
            }`}
          >
            ☰{subtasks.length > 0 ? `${doneSubtasks}/${subtasks.length}` : ""}
          </button>
          <button
            onClick={() => setCommentsExpanded((v) => !v)}
            aria-label={t("commentCount", { count: comments.length, name: task.name })}
            className={`t-label ${
              commentsExpanded ? "text-[var(--accent)]" : "text-[var(--text-faint)] hover:text-[var(--text-primary)]"
            }`}
          >
            💬{comments.length > 0 ? comments.length : ""}
          </button>
          <form action={deleteTask}>
            <input type="hidden" name="task_id" value={task.id} />
            <button
              type="submit"
              aria-label={t("deleteTask", { name: task.name })}
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
            <p className="t-subhead text-[var(--text-faint)]">{t("noSubtasks")}</p>
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
              placeholder={t("addSubtask")}
              className="flex-1 border border-[var(--border)] bg-[var(--page)] px-2.5 py-1.5 t-callout text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--accent)]"
            />
            <button
              type="submit"
              className="bg-[var(--accent)] px-3 py-1.5 t-subhead font-medium text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)]"
            >
              {t("addSubtaskButton")}
            </button>
          </form>
        </div>
      )}

      {commentsExpanded && (
        <div className="flex flex-col gap-2 bg-[var(--surface-2)] px-4 py-3">
          {comments.length === 0 && (
            <p className="t-subhead text-[var(--text-faint)]">{t("noComments")}</p>
          )}
          {comments.map((c) => (
            <div key={c.id} className="flex items-start justify-between gap-2 t-callout">
              <div>
                <span className="font-medium text-[var(--text-primary)]">{c.authorName}</span>{" "}
                <span className="text-[var(--text-secondary)]">{c.body}</span>
              </div>
              {c.authorId === currentUserId && (
                <form action={deleteComment}>
                  <input type="hidden" name="comment_id" value={c.id} />
                  <button
                    type="submit"
                    aria-label={t("deleteComment")}
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
              placeholder={t("addComment")}
              className="flex-1 border border-[var(--border)] bg-[var(--page)] px-2.5 py-1.5 t-callout text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--accent)]"
            />
            <button
              type="submit"
              className="bg-[var(--accent)] px-3 py-1.5 t-subhead font-medium text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)]"
            >
              {t("postComment")}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
