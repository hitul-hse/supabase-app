"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { Select, TextInput } from "@/components/ui/Field";
import { resolveToPerson, excludeRow, createPersonAndLink, type DecisionState } from "./actions";

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
  member_name?: string | null;
  member_team?: string | null;
  member_job?: string | null;
  member_hours?: number | null;
};

const idle: DecisionState = { status: "idle" };

/**
 * One open identity, three honest exits. The machine wrote the row and its
 * reason; everything below the reason line is the part only a human may do,
 * which is why every button ends up signing the row with the reviewer's id.
 *
 * THE POPULATIONS DO NOT FULLY OVERLAP, and the UI says so instead of letting
 * the picker imply otherwise. Factorial holds every employee past and present;
 * the hub's people list holds colleagues wired up from TrackingTime. A former
 * employee often has no person to link to -- for them, "No longer our
 * employee" is the honest terminal state, not a forced match to whoever
 * sounds closest.
 */
export function ReviewRow({ row, people }: { row: ReviewRowData; people: PersonOption[] }) {
  const [linkState, linkAction, linkPending] = useActionState(resolveToPerson, idle);
  const [exclState, exclAction, exclPending] = useActionState(excludeRow, idle);
  const [createState, createAction, createPending] = useActionState(createPersonAndLink, idle);
  const busy = linkPending || exclPending || createPending;
  const message = createState.status !== "idle" ? createState : linkState.status !== "idle" ? linkState : exclState;
  const inactive = row.factorial_active === false;
  const canCreate = row.status === "bridged_unlinked" && !!row.member_name;

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <span className="font-medium text-[var(--text-primary)]">{row.factorial_full_name ?? "(no name)"}</span>
          <span className="ml-2 text-sm text-[var(--text-muted)]">{row.factorial_login_email ?? "no email"}</span>
      {row.status === "unmatched" && row.factorial_active !== false && (
        <p className="mt-1 text-sm text-[var(--text-faint)]">
          In Factorial but has no TrackingTime account — usually a live colleague the hub
          doesn&apos;t track yet. Current stage links hub ↔ TrackingTime ↔ Factorial only, so
          leaving this row open is the correct call until that changes.
        </p>
      )}
          {inactive && (
            <span className="ml-2 rounded px-1.5 py-0.5 text-xs bg-[var(--warning-wash)] text-[var(--warning)]">
              inactive in Factorial
            </span>
          )}
          {(row.member_hours ?? 0) > 0 && (
            <span className="ml-2 rounded px-1.5 py-0.5 text-xs bg-[var(--accent-wash)] text-[var(--accent)]">
              {row.member_hours}h logged
            </span>
          )}
        </div>
        <span className="text-xs uppercase tracking-wide text-[var(--text-faint)]">{row.status}</span>
      </div>
      <p className="mt-2 text-sm text-[var(--text-muted)]">{row.status_reason}</p>
      {row.member_name && (row.member_team || row.member_job) && (
        <p className="mt-1 text-xs text-[var(--text-faint)]">TrackingTime: {row.member_name}{row.member_job ? ` · ${row.member_job}` : ""}{row.member_team ? ` · ${row.member_team}` : ""}</p>
      )}
      {inactive && (
        <p className="mt-1 text-sm text-[var(--text-faint)]">
          {(row.member_hours ?? 0) > 0
            ? `${row.member_hours}h of logged work needs a name to attribute to — Create & link keeps that history analysable. (Factorial's active flag is app access, not employment; the owner confirms status by deciding.)`
            : "No Factorial app access and no logged hours. If they've truly left, “No longer our employee”; if they're a current colleague without accounts, leave open for the later stage."}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {canCreate && (
          <form action={createAction} className="flex items-center gap-2">
            <input type="hidden" name="review_id" value={row.id} />
            <Button type="submit" variant="primary" disabled={busy}>
              {createPending ? "Creating…" : `Create “${row.member_name}” & link`}
            </Button>
          </form>
        )}
        <form action={linkAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="review_id" value={row.id} />
          <Select label="Person to link" name="person_id" defaultValue={row.candidate_person_id ?? ""}>
            <option value="">— pick a person —</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </Select>
          <TextInput label="Resolution note" name="note" placeholder="note (optional)" className="w-44" />
          <Button type="submit" disabled={busy}>
            {linkPending ? "Linking…" : "Link person"}
          </Button>
        </form>

        <form action={exclAction}>
          <input type="hidden" name="review_id" value={row.id} />
          <input type="hidden" name="kind" value="excluded_not_a_person" />
          <Button type="submit" variant="ghost" disabled={busy}>Not a person</Button>
        </form>
        <form action={exclAction}>
          <input type="hidden" name="review_id" value={row.id} />
          <input type="hidden" name="kind" value="excluded_not_employee" />
          <Button type="submit" variant="ghost" disabled={busy}>
            {inactive ? "No longer our employee" : "Not our employee"}
          </Button>
        </form>
      </div>

      {message.status === "error" && (
        <p className="mt-2 text-sm text-[var(--critical)]">{message.message}</p>
      )}
      {message.status === "success" && (
        <p className="mt-2 text-sm text-[var(--accent)]">{message.message}</p>
      )}
    </div>
  );
}
