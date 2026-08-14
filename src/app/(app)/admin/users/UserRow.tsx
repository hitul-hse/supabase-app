"use client";

import { useTransition, useState } from "react";
import { setUserActive, changeUserRole, changeUserDepartment } from "./actions";
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
 * Interactive user row in the admin user list. Inline role/department edits
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

  function handleDeptBlur() {
    startTransition(async () => {
      const res = await changeUserDepartment(userId, localDept);
      if (res.error) { setLocalDept(department ?? ""); setError(res.error); }
    });
  }

  const currentRole = roles.find(r => r.role_key === localRole);

  return (
    <div
      className={`grid grid-cols-12 items-center gap-3 border-b border-[#3a414c] px-4 py-2.5 text-[12.5px] transition-opacity ${
        isPending ? "opacity-60" : ""
      } ${!localActive ? "opacity-50" : ""}`}
    >
      {/* Email */}
      <span className="col-span-3 truncate text-[var(--text-primary)]">{email || "—"}</span>

      {/* Role — inline select for execs */}
      <span className="col-span-2">
        {canEdit ? (
          <select
            value={localRole}
            onChange={handleRoleChange}
            disabled={isPending}
            className="w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-[11.5px] text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
          >
            {roles.map(r => (
              <option key={r.role_key} value={r.role_key}>{r.display_name}</option>
            ))}
          </select>
        ) : (
          <span className="text-[var(--text-secondary)]">{currentRole?.display_name ?? roleDisplayName}</span>
        )}
      </span>

      {/* Department — inline text input for execs */}
      <span className="col-span-2">
        {canEdit ? (
          <input
            type="text"
            value={localDept}
            onChange={e => setLocalDept(e.target.value)}
            onBlur={handleDeptBlur}
            placeholder="—"
            disabled={isPending}
            className="w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-[11.5px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
          />
        ) : (
          <span className="text-[var(--text-secondary)]">{department ?? "—"}</span>
        )}
      </span>

      {/* Person */}
      <span className="col-span-2 text-[var(--text-secondary)]">{personName ?? "—"}</span>

      {/* Status toggle */}
      <span className="col-span-1">
        {canEdit ? (
          <button
            onClick={handleToggleActive}
            disabled={isPending}
            className={`px-2 py-0.5 font-mono text-[10px] font-semibold transition-colors ${
              localActive
                ? "bg-[var(--accent)] text-[var(--accent-contrast)] hover:opacity-80"
                : "border border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
            }`}
          >
            {localActive ? "ACTIVE" : "INACTIVE"}
          </button>
        ) : (
          <span className={localActive ? "text-[var(--accent)]" : "text-[var(--text-muted)]"}>
            {localActive ? "ACTIVE" : "INACTIVE"}
          </span>
        )}
      </span>

      {/* Since */}
      <span className="col-span-2 text-right font-mono text-[11px] text-[var(--text-muted)]">
        {error ? (
          <span className="text-[var(--critical)] text-[10px]" title={error}>Error</span>
        ) : (
          new Date(createdAt).toLocaleDateString("de-DE")
        )}
      </span>
    </div>
  );
}
