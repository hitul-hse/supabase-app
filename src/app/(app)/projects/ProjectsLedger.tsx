"use client";

import { useCallback, useState, useRef, useTransition } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { EmptyState } from "@/components/EmptyState";
import { SortHeader, type SortDirection } from "@/components/ui/Field";
import type { ProjectListRow } from "@/lib/queries/projects-live";
import { usePager } from "@/components/Pager";
import { useUrlState } from "@/components/url-state";
import { LEDGER_SORTS, type LedgerSort } from "./project-insights";
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
import { burnColor, projectStatus } from "./ProjectPanels";
import { Card, CardHeader } from "@/components/ui/Card";
import { Meter } from "@/components/ui/Meter";
import { StatusDot } from "@/components/ui/StatusDot";
import { NumberedPager } from "@/components/NumberedPager";
import { Button } from "@/components/ui/Button";
import { segmentedItemClass, segmentedTrackClass } from "@/components/ui/Segmented";
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

/**
 * Re-exported for the client-side callers (the explorer). The server page
 * reads the list from project-insights.ts directly: a value re-exported
 * through this `"use client"` module would reach it as a client reference.
 */
export type { LedgerSort };

/** Names sort A-Z first; every measure sorts worst-first (APPLE_REF §5.6 `descFirst`). */
const defaultDir = (key: LedgerSort): SortDirection => (key === "name" ? "asc" : "desc");

/**
 * How many rows render before the reader has to ask for more.
 *
 * 25, the house default (DESIGN.md §Data tables 2; APPLE_REF §5.6 "page size
 * 25 default with ALL"): at 28px a row that is ~700px, so the first paint is
 * the whole answer on a laptop and the pager is the exception. It was 30, a
 * size the PER PAGE control could not even show as chosen because 30 was not
 * among its choices. Anyone who wants the long list is one click from it, and
 * the sort order means the rows that matter are already at the top.
 */
/**
 * The ledger's eight columns, as one template both the sticky header and every
 * row read.
 *
 * A named constant rather than `grid-cols-12` with a `col-span-*` per cell: the
 * twelve-column form made every width a fraction of twelve that had to be
 * re-derived when a column was added, and the header and the rows each carried
 * their own copy of that arithmetic. These are the measures the design draws,
 * with the two prose columns free to take the slack (`minmax`) and the six
 * token columns fixed at what their content needs.
 *
 * Total at the fixed columns: 140 + 88 + 72 + 72 + 148 + 108 = 628, plus 12px
 * gaps, against 1,148 of card at 1440 — so CUSTOMER and PROJECT share ~430.
 */
const LEDGER_GRID =
  "grid-cols-[minmax(7rem,1.2fr)_minmax(9rem,2fr)_8.5rem_8.25rem_4.5rem_4.5rem_9rem_7rem]";

const PAGE_SIZE = 25;
const PAGE_SIZES = [25, 50, 100];

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
  /*
   * Sort key and direction live in the URL (`?sort=&dir=`, UI-CONVENTIONS
   * rule 2) with no round-trip: `initialSort` is the server's reading of the
   * same `?sort=`, so a shared link opens sorted the way it was sent, and the
   * columns re-sort in the browser from there. The defaults are absent from
   * the URL so an untouched ledger keeps a clean one.
   */
  const [sort, setSort] = useUrlState<{ key: LedgerSort; dir: SortDirection }>(
    (params) => {
      const raw = params.get("sort");
      const key = LEDGER_SORTS.includes(raw as LedgerSort) ? (raw as LedgerSort) : initialSort;
      const dir = params.get("dir");
      return { key, dir: dir === "asc" || dir === "desc" ? dir : defaultDir(key) };
    },
    (s) => ({
      sort: s.key === "burn" ? null : s.key,
      dir: s.dir === defaultDir(s.key) ? null : s.dir,
      // A sort defines a new order, and page 7 of the old one is not a page
      // of it: the pager resets on its key, the URL is cleared here.
      page: null,
    }),
  );
  const { key: sortKey, dir: sortDir } = sort;
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
  /*
   * Which open request is current. The server action resolves whenever it
   * resolves; if the reader has dismissed the dialog by then (Escape the
   * moment it appeared -- measured: closed at +200 ms, back at +500 ms with
   * the rows), the resolution must be dropped, not rendered. Every open
   * bumps the generation and every close bumps it again, so a result that
   * arrives after either is stale and ignored.
   */
  const drillGeneration = useRef(0);
  const closeHours = useCallback(() => {
    drillGeneration.current += 1;
    setDrill(null);
  }, []);
  /** Hours with their unit, in the reader's language: "1,234.5h" / "1.234,5 Std". */
  const h = (n: number) => fmtHours(n, locale, 1);
  const [, startTransition] = useTransition();

  const openHours = (p: ProjectListRow, from: Element | null) => {
    const generation = ++drillGeneration.current;
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
      // Dismissed (or re-opened for another row) while this was pending.
      if (generation !== drillGeneration.current) return;
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
  // `?page=` and `?size=` too, so the back button walks pages and a pasted
  // link opens on the row it was sent from. `rows.length` in the key: the
  // explorer's filter defines a new list, and its patch clears `page` for the
  // same reason this key resets it.
  const pager = usePager(sorted.length, PAGE_SIZE, `${sortKey}|${sortDir}|${rows.length}`, {
    page: "page",
    size: "size",
    sizes: PAGE_SIZES,
  });
  const visible = sorted.slice(pager.start, pager.end);
  // Re-collapsing on a sort or page change is deliberate: the point of the cap
  // is that the first paint after any control is one screen.
  const mobileVisible = mobileExpanded ? visible : visible.slice(0, MOBILE_ROWS);
  const mobileHidden = visible.length - mobileVisible.length;

  const handleSort = (key: string) => {
    const next = key as LedgerSort;
    if (next === sortKey) {
      // Click again reverses [Apple: "re-sort… in the opposite direction"].
      setSort({ key: next, dir: sortDir === "asc" ? "desc" : "asc" });
    } else {
      setSort({ key: next, dir: defaultDir(next) });
    }
  };

  /*
   * The count in the card header as well as the foot (APPLE_REF §5.4
   * "Placement"; §8 #11): a ledger longer than a screen states the size of
   * the work before the reader scrolls, and states the SLICE ("1–25 OF 334")
   * once it is paged, so a page is never mistaken for the whole. The same
   * `pager` strings the foot uses, so the two lines cannot disagree.
   */
  const tpager = useTranslations("pager");

  /**
   * Export exactly what is on screen: the same filter and the same sort, all
   * pages of it.
   *
   * The ledger had no export at all, so answering "send me the overruns" meant
   * a screenshot. The columns are the eight the table draws, in the order it
   * draws them, so the file and the screenshot beside it reconcile. BOM and
   * CRLF because the only spreadsheet this is ever opened in is Excel on a
   * German locale, which mangles umlauts without them — the same reason
   * DataTable's export does it.
   */
  const downloadCsv = () => {
    const cell = (v: string | number | null) => {
      const str = v === null ? "" : String(v);
      return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    };
    const header = [
      tp("ledger.columns.customer"),
      tp("ledger.columns.project"),
      tp("ledger.columns.code"),
      tp("ledger.columns.billable"),
      tp("ledger.columns.hours"),
      tp("ledger.columns.budget"),
      tp("ledger.columns.burn"),
      tp("ledger.columns.status"),
    ];
    const lines = [
      header.map(cell).join(","),
      ...sorted.map((p) =>
        [
          p.customerName,
          p.name,
          p.code,
          p.isBillable ? tp("ledger.billable.yes") : tp("ledger.billable.no"),
          p.actualHours,
          // Empty, never 0: "no budget set" and "a budget of zero" are
          // different facts and a spreadsheet cannot tell them apart later.
          p.estimatedHours && p.estimatedHours > 0 ? p.estimatedHours : null,
          p.burnPercent,
          tp(`ledger.status.${projectStatus(p.burnPercent).key}`),
        ]
          .map(cell)
          .join(","),
      ),
    ];
    const url = URL.createObjectURL(
      new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "projects-ledger.csv";
    a.click();
    URL.revokeObjectURL(url);
  };
  const shownFrom = sorted.length === 0 ? 0 : pager.start + 1;
  const shownTo = Math.min(pager.end, sorted.length);
  const headerCount =
    pager.pageCount > 1 && pager.size !== "all"
      ? tpager("range", {
          from: shownFrom,
          to: shownTo,
          count: sorted.length,
          noun: tp("ledger.pagerNoun").toUpperCase(),
        })
      : tp("ledger.count", { count: fmtInt(rows.length, locale) });

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
          qualifier={headerCount}
          className="border-b border-[var(--divider)]"
          actions={
            /*
              Page size and CSV in the HEADER, beside the count they qualify,
              and the numbered pager alone in the foot. They were all three in
              the foot, which put the control that changes how much you are
              looking at below the thing it changes and one scroll away from the
              count that states it (APPLE_REF §5.6 "Anatomy": card header ->
              toolbar; §5.4 "Placement").
            */
            <div className="hidden items-center gap-1.5 sm:flex">
              <div role="group" aria-label={tpager("perPage")} className={segmentedTrackClass}>
                {[...PAGE_SIZES, "all" as const].map((size) => (
                  <button
                    key={String(size)}
                    type="button"
                    onClick={() => pager.setSize(size)}
                    aria-pressed={pager.size === size}
                    className={segmentedItemClass(pager.size === size)}
                  >
                    {size === "all" ? tpager("all") : size}
                  </button>
                ))}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={downloadCsv}
                title={tp("ledger.csvTitle")}
                className="font-mono"
              >
                CSV
              </Button>
            </div>
          }
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
              {/* The same meter as the desktop row: fixed 0–100, and an empty
                  track rather than a zero-width fill when there is no budget. */}
              <Meter percent={p.burnPercent} color={burnColor(p.burnPercent)} />
              {/* The word, on the phone too. §8 #5 is not a desktop rule. */}
              <StatusDot tone={projectStatus(p.burnPercent).tone}>
                {tp(`ledger.status.${projectStatus(p.burnPercent).key}`)}
              </StatusDot>
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
              band read as a second, recessed panel inside the card. OPAQUE, and
              that is the point (APPLE_REF §8 #4): a translucent header over
              moving digits is a measured incident, not a taste. */}
          {/* 32px header (APPLE_REF §5.6): `h-8` with the 24px sort targets
              centred in it, over 28px compact rows. */}
          <div
            className={`sticky top-0 z-10 grid h-8 ${LEDGER_GRID} min-w-[63rem] items-center gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-1`}
          >
            {/* Not sortable (a customer is a label, not a measure): the same
                caption rung as the sortable headers at rest. */}
            <span className="t-label text-[var(--text-faint)]">
              {tp("ledger.columns.customer")}
            </span>
            <SortHeader
              label={tp("ledger.columns.project")}
              columnKey="name"
              activeKey={sortKey}
              direction={sortDir}
              onSort={handleSort}
            />
            <span className="t-label text-[var(--text-faint)]">
              {tp("ledger.columns.code")}
            </span>
            <span className="t-label text-[var(--text-faint)]">
              {tp("ledger.columns.billable")}
            </span>
            <SortHeader
              label={tp("ledger.columns.hours")}
              columnKey="hours"
              activeKey={sortKey}
              direction={sortDir}
              onSort={handleSort}
              align="right"
              className="justify-end"
            />
            <SortHeader
              label={tp("ledger.columns.budget")}
              columnKey="budget"
              activeKey={sortKey}
              direction={sortDir}
              onSort={handleSort}
              align="right"
              className="justify-end"
            />
            <SortHeader
              label={tp("ledger.columns.burn")}
              columnKey="burn"
              activeKey={sortKey}
              direction={sortDir}
              onSort={handleSort}
            />
            <span className="t-label text-[var(--text-faint)]">
              {tp("ledger.columns.status")}
            </span>
          </div>

          {visible.map((p) => {
            const status = projectStatus(p.burnPercent);
            return (
            <div
              key={p.id}
              data-ledger-row
              className={`grid ${LEDGER_GRID} min-w-[63rem] items-center gap-3 border-b border-[var(--divider)] px-3 py-1.5 t-callout transition-colors duration-100 last:border-b-0 hover:bg-[var(--surface-hover)]`}
            >
              <span className="truncate text-[var(--text-secondary)]" title={p.customerName ?? ""}>
                {p.customerName ?? "—"}
              </span>
              <Link
                href={`/projects/${p.id}`}
                className="truncate font-medium text-[var(--text-primary)] hover:text-[var(--accent)]"
                title={p.name}
              >
                {p.name}
              </Link>
              {/* The code in a column of its own (APPLE_REF §8 #17): the web has
                  no middle-ellipsis, so an identifier that cannot be shortened
                  gets width instead of being buried under the name. */}
              <span className="truncate fig text-[var(--text-secondary)]" title={p.code ?? ""}>
                {p.code ?? "—"}
              </span>
              <span className="truncate text-[var(--text-secondary)]" title={p.isBillable ? tp("ledger.billable.yes") : tp("ledger.billable.no")}>
                {p.isBillable ? tp("ledger.billable.yes") : tp("ledger.billable.no")}
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
                  className="cursor-pointer text-right fig text-[var(--text-primary)] underline-offset-4 control-motion hover:text-[var(--accent)] hover:underline active:translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
                >
                  {fmtNum(p.actualHours, locale, 1)}
                </button>
              ) : (
                <span className="text-right fig text-[var(--text-primary)]">
                  {fmtNum(p.actualHours, locale, 1)}
                </span>
              )}
              <span className="text-right fig text-[var(--text-secondary)]">
                {p.estimatedHours && p.estimatedHours > 0
                  ? fmtNum(p.estimatedHours, locale, 1)
                  : "—"}
              </span>
              <div className="flex items-center gap-2">
                {/* Fixed 0–100 scale (APPLE_REF §5.3, Apple's own charts rule):
                    139 % is a FULL bar with the overshoot stated beside it, not
                    a bar that overflows its track or rescales its neighbours.
                    A null budget draws the empty track and no fill. */}
                <Meter
                  percent={p.burnPercent}
                  color={burnColor(p.burnPercent)}
                  className="flex-1"
                />
                <span
                  className="w-11 shrink-0 text-right fig font-medium"
                  style={{ color: burnColor(p.burnPercent) }}
                >
                  {p.burnPercent === null ? "—" : fmtPct(p.burnPercent, locale)}
                </span>
              </div>
              {/*
                THE FIX THIS SCREEN EXISTS FOR. The posture was carried by the
                colour of the bar and the number and by nothing else, which §8 #5
                and UI-CONVENTIONS forbid in the same words: a dot AND the word.
              */}
              <StatusDot tone={status.tone}>{tp(`ledger.status.${status.key}`)}</StatusDot>
            </div>
            );
          })}
        </div>

        {/*
          The house pager at the foot of the BOUNDED CARD, not of the window
          (APPLE_REF §3.2 "Bottom of the window", §5.4 "Placement"): first, last,
          a one-step window, an elided middle, and PREV dimmed rather than hidden
          so NEXT never slides under the cursor between clicks.

          Shared with the two server-rendered queues through `NumberedPager` —
          the elided-window arithmetic used to exist twice as an unexported
          `function Pager`, and this would have been the third copy. The page
          size and CSV moved up into the card header, where the count they
          qualify already is.
        */}
        <NumberedPager
          page={pager.page + 1}
          pageCount={pager.pageCount}
          countLine={
            <span>
              {headerCount}
              {pager.pageCount > 1
                ? ` · ${tpager("pageOf", { page: pager.page + 1, pages: pager.pageCount })}`
                : ""}
            </span>
          }
          navLabel={tp("ledger.pagerNav")}
          labels={{
            prev: tpager("prev"),
            next: tpager("next"),
            pageLabel: (n) => tpager("goToPage", { page: n }),
          }}
          onSelect={(n) => {
            pager.setPage(n - 1);
            // Back to the top of the TABLE, not of the document: the reader
            // asked for the next page of rows, not to be moved off the card.
            tableRef.current?.scrollIntoView({ block: "start", behavior: "auto" });
          }}
        />
      </Card>

      <AnimatePresence>
        {drill && (
          <DrillDialog drill={drill} onClose={closeHours} origin={drillOrigin} />
        )}
      </AnimatePresence>
    </div>
  );
}
