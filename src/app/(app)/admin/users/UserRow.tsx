"use client";

import { useTransition, useState } from "react";
import { setUserActive, changeUserRole, changeUserDepartment, resendInvite, deleteUser } from "./actions";
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
  /**
   * Whether this person has ever signed in. Drives whether RE-INVITE is offered at
   * all: sending an unrequested password link to somebody who signs in daily looks
   * like a phishing attempt, and they can reset their own password anyway.
   *
   * Null when the service-role client is unavailable, in which case the page cannot
   * know -- so the control is hidden rather than shown on a guess.
   */
  hasSignedIn: boolean | null;
}

/**
 * Interactive user row in the admin user list. Shows as a full table row on
 * desktop (sm+) and as a compact card on mobile. Inline role/team edits, the
 * activate/deactivate toggle, re-invite, and removal — no page reload needed.
 */
export function UserRow({
  userId, email, roleKey, roleDisplayName, department, personName,
  isActive, createdAt, roles, canEdit, hasSignedIn,
}: Props) {
  const [isPending, startTransition] = useTransition();
  const [localActive, setLocalActive] = useState(isActive);
  const [localRole, setLocalRole] = useState(roleKey);
  const [localDept, setLocalDept] = useState(department ?? "");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /**
   * A one-time sign-in link, shown only when the email could not be sent.
   *
   * Supabase's mail limiter is shared across every mail the project sends, so a
   * re-invite is sometimes refused for a minute. The action returns the link in that
   * case so the admin can pass it on by hand instead of hitting a dead end. Held in
   * state rather than rendered from the message so it can be selected on its own.
   */
  const [fallbackLink, setFallbackLink] = useState<string | null>(null);
  /** Momentary confirmation that the copy landed, so the click has an outcome. */
  const [copied, setCopied] = useState(false);
  /**
   * Two-step delete, in the row itself rather than a window.confirm().
   *
   * confirm() is blocked in some embedded browsers and reads as a browser alert
   * rather than part of the app, which is the wrong tone for the one irreversible
   * action on this page. Inline also lets the warning name what is kept -- their
   * TrackingTime hours -- which is the fact that decides whether to go ahead.
   */
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleted, setDeleted] = useState(false);

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

  function handleResend() {
    setError(null);
    setNotice(null);
    setFallbackLink(null);
    startTransition(async () => {
      const res = await resendInvite(userId);
      if (res.error) setError(res.error);
      else {
        setNotice(res.message ?? "Invite re-sent.");
        // Present when the mail was refused. Rendered below so the admin can copy it.
        if (res.link) setFallbackLink(res.link);
      }
    });
  }

  function handleDelete() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await deleteUser(userId);
      if (res.error) {
        setError(res.error);
        setConfirmingDelete(false);
      } else {
        // The row stays mounted until the server component re-renders without it.
        // Marking it removed avoids a moment where a deleted account still looks
        // editable, which would invite a second click and a confusing error.
        setDeleted(true);
        setNotice(res.message ?? "Account removed.");
      }
    });
  }

  const currentRole = roles.find(r => r.role_key === localRole);
  const opacity = isPending || !localActive || deleted ? "opacity-60" : "";

  const roleSelect = canEdit && !deleted ? (
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

  const deptInput = canEdit && !deleted ? (
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

  const statusToggle = canEdit && !deleted ? (
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
      {deleted ? "REMOVED" : localActive ? "ACTIVE" : "INACTIVE"}
    </span>
  );

  /*
   * RE-INVITE, only where it means something.
   *
   * Shown when the account has never been used. Most of the 19 provisioned accounts
   * are in that state, and before this there was no way to reach those people from
   * the console at all: the invite form calls inviteUserByEmail, which fails outright
   * on an address that already has an account.
   *
   * Hidden when hasSignedIn is null, which means the service-role client is missing
   * and the page cannot tell. Offering it then would send password links to people who
   * did not ask, on a guess.
   */
  const showResend = canEdit && !deleted && hasSignedIn === false;

  const actionButtons = (
    <div className="flex flex-wrap items-center gap-1.5">
      {showResend && (
        <button
          onClick={handleResend}
          disabled={isPending}
          aria-label={`Re-send the invite to ${email}`}
          title="This account has never been used. Sends a fresh link to set a password."
          className="rounded-[var(--radius-sm)] border border-[var(--border)] px-2 py-0.5 font-mono text-[9.5px] font-semibold tracking-[0.06em] text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:cursor-not-allowed pointer-coarse:min-h-[32px] pointer-coarse:px-3"
        >
          RE-INVITE
        </button>
      )}

      {canEdit && !deleted && !confirmingDelete && (
        <button
          onClick={() => { setConfirmingDelete(true); setError(null); setNotice(null); }}
          disabled={isPending}
          aria-label={`Remove ${email} from the Hub`}
          className="rounded-[var(--radius-sm)] border border-[var(--border)] px-2 py-0.5 font-mono text-[9.5px] font-semibold tracking-[0.06em] text-[var(--text-muted)] transition-colors hover:border-[var(--critical)] hover:text-[var(--critical)] disabled:cursor-not-allowed pointer-coarse:min-h-[32px] pointer-coarse:px-3"
        >
          REMOVE
        </button>
      )}

      {confirmingDelete && !deleted && (
        // The warning states what survives. Someone hesitating over this button is
        // usually worried about destroying work history, and that is exactly what is
        // NOT destroyed -- so saying it is what lets them decide.
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10.5px] text-[var(--text-secondary)]">
            Delete sign-in? Their tracked hours are kept. Deactivating is reversible;
            this is not.
          </span>
          <button
            onClick={handleDelete}
            disabled={isPending}
            aria-label={`Confirm removing ${email}`}
            className="rounded-[var(--radius-sm)] border border-[var(--critical)] px-2 py-0.5 font-mono text-[9.5px] font-semibold tracking-[0.06em] text-[var(--critical)] transition-colors hover:bg-[var(--warning-wash)] disabled:cursor-not-allowed pointer-coarse:min-h-[32px] pointer-coarse:px-3"
          >
            {isPending ? "REMOVING…" : "CONFIRM"}
          </button>
          <button
            onClick={() => setConfirmingDelete(false)}
            disabled={isPending}
            className="rounded-[var(--radius-sm)] px-2 py-0.5 font-mono text-[9.5px] tracking-[0.06em] text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)] disabled:cursor-not-allowed pointer-coarse:min-h-[32px]"
          >
            CANCEL
          </button>
        </span>
      )}
    </div>
  );

  const feedback = (error || notice || fallbackLink) && (
    <span className="flex flex-col items-start gap-1 sm:items-end">
      {(error || notice) && (
        <span
          role={error ? "alert" : "status"}
          className={`text-[10px] ${error ? "text-[var(--critical)]" : "text-[var(--accent)]"}`}
        >
          {error ?? notice}
        </span>
      )}
      {fallbackLink && (
        /*
         * A copyable field, sized to be used rather than tucked away.
         *
         * This is not a rare error path: sending is rate-limited project-wide on
         * Supabase's built-in SMTP, so handing over this link is the normal way a
         * colleague gets in until custom SMTP is configured. It needs a label saying
         * what it is, a field wide enough to see it, and one-click copying.
         *
         * An input rather than a bare <a>: the link has to be pasted into a message to
         * a person, and a link you can only click is the one thing that does not help.
         */
        <span className="flex w-full flex-col gap-1 sm:items-end">
          <span className="font-mono text-[9px] tracking-[0.06em] text-[var(--text-faint)]">
            ONE-TIME SIGN-IN LINK — SEND THIS TO THEM
          </span>
          <span className="flex w-full items-center gap-1">
            <input
              readOnly
              value={fallbackLink}
              // Select the whole URL on focus, so click-then-Ctrl+C is enough and a
              // partial selection cannot produce a broken link.
              onFocus={(e) => e.currentTarget.select()}
              onClick={(e) => e.currentTarget.select()}
              aria-label={`One-time sign-in link for ${email}`}
              className="min-w-0 flex-1 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 font-mono text-[10px] text-[var(--text-secondary)]"
            />
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(fallbackLink);
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 2000);
                } catch {
                  // Clipboard access can be refused (insecure context, permissions).
                  // The field beside this is still selectable, so say what to do rather
                  // than failing silently.
                  setCopied(false);
                  setError("Could not reach the clipboard — select the link and copy it manually.");
                }
              }}
              className="flex-none rounded-[var(--radius-sm)] border border-[var(--border)] px-2 py-1 font-mono text-[9.5px] font-semibold tracking-[0.06em] text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
            >
              {copied ? "COPIED" : "COPY"}
            </button>
          </span>
        </span>
      )}
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
              {hasSignedIn === false ? " · NEVER SIGNED IN" : ""}
            </span>
          </div>
          {statusToggle}
        </div>

        {feedback}

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

        {canEdit && actionButtons}
      </div>

      {/* Desktop table row — shown from sm up */}
      <div
        className={`hidden grid-cols-12 items-center gap-3 border-b border-[var(--divider)] px-4 py-2.5 text-[12.5px] transition-opacity sm:grid ${opacity}`}
      >
        <span className="col-span-3 flex min-w-0 flex-col">
          <span className="truncate text-[var(--text-primary)]">{email || "—"}</span>
          {/* Stated on the row rather than only implied by the RE-INVITE button:
              "never signed in" is the reason the button is there, and an admin
              scanning the list wants to see who is still outside. */}
          {hasSignedIn === false && (
            <span className="font-mono text-[9px] tracking-[0.06em] text-[var(--text-faint)]">
              NEVER SIGNED IN
            </span>
          )}
        </span>

        <span className="col-span-2">{roleSelect}</span>
        <span className="col-span-2">{deptInput}</span>
        <span className="col-span-1 text-[var(--text-secondary)] truncate">{personName ?? "—"}</span>
        <span className="col-span-1">{statusToggle}</span>

        <span className="col-span-3 flex flex-col items-end gap-1 text-right font-mono text-[11px] text-[var(--text-muted)]">
          {/* The message itself, not "Error" behind a title= tooltip: a failed
              permission change is exactly the case where the reason matters,
              and title is unreachable by keyboard and on touch. */}
          {feedback}
          {canEdit ? actionButtons : new Date(createdAt).toLocaleDateString("de-DE")}
        </span>
      </div>
    </>
  );
}
