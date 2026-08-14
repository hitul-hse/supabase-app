"use client";

import { Suspense, useEffect, useState } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/utils/supabase/client";

/** A real connectivity check, not a fabricated status line — mirrors the
 * dot+label convention SyncBar uses for sync_sources. */
function ConnectionStatus() {
  const [status, setStatus] = useState<"checking" | "ok" | "error">("checking");

  useEffect(() => {
    let active = true;
    const supabase = createClient();
    supabase.auth
      .getSession()
      .then(({ error }) => {
        if (active) setStatus(error ? "error" : "ok");
      })
      .catch(() => {
        if (active) setStatus("error");
      });
    return () => {
      active = false;
    };
  }, []);

  const color =
    status === "ok" ? "var(--good)" : status === "error" ? "var(--critical)" : "var(--warning)";
  const label = status === "ok" ? "CONNECTED" : status === "error" ? "UNREACHABLE" : "CHECKING";

  return (
    <div className="flex items-center gap-2 font-mono text-[10.5px] text-[var(--text-faint)]">
      <span aria-hidden className="h-1.5 w-1.5 flex-none" style={{ background: color }} />
      SUPABASE · {label}
    </div>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirect_to") || "/";

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
    <div className="w-full max-w-sm">
      {/* Compact brand mark, mobile only — the desktop identity panel covers this */}
      <div className="mb-8 flex items-center gap-2.5 lg:hidden">
        <div className="relative h-7 w-7 flex-none overflow-hidden rounded-[var(--radius-sm)]">
          <Image src="/hse-logo.png" alt="HSE Logo" width={28} height={28} className="h-full w-full object-contain" />
        </div>
        <span className="font-sans text-[13px] font-bold tracking-[0.02em] text-[var(--text-primary)]">
          HSE HUB
        </span>
      </div>

      <span className="mb-2 block font-mono text-[10px] tracking-[0.14em] text-[var(--text-faint)]">
        HSE HUB / ACCESS
      </span>
      <h1 className="mb-6 text-[26px] font-semibold text-[var(--text-primary)]">Log in</h1>

      {error && (
        <div
          className="mb-4 flex items-start gap-3 border border-[var(--border)] p-3 text-sm"
          style={{ background: "var(--critical-wash)" }}
        >
          <span aria-hidden className="mt-0.5 text-[var(--critical)]">
            ✕
          </span>
          <p className="text-[var(--text-primary)]">{error}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-[var(--text-primary)]">
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={loading}
            className="w-full border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] disabled:opacity-50"
            placeholder="you@hs-experts.com"
          />
        </div>

        <div>
          <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-[var(--text-primary)]">
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={loading}
            className="w-full border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] disabled:opacity-50"
            placeholder="••••••••"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-contrast)] transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-50"
        >
          {loading ? "Logging in..." : "Log in"}
        </button>
      </form>

      <div className="mt-6 border-t border-[var(--border)] pt-6">
        <p className="text-sm text-[var(--text-secondary)]">
          Accounts are created by an administrator. Contact yours if you need access.
        </p>
      </div>

      <div className="mt-6 lg:hidden">
        <ConnectionStatus />
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen bg-[var(--page)]">
      {/* Identity panel — desktop only. The right-edge seam is the one
          deliberate flourish on this page: an abstracted hazard-stripe,
          in the brand mint rather than literal yellow/black, marking the
          threshold into the app. */}
      <div className="relative hidden w-[42%] flex-none flex-col justify-between overflow-hidden bg-[var(--sidebar)] p-12 lg:flex">
        <div>
          <div className="flex items-center gap-3">
            <div className="relative h-8 w-8 flex-none overflow-hidden rounded-[var(--radius-sm)]">
              <Image
                src="/hse-logo.png"
                alt="HSE Logo"
                width={32}
                height={32}
                className="h-full w-full object-contain"
                priority
              />
            </div>
            <div className="flex flex-col leading-[1.15]">
              <span className="font-sans text-[15px] font-bold tracking-[0.02em] text-[var(--text-primary)]">
                HSE HUB
              </span>
              <span className="font-mono text-[9px] tracking-[0.14em] text-[var(--text-faint)]">
                HEALTH &amp; SAFETY EXPERTS
              </span>
            </div>
          </div>

          <p className="mt-12 max-w-[280px] text-[15px] leading-relaxed text-[var(--text-secondary)]">
            Projects, timesheets, people, and compliance — in one operational
            view.
          </p>
        </div>

        <ConnectionStatus />

        <div
          aria-hidden
          className="absolute inset-y-0 right-0 w-[3px]"
          style={{
            background:
              "repeating-linear-gradient(-45deg, var(--accent) 0 6px, var(--sidebar) 6px 12px)",
          }}
        />
      </div>

      {/* Form panel */}
      <div className="flex flex-1 items-center justify-center p-6">
        <Suspense fallback={<div className="font-mono text-sm text-[var(--text-muted)]">Loading...</div>}>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
