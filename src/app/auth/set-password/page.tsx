"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import {
  AuthShell,
  AuthHeading,
  AuthNotice,
  authButtonClass,
  authInputClass,
  authLabelClass,
} from "@/components/AuthShell";

const MIN_PASSWORD_LENGTH = 8;

/** 0-4 password strength score based on length, digits, uppercase, and symbols. */
function getPasswordStrength(pwd: string): { score: number; label: string; color: string } {
  if (!pwd) return { score: 0, label: "", color: "" };
  let score = 0;
  if (pwd.length >= 8) score++;
  if (pwd.length >= 14) score++;
  if (/[0-9]/.test(pwd)) score++;
  if (/[A-Z]/.test(pwd)) score++;
  if (/[^A-Za-z0-9]/.test(pwd)) score++;
  const clamp = Math.min(score, 4);
  const labels = ["Weak", "Fair", "Good", "Strong", "Very strong"];
  const colors = ["var(--critical)", "var(--warning)", "var(--warning)", "var(--good)", "var(--good)"];
  return { score: clamp, label: labels[clamp], color: colors[clamp] };
}

function PasswordStrengthBar({ password }: { password: string }) {
  const { score, label, color } = getPasswordStrength(password);
  if (!password) return null;
  return (
    <div className="mt-1.5 flex flex-col gap-1">
      <div className="flex gap-1">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-1 flex-1 rounded-full transition-all"
            style={{ background: i <= score ? color : "var(--border)" }}
          />
        ))}
      </div>
      <span className="font-mono text-[10px]" style={{ color }}>
        {label}
      </span>
    </div>
  );
}

/**
 * Where an invited colleague finishes creating their account, and where a
 * password reset lands. Both cases are the same job: there is a valid session
 * from the email link, but no usable password yet.
 *
 * The session can arrive two ways. /auth/callback handles the server-visible
 * shapes and forwards here already signed in. Implicit flow instead puts the
 * tokens in the URL fragment, which never reaches the server — the browser
 * client picks those up itself (detectSessionInUrl), so this page waits for a
 * session rather than assuming one is already there.
 */
function SetPasswordForm() {
  const router = useRouter();
  const [supabase] = useState(() => createClient());

  const [sessionState, setSessionState] = useState<"waiting" | "ready" | "missing">("waiting");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function establishSession() {
      // Take the tokens out of the fragment ourselves rather than relying on
      // the client's implicit URL detection, which does not fire for a
      // client-side navigation into this page (the rescue path from /login).
      const hash = window.location.hash;
      if (hash) {
        const params = new URLSearchParams(hash.slice(1));
        const access_token = params.get("access_token");
        const refresh_token = params.get("refresh_token");

        if (access_token && refresh_token) {
          const { error: sessionError } = await supabase.auth.setSession({
            access_token,
            refresh_token,
          });
          // Drop the tokens from the address bar either way — they should not
          // sit in browser history or get copied out of the URL.
          window.history.replaceState(null, "", window.location.pathname);
          if (!active) return;
          setSessionState(sessionError ? "missing" : "ready");
          return;
        }
      }

      // No fragment: either /auth/callback already signed them in server-side,
      // or the link is spent.
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!active) return;
      setSessionState(session ? "ready" : "missing");
    }

    establishSession();

    return () => {
      active = false;
    };
  }, [supabase]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("Those two passwords don't match.");
      return;
    }

    setSaving(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSaving(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    // refresh() as well as push(): the server components behind "/" were
    // rendered for a visitor with no usable session, so without it the app
    // shell can come back still thinking nobody is signed in.
    router.push("/");
    router.refresh();
  };

  if (sessionState === "missing") {
    return (
      <>
        <AuthHeading eyebrow="HSE HUB / ACCESS" title="Link expired" />
        <AuthNotice tone="error">
          This invite or reset link is no longer valid. Links can only be used once,
          and they expire.
        </AuthNotice>
        <p className="text-sm text-[var(--text-secondary)]">
          Ask an administrator to send a new invite, or{" "}
          <Link href="/auth/forgot-password" className="text-[var(--accent)] hover:underline">
            request a new reset link
          </Link>
          .
        </p>
      </>
    );
  }

  if (sessionState === "waiting") {
    return (
      <>
        <AuthHeading eyebrow="HSE HUB / ACCESS" title="Set your password" />
        <p className="font-mono text-sm text-[var(--text-muted)]">Verifying your link…</p>
      </>
    );
  }

  return (
    <>
      <AuthHeading eyebrow="HSE HUB / ACCESS" title="Set your password" />
      <p className="mb-6 text-sm text-[var(--text-secondary)]">
        Choose a password to finish setting up your account. You&apos;ll use it with
        your email address from now on.
      </p>

      {error && <AuthNotice tone="error">{error}</AuthNotice>}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="password" className={authLabelClass}>
            New password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={MIN_PASSWORD_LENGTH}
            disabled={saving}
            className={authInputClass}
            placeholder="At least 8 characters"
          />
          <PasswordStrengthBar password={password} />
        </div>

        <div>
          <label htmlFor="confirm" className={authLabelClass}>
            Confirm password
          </label>
          <input
            id="confirm"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            disabled={saving}
            className={authInputClass}
            placeholder="••••••••"
          />
        </div>

        <button type="submit" disabled={saving} className={authButtonClass}>
          {saving ? "Saving…" : "Save password and continue"}
        </button>
      </form>
    </>
  );
}

export default function SetPasswordPage() {
  return (
    <AuthShell>
      <Suspense
        fallback={<p className="font-mono text-sm text-[var(--text-muted)]">Loading…</p>}
      >
        <SetPasswordForm />
      </Suspense>
    </AuthShell>
  );
}
