"use client";
/**
 * The shared table shell every dashboard breakdown renders through.
 *
 * It grew up inside time/dashboard and lives here now because it is the house
 * standard, not one route's helper: sort with explicit null placement, in-table
 * search, paging, CSV export of exactly what is on screen, a collapsible panel
 * that still states its row count while shut, and a sticky header.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every table on this page used to render `rows.slice(0, 40)` (or 25) and say so
 * in its hint. That is honest but useless: the live data has 334 projects and 49
 * people, so "top 40 of 334" meant the other 294 projects were simply
 * unreachable — there was no control anywhere on the page that could show them.
 * A reporting surface that cannot show you a row is not a reporting surface.
 *
 * So the server now hands over EVERY grouped row and this component owns the
 * presentation: sort, search, page, and export. That is the right split because
 * the rows are already aggregated server-side (hundreds of rows, not the tens of
 * thousands of raw entries behind them), so shipping them costs little and makes
 * every subsequent interaction instant — no round trip to re-sort a column.
 *
 * THE ONE RULE INHERITED FROM ReportPanels.tsx: a missing number renders as "—",
 * never as zero. Sorting must therefore decide where nulls go explicitly rather
 * than letting them coerce to 0 and pretend to be the smallest value.
 */
import { useTranslations } from "next-intl";
import { useId, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { controlClass } from "@/components/ui/Field";
import { segmentedItemClass, segmentedTrackClass } from "@/components/ui/Segmented";
import { IconArrowRight, IconCaret, IconCross } from "@/components/nav-icons";

export type Align = "left" | "right";

export type Column<T> = {
  /** Stable id, used for the sort key in state. */
  key: string;
  header: string;
  align?: Align;
  /** Tailwind width class, e.g. "w-[11rem]". */
  className?: string;
  /**
   * Narrow gutters (px-2 instead of px-4) for a column that carries a token
   * rather than prose -- an icon link, a badge, a status pill, a short code, a
   * date. Leave it off for anything a reader parses as a sentence.
   *
   * The default 32px gutter is sized for text that needs breathing room beside
   * its neighbour. Around an 11-character badge or a 24px icon target it is
   * wider than the content it separates, and on /my-work -- eleven columns, of
   * which eight are tokens -- it came to 128px of the table's min-content width
   * spent on air, which was most of the reason that table could not fit a
   * 1280px screen without scrolling sideways.
   *
   * It is a property of the COLUMN rather than a class the caller passes,
   * because `className` lands in the same slot as the built-in `px-4`, and
   * which of two padding utilities wins is decided by Tailwind's stylesheet
   * order rather than by the order they appear in the string -- i.e. passing
   * `px-2` there would silently not work.
   */
  compact?: boolean;
  /** Omit to make the column unsortable (a bar-only column, say). */
  compare?: (a: T, b: T) => number;
  /** Sorting this column first goes descending — true for every measure. */
  descFirst?: boolean;
  cell: (row: T) => React.ReactNode;
  /** Plain value for CSV. Omit to leave the column out of the export. */
  csv?: (row: T) => string | number;
  /** Text this column contributes to the in-table search. */
  search?: (row: T) => string;
  /** Short explanation shown in the header tooltip. */
  title?: string;
};

type Props<T> = {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string | number;
  title: string;
  /** Static context line. Row counts are appended automatically. */
  hint?: string;
  /** Column key to sort by on first render. */
  initialSort?: string;
  initialDesc?: boolean;
  /** Basename for the downloaded CSV. */
  exportName?: string;
  searchPlaceholder?: string;
  /** Rendered under the table, e.g. a totals row or a caveat. */
  footnote?: React.ReactNode;
  /** Shown when the data itself is empty (not when a search finds nothing). */
  emptyText?: string;
  /** Rows per page before paging kicks in. */
  defaultPageSize?: PageSize;
  /**
   * Render collapsed until opened. The panel still states its row count and a
   * one-line summary while shut, so collapsing hides the rows, never the fact
   * that they exist.
   */
  collapsible?: boolean;
  defaultOpen?: boolean;
  /** One line shown in the collapsed header, e.g. "305h across 60 projects". */
  summary?: string;
  /**
   * Freeze the FIRST column so the row label stays readable while a wide table
   * scrolls sideways. Opt-in, because a pinned cell must carry an opaque
   * background of its own — which costs it the row-hover tint an ordinary cell
   * inherits for free (restored here via group-hover) — and a table narrow
   * enough to fit gains nothing from either.
   *
   * The first column has to BE the label column for this to make sense; that is
   * the caller's arrangement, not something this component can verify.
   */
  freezeFirstColumn?: boolean;
  /**
   * Bound the table BODY rather than letting it grow the page: rows scroll
   * inside the card and the sticky header stays put. `true` takes the house
   * default of ~60vh; a string is any CSS length ("32rem"), a number is px.
   *
   * Opt-in for the same reason the existing internal scroller is conditional —
   * a scrollbar inside a five-row table looks broken. Left unset, behaviour is
   * exactly as before: a 70vh scroller appears by itself past 25 visible rows.
   */
  maxBodyHeight?: string | number | true;
};

/** The house cap for an opted-in bounded body: roughly 60% of the viewport. */
export const DEFAULT_MAX_BODY_HEIGHT = "60vh";

const PAGE_SIZES = [25, 50, 100, "all"] as const;
export type PageSize = (typeof PAGE_SIZES)[number];

/** CSV escaping. A project name containing a comma or a quote is normal. */
function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Numeric compare that keeps nulls at the bottom in BOTH directions.
 *
 * Treating null as 0 would sort "no budget set" in among the genuinely small
 * numbers, and reversing the sort would then float it to the top — so the first
 * screen of a table sorted by "worst burn" would be rows that have no burn to
 * speak of. Nulls are absent data and belong last either way.
 */
export function cmpNum(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

export function cmpText(a: string | null, b: string | null): number {
  return (a ?? "").localeCompare(b ?? "", "en", { sensitivity: "base" });
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  title,
  hint,
  initialSort,
  initialDesc = true,
  exportName,
  searchPlaceholder,
  footnote,
  emptyText,
  defaultPageSize = 25,
  collapsible = false,
  defaultOpen = true,
  summary,
  freezeFirstColumn = false,
  maxBodyHeight,
}: Props<T>) {
  const [sortKey, setSortKey] = useState<string | null>(initialSort ?? null);
  const [desc, setDesc] = useState(initialDesc);
  const [query, setQuery] = useState("");
  const [pageSize, setPageSize] = useState<PageSize>(defaultPageSize);
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState(defaultOpen);
  const searchId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);

  const searchable = useMemo(() => columns.filter((c) => c.search), [columns]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || searchable.length === 0) return rows;
    // Every term must match somewhere in the row, so "anna dguv" narrows
    // instead of widening — the behaviour people expect from a filter box, and
    // the opposite of what a single includes() on the joined string gives.
    const terms = q.split(/\s+/);
    return rows.filter((r) => {
      const hay = searchable.map((c) => c.search!(r)).join(" ").toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }, [rows, query, searchable]);

  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    const col = columns.find((c) => c.key === sortKey);
    if (!col?.compare) return filtered;
    // Copy before sorting: `filtered` can be the `rows` prop itself when no
    // search is active, and sorting in place would mutate a prop.
    const out = [...filtered].sort(col.compare);
    return desc ? out.reverse() : out;
  }, [filtered, sortKey, desc, columns]);

  const total = sorted.length;
  const size = pageSize === "all" ? total : pageSize;
  const pageCount = size > 0 ? Math.max(1, Math.ceil(total / size)) : 1;

  // A filter or a sort can leave the stored page past the end of the data.
  // Clamped during RENDER rather than corrected in an effect: the rows and the
  // "showing X–Y" line then always agree on the same frame, and there is no
  // cascading second render (which is also what react-hooks/set-state-in-effect
  // objects to). `page` itself is left alone, so clearing a search returns you
  // to the page you were on rather than to the top.
  const safePage = Math.min(page, pageCount - 1);

  const start = pageSize === "all" ? 0 : safePage * size;
  const visible = pageSize === "all" ? sorted : sorted.slice(start, start + size);

  const onSort = (col: Column<T>) => {
    if (!col.compare) return;
    if (sortKey === col.key) {
      setDesc((v) => !v);
    } else {
      setSortKey(col.key);
      setDesc(col.descFirst ?? true);
    }
    setPage(0);
  };

  /**
   * Export what is on screen, not the original array.
   *
   * Deliberate: the file matches the table the person is looking at — same
   * filter, same sort — so a spreadsheet they build from it reconciles with the
   * screenshot they paste beside it. The header row states the row count so a
   * truncated export cannot be mistaken for the whole dataset.
   */
  const download = () => {
    const cols = columns.filter((c) => c.csv);
    const lines = [
      cols.map((c) => csvCell(c.header)).join(","),
      ...sorted.map((r) => cols.map((c) => csvCell(c.csv!(r))).join(",")),
    ];
    const blob = new Blob(["\uFEFF" + lines.join("\r\n")], {
      // BOM + CRLF so Excel on a German locale opens it without mangling
      // umlauts, which is the only spreadsheet this will ever be opened in.
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${exportName ?? title.toLowerCase().replace(/\s+/g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Every table on /time/dashboard inherits this chrome, so an English literal
  // here is English on the German page however well the page itself is
  // translated. Counts follow the request locale for the same reason.
  const t = useTranslations("dataTable");
  const showing =
    total === 0
      ? t("noRows")
      : pageSize === "all"
        ? t("allRows", { count: total })
        : t("range", { from: start + 1, to: Math.min(start + size, total), count: total });

  // Only tall pages get an internal scroller. Applying max-height unconditionally
  // would put a scrollbar inside a five-row table, which looks broken.
  const scrolls = visible.length > 25;

  // An explicit cap overrides that heuristic, and is applied as a real inline
  // style rather than an arbitrary-value Tailwind class: the value comes from
  // the caller at runtime, and Tailwind can only generate classes it saw in the
  // source at build time.
  const capped = maxBodyHeight !== undefined;
  const bodyMaxHeight = !capped
    ? undefined
    : maxBodyHeight === true
      ? DEFAULT_MAX_BODY_HEIGHT
      : typeof maxBodyHeight === "number"
        ? `${maxBodyHeight}px`
        : maxBodyHeight;

  /**
   * Sticky classes for the first cell of a row when the label column is frozen.
   * `left-0` pins it to the scroller's edge; the opaque background stops the
   * columns sliding underneath from showing through; the `after` hairline gives
   * the frozen edge a visible seam so it reads as pinned rather than misaligned.
   * The header cell sits a layer above the body cells so the two stickies do not
   * fight where they cross.
   */
  const frozenCell = (index: number, isHeader: boolean) =>
    freezeFirstColumn && index === 0
      ? `sticky left-0 ${isHeader ? "z-20" : "z-10"} bg-[var(--surface)] ${
          isHeader ? "" : "group-hover:bg-[var(--surface-hover)]"
        } after:pointer-events-none after:absolute after:inset-y-0 after:right-0 after:w-px after:bg-[var(--border)]`
      : "";

  return (
    <section className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] card-elev">
      {/*
        CardHeader geometry, not a bespoke 10px mono kicker: a table is a panel
        with a heading, and the heading dialect is the one every other card on
        the page uses -- 13/600 sans title, 10px mono qualifier beside it. The
        controls on the right are what keep this from BEING a CardHeader.
      */}
      <header className="flex flex-col gap-2 border-b border-[var(--divider)] px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        {(() => {
          const heading = (
            <>
              <h2 className="flex items-center gap-1.5 t-title-3 text-[var(--text-primary)]">
                {collapsible && (
                  <IconCaret
                    className={`flex-none text-[var(--text-faint)] transition-transform duration-150 ${
                      open ? "" : "-rotate-90"
                    }`}
                  />
                )}
                {title}
              </h2>
              <span className="t-label text-[var(--text-faint)]">
                {/* The row count is stated whether open or shut. A collapsed
                    panel must never look like an absent one. */}
                {open ? showing : (summary ?? showing)}
                {open && query.trim() && rows.length !== total
                  ? ` · ${t("filteredFrom", { count: rows.length })}`
                  : ""}
                {/* The hint is appended only while OPEN. A collapsed `summary`
                    is written to stand alone and usually restates the same
                    fact, which rendered as "20 over budget · 20 over budget". */}
                {open && hint ? ` · ${hint}` : ""}
              </span>
            </>
          );

          return collapsible ? (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              className="flex min-w-0 flex-col gap-0.5 rounded-[var(--radius-sm)] text-left transition-transform duration-100 active:translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
            >
              {heading}
            </button>
          ) : (
            <div className="flex min-w-0 flex-col gap-0.5">{heading}</div>
          );
        })()}

        {/* Controls belong to the rows, so they go away with them. Leaving a
            search box and a pager above a collapsed table is a row of controls
            with nothing to control. */}
        <div className={`flex flex-none flex-wrap items-center gap-1.5 ${open ? "" : "hidden"}`}>
          {searchable.length > 0 && (
            <div className="relative">
              {/* A real <label>, visually hidden, rather than the SearchInput
                  primitive's aria-label form: the label is what the table's
                  gate reads, and the skin is shared through controlClass. */}
              <label className="sr-only" htmlFor={searchId}>
                {t("searchLabel", { title: title.toLowerCase() })}
              </label>
              <input
                id={searchId}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(0);
                }}
                placeholder={searchPlaceholder ?? t("searchPlaceholder")}
                // No `outline-none`: the global :focus-visible ring is the
                // keyboard story, and controlClass already tints the border.
                className={`${controlClass} w-[9.5rem] py-1 pl-2.5 pr-7 sm:w-[12rem]`}
              />
              {query && (
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    setPage(0);
                  }}
                  aria-label={t("clearSearch")}
                  className="absolute right-1 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
                >
                  <IconCross className="h-3 w-3" />
                </button>
              )}
            </div>
          )}

          {/* Page sizes wear the segmented skin: a choice among a few, one lit. */}
          <div role="group" aria-label={t("rowsPerPageGroup")} className={segmentedTrackClass}>
            {PAGE_SIZES.map((s) => (
              <button
                key={String(s)}
                type="button"
                onClick={() => {
                  setPageSize(s);
                  setPage(0);
                }}
                aria-pressed={pageSize === s}
                title={s === "all" ? t("showEveryRow") : t("rowsPerPage", { count: s })}
                className={segmentedItemClass(pageSize === s)}
              >
                {s === "all" ? t("all") : s}
              </button>
            ))}
          </div>

          {exportName !== undefined && total > 0 && (
            <Button variant="ghost" size="sm" onClick={download} title={t("csvTitle")} className="font-mono">
              CSV
            </Button>
          )}
        </div>
      </header>

      {!open ? null : rows.length === 0 ? (
        <p className="px-4 py-6 text-center t-subhead text-[var(--text-faint)]">{emptyText ?? t("empty")}</p>
      ) : total === 0 ? (
        <p className="px-4 py-6 text-center t-subhead text-[var(--text-faint)]">
          {t("noMatch", { query: query.trim() })}{" "}
          <button
            type="button"
            onClick={() => setQuery("")}
            className="text-[var(--accent)] underline-offset-2 transition-transform duration-100 hover:underline active:translate-y-px"
          >
            {t("clearTheSearch")}
          </button>
        </p>
      ) : (
        <>
          <div
            ref={scrollRef}
            className={`overflow-x-auto ${
              capped ? "overflow-y-auto" : scrolls ? "max-h-[70vh] overflow-y-auto" : ""
            }`}
            style={bodyMaxHeight ? { maxHeight: bodyMaxHeight } : undefined}
          >
            <table className="w-full border-collapse">
              <thead
                // Sticky so the column meaning survives scrolling a long table.
                // Opaque background, because a translucent header over scrolling
                // numbers is unreadable.
                // The hairline is a shadow because border-collapse eats a
                // sticky thead's own border; --divider, not --border, because
                // it separates rows inside ONE surface (Card.tsx's two-tier rule).
                className="sticky top-0 z-10 bg-[var(--surface)] shadow-[0_1px_0_var(--divider)]"
              >
                <tr>
                  {columns.map((c, i) => {
                    const active = sortKey === c.key;
                    const sortable = Boolean(c.compare);
                    return (
                      <th
                        key={c.key}
                        scope="col"
                        aria-sort={active ? (desc ? "descending" : "ascending") : "none"}
                        className={`whitespace-nowrap ${c.compact ? "px-2" : "px-4"} py-2 t-label ${
                          c.align === "right" ? "text-right" : "text-left"
                        } ${active ? "text-[var(--accent)]" : "text-[var(--text-faint)]"} ${frozenCell(i, true)} ${c.className ?? ""}`}
                      >
                        {sortable ? (
                          <button
                            type="button"
                            onClick={() => onSort(c)}
                            title={c.title ?? `Sort by ${c.header.toLowerCase()}`}
                            className={`inline-flex items-center gap-1 transition-[color,transform] duration-150 hover:text-[var(--text-primary)] active:translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${
                              c.align === "right" ? "flex-row-reverse" : ""
                            }`}
                          >
                            <span>{c.header}</span>
                            {/* The inactive marker is rendered too, at low
                                opacity, so the column's width does not jump
                                when the sort moves to it. Same caret as
                                SortHeader: descending points down. */}
                            <IconCaret
                              className={`flex-none transition-transform duration-150 ${
                                active ? (desc ? "" : "rotate-180") : "opacity-25"
                              }`}
                            />
                          </button>
                        ) : (
                          <span title={c.title}>{c.header}</span>
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr
                    key={rowKey(r)}
                    className="group border-b border-[var(--divider)] transition-colors last:border-0 hover:bg-[var(--surface-hover)]"
                  >
                    {columns.map((c, i) => (
                      <td
                        key={c.key}
                        className={`${c.compact ? "px-2" : "px-4"} py-1.5 t-callout ${
                          c.align === "right" ? "text-right" : "text-left"
                        } ${frozenCell(i, false)} ${c.className ?? ""}`}
                      >
                        {c.cell(r)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {(pageCount > 1 || footnote) && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--divider)] px-4 py-1.5">
              {/* Prose, so it is set in the sans face at 11px with real leading,
                  not as a 10px mono label -- a sentence is not a column header. */}
              <span className="t-subhead text-[var(--text-faint)]">{footnote}</span>
              {pageCount > 1 && (
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setPage((p) => Math.max(0, p - 1));
                      scrollRef.current?.scrollTo({ top: 0 });
                    }}
                    disabled={safePage === 0}
                    className="font-mono tracking-[0.06em] disabled:opacity-35"
                  >
                    <IconArrowRight className="h-3.5 w-3.5 rotate-180" />
                    {t("prev")}
                  </Button>
                  <span className="px-1 t-label text-[var(--text-faint)]">
                    {safePage + 1} / {pageCount}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setPage((p) => Math.min(pageCount - 1, p + 1));
                      scrollRef.current?.scrollTo({ top: 0 });
                    }}
                    disabled={safePage >= pageCount - 1}
                    className="font-mono tracking-[0.06em] disabled:opacity-35"
                  >
                    {t("next")}
                    <IconArrowRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
