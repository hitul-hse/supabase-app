import type { ReactNode } from "react";

/**
 * The three primitives every card of the customer profile is built from.
 *
 * WHY A SHARED FILE RATHER THAN A COPY PER CARD
 * ---------------------------------------------
 * The absence glyph and the dt/dd geometry are the two things that must NOT
 * drift between the six cards: a page where one card renders a missing value as
 * "—" and another as "" or "0" is a page whose nulls stop meaning anything, and
 * that is the whole argument the profile makes. One definition, six call sites.
 *
 * The geometry is `MyWorkDetail`'s, deliberately: a reader who has seen the
 * order panel has already learnt this layout, and a second dialect for the same
 * idea would be a cost with no benefit.
 */

/** The house glyph for a missing value (DESIGN.md) — never 0, never blank. */
export const ABSENT = "—";

/** One label / value pair of a definition list. */
export function Row({
  label,
  children,
  mono = false,
}: {
  label: string;
  children: ReactNode;
  /** Figures and codes set in the mono role; prose in the callout role. */
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <dt className="flex-none t-label text-[var(--text-faint)]">{label}</dt>
      <dd
        className={`min-w-0 text-right [overflow-wrap:anywhere] ${
          mono ? "fig" : "t-callout"
        } text-[var(--text-primary)]`}
      >
        {children}
      </dd>
    </div>
  );
}

/**
 * A value, or the absence glyph set faint so the eye skips it.
 *
 * This renders UNKNOWN. It is never used for a value the reader's role was
 * denied: a withheld figure is the WORDS "nicht freigegeben", because a dash
 * that means both "nobody recorded this" and "not for you" is exactly the
 * substitution budget-visibility.ts exists to prevent.
 */
export function Value({ value }: { value: string | null }) {
  if (value === null) return <span className="text-[var(--text-faint)]">{ABSENT}</span>;
  return <>{value}</>;
}

/**
 * A card section that is a definition list, unless it can be empty — in which
 * case its empty state is a sentence OUTSIDE the list.
 *
 * A `<p>` inside a `<dl>` is invalid markup that costs assistive tech the list
 * semantics it would otherwise announce. Written without a bare `>` in the
 * opening tag so a static gate can find where that tag ends.
 */
export function Rows({ children, list = true }: { children: ReactNode; list?: boolean }) {
  return list ? <dl className="flex flex-col px-4 py-3">{children}</dl> : <div className="px-4 py-3">{children}</div>;
}

/** The one-line empty state a card shows instead of a blank panel. */
export function NoneLine({ children }: { children: ReactNode }) {
  return <p className="t-callout text-[var(--text-faint)]">{children}</p>;
}
