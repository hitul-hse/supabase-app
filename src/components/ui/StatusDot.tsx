import type { ReactNode } from "react";

/**
 * A status tone, stated as a coloured dot AND the word beside it.
 *
 * WHY THIS EXISTS
 * ---------------
 * The projects ledger carried budget posture in the burn percentage's COLOUR
 * ALONE: `burnColor()` painted the bar and the number red, amber, green or
 * grey, and no word anywhere said which. That is the one thing both authorities
 * forbid outright -- APPLE_REF §8 #5 ("Status is never colour alone") and
 * docs/UI-CONVENTIONS ("Status is never colour alone: icon + text") -- and it
 * is invisible to a red-green reader, to a greyscale print of a board pack, and
 * to anyone reading the number without the legend.
 *
 * WHY NOT StatusBadge OR Pill
 * ---------------------------
 * Both are FILLED pills with their own bezel and their own padding. A filled
 * pill in every row of a 25-row ledger is 25 competing rectangles, and it reads
 * as a control rather than as a fact. What the design draws -- and what §5.3 and
 * §5.6 ask for -- is a 6px tone dot beside plain `--text-secondary` text with no
 * fill at all: the dot carries the tone, the word carries the meaning, and the
 * row keeps its 28px pitch.
 *
 * The word is in the READER's language and comes from the caller, so this
 * component never hardcodes a status name.
 */
export type StatusTone = "critical" | "warning" | "good" | "neutral" | "unknown";

/**
 * The one place a status tone becomes a colour. Exported so `FilterChip`'s
 * optional tone dot and this component cannot drift apart — two maps of the
 * same five names is how "amber" comes to mean two different things.
 */
export const STATUS_TONE_COLOR: Record<StatusTone, string> = {
  critical: "var(--critical)",
  warning: "var(--warning)",
  good: "var(--good)",
  /* A measured-but-unremarkable state: the muted rung, not the faintest. */
  neutral: "var(--text-muted)",
  /* Nothing was measured. The faint rung is the same one "—" uses. */
  unknown: "var(--text-faint)",
};

export function StatusDot({
  tone,
  children,
  className = "",
}: {
  tone: StatusTone;
  /** The word. Always supplied, always translated: the dot alone is the bug. */
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={`inline-flex min-w-0 items-center gap-1.5 ${className}`}>
      {/*
        aria-hidden because the WORD is the accessible name. Announcing a
        decorative dot would read the status twice.
        `h-1.5` = 6px, the size §5.3 and §5.6 specify; `flex-none` so a long
        German status ("Budget überschritten") wraps the text, never the dot.
      */}
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 flex-none rounded-full"
        style={{ background: STATUS_TONE_COLOR[tone] }}
      />
      <span className="truncate text-[var(--text-secondary)]">{children}</span>
    </span>
  );
}
