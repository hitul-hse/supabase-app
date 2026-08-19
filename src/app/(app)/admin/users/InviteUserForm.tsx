"use client";

import { useActionState } from "react";
import { inviteUser } from "./actions";
import type { AppRoleRow } from "./page";
import { TEAMS } from "@/lib/teams";
import { Button } from "@/components/ui/Button";
import { IconCheck, IconCross } from "@/components/nav-icons";

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
          <p className="border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-[12px] text-[var(--text-secondary)]">
            Linked automatically by email address. If this person has a
            TrackingTime account on the same address, their logged hours appear on
            their own Time page immediately. If not, they can still sign in and
            use the Hub — the link is made whenever the addresses match.
          </p>
        </div>

        <div>
          <label htmlFor="department" className="mb-1.5 block text-sm font-medium text-[var(--text-primary)]">
            Team
          </label>
          <select
            id="department"
            /* The form field and the column are still called department: renaming a
               column that appears in RLS policies is a migration with real risk and
               no benefit a user would notice. Only the label changes. */
            name="department"
            disabled={isPending}
            className="w-full border border-[var(--border)] bg-[var(--page)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
          >
            <option value="">None</option>
            {/* From lib/teams, so this form and the users table cannot drift apart
                about what a valid team is -- they previously did. */}
            {TEAMS.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
      </div>

      <Button type="submit" variant="primary" busy={isPending} className="self-start">
        Send invite
      </Button>

      {state.status === "success" && (
        <div
          role="status"
          className="flex items-start gap-3 border border-[var(--border)] p-3 text-sm"
          style={{ background: "var(--good-wash)" }}
        >
          <IconCheck className="mt-0.5 h-4 w-4 flex-none text-[var(--good)]" />
          <p className="text-[var(--text-primary)]">{state.message}</p>
        </div>
      )}

      {state.status === "error" && (
        <div
          role="alert"
          className="flex items-start gap-3 border border-[var(--border)] p-3 text-sm"
          style={{ background: "var(--critical-wash)" }}
        >
          <IconCross className="mt-0.5 h-4 w-4 flex-none text-[var(--critical)]" />
          <p className="text-[var(--text-primary)]">{state.message}</p>
        </div>
      )}
    </form>
  );
}
