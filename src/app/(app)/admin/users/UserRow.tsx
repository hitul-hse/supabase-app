"use client";

import { useTransition, useState } from "react";
import { setUserActive, changeUserRole, changeUserDepartment } from "./actions";
import { teamLabel, teamOptionsFor } from "@/lib/teams";
import type { AppRoleRow } from "./page";

interface Props {
  userId: string;
  email: string;
  roleKey: string;
  roleDisplayName: string;
  department: string | null;
  personName: string | null;
  isActive: boolean;
  createdAt: string;
  roles: AppRoleRow[];
  canEdit: boolean;
}

/**
 * Interactive user row in the admin user list. Shows as a full table row on
 * desktop (sm+) and as a compact card on mobile. Inline role/department edits
 * and activate/deactivate toggle — no page reload needed.
 */
export function UserRow({
  userId, email, roleKey, roleDisplayName, department, personName,
  isActive, createdAt, roles, canEdit,
}: Props) {
  const [isPending, startTransition] = useTransition();
  const [localActive, setLocalActive] = useState(isActive);
  const [localRole, setLocalRole] = useState(roleKey);
  const [localDept, setLocalDept] = useState(department ?? "");
  const [error, setError] = useState<string | null>(null);

  function handleToggleActive() {
    const next = !localActive;
    setLocalActive(next);
    startTransition(async () => {
      const res = await setUserActive(userId, next);
      if (res.error) { setLocalActive(!next); setError(res.error); }
    });
  }

  function handleRoleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value;
    setLocalRole(next);
    startTransition(async () => {
      const res = await changeUserRole(userId, next);
      if (res.error) { setLocalRole(roleKey); setError(res.error); }
    });
  }

  /**
   * Save the team as soon as one is picked.
   *
   * Not onBlur, which is what the free-text version did. On a select, choosing an
   * option and then clicking away are two separate actions, and someone who picks
   * "Tech" and navigates on would reasonably believe it saved. On change there is
   * exactly one gesture and one outcome.
   */
  function handleTeamChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value;
    const previous = localDept;
    setLocalDept(next);
    startTransition(async () => {
      const res = await changeUserDepartment(userId, next);
      if (res.error) { setLocalDept(previous); setError(res.error); }
    });
  }

  const currentRole = roles.find(r => r.role_key === localRole);
  const opacity = isPending || !localActive ? "opacity-60" : "";

  const roleSelect = canEdit ? (
    <select
      value={localRole}
      onChange={handleRoleChange}
      disabled={isPending}
      aria-label={`Role for ${email}`}
      // No focus:outline-none. This control changes someone's permissions, so
      // it is the last place to make the keyboard focus position invisible.
      className="w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-[11.5px] text-[var(--text-primary)] transition-colors hover:border-[var(--text-faint)] focus:border-[var(--accent)] disabled:cursor-not-allowed"
    >
      {roles.map(r => (
        <option key={r.role_key} value={r.role_key}>{r.display_name}</option>
      ))}
    </select>
  ) : (
    <span className="text-[var(--text-secondary)]">{currentRole?.display_name ?? roleDisplayName}</span>
  );

  const deptInput = canEdit ? (
    <select
      value={localDept}
      onChange={handleTeamChange}
      disabled={isPending}
      aria-label={`Team for ${email}`}
      // No focus:outline-none, same reasoning as the role select above: this is a
      // control someone operates by keyboard and the focus ring must stay visible.
      className="w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-[11.5px] text-[var(--text-primary)] transition-colors hover:border-[var(--text-faint)] focus:border-[var(--accent)] disabled:cursor-not-allowed"
    >
      <option value="">— None —</option>
      {/* teamOptionsFor appends a legacy value when one is stored, so a person on
          the old ENG/SAFETY labels renders as themselves rather than silently
          showing the first option and overwriting on the next save. */}
      {teamOptionsFor(localDept).map((t) => (
        <option key={t.value} value={t.value}>{t.label}</option>
      ))}
    </select>
  ) : (
    <span className="text-[var(--text-secondary)]">{teamLabel(department)}</span>
  );

  const statusToggle = canEdit ? (
    <button
      onClick={handleToggleActive}
      disabled={isPending}
      // aria-pressed, not just colour: "ACTIVE" styled two ways is the same
      // word twice to a screen reader, so the state has to be in the semantics.
      aria-pressed={localActive}
      aria-label={`${localActive ? "Deactivate" : "Activate"} ${email}`}
      className={`rounded-[var(--radius-sm)] px-2 py-0.5 font-mono text-[10px] font-semibold transition-colors active:translate-y-px disabled:cursor-not-allowed pointer-coarse:min-h-[32px] pointer-coarse:px-3 ${
        localActive
          ? "bg-[var(--accent)] text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)]"
          : "border border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
      }`}
    >
      {localActive ? "ACTIVE" : "INACTIVE"}
    </button>
  ) : (
    <span className={localActive ? "text-[var(--accent)]" : "text-[var(--text-muted)]"}>
      {localActive ? "ACTIVE" : "INACTIVE"}
    </span>
  );

  return (
    <>
      {/* Mobile card — shown below sm */}
      <div
        className={`flex flex-col gap-3 border-b border-[var(--divider)] p-4 transition-opacity sm:hidden ${opacity}`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-[13px] font-medium text-[var(--text-primary)] truncate">
              {email || "—"}
            </span>
            <span className="font-mono text-[10px] text-[var(--text-muted)]">
              {new Date(createdAt).toLocaleDateString("de-DE")}
              {personName ? ` · ${personName}` : ""}
            </span>
          </div>
          {statusToggle}
        </div>

        {error && (
          <span role="alert" className="font-mono text-[10px] text-[var(--critical)]">
            {error}
          </span>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <span className="font-mono text-[9.5px] tracking-[0.1em] text-[var(--text-faint)]">ROLE</span>
            {roleSelect}
          </div>
          <div className="flex flex-col gap-1">
            <span className="font-mono text-[9.5px] tracking-[0.1em] text-[var(--text-faint)]">TEAM</span>
            {deptInput}
          </div>
        </div>
      </div>

      {/* Desktop table row — shown from sm up */}
      <div
        className={`hidden grid-cols-12 items-center gap-3 border-b border-[var(--divider)] px-4 py-2.5 text-[12.5px] transition-opacity sm:grid ${opacity}`}
      >
        <span className="col-span-3 truncate text-[var(--text-primary)]">{email || "—"}</span>

        <span className="col-span-2">{roleSelect}</span>
        <span className="col-span-2">{deptInput}</span>
        <span className="col-span-2 text-[var(--text-secondary)]">{personName ?? "—"}</span>
        <span className="col-span-1">{statusToggle}</span>

        <span className="col-span-2 text-right font-mono text-[11px] text-[var(--text-muted)]">
          {error ? (
            // The message itself, not "Error" behind a title= tooltip: a failed
            // permission change is exactly the case where the reason matters,
            // and title is unreachable by keyboard and on touch.
            <span role="alert" className="text-[10px] text-[var(--critical)]">
              {error}
            </span>
          ) : (
            new Date(createdAt).toLocaleDateString("de-DE")
          )}
        </span>
      </div>
    </>
  );
}
