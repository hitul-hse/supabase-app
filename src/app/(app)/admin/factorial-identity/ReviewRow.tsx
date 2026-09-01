"use client";

import { useActionState } from "react";
import { resolveToPerson, excludeRow, type DecisionState } from "./actions";

export type PersonOption = { id: string; name: string };
export type ReviewRowData = {
  id: string;
  factorial_login_email: string | null;
  factorial_full_name: string | null;
  factorial_active: boolean | null;
  candidate_person_id: string | null;
  candidate_count: number;
  status: string;
  status_reason: string;
  last_seen_at: string;
};

const idle: DecisionState = { status: "idle" };

/**
 * One open identity, three honest exits. The machine wrote the row and its
 * reason; everything below the reason line is the part only a human may do,
 * which is why every button ends up signing the row with the reviewer's id.
 */
export function ReviewRow({ row, people }: { row: ReviewRowData; people: PersonOption[] }) {
  const [linkState, linkAction, linkPending] = useActionState(resolveToPerson, idle);
  const [exclState, exclAction, exclPending] = useActionState(excludeRow, idle);
  const busy = linkPending || exclPending;
  const message = linkState.status !== "idle" ? linkState : exclState;

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <span className="font-medium">{row.factorial_full_name ?? "(no name)"}</span>
          <span className="ml-2 text-sm text-[var(--muted)]">{row.factorial_login_email ?? "no email"}</span>
          {row.factorial_active === false && (
            <span className="ml-2 text-xs text-[var(--muted)]">inactive in Factorial</span>
          )}
        </div>
        <span className="text-xs uppercase tracking-wide text-[var(--muted)]">{row.status}</span>
      </div>
      <p className="mt-2 text-sm text-[var(--muted)]">{row.status_reason}</p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <form action={linkAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="review_id" value={row.id} />
          <select
            name="person_id"
            defaultValue={row.candidate_person_id ?? ""}
            className="rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1.5 text-sm"
            aria-label="Person to link"
          >
            <option value="">— pick a person —</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <input
            name="note"
            placeholder="note (optional)"
            className="w-44 rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1.5 text-sm"
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-contrast)] disabled:opacity-50"
          >
            {linkPending ? "Linking…" : "Link person"}
          </button>
        </form>

        <form action={exclAction} className="flex items-center gap-2">
          <input type="hidden" name="review_id" value={row.id} />
          <input type="hidden" name="kind" value="excluded_not_a_person" />
          <button
            type="submit"
            disabled={busy}
            className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-50"
          >
            Not a person
          </button>
        </form>
        <form action={exclAction} className="flex items-center gap-2">
          <input type="hidden" name="review_id" value={row.id} />
          <input type="hidden" name="kind" value="excluded_not_employee" />
          <button
            type="submit"
            disabled={busy}
            className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-50"
          >
            Not our employee
          </button>
        </form>
      </div>

      {message.status === "error" && (
        <p className="mt-2 text-sm text-[var(--danger,#c53030)]">{message.message}</p>
      )}
      {message.status === "success" && (
        <p className="mt-2 text-sm text-[var(--accent)]">{message.message}</p>
      )}
    </div>
  );
}
