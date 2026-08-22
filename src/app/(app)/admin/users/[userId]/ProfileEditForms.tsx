"use client";

/**
 * The two profile-level edit forms on /admin/users/[userId].
 *
 * WHY useActionState WITH AN ADAPTER. The actions in profile-actions.ts take a
 * bare FormData, because that is the signature a plain `<form action={fn}>`
 * calls and it is the shape the security gate (scripts/check-profile-admin.mjs)
 * reasons about. useActionState calls its action as (previousState, formData),
 * so a tiny client adapter drops the state argument rather than the action
 * growing a parameter it does not want. The action itself is untouched, and it
 * still re-checks the permission server-side — hiding these forms when the
 * viewer lacks the key is presentation, not the boundary.
 *
 * WHY THE LIVE REGION ROLES ARE STATIC. Two elements with a fixed
 * role="alert" / role="status", never role={error ? "alert" : "status"}. A role
 * that changes after mount is not reliably announced: the assistive tech has
 * already decided what kind of region that node is. This codebase fixed exactly
 * that bug once (see UserRow.tsx) and it is not being reintroduced here.
 */

import { useActionState } from "react";
import { adminUpdateProfile, adminUpdateWeeklyHours } from "../profile-actions";
import type { AdminActionResult } from "../profile-actions";
import { NOMINAL_WEEKLY_HOURS } from "@/lib/queries/profile-admin";
import type { AdminMemberLink, AdminProfileTarget } from "@/lib/queries/profile-admin";
import { teamOptionsFor } from "@/lib/teams";

/** No result yet. `ok: true` with no message renders nothing, which is correct. */
const IDLE: AdminActionResult = { ok: true };

const fieldClass =
  "w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-[13px] text-[var(--text-primary)] transition-colors hover:border-[var(--text-faint)] focus:border-[var(--accent)]";
const labelClass =
  "font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-faint)]";
const buttonClass =
  "self-start rounded-[var(--radius-sm)] border border-[var(--border-strong)] px-3 py-1.5 font-mono text-[11px] font-semibold tracking-[0.06em] text-[var(--text-primary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60 pointer-coarse:min-h-[40px]";

/**
 * The announcement pair.
 *
 * Both roles exist unconditionally as element types; only the message moves
 * between them. Rendering both at once would announce a stale success beside a
 * fresh failure, so the error wins when there is one.
 */
function ActionResult({ result }: { result: AdminActionResult }) {
  const failed = !result.ok && !!result.message;
  const succeeded = result.ok && !!result.message;
  return (
    <>
      <span role="alert" className="text-[12px] text-[var(--critical)]">
        {failed ? result.message : ""}
      </span>
      <span role="status" className="text-[12px] text-[var(--good)]">
        {succeeded ? result.message : ""}
      </span>
    </>
  );
}

/** Display name and team, the two fields this path owns on app_user_profile. */
export function ProfileFieldsForm({ target }: { target: AdminProfileTarget }) {
  const [result, submit, pending] = useActionState(
    (_prev: AdminActionResult, formData: FormData) => adminUpdateProfile(formData),
    IDLE,
  );

  return (
    <form action={submit} className="flex flex-col gap-3">
      {/* The target travels in the form; the action refuses a self-edit and
          re-checks the permission, so a tampered value buys nothing. */}
      <input type="hidden" name="user_id" value={target.userId} />

      <div className="flex flex-col gap-1.5">
        <label htmlFor="admin_display_name" className={labelClass}>
          Display name
        </label>
        <input
          id="admin_display_name"
          name="display_name"
          defaultValue={target.displayName ?? ""}
          maxLength={60}
          // The HR name, shown as the placeholder, is what the app falls back to
          // when this is empty -- so an empty box is a real choice, not a gap.
          placeholder={target.personName ?? "Uses their HR name"}
          className={fieldClass}
        />
        <p className="text-[11px] text-[var(--text-faint)]">
          Leave empty to fall back to their HR name
          {target.personName ? ` (${target.personName})` : " — none on record"}.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="admin_department" className={labelClass}>
          Team
        </label>
        <select
          id="admin_department"
          name="department"
          defaultValue={target.department ?? ""}
          className={fieldClass}
        >
          <option value="">— None —</option>
          {/* teamOptionsFor appends whatever is stored, so somebody on a legacy
              label renders as themselves instead of silently being rewritten to
              the first option on the next save. */}
          {teamOptionsFor(target.department ?? "").map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? "SAVING…" : "SAVE PROFILE"}
      </button>

      <ActionResult result={result} />
    </form>
  );
}

/**
 * Contracted hours per week, on the TrackingTime member row.
 *
 * The highest-value field on this page, and the one that needs explaining: every
 * imported member carries TrackingTime's account-wide 40h default, which is why
 * every utilisation figure in this app is labelled "nominal". The callout says
 * so, because a number that looks already-correct is the reason nobody has
 * fixed it.
 */
export function WeeklyHoursForm({
  member,
  nominalCount,
}: {
  member: AdminMemberLink;
  /** How much of the roster is still on the default, when it could be counted. */
  nominalCount: { nominal: number; total: number } | null;
}) {
  const [result, submit, pending] = useActionState(
    (_prev: AdminActionResult, formData: FormData) => adminUpdateWeeklyHours(formData),
    IDLE,
  );

  return (
    <form action={submit} className="flex flex-col gap-3">
      <input type="hidden" name="member_id" value={member.id} />

      <div className="flex flex-col gap-1.5">
        <label htmlFor="admin_weekly_hours" className={labelClass}>
          Contracted hours per week
        </label>
        <input
          id="admin_weekly_hours"
          name="weekly_hours"
          type="number"
          min={0.5}
          max={80}
          step={0.5}
          defaultValue={member.weeklyHours ?? ""}
          // No value rather than a guess: an empty contract is unknown, and 40
          // typed into the box for them is how the nominal figure became
          // invisible in the first place.
          placeholder="n/a"
          className={`${fieldClass} max-w-[10rem]`}
        />
      </div>

      {/* WHY THIS MATTERS, next to the field rather than in a doc nobody opens. */}
      <div
        className="rounded-[var(--radius-card)] border border-[var(--border)] p-3 text-[11px] leading-relaxed text-[var(--text-secondary)]"
        style={{ background: "var(--warning-wash)" }}
      >
        <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--text-faint)]">
          WHY THIS FIELD MATTERS
        </span>
        <p className="mt-1.5">
          {member.isNominalWeek
            ? `This still reads TrackingTime's account-wide default of ${NOMINAL_WEEKLY_HOURS}h, not a negotiated contract.`
            : "This has been set to a real contracted week."}{" "}
          Utilisation everywhere in the Hub is logged hours divided by this
          number, so until it is real every percentage is labelled
          &ldquo;nominal&rdquo;. Setting it here is what turns those figures into
          something you can act on.
        </p>
        {nominalCount && (
          <p className="mt-1.5 font-mono text-[10px] tracking-[0.06em] text-[var(--text-faint)]">
            {nominalCount.nominal} OF {nominalCount.total} ACTIVE MEMBERS STILL ON
            THE {NOMINAL_WEEKLY_HOURS}H DEFAULT
          </p>
        )}
      </div>

      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? "SAVING…" : "SAVE CONTRACTED HOURS"}
      </button>

      <ActionResult result={result} />
    </form>
  );
}
