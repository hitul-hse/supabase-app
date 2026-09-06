"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { IconCheck, IconCross } from "@/components/nav-icons";
import { BrandMark } from "@/components/BrandMark";
import { LocaleSwitcher } from "@/components/locale/LocaleSwitcher";
import { buttonClass } from "@/components/ui/Button";

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
    <div className="flex items-center gap-2 t-label text-[var(--text-faint)]">
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
          <p className="relative z-10 max-w-[300px] t-label t-loose text-[var(--text-faint)]">
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
              <h2 className="max-w-[360px] t-large text-[var(--text-primary)]">
                One operational view
              </h2>
              <p className="max-w-[340px] t-body t-loose text-[var(--text-secondary)]">
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
          {/*
            The top row of the form panel: the DESKTOP lockup on the leading
            edge (small, because the 220 px hero in the identity panel beside it
            already carries the brand) and the language picker on the trailing
            edge.

            The ROW is present at every width even though the lockup inside it
            is not, because the picker has to be. Before sign-in there is no top
            bar and no account menu to carry it, and the first version of this
            put it in the footer row: on a 390 x 844 phone that landed it below
            the fold, under the form, where the one user who needs it — someone
            who cannot read this screen — would never look. Top trailing corner
            is also where the app itself keeps it (TopBarChrome), so the control
            does not move when you sign in.
          */}
          <div className="flex flex-none items-center justify-end gap-3">
            <div className="hidden items-center gap-3 lg:me-auto lg:flex">
              <BrandMark size={26} className="flex-none" />
              <div className="flex flex-col leading-[1.15]">
                <span className="t-title-3 text-[var(--text-primary)]">
                  HSE HUB
                </span>
                <span className="t-label text-[var(--text-faint)]">
                  HEALTH &amp; SAFETY EXPERTS
                </span>
              </div>
            </div>
            <LocaleSwitcher hideOnPhone={false} />
          </div>

          {/*
            MOBILE hero. The identity panel is hidden below lg, so this is the
            ONLY mark a phone user ever sees — and at 30px in the corner it was
            a favicon, not a brand moment. The reference this page follows gives
            its mark roughly a third of the screen with the wordmark centred
            beneath it, and that is what this is: 96px, centred, with the rings
            echoing the desktop hero so the two read as one design.

            `animate` but NOT `loop`. On a phone the form sits directly beneath
            this, so a perpetual animation would be moving right next to what
            somebody is typing into. It plays once on arrival and then rests.
          */}
          <div className="relative flex flex-none flex-col items-center gap-3 pb-2 pt-2 lg:hidden">
            <div aria-hidden className="pointer-events-none absolute inset-0 flex items-start justify-center pt-2">
              {[210, 150].map((d) => (
                <span
                  key={d}
                  className="absolute rounded-full border border-[var(--accent)] opacity-[0.07]"
                  style={{ width: d, height: d }}
                />
              ))}
            </div>
            <BrandMark size={96} animate className="relative z-10 flex-none" />
            <div className="relative z-10 flex flex-col items-center leading-[1.15]">
              <span className="t-title-2 text-[var(--text-primary)]">
                HSE HUB
              </span>
              <span className="t-label text-[var(--text-faint)]">
                HEALTH &amp; SAFETY EXPERTS
              </span>
            </div>
          </div>

          {/* The form is vertically centred in its panel and left-aligned,
              which is the reference's arrangement. `flex-1` plus justify-center
              does the centring without a fixed height, so a short viewport (or
              an open keyboard) just scrolls instead of clipping. */}
          <div className="flex flex-1 items-center justify-center py-10">
            <div className="w-full max-w-sm">{children}</div>
          </div>

          {/* Utility row pinned to the bottom edge, as in the reference:
              passive status only, no controls (APPLE_REF §3.2 "Bottom of the
              window: nothing critical"). The language picker sits in the top
              row instead — see the note there. */}
          <div className="flex flex-none flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-5">
            <ConnectionStatus />
            <span className="t-label text-[var(--text-faint)]">
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
      <span className="mb-2 block t-label text-[var(--text-faint)]">
        {eyebrow}
      </span>
      <h1 className="mb-6 t-large text-[var(--text-primary)]">{title}</h1>
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
      // `rise-in`, the house entrance (globals.css "MOTION VOCABULARY"), so a
      // refused sign-in does not simply BE there on the next paint in the spot
      // the eye has already scanned past — it settles in. A CSS keyframe rather
      // than a spring on purpose: this element is server-rendered when
      // /auth/callback sends someone back with `?error=`, and a JS entrance
      // would leave the one message that explains the failure invisible until
      // hydration. Reduce Motion removes it outright.
      className="rise-in mb-4 flex items-start gap-3 border border-[var(--border)] p-3 t-body"
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
// 3. The bezel is `--border-strong`, which is what Field.tsx's CONTROL_BASE
//    gives every input INSIDE the app (APPLE_REF §3.2 "Inputs: bezel
//    `--border-strong`"). The well stays `--surface` rather than CONTROL_BASE's
//    `--page`, because this panel IS `--page`: a page-coloured input on a
//    page-coloured panel is a bezel with nothing inside it.
//
// THE TWO SIZES ARE BOTH MEASURED RULES, and neither is a role.
//
// This class briefly read `sm:t-callout`, on the reasoning that §3.2 sizes an
// in-app input at `t-callout`. But `t-callout` is 12px, so that quietly took
// the desktop sign-in form from 14px to 12px — a design change smuggled in
// under a mobile fix, which is the exact pairing rule 1 exists to protect
// (check-brand-mark: "16px is a mobile fix, not a design change"). `t-callout`
// is right for a ledger row with fifty siblings; it is not right for the two
// fields on the one screen everybody types into. Back to 14px from `sm` up,
// which is what shipped before.
//
// So this class carries two raw sizes on purpose, and that is why AuthShell is
// NOT in the design gate's ROLE_ONLY list: both are measurements the role scale
// has no entry for.
export const authInputClass =
  "w-full min-h-11 rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-base text-[var(--text-primary)] transition-colors placeholder:text-[var(--text-muted)] hover:border-[var(--text-faint)] focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-0 sm:text-sm";

/**
 * The submit on every auth page is now the house `primary` button, composed
 * from the Button primitive rather than restated here. It had drifted into its
 * own vocabulary — `text-sm`, `px-4 py-2`, its own disabled colours — which is
 * exactly the "99 distinct button signatures" problem Button.tsx was written to
 * end, and it meant the one button a user meets before they are even in the
 * product was the one button that did not look like the product.
 *
 * `max-sm:min-h-11` rather than a bare `min-h-11`: `md` already sets
 * `min-h-[32px]`, and a variant utility sorts after an unvariant one, so the
 * 44 px touch floor wins below `sm` without depending on class order. Coarse
 * pointers get 44 px at every width from the primitive's own
 * `pointer-coarse:` rule.
 */
export const authButtonClass = buttonClass("primary", "md", "w-full max-sm:min-h-11");

export const authLabelClass =
  "mb-1.5 block t-body font-medium text-[var(--text-primary)]";
