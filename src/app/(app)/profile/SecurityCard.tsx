"use client";

import { useActionState, useState } from "react";
import { Card, CardHeader, CardDivider } from "@/components/ui/Card";
import { MIN_PASSWORD_LENGTH } from "@/lib/password-strength";
import { PasswordStrengthBar } from "@/components/PasswordStrengthBar";
import { changePassword } from "./actions";
import type { ProfileActionState } from "./constants";

const IDLE: ProfileActionState = { status: "idle" };

const inputClass =
  "w-full border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]";
const labelClass = "font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-faint)]";

export function SecurityCard() {
  const [state, action, pending] = useActionState(changePassword, IDLE);
  const [next, setNext] = useState("");

  return (
    // Security is a top-level profile section: password change form.
    // Qualifier carries the "current password required" note at header level
    // so readers see it before reaching the form fields.
    <Card>
      <CardHeader title="Security" qualifier="YOUR CURRENT PASSWORD IS REQUIRED" />
      <CardDivider />
      <div className="p-5">

      <form action={action} className="flex max-w-sm flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="current_password" className={labelClass}>
            Current password
          </label>
          <input
            id="current_password"
            name="current_password"
            type="password"
            autoComplete="current-password"
            required
            className={inputClass}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="new_password" className={labelClass}>
            New password
          </label>
          <input
            id="new_password"
            name="new_password"
            type="password"
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            value={next}
            onChange={(e) => setNext(e.target.value)}
            className={inputClass}
          />
          <PasswordStrengthBar password={next} />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="confirm_password" className={labelClass}>
            Confirm new password
          </label>
          <input
            id="confirm_password"
            name="confirm_password"
            type="password"
            autoComplete="new-password"
            required
            className={inputClass}
          />
        </div>

        <button
          type="submit"
          disabled={pending}
          className="self-start border border-[var(--border-strong)] px-3 py-1.5 text-[12px] text-[var(--text-primary)] hover:bg-[var(--surface-hover)] disabled:opacity-50"
        >
          {pending ? "Changing…" : "Change password"}
        </button>

        {state.message && (
          <p
            className="text-[12px]"
            style={{ color: state.status === "error" ? "var(--critical)" : "var(--good)" }}
          >
            {state.message}
          </p>
        )}
      </form>
      </div>
    </Card>
  );
}
