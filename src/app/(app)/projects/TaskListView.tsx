"use client";

/**
 * The task list, paged.
 *
 * WHY IT NEEDS PAGING. The largest live project has 101 tasks, and every row can expand to
 * reveal subtasks and a comment thread, so the rendered height is well past four screens.
 * There was no paging of any kind here -- the same long-page problem the user reported on
 * the projects ledger, without even a control to blame for it.
 *
 * WHY 25. A task row is taller than a ledger row and expands in place, so a page of 25 is
 * about a screen. ALL is still offered, which matters here more than elsewhere: reviewing
 * every task before a milestone is a real thing to want, and so is the browser's own find.
 *
 * WHY THE BOARD VIEW IS NOT PAGED. A kanban exists to be seen at once, and hiding cards
 * behind a pager would defeat it. The board also spreads these tasks across columns, so no
 * column comes close to the full count.
 */

import { useRef } from "react";
import { useTranslations } from "next-intl";
import { TaskRow } from "./TaskRow";
import { Pager, usePager } from "@/components/Pager";
import type { TaskComment, TaskWithSubtasks, BoardParent } from "@/lib/queries/types";

export function TaskListView({
  parent,
  tasks,
  commentsByTask,
  currentUserId,
  locale,
}: {
  parent: BoardParent;
  tasks: TaskWithSubtasks[];
  commentsByTask: Record<number, TaskComment[]>;
  currentUserId: string | null;
  /** The request locale, handed down by the page. Absent means en-GB. */
  locale?: string;
}) {
  const t = useTranslations("projects.tasks");
  const listRef = useRef<HTMLDivElement>(null);
  // The reset key is the task count: when tasks are added or removed the list shifts, and
  // sitting on a page that no longer exists would render nothing.
  const pager = usePager(tasks.length, 25, String(tasks.length));
  const visible = tasks.slice(pager.start, pager.end);

  return (
    <div className="overflow-x-auto">
      <div
        ref={listRef}
        className="grid min-w-[420px] grid-cols-12 border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-2 t-label text-[var(--text-faint)]"
      >
        <span className="col-span-4">{t("columns.task")}</span>
        <span className="col-span-2 text-right">{t("columns.estimate")}</span>
        <span className="col-span-2 text-right">{t("columns.logged")}</span>
        <span className="col-span-3 text-right">{t("columns.statusOwner")}</span>
        <span className="col-span-1" />
      </div>

      {visible.map((task) => (
        <TaskRow
          key={task.id}
          task={task}
          parent={parent}
          subtasks={task.subtasks}
          comments={commentsByTask[task.id] ?? []}
          currentUserId={currentUserId}
          locale={locale}
        />
      ))}

      {/* Only appears once there is more than one page's worth, so a project with six
          tasks carries no pager furniture at all. */}
      {tasks.length > 25 && (
        <Pager state={pager} total={tasks.length} noun={t("pagerNoun")} anchorRef={listRef} />
      )}
    </div>
  );
}
