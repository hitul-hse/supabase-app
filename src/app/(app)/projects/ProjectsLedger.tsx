"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { SortHeader, type SortDirection } from "@/components/ui/Field";
import type { ProjectListRow } from "@/lib/queries/projects-live";
import { Pager, usePager } from "@/components/Pager";
// Imported, never redefined. Two copies of the burn thresholds is how the list
// and the detail page end up disagreeing about whether a project is "at risk".
import { burnColor } from "./ProjectPanels";
import { Card } from "@/components/ui/Card";

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
 * How many rows the PHONE shows before asking, within the same page of 30.
 *
 * The desktop row is a 12-column grid ~28px tall. Under 640px that grid is
 * unreadable, so the mobile branch renders a stacked card instead -- name,
 * customer, a burn bar and two figures -- which measures ~95px. Thirty of those
 * is 2,871px, and audit-mobile.mjs measured exactly that: the ledger alone was
 * 3.4 of the 7.1 screens this route occupied at 390px. The same 30 rows are
 * ~840px on a desktop, which is why this never showed up at 1440px.
 *
 * Eight rows is ~760px, just under one phone screen, so the first paint is the
 * top of the sorted list and the pager is reachable without a scroll. It is a
 * VIEW cap, not a page cap: the pager still pages in 30, the count line still
 * states the total, and one tap reveals the rest of the page in place. Nothing
 * is unreachable and no number changes.
 */
const MOBILE_ROWS = 8;

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
  const [sortKey, setSortKey] = useState<LedgerSort>(initialSort);
  const [sortDir, setSortDir] = useState<SortDirection>(initialSort === "name" ? "asc" : "desc");
  /** Phone only: has the reader asked for the rest of this page? */
  const [mobileExpanded, setMobileExpanded] = useState(false);

  const sorted = sortRows(rows, sortKey, sortDir);

  const tableRef = useRef<HTMLDivElement>(null);
  const pager = usePager(sorted.length, PAGE_SIZE, `${sortKey}|${sortDir}|${rows.length}`);
  const visible = sorted.slice(pager.start, pager.end);
  // Re-collapsing on a sort or page change is deliberate: the point of the cap
  // is that the first paint after any control is one screen.
  const mobileVisible = mobileExpanded ? visible : visible.slice(0, MOBILE_ROWS);
  const mobileHidden = visible.length - mobileVisible.length;

  const handleSort = (key: string) => {
    const next = key as LedgerSort;
    if (next === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(next);
      setSortDir(next === "name" ? "asc" : "desc");
    }
  };

  if (rows.length === 0) {
    return (
      <EmptyState
        title="No projects match"
        description="No project matches the current filters. Clearing them above brings the full portfolio back."
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="font-mono text-[10px] tracking-[0.14em] text-[var(--text-muted)]">
          PROJECT LEDGER
        </h2>
        <span className="font-mono text-[10px] tracking-[0.06em] text-[var(--text-faint)]">
          {rows.length.toLocaleString("en-GB")} PROJECTS
        </span>
      </div>

      <Card className="overflow-hidden">
        {/* Mobile cards — a 7-column grid is unreadable under ~640px. */}
        <div className="flex flex-col divide-y divide-[var(--divider)] sm:hidden">
          {mobileVisible.map((p) => (
            <Link
              key={p.id}
              data-ledger-row
              href={`/projects/${p.id}`}
              className="flex flex-col gap-1.5 px-3 py-2.5 hover:bg-[var(--surface-hover)]"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-[12px] font-medium text-[var(--text-primary)]">{p.name}</span>
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

          {/*
            The count is stated whether expanded or not (DESIGN.md rule 7): a
            capped list with no count is indistinguishable from a truncated one.
            `sm:hidden` is inherited from the wrapper, so the desktop tree below
            never sees this control.
          */}
          {(mobileHidden > 0 || mobileExpanded) && (
            <button
              type="button"
              onClick={() => setMobileExpanded((v) => !v)}
              aria-expanded={mobileExpanded}
              className="px-3 py-2.5 text-left font-mono text-[10px] tracking-[0.08em] text-[var(--accent)]"
            >
              {mobileExpanded
                ? `SHOW FEWER · ${mobileVisible.length} OF ${sorted.length.toLocaleString("en-GB")} PROJECTS`
                : `SHOW ${mobileHidden} MORE ON THIS PAGE · ${mobileVisible.length} OF ${sorted.length.toLocaleString("en-GB")} PROJECTS`}
            </button>
          )}
        </div>

        <div ref={tableRef} className="hidden sm:block">
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
              data-ledger-row
              className="grid min-w-[900px] grid-cols-12 items-center gap-3 border-b border-[var(--divider)] px-3 py-1 text-[12.5px] transition-colors duration-100 last:border-b-0 hover:bg-[var(--surface-hover)]"
            >
              <Link
                href={`/projects/${p.id}`}
                className="col-span-4 truncate text-[12.5px] font-medium text-[var(--text-primary)] hover:text-[var(--accent)]"
                title={p.name}
              >
                {p.name}
              </Link>
              <span className="col-span-2 truncate text-[var(--text-secondary)]" title={p.customerName ?? ""}>
                {p.customerName ?? "—"}
              </span>
              <span className="col-span-1 text-right font-mono text-[11px] text-[var(--text-secondary)]">
                {p.estimatedHours && p.estimatedHours > 0 ? h(p.estimatedHours) : "—"}
              </span>
              <span className="col-span-1 text-right font-mono text-[11px] text-[var(--text-primary)]">
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
              <span className="col-span-1 text-right font-mono text-[10px] text-[var(--text-faint)]">
                {p.lastActivity ?? "never"}
              </span>
            </div>
          ))}
        </div>

        <Pager state={pager} total={sorted.length} noun="projects" anchorRef={tableRef} />
      </Card>
    </div>
  );
}
