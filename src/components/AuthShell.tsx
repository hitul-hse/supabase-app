"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { IconCheck, IconCross } from "@/components/nav-icons";
import { BrandMark } from "@/components/BrandMark";

/** A real connectivity check, not a decorative status line — mirrors the
 * dot+label convention SyncBar uses for sync_sources inside the app. */
function ConnectionStatus() {
  const [status, setStatus] = useState<"checking" | "ok" | "error">("checking");

  useEffect(() => {
    let active = true;
    createClient()
      .auth.getSession()
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

/**
 * Shared frame for every unauthenticated page. The right-edge seam on the
 * identity panel is the one deliberate flourish: an abstracted hazard stripe
 * in the brand mint rather than literal yellow-and-black, marking the
 * threshold into the app.
 */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-[var(--page)]">
      <div className="relative hidden w-[42%] flex-none flex-col justify-between overflow-hidden bg-[var(--sidebar)] p-12 lg:flex">
        <div>
          <div className="flex items-center gap-3">
            {/*
              The one place the mark animates: signing in is a rare, first-time
              moment and a real threshold into the app. Decorative — the wordmark
              beside it already says HSE HUB, so a second announcement of "HSE
              Logo" would be noise.
            */}
            <BrandMark size={32} animate className="flex-none" />
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

      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-sm">
          {/* Compact brand mark, mobile only — the identity panel covers this
              at lg and above. */}
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <BrandMark size={28} animate className="flex-none" />
            <span className="font-sans text-[13px] font-bold tracking-[0.02em] text-[var(--text-primary)]">
              HSE HUB
            </span>
          </div>

          {children}

          <div className="mt-8 lg:hidden">
            <ConnectionStatus />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Eyebrow + heading, so every auth page announces itself the same way. */
export function AuthHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <>
      <span className="mb-2 block font-mono text-[10px] tracking-[0.14em] text-[var(--text-faint)]">
        {eyebrow}
      </span>
      <h1 className="mb-6 text-[26px] font-semibold text-[var(--text-primary)]">{title}</h1>
    </>
  );
}

export function AuthNotice({ tone, children }: { tone: "error" | "success"; children: React.ReactNode }) {
  const Glyph = tone === "error" ? IconCross : IconCheck;
  return (
    <div
      // role="alert" so a failed sign-in is announced rather than silently
      // appearing above a form the user is about to retry blind.
      role="alert"
      className="mb-4 flex items-start gap-3 border border-[var(--border)] p-3 text-sm"
      style={{ background: tone === "error" ? "var(--critical-wash)" : "var(--good-wash)" }}
    >
      <Glyph
        className={`mt-0.5 h-4 w-4 flex-none ${
          tone === "error" ? "text-[var(--critical)]" : "text-[var(--good)]"
        }`}
      />
      <p className="text-[var(--text-primary)]">{children}</p>
    </div>
  );
}

// No `outline-none`: this class is shared by every auth field, so removing the
// ring here would have made the entire sign-in flow unnavigable by keyboard —
// the one flow where a user cannot fall back to a mouse-driven workaround
// because they have not got into the app yet.
export const authInputClass =
  "w-full border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text-primary)] transition-colors placeholder:text-[var(--text-muted)] hover:border-[var(--text-faint)] focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60";

export const authButtonClass =
  "w-full rounded-[var(--radius-sm)] bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-contrast)] transition-colors hover:bg-[var(--accent-hover)] active:translate-y-px disabled:cursor-not-allowed disabled:bg-[var(--surface-2)] disabled:text-[var(--text-faint)] disabled:active:translate-y-0";

export const authLabelClass =
  "mb-1.5 block text-sm font-medium text-[var(--text-primary)]";
