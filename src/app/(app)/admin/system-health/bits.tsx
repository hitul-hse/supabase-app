"use client";

import { useTranslations } from "next-intl";
import { DrillTrigger } from "@/components/DrillDialog";
import type { Drill } from "@/components/DrillDialog";

/**
 * The small vocabulary the five health panels share.
 *
 * WHY A CHIP AS WELL AS A WRAPPED FIGURE. `DrillTrigger` is a <button>. A
 * Gauge, a Meter, a Donut, or an HBar without `onSelect` contains no buttons
 * of its own, so wrapping the whole figure is fine and the whole figure is the
 * hit target. A Timeline, a ProportionBar or a Sparkline renders a <button>
 * per mark (that is how the keyboard reaches a readout), and a button inside a
 * button is not HTML: the parser closes the outer one at the inner start tag,
 * the client tree disagrees with the server's, and React reports a hydration
 * mismatch. Those figures get a DETAILS chip beside their heading instead.
 */

/**
 * Every section is a `.stagger` child, so it arrives with the house rise-in.
 * That rule ends in `animation-fill-mode: both`, which keeps the transform
 * animation "in effect" forever -- and Chrome treats an element with an
 * in-effect transform animation as the containing block for `position: fixed`
 * descendants. The DrillDialog is a fixed overlay rendered INSIDE its trigger,
 * so with `both` it was clipped to its section's box (seen: the statements
 * drill's pager sat under the next card). `backwards` is the same entrance --
 * hidden until its turn, settled after -- but once the 450 ms is over the
 * animation is no longer in effect and the overlay covers the viewport again.
 * Inline, because an unlayered stylesheet rule outranks a utility class.
 */
export const SECTION_STYLE = { animationFillMode: "backwards" } as const;

/**
 * For every Card that hosts a drill. `.card-elev:hover` lifts the card with
 * `transform: translateY(-1px)`, and a transformed ancestor is the containing
 * block for a `position: fixed` descendant -- so while the pointer rests on
 * the open dialog (which keeps its ancestor Card in :hover), the overlay was
 * clipped to the card's box (measured: 1010 × 440 instead of the viewport).
 * The glow and border still answer the hover; only the 1px lift is dropped.
 * `!` because the lift is an unlayered rule and outranks a plain utility.
 */
export const CARD_WITH_DRILL = "hover:transform-none!";

/** Wrapper class for a figure that is itself the drill trigger. */
export const FIGURE_TRIGGER =
  "block w-full rounded-[var(--radius-sm)] transition-colors hover:bg-[var(--surface-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]";

const CHIP =
  "rounded-[var(--radius-sm)] border border-[var(--border)] px-2.5 py-1 font-mono text-[10px] tracking-[0.08em] text-[var(--text-muted)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]";

export function DrillChip({ drill, id, label }: { drill: Drill; id: string; label?: string }) {
  const t = useTranslations("systemHealth");
  return (
    <DrillTrigger drill={drill} id={id} className={CHIP}>
      {label ?? t("details")}
    </DrillTrigger>
  );
}

/**
 * The one line under a figure that says why it is blank. Rendered inline so a
 * reader never has to guess whether "n/a" means zero, unknown, or broken.
 */
export function Reason({ reason, className = "" }: { reason: string; className?: string }) {
  const t = useTranslations("systemHealth");
  return (
    <span className={`font-mono text-[10px] leading-snug text-[var(--text-faint)] ${className}`}>
      {t("na")} — {reason}
    </span>
  );
}

/** The mono kicker over a sub-figure inside a card. */
export const KICKER = "font-mono text-[10px] tracking-[0.1em] text-[var(--text-faint)]";

/** A big lone number: proportional face, not tabular. */
export const BIG = "text-[26px] font-semibold leading-none tracking-[-0.02em] text-[var(--text-primary)]";

export function TickIcon({ className = "" }: { className?: string }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className={className}>
      <path d="M2.5 6.5 L5 9 L9.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CrossIcon({ className = "" }: { className?: string }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className={className}>
      <path d="M3 3 L9 9 M9 3 L3 9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
