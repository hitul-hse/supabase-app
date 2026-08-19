"use client";
/**
 * The table shell every dashboard breakdown renders through.
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
import { useId, useMemo, useRef, useState } from "react";

export type Align = "left" | "right";

export type Column<T> = {
  /** Stable id, used for the sort key in state. */
  key: string;
  header: string;
  align?: Align;
  /** Tailwind width class, e.g. "w-[11rem]". */
  className?: string;
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
};

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
  searchPlaceholder = "Search rows…",
  footnote,
  emptyText = "Nothing to show.",
  defaultPageSize = 25,
  collapsible = false,
  defaultOpen = true,
  summary,
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

  const showing =
    total === 0
      ? "no rows"
      : pageSize === "all"
        ? `all ${total.toLocaleString("en-GB")} rows`
        : `${(start + 1).toLocaleString("en-GB")}–${Math.min(start + size, total).toLocaleString("en-GB")} of ${total.toLocaleString("en-GB")}`;

  // Only tall pages get an internal scroller. Applying max-height unconditionally
  // would put a scrollbar inside a five-row table, which looks broken.
  const scrolls = visible.length > 25;

  return (
    <section className="border border-[var(--border)] bg-[var(--surface)]">
      <header className="flex flex-col gap-2 border-b border-[var(--border)] px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        {(() => {
          const heading = (
            <>
              <h2 className="font-mono text-[10px] font-semibold tracking-[0.14em] text-[var(--text-primary)]">
                {collapsible && (
                  <span
                    aria-hidden
                    className={`mr-1.5 inline-block text-[8px] text-[var(--text-faint)] transition-transform ${
                      open ? "rotate-90" : ""
                    }`}
                  >
                    ▶
                  </span>
                )}
                {title}
              </h2>
              <span className="text-[10px] leading-tight text-[var(--text-faint)]">
                {/* The row count is stated whether open or shut. A collapsed
                    panel must never look like an absent one. */}
                {open ? showing : (summary ?? showing)}
                {open && query.trim() && rows.length !== total
                  ? ` · filtered from ${rows.length.toLocaleString("en-GB")}`
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
              className="flex min-w-0 flex-col gap-0.5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
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
              <label className="sr-only" htmlFor={searchId}>
                Search {title.toLowerCase()}
              </label>
              <input
                id={searchId}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(0);
                }}
                placeholder={searchPlaceholder}
                className="w-[9.5rem] border border-[var(--border)] bg-[var(--page)] py-1 pl-2 pr-6 text-[11px] text-[var(--text-primary)] outline-none transition-colors placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] sm:w-[12rem]"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    setPage(0);
                  }}
                  aria-label="Clear search"
                  className="absolute right-1 top-1/2 -translate-y-1/2 px-1 text-[11px] text-[var(--text-faint)] hover:text-[var(--critical)]"
                >
                  ×
                </button>
              )}
            </div>
          )}

          <div className="flex overflow-hidden border border-[var(--border)]">
            {PAGE_SIZES.map((s) => (
              <button
                key={String(s)}
                type="button"
                onClick={() => {
                  setPageSize(s);
                  setPage(0);
                }}
                aria-pressed={pageSize === s}
                title={s === "all" ? "Show every row" : `${s} rows per page`}
                className={`px-1.5 py-1 font-mono text-[10px] transition-colors ${
                  pageSize === s
                    ? "bg-[var(--surface-hover)] text-[var(--text-primary)]"
                    : "text-[var(--text-faint)] hover:text-[var(--text-primary)]"
                }`}
              >
                {s === "all" ? "ALL" : s}
              </button>
            ))}
          </div>

          {exportName !== undefined && total > 0 && (
            <button
              type="button"
              onClick={download}
              title="Download these rows as CSV, with the current filter and sort applied"
              className="border border-[var(--border)] px-2 py-1 font-mono text-[10px] text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
            >
              CSV
            </button>
          )}
        </div>
      </header>

      {!open ? null : rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-[11px] text-[var(--text-faint)]">{emptyText}</p>
      ) : total === 0 ? (
        <p className="px-4 py-6 text-center text-[11px] text-[var(--text-faint)]">
          No row matches “{query.trim()}”.{" "}
          <button
            type="button"
            onClick={() => setQuery("")}
            className="text-[var(--accent)] underline-offset-2 hover:underline"
          >
            Clear the search
          </button>
        </p>
      ) : (
        <>
          <div
            ref={scrollRef}
            className={`overflow-x-auto ${scrolls ? "max-h-[70vh] overflow-y-auto" : ""}`}
          >
            <table className="w-full border-collapse">
              <thead
                // Sticky so the column meaning survives scrolling a long table.
                // Opaque background, because a translucent header over scrolling
                // numbers is unreadable.
                className="sticky top-0 z-10 bg-[var(--surface)] shadow-[0_1px_0_var(--border)]"
              >
                <tr>
                  {columns.map((c) => {
                    const active = sortKey === c.key;
                    const sortable = Boolean(c.compare);
                    return (
                      <th
                        key={c.key}
                        scope="col"
                        aria-sort={active ? (desc ? "descending" : "ascending") : "none"}
                        className={`whitespace-nowrap px-4 py-2 font-mono text-[10px] font-medium tracking-[0.1em] ${
                          c.align === "right" ? "text-right" : "text-left"
                        } ${active ? "text-[var(--accent)]" : "text-[var(--text-faint)]"} ${c.className ?? ""}`}
                      >
                        {sortable ? (
                          <button
                            type="button"
                            onClick={() => onSort(c)}
                            title={c.title ?? `Sort by ${c.header.toLowerCase()}`}
                            className={`inline-flex items-center gap-1 transition-colors hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${
                              c.align === "right" ? "flex-row-reverse" : ""
                            }`}
                          >
                            <span>{c.header}</span>
                            {/* The inactive marker is rendered too, at low
                                opacity, so the column's width does not jump
                                when the sort moves to it. */}
                            <span aria-hidden className={active ? "" : "opacity-25"}>
                              {active ? (desc ? "▼" : "▲") : "▾"}
                            </span>
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
                    className="border-b border-[var(--border)] transition-colors last:border-0 hover:bg-[var(--surface-hover)]"
                  >
                    {columns.map((c) => (
                      <td
                        key={c.key}
                        className={`px-4 py-2 text-[12px] ${
                          c.align === "right" ? "text-right" : "text-left"
                        } ${c.className ?? ""}`}
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
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] px-4 py-1.5">
              <span className="text-[10px] text-[var(--text-faint)]">{footnote}</span>
              {pageCount > 1 && (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      setPage((p) => Math.max(0, p - 1));
                      scrollRef.current?.scrollTo({ top: 0 });
                    }}
                    disabled={safePage === 0}
                    className="border border-[var(--border)] px-2 py-0.5 font-mono text-[10px] text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-[var(--border)] disabled:hover:text-[var(--text-secondary)]"
                  >
                    ← PREV
                  </button>
                  <span className="px-1 font-mono text-[10px] tabular-nums text-[var(--text-faint)]">
                    {safePage + 1} / {pageCount}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setPage((p) => Math.min(pageCount - 1, p + 1));
                      scrollRef.current?.scrollTo({ top: 0 });
                    }}
                    disabled={safePage >= pageCount - 1}
                    className="border border-[var(--border)] px-2 py-0.5 font-mono text-[10px] text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-[var(--border)] disabled:hover:text-[var(--text-secondary)]"
                  >
                    NEXT →
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
