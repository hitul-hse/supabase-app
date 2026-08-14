"use client";

import { useTransition, useState } from "react";
import { toggleRolePermission } from "./actions";

interface Props {
  roleKey: string;
  permissionKey: string;
  initialGranted: boolean;
  canEdit: boolean;
}

/**
 * Single toggle cell in the permission matrix. Optimistic update: flips
 * immediately and reverts on server error to avoid a stale-looking UI.
 */
export function PermissionToggle({ roleKey, permissionKey, initialGranted, canEdit }: Props) {
  const [granted, setGranted] = useState(initialGranted);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleToggle() {
    if (!canEdit || isPending) return;
    const next = !granted;
    setGranted(next);
    setError(null);
    startTransition(async () => {
      const result = await toggleRolePermission(roleKey, permissionKey, next);
      if (result.error) {
        setGranted(!next); // revert
        setError(result.error);
      }
    });
  }

  return (
    <button
      onClick={handleToggle}
      disabled={!canEdit || isPending}
      title={error ?? (granted ? "Revoke" : "Grant")}
      className={`h-5 w-5 flex-none rounded-[3px] border transition-all ${
        isPending
          ? "border-[var(--border)] bg-[var(--border)] opacity-60"
          : granted
          ? "border-[var(--accent)] bg-[var(--accent)]"
          : "border-[var(--border)] bg-transparent hover:border-[var(--accent)]"
      } ${!canEdit ? "cursor-not-allowed opacity-40" : "cursor-pointer"}`}
      aria-label={`${granted ? "Revoke" : "Grant"} ${permissionKey} for ${roleKey}`}
      aria-pressed={granted}
    >
      {granted && (
        <svg viewBox="0 0 10 10" className="h-full w-full p-[2px]" aria-hidden>
          <path d="M1.5 5l2.5 2.5 4.5-4.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}
