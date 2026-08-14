"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import {
  AuthShell,
  AuthHeading,
  AuthNotice,
  authButtonClass,
  authInputClass,
  authLabelClass,
} from "@/components/AuthShell";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirect_to") || "/";
  // /auth/callback sends failures back here with a readable reason.
  const linkError = searchParams.get("error");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const supabase = createClient();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const result = await supabase.auth.signInWithPassword({ email, password });

      if (result.error) {
        setError(result.error.message);
      } else {
        router.push(redirectTo);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "An error occurred. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <AuthHeading eyebrow="HSE HUB / ACCESS" title="Log in" />

      {(error || linkError) && <AuthNotice tone="error">{error ?? linkError}</AuthNotice>}

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
            disabled={loading}
            className={authInputClass}
            placeholder="you@hs-experts.com"
          />
        </div>

        <div>
          <div className="mb-1.5 flex items-baseline justify-between">
            <label htmlFor="password" className="text-sm font-medium text-[var(--text-primary)]">
              Password
            </label>
            <Link
              href="/auth/forgot-password"
              className="text-[12px] text-[var(--accent)] hover:underline"
            >
              Forgot password?
            </Link>
          </div>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={loading}
            className={authInputClass}
            placeholder="••••••••"
          />
        </div>

        <button type="submit" disabled={loading} className={authButtonClass}>
          {loading ? "Logging in..." : "Log in"}
        </button>
      </form>

      <div className="mt-6 border-t border-[var(--border)] pt-6">
        <p className="text-sm text-[var(--text-secondary)]">
          Accounts are created by an administrator. Contact yours if you need access.
        </p>
      </div>
    </>
  );
}

export default function LoginPage() {
  return (
    <AuthShell>
      <Suspense
        fallback={<p className="font-mono text-sm text-[var(--text-muted)]">Loading…</p>}
      >
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
