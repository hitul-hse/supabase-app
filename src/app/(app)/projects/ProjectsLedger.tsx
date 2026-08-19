"use client";

import { useMemo, useState, useRef } from "react";
import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/Button";
import { FilterChip, SearchInput, SortHeader, type SortDirection } from "@/components/ui/Field";
import type { ProjectListRow } from "@/lib/queries/projects-live";
import { Pager, usePager } from "@/components/Pager";
// Imported, never redefined. Two copies of the burn thresholds is how the list
// and the detail page end up disagreeing about whether a project is "at risk".
import { burnColor } from "./ProjectPanels";

/**
 * The projects ledger — 334 real projects, made reachable without scrolling.
 *
 * WHAT WAS WRONG
 * --------------
 * Every project rendered, always, in one ungated list: 334 rows at ~41px is
 * ~13,700px, roughly FIFTEEN full screens. There was no search, no pagination
 * and no way to filter by status, so finding one project meant scrolling for it
 * or using the browser's own find. Sorting was a set of `<Link>`s that round-
 * tripped to the server and re-rendered the page for what is a pure reordering
 * of data already in the browser.
 *
 * Measured against the live portfolio, most of that scroll carried nothing:
 * 136 of 334 projects (41%) have zero logged hours, 83 (25%) have no budget,
 * and 27 rows are entirely dashes. Meanwhile the 9 projects actually over
 * budget — the single most actionable signal on the page — were buried in it.
 *
 * THE THREE FIXES, IN ORDER OF EFFECT
 * -----------------------------------
 * 1. **Page the list.** 30 rows initially with an explicit "show more". This is
 *    what takes 15 screens down to ~1.3, and it is reversible in one click.
 * 2. **Filter by status.** Chips for over budget / at risk / no budget / no
 *    activity, each carrying its count, so "which projects are overrunning" is
 *    one click rather than a scan.
 * 3. **Tighten the row.** ~41px to ~30px. Worth doing, but note it is the
 *    SMALLEST of the three — compaction alone would still leave 10 screens.
 *
 * WHY NOTHING IS FILTERED BY DEFAULT
 * ----------------------------------
 * It is tempting to hide the 136 zero-hour projects out of the gate. They are
 * still real projects someone created, and a list whose count silently
 * disagrees with TrackingTime's own is how people stop trusting the page. They
 * are paged past, not hidden: sorting puts them last and the chip makes them
 * one click away.
 *
 * WHY SORTING MOVED TO THE CLIENT
 * -------------------------------
 * All 334 rows are already in the browser — the server sends the whole list to
 * compute the on-screen totals. Re-sorting them is free here and costs a full
 * server round-trip through the URL. The `?sort=` param is still honoured as
 * the initial state so existing links keep working.
 */

const h = (n: number) => n.toLocaleString("en-GB", { maximumFractionDigits: 1 });

export type LedgerSort = "burn" | "hours" | "recent" | "name" | "budget" | "people";

/**
 * How many rows render before the reader has to ask for more.
 *
 * 30 rather than 50: at ~28px a row, 50 rows is still most of two screens, and
 * the point of paging is that the first paint is scannable without scrolling.
 * Anyone who wants the long list is one click from it, and the sort order means
 * the rows that matter are already at the top.
 */
const PAGE_SIZE = 30;

/**
 * Sort, with unmeasured rows pinned last in BOTH directions.
 *
 * A null burn means "nobody set a budget", not "0% burned". Coercing it to 0
 * would float 83 unbudgeted projects above a project at 140% — inverting the
 * exact signal the column exists to surface. Reversing a sort must not promote
 * an absence of data to the top, so nulls stay at the bottom either way.
 */
export function sortRows(
  rows: ProjectListRow[],
  key: LedgerSort,
  dir: SortDirection,
): ProjectListRow[] {
  const sign = dir === "asc" ? 1 : -1;
  const byName = (a: ProjectListRow, b: ProjectListRow) =>
    a.name.localeCompare(b.name, "en", { sensitivity: "base" });

  /**
   * The sortable value for a row, or null when the column has no measurement
   * for it. `estimatedHours = 0` is mapped to null on purpose: the vendor uses
   * zero to mean "nobody set a budget", not "a budget of zero hours".
   */
  const valueOf = (p: ProjectListRow): number | string | null => {
    switch (key) {
      case "burn":
        return p.burnPercent;
      case "budget":
        return p.estimatedHours && p.estimatedHours > 0 ? p.estimatedHours : null;
      case "recent":
        return p.lastActivity;
      case "hours":
        return p.actualHours;
      case "people":
        return p.memberCount;
      case "name":
      default:
        return p.name;
    }
  };

  return [...rows].sort((a, b) => {
    if (key === "name") return byName(a, b) * sign;

    const av = valueOf(a);
    const bv = valueOf(b);

    // Nulls are pinned last and NOT multiplied by `sign`, so reversing the sort
    // cannot promote an unmeasured row to the top.
    if (av === null && bv === null) return byName(a, b);
    if (av === null) return 1;
    if (bv === null) return -1;

    const cmp =
      typeof av === "string" && typeof bv === "string" ? av.localeCompare(bv) : Number(av) - Number(bv);

    // Ties fall back to name so the order is stable and reproducible rather
    // than dependent on the incoming row order.
    return cmp === 0 ? byName(a, b) : cmp * sign;
  });
}

type Facet = "over" | "risk" | "nobudget" | "idle";

/** Does one row belong to a facet? Kept pure so the gate can exercise it. */
export function matchesFacet(p: ProjectListRow, facet: Facet): boolean {
  switch (facet) {
    case "over":
      return p.burnPercent !== null && p.burnPercent > 100;
    case "risk":
      return p.burnPercent !== null && p.burnPercent >= 85 && p.burnPercent <= 100;
    case "nobudget":
      return p.burnPercent === null;
    case "idle":
      return p.actualHours === 0;
  }
}

export function ProjectsLedger({
  rows,
  initialSort = "burn",
}: {
  rows: ProjectListRow[];
  initialSort?: LedgerSort;
}) {
  const [query, setQuery] = useState("");
  const [facets, setFacets] = useState<Set<Facet>>(new Set());
  const [sortKey, setSortKey] = useState<LedgerSort>(initialSort);
  const [sortDir, setSortDir] = useState<SortDirection>(initialSort === "name" ? "asc" : "desc");

  // Counts come from the FULL list, never the filtered one. A chip whose count
  // shrinks to match the current filter tells the reader nothing they cannot
  // already see, and makes it impossible to judge whether it is worth clicking.
  const counts = useMemo(
    () => ({
      over: rows.filter((p) => matchesFacet(p, "over")).length,
      risk: rows.filter((p) => matchesFacet(p, "risk")).length,
      nobudget: rows.filter((p) => matchesFacet(p, "nobudget")).length,
      idle: rows.filter((p) => matchesFacet(p, "idle")).length,
    }),
    [rows],
  );

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    const matched = rows.filter((p) => {
      const matchesSearch =
        q === "" ||
        p.name.toLowerCase().includes(q) ||
        (p.customerName ?? "").toLowerCase().includes(q) ||
        (p.code ?? "").toLowerCase().includes(q);
      // Facets are OR'd, not AND'd: "over budget" and "at risk" are disjoint,
      // so AND-ing them would always yield an empty list — a filter row where
      // clicking a second chip empties the table is a trap, not a feature.
      const matchesFacets =
        facets.size === 0 || [...facets].some((f) => matchesFacet(p, f));
      return matchesSearch && matchesFacets;
    });
    return sortRows(matched, sortKey, sortDir);
  }, [rows, q, facets, sortKey, sortDir]);

  /*
   * Paged, not appended.
   *
   * The previous control added PAGE_SIZE rows per click, so the document grew each time and
   * the reader had to scroll further to reach the button again -- with 334 live projects,
   * up to about 13 screens. A page index keeps the ledger a constant height.
   *
   * The reset key is the filter and sort state: when the result set changes, page 7 of a
   * list that just became 3 rows long would render empty and read as "no results".
   */
  // Scroll target for a page change: without it, paging from the bottom of one page
  // leaves you at the bottom of the next, reading its last rows first.
  const tableRef = useRef<HTMLDivElement>(null);

  const pager = usePager(
    filtered.length,
    PAGE_SIZE,
    `${q}|${[...facets].sort().join(",")}|${sortKey}|${sortDir}`,
  );
  const visible = filtered.slice(pager.start, pager.end);
  const activeFilters = facets.size + (q ? 1 : 0);

  const toggleFacet = (f: Facet) => {
    setFacets((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });
    // Any change to the result set resets paging: leaving the limit at 200
    // after filtering down to 9 rows would show a "show more" control that
    // does nothing.

  };

  const handleSort = (key: string) => {
    const next = key as LedgerSort;
    if (next === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(next);
      // Names read naturally A→Z; every numeric column is more useful
      // largest-first, which is what someone scanning for outliers wants.
      setSortDir(next === "name" ? "asc" : "desc");
    }

  };

  const clearAll = () => {
    setQuery("");
    setFacets(new Set());

  };

  return (
    <div className="flex flex-col gap-3">
      {/* ------------------------------------------------------------ toolbar */}
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
        <SearchInput
          value={query}
          onValueChange={(v) => {
            setQuery(v);

          }}
          label="Search projects by name, customer or code"
          placeholder="Search 334 projects…"
          className="sm:w-72"
        />

        <div className="flex flex-wrap items-center gap-1.5">
          <FilterChip active={facets.has("over")} onToggle={() => toggleFacet("over")} count={counts.over}>
            OVER BUDGET
          </FilterChip>
          <FilterChip active={facets.has("risk")} onToggle={() => toggleFacet("risk")} count={counts.risk}>
            AT RISK
          </FilterChip>
          <FilterChip
            active={facets.has("nobudget")}
            onToggle={() => toggleFacet("nobudget")}
            count={counts.nobudget}
          >
            NO BUDGET
          </FilterChip>
          <FilterChip active={facets.has("idle")} onToggle={() => toggleFacet("idle")} count={counts.idle}>
            NO ACTIVITY
          </FilterChip>
        </div>

        <div className="flex items-center gap-3 sm:ml-auto">
          <span
            className="font-mono text-[10.5px] tracking-[0.06em] text-[var(--text-muted)]"
            // Announced when filtering changes the result count, so a
            // screen-reader user learns the table shrank without re-reading it.
            role="status"
            aria-live="polite"
          >
            {filtered.length === rows.length
              ? `${rows.length} PROJECTS`
              : `${filtered.length} OF ${rows.length}`}
          </span>
          {activeFilters > 0 && (
            <Button variant="ghost" size="sm" onClick={clearAll}>
              Clear
            </Button>
          )}
        </div>
      </div>

      {/* -------------------------------------------------------------- table */}
      {filtered.length === 0 ? (
        <EmptyState
          title="No projects match"
          description="No project matches the current search and filters. Clearing them brings the full portfolio back."
          action={
            <Button variant="secondary" size="sm" onClick={clearAll}>
              Clear filters
            </Button>
          }
        />
      ) : (
        <div className="border border-[var(--border)] bg-[var(--surface)]">
          {/* Mobile cards — a 7-column grid is unreadable under ~640px. */}
          <div className="flex flex-col divide-y divide-[var(--divider)] sm:hidden">
            {visible.map((p) => (
              <Link
                key={p.id}
                href={`/projects/${p.id}`}
                className="flex flex-col gap-1.5 px-3 py-2.5 hover:bg-[var(--surface-hover)]"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[12.5px] font-medium text-[var(--text-primary)]">{p.name}</span>
                  <span
                    className="shrink-0 font-mono text-[11px] font-semibold"
                    style={{ color: burnColor(p.burnPercent) }}
                  >
                    {p.burnPercent === null ? "n/a" : `${p.burnPercent}%`}
                  </span>
                </div>
                <span className="font-mono text-[10px] text-[var(--text-muted)]">
                  {p.customerName ?? "No customer"}
                </span>
                <div className="h-1 w-full bg-[var(--border)]">
                  <div
                    className="h-full"
                    style={{
                      width: `${Math.min(p.burnPercent ?? 0, 100)}%`,
                      background: burnColor(p.burnPercent),
                    }}
                  />
                </div>
                <div className="flex gap-3 font-mono text-[10px] text-[var(--text-secondary)]">
                  <span>{h(p.actualHours)} H LOGGED</span>
                  <span>
                    {p.estimatedHours && p.estimatedHours > 0
                      ? `${h(p.estimatedHours)} H BUDGET`
                      : "NO BUDGET"}
                  </span>
                </div>
              </Link>
            ))}
          </div>

          {/*
            Desktop table.

            `overflow-x-auto` is deliberately NOT on this wrapper. An overflow
            value other than `visible` makes the element a scroll container, and
            `position: sticky` then sticks to THAT box rather than the viewport —
            measured, not guessed: with the wrapper in place the header sat at
            top 324px and moved to -276px after scrolling 600px, i.e. it scrolled
            away exactly like a static element while still carrying the class.

            The grid is allowed to overflow the page instead. At the 1440px
            viewport this page is designed for, 900px fits with room to spare,
            and the whole ledger is hidden below `sm` anyway.
          */}
          <div ref={tableRef} className="hidden sm:block">
            {/*
              Sticky so the column labels survive a long scroll. Without it the
              reader reaches row 40 and can no longer tell which number is the
              budget and which is the burn.
            */}
            <div className="sticky top-0 z-10 grid min-w-[900px] grid-cols-12 gap-3 border-b border-[var(--border)] bg-[var(--surface-2)] px-3 py-1.5">
              <SortHeader
                label="PROJECT"
                columnKey="name"
                activeKey={sortKey}
                direction={sortDir}
                onSort={handleSort}
                className="col-span-4"
              />
              <span className="col-span-2 font-mono text-[10px] tracking-[0.1em] text-[var(--text-muted)]">
                CUSTOMER
              </span>
              <SortHeader
                label="BUDGET"
                columnKey="budget"
                activeKey={sortKey}
                direction={sortDir}
                onSort={handleSort}
                align="right"
                className="col-span-1 justify-end"
              />
              <SortHeader
                label="LOGGED"
                columnKey="hours"
                activeKey={sortKey}
                direction={sortDir}
                onSort={handleSort}
                align="right"
                className="col-span-1 justify-end"
              />
              <SortHeader
                label="CONSUMED"
                columnKey="burn"
                activeKey={sortKey}
                direction={sortDir}
                onSort={handleSort}
                className="col-span-2"
              />
              <SortHeader
                label="PEOPLE"
                columnKey="people"
                activeKey={sortKey}
                direction={sortDir}
                onSort={handleSort}
                align="right"
                className="col-span-1 justify-end"
              />
              <SortHeader
                label="LAST"
                columnKey="recent"
                activeKey={sortKey}
                direction={sortDir}
                onSort={handleSort}
                align="right"
                className="col-span-1 justify-end"
              />
            </div>

            {visible.map((p) => (
              <div
                key={p.id}
                /*
                 * py-1 rather than py-2.5: ~30px per row against the old ~41px.
                 * The name stays 12.5px — shrinking the one column people
                 * actually read to save 2px is a bad trade, and the measured p90
                 * project name is 44 characters.
                 */
                className="grid min-w-[900px] grid-cols-12 items-center gap-3 border-b border-[var(--divider)] px-3 py-1 text-[12.5px] transition-colors duration-100 last:border-b-0 hover:bg-[var(--surface-hover)]"
              >
                <Link
                  href={`/projects/${p.id}`}
                  className="col-span-4 truncate font-medium text-[var(--text-primary)] hover:text-[var(--accent)]"
                  title={p.name}
                >
                  {p.name}
                </Link>
                <span className="col-span-2 truncate text-[var(--text-secondary)]" title={p.customerName ?? ""}>
                  {p.customerName ?? "—"}
                </span>
                <span className="col-span-1 text-right font-mono text-[11.5px] text-[var(--text-secondary)]">
                  {p.estimatedHours && p.estimatedHours > 0 ? h(p.estimatedHours) : "—"}
                </span>
                <span className="col-span-1 text-right font-mono text-[11.5px] text-[var(--text-primary)]">
                  {h(p.actualHours)}
                </span>
                <div className="col-span-2 flex items-center gap-2">
                  <div className="h-1 flex-1 bg-[var(--border)]">
                    <div
                      className="h-full"
                      style={{
                        width: `${Math.min(p.burnPercent ?? 0, 100)}%`,
                        background: burnColor(p.burnPercent),
                      }}
                    />
                  </div>
                  <span
                    className="w-11 text-right font-mono text-[11px] font-medium"
                    style={{ color: burnColor(p.burnPercent) }}
                  >
                    {p.burnPercent === null ? "n/a" : `${p.burnPercent}%`}
                  </span>
                </div>
                <span className="col-span-1 text-right font-mono text-[11px] text-[var(--text-secondary)]">
                  {p.memberCount || "—"}
                </span>
                <span className="col-span-1 text-right font-mono text-[10.5px] text-[var(--text-faint)]">
                  {p.lastActivity ?? "never"}
                </span>
              </div>
            ))}
          </div>

          {/* ------------------------------------------------------------ paging */}
          {/* Fixed-height paging. The old control appended 30 rows a click, which is what
              made this page grow without bound; anyone who genuinely wants one long list
              can still choose ALL. tableRef scrolls the first row back into view on a page
              change, so paging does not leave you at the bottom of the next page. */}
          <Pager state={pager} total={filtered.length} noun="projects" anchorRef={tableRef} />
        </div>
      )}
    </div>
  );
}
