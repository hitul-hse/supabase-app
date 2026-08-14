"use client";

import { useActionState } from "react";
import { inviteUser } from "./actions";
import type { AppRoleRow, PersonOption } from "./page";

export function InviteUserForm({
  roles,
  people,
}: {
  roles: AppRoleRow[];
  people: PersonOption[];
}) {
  const [state, formAction, isPending] = useActionState(inviteUser, { status: "idle" });

  return (
    <form
      action={formAction}
      className="flex flex-col gap-3 border border-[var(--border)] bg-[var(--surface)] p-4"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-[var(--text-primary)]">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            disabled={isPending}
            className="w-full border border-[var(--border)] bg-[var(--page)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] disabled:opacity-50"
            placeholder="name@hs-experts.com"
          />
        </div>

        <div>
          <label htmlFor="role_key" className="mb-1.5 block text-sm font-medium text-[var(--text-primary)]">
            Role
          </label>
          <select
            id="role_key"
            name="role_key"
            required
            disabled={isPending}
            className="w-full border border-[var(--border)] bg-[var(--page)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
          >
            {roles.map((role) => (
              <option key={role.role_key} value={role.role_key}>
                {role.display_name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="person_id" className="mb-1.5 block text-sm font-medium text-[var(--text-primary)]">
            Linked person (optional)
          </label>
          <select
            id="person_id"
            name="person_id"
            disabled={isPending}
            className="w-full border border-[var(--border)] bg-[var(--page)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
          >
            <option value="">None</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="department" className="mb-1.5 block text-sm font-medium text-[var(--text-primary)]">
            Department (for Dept Head scoping)
          </label>
          <select
            id="department"
            name="department"
            disabled={isPending}
            className="w-full border border-[var(--border)] bg-[var(--page)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
          >
            <option value="">None</option>
            <option value="SAFETY">Safety</option>
            <option value="ENG">Engineering</option>
            <option value="LAB">Lab &amp; measurement</option>
          </select>
        </div>
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="self-start bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-contrast)] transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-50"
      >
        {isPending ? "Inviting…" : "Send invite"}
      </button>

      {state.status === "success" && (
        <div
          className="flex items-start gap-3 border border-[var(--border)] p-3 text-sm"
          style={{ background: "var(--good-wash)" }}
        >
          <span aria-hidden className="mt-0.5 text-base text-[var(--good)]">
            ✓
          </span>
          <p className="text-[var(--text-primary)]">{state.message}</p>
        </div>
      )}

      {state.status === "error" && (
        <div
          className="flex items-start gap-3 border border-[var(--border)] p-3 text-sm"
          style={{ background: "var(--critical-wash)" }}
        >
          <span aria-hidden className="mt-0.5 text-base text-[var(--critical)]">
            ✕
          </span>
          <p className="text-[var(--text-primary)]">{state.message}</p>
        </div>
      )}
    </form>
  );
}
