"use client";

/**
 * Board view, built over sections rather than a fixed status enum.
 *
 * Columns used to be four hard-coded statuses, which meant every project had
 * the same workflow and nobody could rename a stage. Sections are the same
 * objects the list view groups by (Asana's model), so a column added here is
 * a heading there.
 */

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { deleteTask, moveTaskToSection, createSection } from "./actions";
import type { ProjectSectionRow, TaskWithSubtasks, BoardParent } from "@/lib/queries/types";
import { EmptyState } from "@/components/EmptyState";
import { Card } from "@/components/ui/Card";
import { fmtInt, fmtNum } from "@/lib/locale-format";

/** Tasks with no section yet -- e.g. after their column was deleted. */
const UNFILED = "unfiled";

function TaskCard({
  task,
  sections,
  locale,
}: {
  task: TaskWithSubtasks;
  sections: ProjectSectionRow[];
  locale?: string;
}) {
  const t = useTranslations("projects.tasks");
  const doneSubtasks = task.subtasks.filter((s) => s.status === "DONE").length;
  const overdue =
    task.due_on !== null && task.status !== "DONE" && task.due_on < new Date().toISOString().slice(0, 10);

  return (
    // A board card is an independent record, so it takes card geometry. Its
    // COLUMN stays a plain container: Card-in-Card is banned, and a board is
    // columns of cards, not cards of cards.
    <Card as="article" className="flex flex-col gap-2 p-3 transition-colors hover:border-[var(--border-strong)]">
      <span className="t-callout font-medium text-[var(--text-primary)]">{task.name}</span>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 t-label">
        <span className="text-[var(--text-muted)]">{task.owner || t("unassigned")}</span>
        <span className="text-[var(--text-secondary)]">
          {fmtNum(task.logged_hours, locale, 1)}/{fmtNum(task.estimate_hours, locale, 1)}h
        </span>
        {task.subtasks.length > 0 && (
          <span className="text-[var(--text-muted)]">
            ☰{doneSubtasks}/{task.subtasks.length}
          </span>
        )}
        {task.due_on && (
          <span style={{ color: overdue ? "var(--critical)" : "var(--text-muted)" }}>
            {overdue ? t("overdue") : t("due")}
            {task.due_on}
          </span>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-[var(--border)] pt-2">
        <form action={moveTaskToSection}>
          <input type="hidden" name="task_id" value={task.id} />
          <select
            name="section_id"
            defaultValue={task.section_id ?? ""}
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
            aria-label={t("moveLabel", { name: task.name })}
            className="max-w-[130px] bg-transparent t-label text-[var(--text-muted)] outline-none transition-colors hover:text-[var(--text-primary)]"
          >
            <option value="" className="bg-[var(--surface)] text-[var(--text-primary)]">
              {t("moveToUnfiled")}
            </option>
            {sections.map((s) => (
              <option key={s.id} value={s.id} className="bg-[var(--surface)] text-[var(--text-primary)]">
                {t("moveTo", { name: s.name })}
              </option>
            ))}
          </select>
        </form>

        <form action={deleteTask}>
          <input type="hidden" name="task_id" value={task.id} />
          <button
            type="submit"
            aria-label={t("deleteTask", { name: task.name })}
            className="text-[var(--text-faint)] transition-colors hover:text-[var(--critical)]"
          >
            ✕
          </button>
        </form>
      </div>
    </Card>
  );
}

function AddSectionForm({ parent }: { parent: BoardParent }) {
  const t = useTranslations("projects.tasks");
  const [state, formAction, isPending] = useActionState(createSection, { status: "idle" });

  return (
    <form action={formAction} className="flex w-[220px] flex-none flex-col gap-2">
      <input type="hidden" name={parent.field} value={String(parent.id)} />
      <input
        name="name"
        type="text"
        required
        disabled={isPending}
        placeholder={t("newColumn")}
        className="border border-dashed border-[var(--border-strong)] bg-transparent px-2.5 py-1.5 t-callout text-[var(--text-primary)] outline-none transition-colors placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] disabled:opacity-50"
      />
      {state.status === "error" && (
        <span className="t-subhead text-[var(--critical)]">{state.message}</span>
      )}
    </form>
  );
}

export function TaskBoardView({
  parent,
  tasks,
  sections,
  locale,
}: {
  parent: BoardParent;
  tasks: TaskWithSubtasks[];
  sections: ProjectSectionRow[];
  /** The request locale, handed down by the page. Absent means en-GB. */
  locale?: string;
}) {
  const t = useTranslations("projects.tasks");
  const unfiled = tasks.filter((t) => t.section_id === null);
  // Only shown when it has something in it -- an always-present "Unfiled"
  // column is clutter on a tidy board.
  const columns: Array<{ key: string; section: ProjectSectionRow | null; tasks: TaskWithSubtasks[] }> = [
    ...sections.map((s) => ({
      key: String(s.id),
      section: s,
      tasks: tasks.filter((t) => t.section_id === s.id),
    })),
    ...(unfiled.length > 0 ? [{ key: UNFILED, section: null, tasks: unfiled }] : []),
  ];

  if (sections.length === 0) {
    return (
      <div className="p-4">
        <EmptyState
          title={t("noColumns.title")}
          description={t("noColumns.description")}
          action={<AddSectionForm parent={parent} />}
        />
      </div>
    );
  }

  return (
    <div className="overflow-x-auto p-3">
      <div className="flex gap-3" style={{ minWidth: `${(columns.length + 1) * 232}px` }}>
        {columns.map(({ key, section, tasks: colTasks }) => {
          const over = section?.wip_limit != null && colTasks.length > section.wip_limit;
          const atLimit = section?.wip_limit != null && colTasks.length === section.wip_limit;

          return (
            <section key={key} className="flex w-[220px] flex-none flex-col gap-2">
              <header className="flex items-center justify-between border-b border-[var(--border)] px-1 pb-2">
                <span className="t-label text-[var(--text-primary)]">
                  {section?.name ?? t("unfiled")}
                </span>
                <span
                  className="t-label"
                  style={{
                    color: over
                      ? "var(--critical)"
                      : atLimit
                      ? "var(--warning)"
                      : "var(--text-faint)",
                  }}
                  title={
                    section?.wip_limit != null
                      ? t("wipTitle", {
                          count: fmtInt(colTasks.length, locale),
                          limit: fmtInt(section.wip_limit, locale),
                        })
                      : undefined
                  }
                >
                  {colTasks.length}
                  {section?.wip_limit != null && `/${section.wip_limit}`}
                </span>
              </header>

              <div className="flex flex-col gap-2">
                {colTasks.length === 0 ? (
                  <p className="px-1 t-subhead text-[var(--text-faint)]">{t("noTasks")}</p>
                ) : (
                  colTasks.map((task) => (
                    <TaskCard key={task.id} task={task} sections={sections} locale={locale} />
                  ))
                )}
              </div>
            </section>
          );
        })}

        <AddSectionForm parent={parent} />
      </div>
    </div>
  );
}
