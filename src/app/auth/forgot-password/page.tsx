"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/utils/supabase/client";
import {
  AuthShell,
  AuthHeading,
  AuthNotice,
  authButtonClass,
  authInputClass,
  authLabelClass,
} from "@/components/AuthShell";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSending(true);

    const supabase = createClient();
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      // Same landing page as an invite: both end in "choose a password".
      redirectTo: `${window.location.origin}/auth/callback?next=%2Fauth%2Fset-password`,
    });

    setSending(false);

    if (resetError) {
      setError(resetError.message);
      return;
    }
    setSent(true);
  };

  return (
    <AuthShell>
      <AuthHeading eyebrow="HSE HUB / ACCESS" title="Reset password" />

      {sent ? (
        <>
          <AuthNotice tone="success">
            If an account exists for {email}, a reset link is on its way.
          </AuthNotice>
          <p className="text-sm text-[var(--text-secondary)]">
            The link works once and expires.{" "}
            <Link href="/auth/login" className="text-[var(--accent)] hover:underline">
              Back to log in
            </Link>
          </p>
        </>
      ) : (
        <>
          <p className="mb-6 text-sm text-[var(--text-secondary)]">
            Enter your work email and we&apos;ll send you a link to choose a new
            password.
          </p>

          {error && <AuthNotice tone="error">{error}</AuthNotice>}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className={authLabelClass}>
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={sending}
                className={authInputClass}
                placeholder="you@hs-experts.com"
              />
            </div>

            <button type="submit" disabled={sending} className={authButtonClass}>
              {sending ? "Sending…" : "Send reset link"}
            </button>
          </form>

          <div className="mt-6 border-t border-[var(--border)] pt-6">
            <p className="text-sm text-[var(--text-secondary)]">
              <Link href="/auth/login" className="text-[var(--accent)] hover:underline">
                Back to log in
              </Link>
            </p>
          </div>
        </>
      )}
    </AuthShell>
  );
}
