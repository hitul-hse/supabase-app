import { TaskRow } from "./TaskRow";
import type { TaskComment, TaskWithSubtasks } from "@/lib/queries/types";

export function TaskListView({
  projectId,
  tasks,
  commentsByTask,
  currentUserId,
}: {
  projectId: string;
  tasks: TaskWithSubtasks[];
  commentsByTask: Record<number, TaskComment[]>;
  currentUserId: string | null;
}) {
  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[420px] grid-cols-12 border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-2 font-mono text-[10px] tracking-[0.1em] text-[var(--text-faint)]">
        <span className="col-span-4">TASK</span>
        <span className="col-span-2 text-right">EST</span>
        <span className="col-span-2 text-right">LOGGED</span>
        <span className="col-span-3 text-right">STATUS / OWNER</span>
        <span className="col-span-1" />
      </div>

      {tasks.map((task) => (
        <TaskRow
          key={task.id}
          task={task}
          projectId={projectId}
          subtasks={task.subtasks}
          comments={commentsByTask[task.id] ?? []}
          currentUserId={currentUserId}
        />
      ))}
    </div>
  );
}
