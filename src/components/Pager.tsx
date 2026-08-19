"use client";

/**
 * Paging that keeps the PAGE a fixed height.
 *
 * THE REPORTED BUG. Projects showed 30 rows with a "Show 30 more" that APPENDED. Click it
 * and the document gets longer, so the reader scrolls further to reach the control, clicks
 * again, and scrolls further still. Measured against live data the ledger is 334 projects:
 * about 13 screens if fully expanded, and the "Show all" button next to it does exactly
 * that in one click. The People directory had the same append-style control, added earlier
 * today.
 *
 * WHY APPENDING IS THE WRONG SHAPE. "Show more" answers "let me see additional rows"; it
 * does not answer "let me get through this list". Those are the same request only when the
 * list is short. Past a screen or two, appending guarantees the page grows without bound
 * while the thing you need next -- the control -- keeps moving away from you.
 *
 * WHAT THIS DOES INSTEAD. Fixed-size pages with PREV/NEXT, so the page height is constant
 * no matter how many rows exist, and moving through the list is a click that does not
 * change the geometry. This is the pattern the TrackingTime dashboard's DataTable already
 * uses, and it is the reason that surface never grew this complaint even though it renders
 * the same 334 projects. This component exists so the other surfaces can share it without
 * pulling in DataTable's sorting, CSV export and column model, which they do not need.
 *
 * IT ALSO KEEPS "SHOW ALL". Some readers genuinely want one long list -- to use the
 * browser's own find, or to print. Removing that would trade one complaint for another. It
 * is a deliberate, labelled choice rather than the default, and it flips back.
 */

import { useRef, useState } from "react";

export type PagerState = {
  /** Zero-based index of the visible page. */
  page: number;
  /** Rows per page, or "all" when the reader has asked for the whole list. */
  size: number | "all";
  /** Slice bounds for the caller to apply to its own sorted/filtered rows. */
  start: number;
  end: number;
  pageCount: number;
  setPage: (n: number) => void;
  setSize: (s: number | "all") => void;
  /** Call whenever the underlying result set changes, e.g. on search or sort. */
  reset: () => void;
};

/**
 * Page state for `total` rows.
 *
 * @param resetKey A value that changes whenever the result set changes -- typically the
 *   filter and sort state joined into a string. Paging resets when it changes, because
 *   leaving the reader on page 7 of a list that just became 3 rows long shows an empty
 *   table, which reads as "no results" and is the bug this parameter exists to prevent.
 */
export function usePager(total: number, defaultSize = 25, resetKey = ""): PagerState {
  const [page, setPage] = useState(0);
  const [size, setSize] = useState<number | "all">(defaultSize);

  // Derived-state reset during render rather than in an effect: an effect would paint one
  // frame of the wrong page first.
  const [lastKey, setLastKey] = useState(resetKey);
  if (resetKey !== lastKey) {
    setLastKey(resetKey);
    setPage(0);
  }

  const perPage = size === "all" ? Math.max(total, 1) : size;
  const pageCount = Math.max(1, Math.ceil(total / perPage));
  // Clamp rather than trust: `total` can shrink under a page index that was valid a
  // moment ago, and reading past the end renders nothing at all.
  const safePage = Math.min(page, pageCount - 1);
  const start = size === "all" ? 0 : safePage * perPage;
  const end = size === "all" ? total : start + perPage;

  return {
    page: safePage,
    size,
    start,
    end,
    pageCount,
    setPage,
    setSize,
    reset: () => setPage(0),
  };
}

/**
 * The pager controls.
 *
 * @param anchorRef Scrolled back into view on a page change. Without it, paging from the
 *   bottom of page 1 leaves you at the bottom of page 2 -- looking at its last rows, with
 *   the first ones above you unread. The scroll is instant, not smooth: this is a
 *   reposition, and animating it makes a fast click feel like the page moved on its own.
 */
export function Pager({
  state,
  total,
  noun,
  anchorRef,
  sizes = [25, 50, 100],
}: {
  state: PagerState;
  total: number;
  /** Plural noun for the count line, e.g. "projects". */
  noun: string;
  anchorRef?: React.RefObject<HTMLElement | null>;
  sizes?: number[];
}) {
  const { page, size, start, end, pageCount, setPage, setSize } = state;

  // Announce the change, because moving between pages replaces the whole table without
  // moving focus -- a screen-reader user would otherwise get no indication anything
  // happened.
  const liveRef = useRef<HTMLSpanElement>(null);

  const go = (n: number) => {
    setPage(n);
    anchorRef?.current?.scrollIntoView({ block: "start", behavior: "auto" });
  };

  // Nothing to page: say what is on screen and stop. Rendering disabled arrows for a
  // 4-row list is noise.
  if (total === 0) return null;

  const shownFrom = total === 0 ? 0 : start + 1;
  const shownTo = Math.min(end, total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] px-3 py-2">
      <span className="font-mono text-[10.5px] text-[var(--text-faint)]">
        {size === "all" ? (
          <>ALL {total.toLocaleString("en-GB")} {noun.toUpperCase()}</>
        ) : (
          <>
            {shownFrom.toLocaleString("en-GB")}–{shownTo.toLocaleString("en-GB")} OF{" "}
            {total.toLocaleString("en-GB")} {noun.toUpperCase()}
          </>
        )}
      </span>

      <span ref={liveRef} role="status" aria-live="polite" className="sr-only">
        {size === "all"
          ? `Showing all ${total} ${noun}`
          : `Showing ${shownFrom} to ${shownTo} of ${total} ${noun}, page ${page + 1} of ${pageCount}`}
      </span>

      <div className="flex flex-wrap items-center gap-3">
        {/* Rows per page. Offered because the right answer depends on the screen: 25 fits
            a laptop, 100 suits a large monitor where paging every 25 rows is friction. */}
        <div className="flex items-center gap-1">
          <span className="font-mono text-[9.5px] tracking-[0.06em] text-[var(--text-faint)]">
            PER PAGE
          </span>
          {[...sizes, "all" as const].map((s) => (
            <button
              key={String(s)}
              type="button"
              onClick={() => {
                setSize(s);
                setPage(0);
                anchorRef?.current?.scrollIntoView({ block: "start", behavior: "auto" });
              }}
              aria-pressed={size === s}
              className={`border px-1.5 py-0.5 font-mono text-[10px] transition-colors ${
                size === s
                  ? "border-[var(--accent)] text-[var(--accent)]"
                  : "border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--text-faint)] hover:text-[var(--text-primary)]"
              }`}
            >
              {s === "all" ? "ALL" : s}
            </button>
          ))}
        </div>

        {pageCount > 1 && size !== "all" && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => go(Math.max(0, page - 1))}
              disabled={page === 0}
              className="border border-[var(--border)] px-2 py-0.5 font-mono text-[10px] text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-[var(--border)] disabled:hover:text-[var(--text-secondary)]"
            >
              ← PREV
            </button>
            <span className="px-1 font-mono text-[10px] tabular-nums text-[var(--text-faint)]">
              {page + 1} / {pageCount}
            </span>
            <button
              type="button"
              onClick={() => go(Math.min(pageCount - 1, page + 1))}
              disabled={page >= pageCount - 1}
              className="border border-[var(--border)] px-2 py-0.5 font-mono text-[10px] text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-[var(--border)] disabled:hover:text-[var(--text-secondary)]"
            >
              NEXT →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
