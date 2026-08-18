"use client";

import { useActionState } from "react";
import { inviteUser } from "./actions";
import type { AppRoleRow } from "./page";

export function InviteUserForm({ roles }: { roles: AppRoleRow[] }) {
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

        {/*
          * No "linked person" picker.
          *
          * It used to list the eight seeded mockup people, so an admin inviting a
          * real colleague was asked which fictional character they were. The link
          * that actually matters is to their TrackingTime member record, and that
          * is derivable: every Hub account on a real work address already matches
          * its member on email exactly. So the server does it, and the admin is
          * told what will happen rather than asked to guess.
          */}
        <div className="sm:col-span-2">
          <span className="mb-1.5 block text-sm font-medium text-[var(--text-primary)]">
            TrackingTime link
          </span>
          <p className="border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-[12.5px] text-[var(--text-secondary)]">
            Linked automatically by email address. If this person has a
            TrackingTime account on the same address, their logged hours appear on
            their own Time page immediately. If not, they can still sign in and
            use the Hub — the link is made whenever the addresses match.
          </p>
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
