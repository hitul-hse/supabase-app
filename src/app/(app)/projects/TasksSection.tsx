"use client";

import { useState } from "react";
import { AddTaskForm } from "./AddTaskForm";
import { TaskListView } from "./TaskListView";
import { TaskBoardView } from "./TaskBoardView";
import type { TaskComment, TaskWithSubtasks, ProjectSectionRow, BoardParent } from "@/lib/queries/types";
import { Card } from "@/components/ui/Card";

export function TasksSection({
  parent,
  tasks,
  sections,
  commentsByTask,
  currentUserId,
}: {
  parent: BoardParent;
  tasks: TaskWithSubtasks[];
  sections: ProjectSectionRow[];
  commentsByTask: Record<number, TaskComment[]>;
  currentUserId: string | null;
}) {
  const [view, setView] = useState<"list" | "board">("list");
  const openCount = tasks.filter((t) => t.status !== "DONE").length;

  return (
    <Card className="flex flex-col lg:col-span-7">
      <div className="flex items-baseline justify-between border-b border-[var(--divider)] p-4">
        <span className="text-[12.5px] font-semibold text-[var(--text-primary)]">Tasks &amp; hours</span>
        <div className="flex items-center gap-3">
          <span className="font-mono text-[10.5px] text-[var(--text-muted)]">
            {openCount} OPEN OF {tasks.length}
          </span>
          <div className="flex border border-[var(--border-strong)]">
            <button
              onClick={() => setView("list")}
              className={`px-2.5 py-1 text-[10.5px] font-medium ${
                view === "list"
                  ? "bg-[var(--accent)] text-[var(--accent-contrast)]"
                  : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
              }`}
            >
              List
            </button>
            <button
              onClick={() => setView("board")}
              className={`border-l border-[var(--border-strong)] px-2.5 py-1 text-[10.5px] font-medium ${
                view === "board"
                  ? "bg-[var(--accent)] text-[var(--accent-contrast)]"
                  : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
              }`}
            >
              Board
            </button>
          </div>
        </div>
      </div>

      <AddTaskForm parent={parent} />

      {view === "list" ? (
        <TaskListView
          parent={parent}
          tasks={tasks}
          commentsByTask={commentsByTask}
          currentUserId={currentUserId}
        />
      ) : (
        <TaskBoardView parent={parent} tasks={tasks} sections={sections} />
      )}
    </Card>
  );
}
