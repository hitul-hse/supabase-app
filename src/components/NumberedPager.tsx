import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The house pager: first · last · a one-step window around the current page ·
 * an elided middle · a dimmed PREV that never disappears.
 *
 * WHY THIS EXISTS
 * ---------------
 * docs/UI-CONVENTIONS rule 3 describes exactly one pager ("The pager is boring
 * on purpose. First / last / a one-step window around the current page / elided
 * middle") and names `customer-master/import-review` as the reference
 * implementation. It was never a component: the same forty lines were written
 * out twice, as an unexported `function Pager` in import-review and again in
 * data-hygiene, with the window arithmetic duplicated verbatim and the control
 * geometry already drifted apart (px-2.5/py-1 in one, px-2/py-0.5 in the
 * other — 24px in one place and ~20px in the other, where APPLE_REF §5.4 sets
 * 24 as the floor). A third copy for the projects ledger would have made the
 * drift permanent, so this promotes one instead.
 *
 * TWO MODES, BECAUSE THE HOUSE HAS TWO KINDS OF LIST
 * -------------------------------------------------
 * `hrefFor` renders server `<Link>`s: page state in the URL, back/forward and a
 * pasted link all work, no JavaScript needed. That is the mode UI-CONVENTIONS
 * rule 2 requires for a queue people work THROUGH, and the mode both existing
 * call sites use.
 *
 * `onSelect` renders buttons for a client-sorted table that already mirrors its
 * page into the URL itself without a server round-trip (`DataTable` through
 * `useUrlState`) — the documented deviation in APPLE_REF §5.4. Passing both is
 * a caller error and the link wins.
 *
 * STATES (APPLE_REF §5.4 "States")
 * --------------------------------
 * Rest: `--border` bezel, `--text-muted`. Hover: accent bezel and primary text.
 * Current: accent bezel + `--accent-wash` fill + accent label, `aria-current`
 * (accent means CURRENT here, exactly as on the sort column and the segment).
 * Unavailable: `opacity-35` and `aria-disabled` — DIMMED, NEVER HIDDEN. A PREV
 * that vanishes on page 1 shifts NEXT under the cursor between clicks, and a
 * screen-reader user is never told the control exists at all.
 */
export type PagerLabels = {
  prev: string;
  next: string;
  /** For the per-link accessible name: "…, page 3". */
  pageLabel: (page: number) => string;
};

export function NumberedPager({
  page,
  pageCount,
  countLine,
  navLabel,
  labels,
  hrefFor,
  onSelect,
  className = "",
}: {
  /** 1-based, like the numbers on screen. */
  page: number;
  pageCount: number;
  /**
   * "1–25 OF 341 PROJECTS · PAGE 1 OF 14". Rendered `aria-live="polite"` so a
   * screen-reader user hears the new position after paging, which is the whole
   * point of the Finder-status-bar count APPLE_REF §5.4 borrows.
   */
  countLine: ReactNode;
  navLabel: string;
  labels: PagerLabels;
  hrefFor?: (page: number) => string;
  onSelect?: (page: number) => void;
  className?: string;
}) {
  /*
   * First, last, and a one-step window around the current page; everything else
   * elides. A pager listing 40 page numbers is a second list to read.
   */
  const windowed: (number | "gap")[] = [];
  for (let n = 1; n <= pageCount; n += 1) {
    if (n === 1 || n === pageCount || Math.abs(n - page) <= 1) windowed.push(n);
    else if (windowed[windowed.length - 1] !== "gap") windowed.push("gap");
  }

  /*
   * 24px min (APPLE_REF §5.4 "Sizes", WCAG 2.2's floor), 44 on a coarse
   * pointer. `tabular-nums` so the control does not change width between
   * page 8 and page 9 and nudge its neighbour.
   */
  const base =
    "inline-flex min-h-6 items-center justify-center rounded-[var(--radius-sm)] border px-2.5 py-1 " +
    "font-mono text-[10px] tabular-nums tracking-[0.06em] control-motion " +
    "pointer-coarse:min-h-11 pointer-coarse:px-3";

  /**
   * `named` is the accessible name, and PREV/NEXT deliberately do not get one.
   *
   * An `aria-label` REPLACES the visible text as the accessible name, so
   * labelling the NEXT control "Page 2" left a button that reads NEXT and
   * announces "Page 2" — WCAG 2.5.3 asks the accessible name to contain the
   * visible label, and a voice-control user saying "click next" would find
   * nothing. The numbered controls keep theirs, where "Page 2" contains "2".
   */
  const control = (
    n: number,
    label: string,
    disabled: boolean,
    current = false,
    named = true,
  ) => {
    if (disabled) {
      return (
        <span
          key={`${label}-off`}
          aria-disabled="true"
          className={`${base} border-[var(--border)] text-[var(--text-faint)] opacity-35`}
        >
          {label}
        </span>
      );
    }
    const skin = current
      ? "border-[var(--accent)] bg-[var(--accent-wash)] text-[var(--accent)]"
      : "border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--text-primary)]";
    const shared = {
      "aria-current": current ? ("page" as const) : undefined,
      "aria-label": named ? labels.pageLabel(n) : undefined,
      className: `${base} ${skin}`,
    };
    return hrefFor ? (
      <Link key={`${label}-${n}`} href={hrefFor(n)} scroll={false} {...shared}>
        {label}
      </Link>
    ) : (
      <button key={`${label}-${n}`} type="button" onClick={() => onSelect?.(n)} {...shared}>
        {label}
      </button>
    );
  };

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-[var(--divider)] px-4 py-2 ${className}`}
    >
      <span aria-live="polite" className="t-label text-[var(--text-faint)]">
        {countLine}
      </span>
      {/* One page needs no controls: five dead buttons under a five-row list
          is noise, and the count line above already says the list is whole. */}
      {pageCount > 1 && (
      <nav aria-label={navLabel} className="flex flex-wrap items-center gap-1">
        {control(page - 1, labels.prev, page <= 1, false, false)}
        {windowed.map((n, i) =>
          n === "gap" ? (
            <span key={`gap-${i}`} aria-hidden="true" className="px-1 t-label text-[var(--text-faint)]">
              …
            </span>
          ) : (
            control(n, String(n), false, n === page)
          ),
        )}
        {control(page + 1, labels.next, page >= pageCount, false, false)}
      </nav>
      )}
    </div>
  );
}
