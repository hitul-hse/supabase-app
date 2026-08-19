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
    /*
      min-h-dvh, NOT min-h-screen.
      `100vh` on mobile Safari/Chrome resolves to the viewport with the URL bar
      HIDDEN, i.e. the largest it ever gets. So a 100vh page is permanently
      taller than what you can actually see, and the layout shifts every time
      the address bar collapses or returns while you scroll. `dvh` tracks the
      real, current viewport. This is the single biggest cause of a sign-in page
      "behaving weirdly" on a phone.

      The two panels are INSET as one rounded card on desktop (matching the
      reference), but deliberately full-bleed on mobile: an inset card on a
      390px screen spends ~48px of scarce width on a frame around a form.
    */
    <div className="flex min-h-dvh bg-[var(--page)] lg:p-6">
      <div className="flex w-full overflow-hidden border-[var(--border)] bg-[var(--page)] lg:rounded-[var(--radius-panel)] lg:border">
        {/* ── Identity panel (desktop only) ───────────────────────────────── */}
        <div className="relative hidden w-[45%] flex-none flex-col overflow-hidden bg-[var(--sidebar)] p-10 lg:flex">
          {/* Caption at the top edge, as in the reference: it sets context
              before the eye drops to the mark, and leaves the vertical centre
              free for the hero rather than competing with it. */}
          <p className="relative z-10 max-w-[300px] font-mono text-[10.5px] leading-relaxed tracking-[0.12em] text-[var(--text-faint)]">
            OPERATIONAL VIEW FOR HEALTH &amp; SAFETY EXPERTS
          </p>

          {/*
            THE HERO BLOCK: mark centred in the panel with its headline and copy
            directly underneath, as one composed unit.

            The copy used to sit pinned to the panel's bottom edge, ~300px below
            the mark, so the two never read as related. Grouping them means the
            eye lands on the mark and falls straight into the words.

            Signing in is the one surface in this product with nothing to read
            and no work to interrupt, which is the only place a perpetual
            animation is defensible - see the `loop` prop's note.

            The mark is decorative: the lockup in the form panel already says
            HSE HUB, so announcing it again would be the same name twice to a
            screen reader.
          */}
          <div className="relative flex flex-1 flex-col items-center justify-center gap-9 py-10">
            {/* Concentric rings behind the mark, taken from the reference's
                centred hero. Static, and at 7% opacity: the mark is already
                the moving element, so rings that also animated would split
                attention between two things doing the same job. */}
            <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
              {[560, 420, 290].map((d) => (
                <span
                  key={d}
                  className="absolute rounded-full border border-[var(--accent)] opacity-[0.07]"
                  style={{ width: d, height: d }}
                />
              ))}
            </div>

            <BrandMark size={220} animate loop className="relative z-10 flex-none" />

            <div className="relative z-10 flex flex-col items-center gap-4 text-center">
              <h2 className="max-w-[360px] text-[30px] font-semibold leading-[1.15] text-[var(--text-primary)]">
                One operational view
              </h2>
              <p className="max-w-[340px] text-[15px] leading-relaxed text-[var(--text-secondary)]">
                Projects, timesheets, people, and compliance - together, with the
                numbers straight from the source.
              </p>
              {/* Hairline under the copy, matched to the mark's own accent: it
                  closes the block so the group reads as composed rather than as
                  two things that happen to be near each other. */}
              <span aria-hidden className="mt-1 h-px w-16 bg-[var(--accent)] opacity-50" />
            </div>
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

        {/* ── Form panel ──────────────────────────────────────────────────── */}
        <div className="flex flex-1 flex-col bg-[var(--page)] px-6 py-8 lg:px-12 lg:py-10">
          {/* Lockup at the top of the FORM panel, as in the reference. On
              mobile it is the only mark on the page, so it carries the brand
              moment the hero carries on desktop - larger and animated, but
              never looping: on a phone the form sits directly beneath it, so a
              perpetual animation would move right beside what someone is
              typing into. */}
          <div className="flex flex-none items-center justify-between">
            <div className="flex items-center gap-3">
              <BrandMark size={30} animate className="flex-none lg:hidden" />
              <BrandMark size={26} className="hidden flex-none lg:block" />
              <div className="flex flex-col leading-[1.15]">
                <span className="font-sans text-[15px] font-bold tracking-[0.02em] text-[var(--text-primary)]">
                  HSE HUB
                </span>
                <span className="font-mono text-[9px] tracking-[0.14em] text-[var(--text-faint)]">
                  HEALTH &amp; SAFETY EXPERTS
                </span>
              </div>
            </div>
          </div>

          {/* The form is vertically centred in its panel and left-aligned,
              which is the reference's arrangement. `flex-1` plus justify-center
              does the centring without a fixed height, so a short viewport (or
              an open keyboard) just scrolls instead of clipping. */}
          <div className="flex flex-1 items-center justify-center py-10">
            <div className="w-full max-w-sm">{children}</div>
          </div>

          {/* Utility row pinned to the bottom edge, as in the reference. */}
          <div className="flex flex-none flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-5">
            <ConnectionStatus />
            <span className="font-mono text-[10px] tracking-[0.12em] text-[var(--text-faint)]">
              HS EXPERTS - INTERNAL
            </span>
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
//
// TWO MOBILE RULES ARE LOAD-BEARING HERE, both measured on the live portal:
//
// 1. `text-base` (16px) below sm, not `text-sm`. iOS Safari force-zooms the
//    whole page when a focused input's font-size is under 16px — you tap the
//    email field and the page lurches and scales, which is exactly the "works
//    weirdly on my phone" report. It cannot be disabled with a viewport
//    meta tag on modern iOS; the only fix is 16px. Back to 14px at sm+, where
//    no such zoom exists and the tighter size is better typography.
//
// 2. `min-h-11` (44px). The measured height was 37.3px, under both Apple's and
//    WCAG 2.5.8's minimum target, on the one form nobody can skip.
export const authInputClass =
  "w-full min-h-11 border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-base text-[var(--text-primary)] transition-colors placeholder:text-[var(--text-muted)] hover:border-[var(--text-faint)] focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-0 sm:text-sm";

export const authButtonClass =
  "w-full min-h-11 rounded-[var(--radius-sm)] bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-contrast)] transition-colors hover:bg-[var(--accent-hover)] active:translate-y-px disabled:cursor-not-allowed disabled:bg-[var(--surface-2)] disabled:text-[var(--text-faint)] disabled:active:translate-y-0 sm:min-h-0";

export const authLabelClass =
  "mb-1.5 block text-sm font-medium text-[var(--text-primary)]";
