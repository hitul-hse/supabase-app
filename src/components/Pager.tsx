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
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { segmentedItemClass, segmentedTrackClass } from "@/components/ui/Segmented";
import { IconArrowRight } from "@/components/nav-icons";

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
  // The frame around the count was English on the German page ("PER PAGE",
  // "OF", "PREV") while the noun it wrapped was already translated, so the line
  // read half in each language. Counts go through ICU rather than
  // toLocaleString("en-GB"), which formats them in the reader's locale for
  // free and keeps the English rendering byte-identical.
  const t = useTranslations("pager");

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
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--divider)] px-3 py-2">
      <span className="font-mono text-[10px] tracking-[0.04em] text-[var(--text-faint)]">
        {size === "all"
          ? t("allCount", { count: total, noun: noun.toUpperCase() })
          : t("range", {
              from: shownFrom,
              to: shownTo,
              count: total,
              noun: noun.toUpperCase(),
            })}
      </span>

      <span ref={liveRef} role="status" aria-live="polite" className="sr-only">
        {size === "all"
          ? t("srAll", { count: total, noun })
          : t("srRange", {
              from: shownFrom,
              to: shownTo,
              count: total,
              noun,
              page: page + 1,
              pages: pageCount,
            })}
      </span>

      <div className="flex flex-wrap items-center gap-3">
        {/* Rows per page. Offered because the right answer depends on the screen: 25 fits
            a laptop, 100 suits a large monitor where paging every 25 rows is friction. */}
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[10px] tracking-[0.06em] text-[var(--text-faint)]">
            {t("perPage")}
          </span>
          {/* The segmented skin DataTable's page sizes wear: one dialect for
              "a choice among a few", whichever table draws it. */}
          <div role="group" aria-label={t("perPage")} className={segmentedTrackClass}>
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
                className={segmentedItemClass(size === s)}
              >
                {s === "all" ? t("all") : s}
              </button>
            ))}
          </div>
        </div>

        {pageCount > 1 && size !== "all" && (
          <div className="flex items-center gap-1">
            {/* Ghost buttons with a real icon: the same PREV / NEXT DataTable
                draws, so a reader pages the same way in every table. */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => go(Math.max(0, page - 1))}
              disabled={page === 0}
              className="font-mono tracking-[0.06em] disabled:opacity-35"
            >
              <IconArrowRight className="h-3.5 w-3.5 rotate-180" />
              {t("prev")}
            </Button>
            <span className="px-1 font-mono text-[10px] tabular-nums text-[var(--text-faint)]">
              {page + 1} / {pageCount}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => go(Math.min(pageCount - 1, page + 1))}
              disabled={page >= pageCount - 1}
              className="font-mono tracking-[0.06em] disabled:opacity-35"
            >
              {t("next")}
              <IconArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
