"use client";

/**
 * A panel that is OPEN on desktop and COLLAPSED on a phone, with its summary
 * still stated while shut.
 *
 * WHY THIS EXISTS
 * ---------------
 * Measured at 390x844 (scripts/audit-mobile.mjs), /projects was 7.1 screens and
 * /team-lead 5.6, against DESIGN.md rule 8's three-screen ceiling. Neither is a
 * long table -- at 390px /projects renders zero <table> elements. The height is
 * that every `lg:grid-cols-12` becomes ONE column, so four panels that sit side
 * by side on a desktop stack end to end on a phone. Paging cannot fix a layout
 * defect, and deleting the panels would cost the desktop page its content.
 *
 * So the secondary panels collapse on a phone only. The reader still sees that
 * the panel exists, still reads its headline figure, and is one tap from the
 * whole thing.
 *
 * WHY IT IS CSS-GATED RATHER THAN JS-GATED
 * ----------------------------------------
 * The obvious implementation is `useMediaQuery("(max-width: 640px)")` and render
 * one of two trees. That was rejected twice over:
 *
 *  1. It regresses the desktop by construction. The server renders the mobile
 *     branch or the desktop branch based on a media query that does not exist
 *     until hydration, so the first paint is wrong at one width or the other and
 *     the panel visibly pops. Every change here had to be measured at BOTH
 *     390px and 1440px, and a hydration-dependent tree makes the 1440px number
 *     depend on when you measure it.
 *
 *  2. It removes the content from the DOM at one width, so the desktop scroll
 *     gate and any check selecting on a panel would see it appear and disappear
 *     with the viewport.
 *
 * Instead the CONTENT IS ALWAYS RENDERED and always visible from `sm:` up
 * (`hidden sm:block` while shut), and the trigger is `sm:hidden`. At 1440px this
 * component is a plain wrapper div: no button, no state, nothing to regress.
 * At 390px it is a disclosure. One tree, no hydration branch.
 *
 * THE SUMMARY IS NOT OPTIONAL
 * ---------------------------
 * DESIGN.md rule 7: "A collapsed or paged table still states its total ... a
 * collapsed panel with no count is indistinguishable from an empty one, so the
 * reader stops trusting every other number on the page." `summary` is a required
 * prop for that reason, and it is rendered while SHUT. It should carry the
 * figure the panel exists to show ("4 over budget of 42"), never a restatement
 * of the title.
 *
 * The chevron mirrors DataTable.tsx's collapsible header (the ▶ that rotates),
 * because a reader should not have to learn two disclosure dialects in one app.
 */

import { useId, useState, type ReactNode } from "react";

export function MobileDisclosure({
  title,
  summary,
  children,
  /**
   * Open on a phone from the start. For the ONE panel per page that is the
   * reason the reader came: collapsing everything equally makes the page a menu
   * rather than an answer. Defaults to collapsed, since by definition anything
   * wrapped here was judged secondary.
   */
  defaultOpen = false,
  className = "",
}: {
  title: string;
  /** The figure that stands in for the panel while it is shut. Required. */
  summary: string;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();

  return (
    <div data-mobile-disclosure={open ? "open" : "closed"} className={className}>
      {/*
        The trigger exists only below sm. `sm:hidden` rather than a conditional
        render, so the desktop tree is identical with or without this wrapper.
      */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={id}
        className="flex w-full items-center justify-between gap-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-left card-elev sm:hidden"
      >
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="font-mono text-[10px] font-semibold tracking-[0.14em] text-[var(--text-primary)]">
            <span
              aria-hidden
              className={`mr-1.5 inline-block text-[8px] text-[var(--text-faint)] transition-transform ${
                open ? "rotate-90" : ""
              }`}
            >
              ▶
            </span>
            {title.toUpperCase()}
          </span>
          {/* Stated whether open or shut: a collapsed panel must never read as
              an absent one. */}
          <span className="text-[10px] leading-tight text-[var(--text-faint)]">{summary}</span>
        </span>
        <span aria-hidden className="flex-none font-mono text-[10px] text-[var(--text-faint)]">
          {open ? "HIDE" : "SHOW"}
        </span>
      </button>

      {/*
        `hidden sm:block` while shut: invisible on a phone, ALWAYS visible from
        sm up regardless of `open`, which is what keeps the desktop at exactly
        its previous height. `mt-2 sm:mt-0` so opening on a phone does not weld
        the content to the trigger, while adding no desktop spacing.
      */}
      <div id={id} className={open ? "mt-2 sm:mt-0" : "hidden sm:block"}>
        {children}
      </div>
    </div>
  );
}
