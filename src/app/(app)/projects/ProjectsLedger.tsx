"use client";

import { useState, useRef, useTransition } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { EmptyState } from "@/components/EmptyState";
import { SortHeader, type SortDirection } from "@/components/ui/Field";
import type { ProjectListRow } from "@/lib/queries/projects-live";
import { Pager, usePager } from "@/components/Pager";
import { AnimatePresence } from "framer-motion";
import {
  DrillDialog,
  drillOriginFrom,
  type Drill,
  type DrillOrigin,
  type DrillRow,
} from "@/components/DrillDialog";
import { secondsToHours } from "@/lib/time-transform";
import { fmtHours, fmtInt, fmtNum, fmtPct } from "@/lib/locale-format";
// Imported, never redefined. Two copies of the burn thresholds is how the list
// and the detail page end up disagreeing about whether a project is "at risk".
import { burnColor } from "./ProjectPanels";
import { Card, CardHeader } from "@/components/ui/Card";
import {
  getProjectHoursDrilldown,
  type ProjectHoursRest,
  type ProjectHoursRow,
} from "./project-drilldown";

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
  locale,
}: {
  rows: ProjectListRow[];
  initialSort?: LedgerSort;
  /**
   * The request locale, handed down by the explorer rather than read with
   * `useLocale()`: the projects gate renders this component bare, outside a
   * request, and absent it every figure formats en-GB exactly as before.
   */
  locale?: string;
}) {
  const [sortKey, setSortKey] = useState<LedgerSort>(initialSort);
  const [sortDir, setSortDir] = useState<SortDirection>(initialSort === "name" ? "asc" : "desc");
  /** Phone only: has the reader asked for the rest of this page? */
  const [mobileExpanded, setMobileExpanded] = useState(false);

  /*
   * The LOGGED figure opens who logged it and on what. The ledger carries one
   * aggregate per project, not the entries, so this is the one drill-down on
   * the page that has to ask the server (project-drilldown.ts, bounded exactly
   * as the row is). The row's own figure stays the headline; the server's rows
   * are made to add up to it -- top 8 each, the rest folded into one labelled
   * row, and any difference to the ledger figure stated as a row of its own
   * rather than hidden.
   */
  const t = useTranslations("drill");
  const tp = useTranslations("projects");
  const tc = useTranslations("common");
  const [drill, setDrill] = useState<Drill | null>(null);
  /** Where the dialog emerges from: the LOGGED figure that was tapped. */
  const [drillOrigin, setDrillOrigin] = useState<DrillOrigin | null>(null);
  /** Hours with their unit, in the reader's language: "1,234.5h" / "1.234,5 Std". */
  const h = (n: number) => fmtHours(n, locale, 1);
  const [, startTransition] = useTransition();

  const openHours = (p: ProjectListRow, from: Element | null) => {
    setDrillOrigin(from ? drillOriginFrom(from) : null);
    const base = {
      kicker: t("projects.ledger.kicker"),
      title: p.name,
      headline: h(p.actualHours),
      headlineValue: p.actualHours,
      check: "sum" as const,
      footer: t("projects.ledger.footer"),
    };
    setDrill({ ...base, loading: true });
    startTransition(async () => {
      const d = await getProjectHoursDrilldown(p.id);
      if (d.error) {
        setDrill({ ...base, error: d.error });
        return;
      }
      const fetchedHours = secondsToHours(d.totals.seconds);
      const gap = Math.round((p.actualHours - fetchedHours) * 100) / 100;
      const section = (
        rows: ProjectHoursRow[],
        rest: ProjectHoursRest,
        moreKey: "morePeople" | "moreTasks",
        fallback: string,
      ): DrillRow[] => {
        const out: DrillRow[] = rows.map((r) => ({
          name: r.name ?? fallback,
          value: `${h(secondsToHours(r.seconds))} · ${t("billableShare", {
            percent: r.seconds > 0 ? Math.round((r.billableSeconds / r.seconds) * 100) : 0,
          })}`,
          magnitude: r.seconds / 3600,
          tone: r.name === null ? ("muted" as const) : ("accent" as const),
        }));
        if (rest.count > 0) {
          out.push({
            name: t(moreKey, { count: rest.count }),
            value: h(secondsToHours(rest.seconds)),
            magnitude: rest.seconds / 3600,
            tone: "muted",
          });
        }
        if (gap !== 0) {
          out.push({
            name: t("projects.ledger.gap"),
            value: `${gap > 0 ? "+" : "−"}${h(Math.abs(gap))}`,
            magnitude: gap,
            tone: "critical",
          });
        }
        return out;
      };
      setDrill({
        ...base,
        subline: t("projects.ledger.subline", {
          billable: fmtNum(secondsToHours(d.totals.billableSeconds), locale, 1),
          people: d.totals.people,
          entries: d.totals.entries,
        }),
        sections: [
          { title: t("byPerson"), rows: section(d.byPerson, d.byPersonRest, "morePeople", t("unknownPerson")) },
          { title: t("byTask"), rows: section(d.byTask, d.byTaskRest, "moreTasks", t("noTask")) },
        ],
      });
    });
  };

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
      <EmptyState title={tp("ledger.empty.title")} description={tp("ledger.empty.description")} />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Card className="overflow-hidden">
        {/* The title lives INSIDE the card, in CardHeader's dialect, like every
            other panel on the page -- a 10px mono kicker floating above the
            card was the one heading on /projects that did not. */}
        <CardHeader
          title={tp("ledger.title")}
          qualifier={tp("ledger.count", { count: fmtInt(rows.length, locale) })}
          className="border-b border-[var(--divider)]"
        />
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
                <span className="t-callout font-medium text-[var(--text-primary)]">{p.name}</span>
                <span
                  className="shrink-0 fig font-medium"
                  style={{ color: burnColor(p.burnPercent) }}
                >
                  {p.burnPercent === null
                    ? tc("notAvailable")
                    : fmtPct(p.burnPercent, locale)}
                </span>
              </div>
              <span className="t-subhead text-[var(--text-muted)]">
                {p.customerName ?? tp("ledger.noCustomer")}
              </span>
              <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--border)]">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.min(p.burnPercent ?? 0, 100)}%`,
                    background: burnColor(p.burnPercent),
                  }}
                />
              </div>
              <div className="flex gap-3 fig text-[var(--text-secondary)]">
                <span>{tp("ledger.loggedH", { hours: fmtNum(p.actualHours, locale, 1) })}</span>
                <span>
                  {p.estimatedHours && p.estimatedHours > 0
                    ? tp("ledger.budgetH", { hours: fmtNum(p.estimatedHours, locale, 1) })
                    : tp("ledger.noBudget")}
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
              className="px-3 py-2.5 text-left t-label text-[var(--accent)]"
            >
              {mobileExpanded
                ? tp("ledger.showFewer", {
                    shown: fmtInt(mobileVisible.length, locale),
                    total: fmtInt(sorted.length, locale),
                  })
                : tp("ledger.showMore", {
                    count: fmtInt(mobileHidden, locale),
                    shown: fmtInt(mobileVisible.length, locale),
                    total: fmtInt(sorted.length, locale),
                  })}
            </button>
          )}
        </div>

        <div ref={tableRef} className="hidden sm:block">
          {/* One header material for every table: --surface with a --divider
              hairline under it, the same as DataTable's thead. The --surface-2
              band read as a second, recessed panel inside the card. */}
          <div className="sticky top-0 z-10 grid min-w-[900px] grid-cols-12 gap-3 border-b border-[var(--divider)] bg-[var(--surface)] px-3 py-2">
            <SortHeader
              label={tp("ledger.columns.project")}
              columnKey="name"
              activeKey={sortKey}
              direction={sortDir}
              onSort={handleSort}
              className="col-span-4"
            />
            <span className="col-span-2 t-label text-[var(--text-muted)]">
              {tp("ledger.columns.customer")}
            </span>
            <SortHeader
              label={tp("ledger.columns.budget")}
              columnKey="budget"
              activeKey={sortKey}
              direction={sortDir}
              onSort={handleSort}
              align="right"
              className="col-span-1 justify-end"
            />
            <SortHeader
              label={tp("ledger.columns.logged")}
              columnKey="hours"
              activeKey={sortKey}
              direction={sortDir}
              onSort={handleSort}
              align="right"
              className="col-span-1 justify-end"
            />
            <SortHeader
              label={tp("ledger.columns.consumed")}
              columnKey="burn"
              activeKey={sortKey}
              direction={sortDir}
              onSort={handleSort}
              className="col-span-2"
            />
            <SortHeader
              label={tp("ledger.columns.people")}
              columnKey="people"
              activeKey={sortKey}
              direction={sortDir}
              onSort={handleSort}
              align="right"
              className="col-span-1 justify-end"
            />
            <SortHeader
              label={tp("ledger.columns.last")}
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
              className="grid min-w-[900px] grid-cols-12 items-center gap-3 border-b border-[var(--divider)] px-3 py-1.5 t-callout transition-colors duration-100 last:border-b-0 hover:bg-[var(--surface-hover)]"
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
              <span className="col-span-1 text-right fig text-[var(--text-secondary)]">
                {p.estimatedHours && p.estimatedHours > 0
                  ? fmtNum(p.estimatedHours, locale, 1)
                  : "—"}
              </span>
              {/* Tappable only when there is something behind it: a zero
                  stays plain text, because an empty popup is a promise the
                  figure cannot keep. */}
              {p.actualHours > 0 ? (
                <button
                  type="button"
                  onClick={(e) => openHours(p, e.currentTarget)}
                  aria-haspopup="dialog"
                  aria-label={t("open", { title: p.name })}
                  data-drill-trigger={`ledger-hours-${p.id}`}
                  className="col-span-1 cursor-pointer text-right fig text-[var(--text-primary)] underline-offset-4 transition-[color,transform] duration-150 hover:text-[var(--accent)] hover:underline active:translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
                >
                  {fmtNum(p.actualHours, locale, 1)}
                </button>
              ) : (
                <span className="col-span-1 text-right fig text-[var(--text-primary)]">
                  {fmtNum(p.actualHours, locale, 1)}
                </span>
              )}
              <div className="col-span-2 flex items-center gap-2">
                {/* A meter is rounded-full, like StatTile's and the drill rows'. */}
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--border)]">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.min(p.burnPercent ?? 0, 100)}%`,
                      background: burnColor(p.burnPercent),
                    }}
                  />
                </div>
                <span
                  className="w-11 text-right fig font-medium"
                  style={{ color: burnColor(p.burnPercent) }}
                >
                  {p.burnPercent === null ? tc("notAvailable") : fmtPct(p.burnPercent, locale)}
                </span>
              </div>
              <span className="col-span-1 text-right fig text-[var(--text-secondary)]">
                {p.memberCount || "—"}
              </span>
              <span className="col-span-1 text-right fig text-[var(--text-faint)]">
                {p.lastActivity ?? tp("ledger.never")}
              </span>
            </div>
          ))}
        </div>

        <Pager
          state={pager}
          total={sorted.length}
          noun={tp("ledger.pagerNoun")}
          anchorRef={tableRef}
        />
      </Card>

      <AnimatePresence>
        {drill && (
          <DrillDialog drill={drill} onClose={() => setDrill(null)} origin={drillOrigin} />
        )}
      </AnimatePresence>
    </div>
  );
}
