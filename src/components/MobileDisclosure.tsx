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

import { useTranslations } from "next-intl";
import { useId, useState, type ReactNode } from "react";
import { IconCaret } from "./nav-icons";

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
  // The collapse toggle read SHOW/HIDE in English on the German page — the
  // one word on this control, so it was the whole control untranslated.
  const t = useTranslations("common");
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
        /*
          The press is a TINT, not a translate, and not `control-motion`.
          `.card-elev` already declares a `transition` covering transform at
          250 ms (globals.css) and it is an unlayered rule, so it beats any
          Tailwind utility on the same element: a `translate-y-px` press here
          would ease over a quarter of a second, which reads as a lag rather
          than as feedback. `background-color` is NOT in that list, so a tint
          lands on the down event and leaves on the up event with nothing to
          interpolate — instant, which is what §6.1 #1 asks for. This control
          is `sm:hidden`, i.e. touch-only, where there is no hover to feel and
          the press is the whole acknowledgement.
        */
        className="flex w-full items-center justify-between gap-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-left card-elev active:bg-[var(--surface-hover)] sm:hidden"
      >
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="flex items-center gap-1.5 t-headline text-[var(--text-primary)]">
            {/* The same caret DataTable's collapsible header rotates: one
                disclosure dialect, drawn from the icon set rather than a glyph. */}
            <IconCaret
              className={`flex-none text-[var(--text-faint)] transition-transform duration-150 ${
                open ? "" : "-rotate-90"
              }`}
            />
            {title}
          </span>
          {/* Stated whether open or shut: a collapsed panel must never read as
              an absent one. */}
          <span className="t-subhead text-[var(--text-faint)]">{summary}</span>
        </span>
        <span aria-hidden className="flex-none t-label text-[var(--text-faint)]">
          {open ? t("hide") : t("show")}
        </span>
      </button>

      {/*
        THE PANEL OPENS, it no longer blinks. `.disclose` (globals.css) runs
        the height (`grid-template-rows: 0fr → 1fr`, 220 ms on --ease-out) and
        the content's opacity (150 ms) together, so the page below slides down
        with the panel instead of jumping the panel's full height in one
        frame. Height is a layout property, knowingly: a disclosure IS a
        change of extent and a transform cannot express one -- the class
        carries the ruling (APPLE_REF §6.1 #8's one-per-case exception, guarded
        by a frame-time measurement rather than a property list) and the
        Reduce Motion branch that makes it instant.

        `.disclose-sm` is what keeps the CSS gate this component was built on:
        from `sm` up the wrapper is a plain, unclipped block with no
        transition and no clipping, exactly as `hidden sm:block` was, so the
        desktop tree is byte-identical in behaviour and there is still no
        hydration branch anywhere. `data-open` is server-rendered from state,
        so a phone with slow JavaScript gets the correct resting state rather
        than an invisible panel.

        `mt-2 sm:mt-0` moved INSIDE the grid item: a margin on the grid
        container itself would be 8 px of gap that never collapses, so a shut
        panel would leave a visible dent under its trigger.
      */}
      <div
        id={id}
        className="disclose disclose-sm"
        data-open={open ? "true" : "false"}
      >
        <div>
          <div className="mt-2 sm:mt-0">{children}</div>
        </div>
      </div>
    </div>
  );
}
