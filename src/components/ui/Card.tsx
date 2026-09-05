import type { ReactNode } from "react";

/**
 * The one panel vocabulary for the app shell.
 *
 * WHY THIS EXISTS
 * ---------------
 * Before this, every panel was hand-rolled as
 * `border border-[var(--border)] bg-[var(--surface)]` with NO radius, and
 * adjacent panels were built as one CSS grid sharing hairlines between cells.
 * Two consequences, both visible on the Overview page:
 *
 *  1. Five separate KPIs read as one table row. A shared border says "these
 *     cells belong to a single record"; five independent facts about the
 *     business do not, so nothing was scannable -- the eye had no boundary to
 *     land on and every figure competed with its neighbour.
 *
 *  2. `border-b lg:border-b-0 lg:border-r` conditionals on the last-child
 *     index, repeated at every call site. That arithmetic is where fused grids
 *     go wrong (a missing rule on one breakpoint, a doubled one on another),
 *     and it has to be re-derived by hand for every new panel.
 *
 * Separate rounded cards on a gap need neither. There is no last-child rule to
 * get wrong, and each card is its own boundary.
 *
 * TONES
 * -----
 * `default` is every ordinary panel. `hero` is the ONE card per page carrying
 * the primary chart or headline figure: it gets --surface-accent, a measurably
 * different material (1.14 contrast against --surface -- see globals.css, where
 * the first value tried was indistinguishable at 1.02). Used more than once per
 * page it stops meaning "start here" and the page flattens again.
 *
 * NESTING
 * -------
 * Do not nest a Card in a Card. The craft floor bans it outright and it is the
 * single most common way a card system decays: an inner card needs its own
 * inset, its own border, and its own radius, and the result reads as a bug
 * rather than as hierarchy. Group with spacing and a `CardDivider` instead.
 */

type Tone = "default" | "hero";

/*
 * `card-elev` / `card-elev-raised` are real CSS classes in globals.css, NOT
 * `shadow-[var(--shadow-card)]`. That arbitrary-value form compiled and shipped
 * while rendering NOTHING -- Tailwind 4 emitted no rule for it, so `--tw-shadow`
 * stayed at its transparent `0 0 #0000` default on every card. See globals.css.
 */
const TONES: Record<Tone, string> = {
  default: "border-[var(--border)] bg-[var(--surface)] card-elev",
  hero:
    "border-[var(--surface-accent-border)] bg-[var(--surface-accent)] [background-image:var(--hero-gradient)] card-elev-raised",
};

export function Card({
  tone = "default",
  as: Element = "div",
  className = "",
  children,
  ...rest
}: {
  tone?: Tone;
  /*
   * The element to render. Defaults to a div, because most cards are just
   * panels. Pass "li" inside a list (a div between <ul> and its items is
   * invalid and silently costs the list semantics assistive tech announces)
   * or "section" where the card is a landmark with a heading.
   */
  as?: "div" | "li" | "section" | "article";
  className?: string;
  children: ReactNode;
} & Omit<React.HTMLAttributes<HTMLElement>, "children">) {
  return (
    <Element
      {...rest}
      data-card={tone}
      className={`rounded-[var(--radius-card)] border ${TONES[tone]} ${className}`}
    >
      {children}
    </Element>
  );
}

/**
 * A card's own header row: title, optional muted qualifier, optional controls.
 *
 * The qualifier ("LAST 12 WEEKS · TRACKINGTIME") is not decoration -- on a page
 * of derived figures, the reader's first question is always "over what period,
 * from where". Stating it beside the title is cheaper than a legend.
 *
 * Note there is no `eyebrow` prop and no kicker. The craft floor bans that
 * outright: the heading carries its own weight.
 */
export function CardHeader({
  title,
  qualifier,
  actions,
  className = "",
}: {
  title: string;
  qualifier?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-wrap items-baseline gap-x-2.5 gap-y-1 px-4 pt-3 pb-3 ${className}`}
    >
      <h2 className="t-title-3 text-[var(--text-primary)]">
        {title}
      </h2>
      {qualifier && (
        <span className="t-label text-[var(--text-faint)]">
          {qualifier}
        </span>
      )}
      {actions && <div className="ml-auto flex items-center gap-1.5">{actions}</div>}
    </div>
  );
}

/**
 * A hairline INSIDE one card, separating rows of the same thing.
 *
 * --divider, not --border: the two-tier system is deliberate (--border outlines
 * a surface, --divider separates rows within one). Using --border here makes an
 * internal split look like the edge of another panel.
 */
export function CardDivider({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`h-px bg-[var(--divider)] ${className}`} />;
}

/**
 * A single figure: label, value, optional trailing unit, optional progress and
 * footnote.
 *
 * THE RULE THIS ENCODES
 * ---------------------
 * `value === null` renders "—" in --text-faint, never 0 and never a plausible
 * substitute. This is the whole reason the Overview page was rebuilt (see
 * queries/overview-live.ts): the page used to render seeded strings like
 * "73.4%" and "18 240" from a mockup, and a confident wrong number is worse
 * than an obvious gap because nobody thinks to check it.
 *
 * `unit` is a separate baseline-aligned span rather than part of the string.
 * "5,123.1 h" set entirely at 26px renders the unit as loud as the figure; the
 * number is the content, the unit is a qualifier.
 */
export function StatTile({
  label,
  value,
  unit,
  hint,
  tone = "neutral",
  progressPercent = null,
  className = "",
  ...rest
}: {
  label: string;
  value: string | number | null;
  unit?: string;
  hint?: string;
  tone?: "neutral" | "good" | "warning" | "critical";
  progressPercent?: number | null;
  className?: string;
  /**
   * Everything else lands on the root div — in practice `data-metric`, which
   * is how the deployed-page checks find a specific figure.
   *
   * Without this spread the prop was accepted by TypeScript (JSX allows extra
   * props on an inline-typed component) and then silently dropped, so the
   * attribute never reached the DOM. That is not a cosmetic loss: it read as
   * "the card is not rendered" to anything selecting on it, which is exactly
   * how the live Overview check failed while the page itself was correct.
   */
} & React.HTMLAttributes<HTMLDivElement>) {
  const toneColour =
    tone === "critical"
      ? "var(--critical)"
      : tone === "warning"
        ? "var(--warning)"
        : tone === "good"
          ? "var(--good)"
          : "var(--text-muted)";

  const isMissing = value === null;

  return (
    <div
      {...rest}
      data-stat-tile
      className={`card-elev flex flex-col gap-1 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-3 ${className}`}
    >
      <span className="t-label text-[var(--text-faint)]">
        {label}
      </span>

      <span className="flex items-baseline gap-1">
        <span
          className="fig-lg"
          style={{
            color: isMissing
              ? "var(--text-faint)"
              : tone === "critical"
                ? "var(--critical)"
                : "var(--text-primary)",
          }}
        >
          {isMissing ? "—" : value}
        </span>
        {/* Only alongside a real figure -- "— h" is nonsense. */}
        {unit && !isMissing && (
          <span className="fig text-[var(--text-muted)]">
            {unit}
          </span>
        )}
      </span>

      {progressPercent !== null && (
        <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-[var(--border)]">
          <div
            className="bar-grow h-full rounded-full"
            style={{
              width: `${Math.min(100, Math.max(0, progressPercent))}%`,
              background: toneColour,
              // The house bar-grow is 700 ms; every entrance on a dashboard stays under 500 ms.
              animationDuration: "400ms",
            }}
          />
        </div>
      )}

      {/*
        Always rendered when supplied, and every caller supplies one. Tiles
        where some have a footnote and some do not come out at different
        heights, which makes a row of them look broken -- measured on the
        projects strip, where three of five were visibly shorter.
      */}
      {hint && (
        <span className="t-subhead text-[var(--text-muted)]">
          {hint}
        </span>
      )}
    </div>
  );
}

/**
 * The one line under a figure that says how it was computed.
 *
 * WHY THIS EXISTS. Every chart in the Hub already carries a text alternative
 * for screen readers -- `Charts.tsx` turns each caller's `label` into
 * `role="img" aria-label`, and all nine chart instances pass one. What none of
 * them had was an explanation a SIGHTED reader can see. "Billable share 63%" is
 * a number without a definition: share of tracked hours, or of contracted ones?
 * Utilisation against a 40-hour week, or against the 1,304 planned hours a year
 * the management page uses? Two readers reach different conclusions from the
 * same pixel, and neither can tell they disagree.
 *
 * A derived figure that does not state its own basis is not self-describing, it
 * is merely confident. This is the smallest honest fix: one muted line, in the
 * card, next to the thing it describes.
 *
 * WHY NOT A TOOLTIP. A definition hidden behind hover is unavailable on a phone,
 * unavailable to keyboard users who do not know to look, and absent from a
 * screenshot pasted into a board pack -- which is exactly where a misread number
 * does its damage. The cost is one line of 11px muted text.
 *
 * WHY NOT IN THE QUALIFIER. `CardHeader`'s qualifier states scope ("LAST 12
 * WEEKS - TRACKINGTIME"), which answers "over what period, from where". This
 * answers "counting what, over what denominator". Different questions, and
 * cramming both into one line beside the title makes the heading unreadable.
 */
export function ChartNote({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <p className={`px-4 pb-3 t-subhead text-[var(--text-faint)] ${className}`}>
      {children}
    </p>
  );
}
