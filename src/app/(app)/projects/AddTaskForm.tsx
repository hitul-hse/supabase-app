"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { createTask } from "./actions";
import type { BoardParent } from "@/lib/queries/types";

export function AddTaskForm({ parent }: { parent: BoardParent }) {
  const t = useTranslations("projects.tasks");
  const [state, formAction, isPending] = useActionState(createTask, { status: "idle" });

  return (
    <form action={formAction} className="flex flex-col gap-2 border-b border-[var(--border)] bg-[var(--surface-2)] p-3">
      <input type="hidden" name={parent.field} value={String(parent.id)} />
      <div className="flex flex-wrap items-center gap-2">
        <input
          name="name"
          type="text"
          required
          disabled={isPending}
          placeholder={t("addName")}
          className="min-w-[160px] flex-1 border border-[var(--border)] bg-[var(--page)] px-2.5 py-1.5 text-[12.5px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] disabled:opacity-50"
        />
        <input
          name="owner"
          type="text"
          required
          disabled={isPending}
          placeholder={t("addOwner")}
          className="w-28 border border-[var(--border)] bg-[var(--page)] px-2.5 py-1.5 text-[12.5px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] disabled:opacity-50"
        />
        <input
          name="estimate_hours"
          type="number"
          min="0"
          step="0.5"
          disabled={isPending}
          placeholder={t("addEstimate")}
          className="w-20 border border-[var(--border)] bg-[var(--page)] px-2.5 py-1.5 text-[12.5px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={isPending}
          className="bg-[var(--accent)] px-3 py-1.5 text-[12px] font-medium text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)] disabled:opacity-50"
        >
          {isPending ? t("adding") : t("add")}
        </button>
      </div>
      {state.status === "error" && (
        <p className="text-[11.5px] text-[var(--critical)]">{state.message}</p>
      )}
    </form>
  );
}
