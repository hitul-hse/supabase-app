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

    // onAuthStateChange fires once the client has parsed any fragment tokens,
    // so it covers both "already signed in" and "signing in right now".
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active && session) setSessionState("ready");
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!active) return;
      if (session) {
        setSessionState("ready");
      } else {
        // Give the fragment a beat to be parsed before declaring the link dead.
        setTimeout(() => {
          if (active) setSessionState((s) => (s === "ready" ? s : "missing"));
        }, 1500);
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
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

    // Full navigation, not router.push: the server needs to see the refreshed
    // auth cookies to render the app shell for the now-complete account.
    window.location.assign("/");
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
