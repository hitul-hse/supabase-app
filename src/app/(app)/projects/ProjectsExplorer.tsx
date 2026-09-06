"use client";

/**
 * The Projects explorer: ONE filter bar that drives the charts AND the ledger.
 *
 * WHY THIS EXISTS. The charts on this page (portfolio health, where-the-hours-
 * go, customer share, capacity, budget burn) used to show a FIXED server
 * snapshot of all 334 projects, while the ledger below filtered only itself.
 * So "show me only ENERCON" changed the table and left every chart above it
 * describing the whole portfolio — the numbers on screen disagreed. The user
 * asked for the filter to "apply directly to the charts". This lifts the filter
 * state up to the page, exactly as the TrackingTime dashboard does: the totals
 * strip, both chart blocks and the ledger all read the SAME filtered rows, so
 * the whole page answers one question at a time.
 *
 * WHY CLIENT-SIDE. The server already sends all 334 rows to compute the totals
 * strip, so every re-derivation here is a fold over data in hand — instant, no
 * round trip.
 *
 * THE FILTER IS IN THE URL (APPLE_REF §8 #16; UI-CONVENTIONS rule 2). It used
 * to live in component state alone, on the argument that nobody deep-links
 * into a slice of the portfolio. They do: "the ENERCON projects over budget"
 * is a link somebody pastes into a chat, and a refresh that dropped the filter
 * quietly showed a different set of numbers under the same heading. The state
 * is mirrored through url-state.ts -- `?q=&customer=&facet=&billable=` --
 * with `history.replaceState`, so it still costs no round trip and the back
 * button still walks the ledger's pages rather than every chip toggle.
 */

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { fmtHours, fmtInt, fmtNum, fmtPct } from "@/lib/locale-format";
import { FilterChip, SearchInput } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Segmented";
import { useUrlState, type UrlPatch } from "@/components/url-state";
import type { Drill } from "@/components/DrillDialog";
import type { ProjectListRow } from "@/lib/queries/projects-live";
import {
  NO_CUSTOMER,
  customerPortfolioFromRows,
  filterProjectRows,
  hasActiveProjectFilters,
  matchesProjectFacet,
  type ProjectFacet,
  type ProjectFilters,
} from "./project-insights";
import { ProjectTotalsStrip, type ProjectTotalsTile } from "./ProjectPanels";
import { PortfolioCharts } from "./PortfolioCharts";
import { CustomerPortfolioCharts } from "./CustomerPortfolioCharts";
import { ProjectsLedger, type LedgerSort } from "./ProjectsLedger";
import { CustomerMultiSelect } from "./CustomerMultiSelect";
import { MobileDisclosure } from "@/components/MobileDisclosure";

/**
 * The status chips, in the order they are drawn.
 *
 * The FACET KEY is the identity -- what the filter set holds and what
 * `matchesProjectFacet` switches on -- and the label is only its rendering, so
 * switching language cannot silently change which rows a chip selects.
 */
const FACETS: ProjectFacet[] = ["over", "risk", "healthy", "nobudget", "idle"];
const FACET_SET = new Set<string>(FACETS);

/**
 * The filter, read out of a query string. Tolerant by contract: a stale
 * bookmark with a facet that no longer exists degrades to "no facet", never to
 * an error, and a customer name is taken as-is because the NAME is the key
 * (see `displayCustomer` below).
 */
export function filtersFromParams(params: URLSearchParams): ProjectFilters {
  const billable = params.get("billable");
  return {
    query: params.get("q") ?? "",
    customers: new Set(params.getAll("customer").filter((c) => c !== "")),
    facets: new Set(
      params.getAll("facet").filter((f): f is ProjectFacet => FACET_SET.has(f)),
    ),
    billableOnly: billable === "1" ? true : billable === "0" ? false : null,
  };
}

/**
 * The inverse. `page: null` because a filter defines a new list, and page 7 of
 * the old one is not a page of it (UI-CONVENTIONS rule 2).
 */
export function filtersToPatch(f: ProjectFilters): UrlPatch {
  return {
    q: f.query,
    customer: [...f.customers],
    facet: [...f.facets],
    billable: f.billableOnly === null ? null : f.billableOnly ? "1" : "0",
    page: null,
  };
}

/** The address of a filter state -- the billable segments are links to these. */
function hrefFor(f: ProjectFilters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filtersToPatch(f))) {
    // The same rule as url-state's writeUrl: an empty string is an unset key.
    if (typeof value === "string" && value !== "") params.set(key, value);
    else if (Array.isArray(value)) for (const v of value) if (v !== "") params.append(key, v);
  }
  const qs = params.toString();
  return qs ? `/projects?${qs}` : "/projects";
}

export function ProjectsExplorer({
  rows,
  initialSort = "burn",
  locale,
}: {
  rows: ProjectListRow[];
  initialSort?: LedgerSort;
  /**
   * The request locale, handed down by the page rather than read with
   * `useLocale()`. The projects gate renders this component bare, outside a
   * request, where a next-intl hook other than the one it stubs would throw --
   * and absent, every figure formats en-GB, exactly as it did before.
   */
  locale?: string;
}) {
  // Initialised from the URL, mirrored back on every change, re-read on the
  // back button. Outside the router (the projects gate renders this bare) it
  // is plain component state starting empty, exactly as before.
  const [filters, setFilters] = useUrlState<ProjectFilters>(filtersFromParams, filtersToPatch);

  // `drill` for the popup chrome the tiles open, `projects` for the page's own
  // words. Both are read here so every derivation below can use them.
  const t = useTranslations("drill");
  const tp = useTranslations("projects");

  // Facet counts come from the FULL list, never the filtered one: a chip whose
  // count shrinks to match the current filter tells the reader nothing they
  // cannot already see, and makes it impossible to judge before clicking.
  const facetCounts = useMemo(
    () =>
      Object.fromEntries(
        FACETS.map((key) => [key, rows.filter((p) => matchesProjectFacet(p, key)).length]),
      ) as Record<ProjectFacet, number>,
    [rows],
  );

  // Customer options, biggest-first by hours, for the multi-select.
  const customerOptions = useMemo(() => {
    const byName = new Map<string, number>();
    for (const p of rows) {
      const name = p.customerName ?? NO_CUSTOMER;
      byName.set(name, (byName.get(name) ?? 0) + p.actualHours);
    }
    return [...byName.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, hours]) => ({ name, hours }));
  }, [rows]);

  const filtered = useMemo(() => filterProjectRows(rows, filters), [rows, filters]);
  const portfolio = useMemo(() => customerPortfolioFromRows(filtered), [filtered]);

  const active = hasActiveProjectFilters(filters);

  /*
   * The customer NAME is the filter key (project-insights.NO_CUSTOMER), so the
   * "no customer" bucket keeps its English key and only its rendering follows
   * the locale. Translating the key itself would unselect the bucket the moment
   * the reader switches language.
   */
  const noCustomerLabel = t("noCustomer");
  const displayCustomer = (name: string) => (name === NO_CUSTOMER ? noCustomerLabel : name);

  const totalHours = filtered.reduce((s, p) => s + p.actualHours, 0);
  const billableHours = filtered.reduce((s, p) => s + p.billableHours, 0);
  const overBudget = filtered.filter((p) => p.isOver).length;
  const noBudget = filtered.filter((p) => p.burnPercent === null).length;

  /*
   * What sits behind each tile of the totals strip -- five re-projections of
   * the SAME `filtered` rows the five figures above are folded from, so a popup
   * cannot disagree with the tile it opened from. Each states its `check`:
   * the customer rows SUM to PROJECTS and TRACKED HOURS, the project rows SUM to
   * the billable hours, and the over-budget / no-budget lists COUNT to their
   * tiles. Rows that lead to a project record are links, never a second popup.
   */
  const drills = useMemo<Partial<Record<ProjectTotalsTile, Drill>>>(() => {
    const hrs = (n: number) => fmtHours(n, locale, 1);
    const noCustomer = t("noCustomer");
    const byCustomer = new Map<string, { projects: number; hours: number }>();
    for (const p of filtered) {
      const name = p.customerName ?? noCustomer;
      const a = byCustomer.get(name) ?? { projects: 0, hours: 0 };
      a.projects += 1;
      a.hours += p.actualHours;
      byCustomer.set(name, a);
    }
    const customers = [...byCustomer.entries()];
    const customerTone = (name: string) => (name === noCustomer ? ("muted" as const) : ("accent" as const));
    const billablePercent = totalHours > 0 ? Math.round((billableHours / totalHours) * 100) : null;
    const record = (p: ProjectListRow) => `/projects/${p.id}`;

    return {
      projects: {
        kicker: tp("tiles.projects.label"),
        title: t("projects.count.title"),
        headline: fmtInt(filtered.length, locale),
        headlineValue: filtered.length,
        check: "sum",
        subline: tp("drills.customerCount", { count: customers.length }),
        rows: customers
          .sort((a, b) => b[1].projects - a[1].projects)
          .map(([name, a]) => ({
            name,
            value: t("projects.count.value", { count: a.projects }),
            magnitude: a.projects,
            tone: customerTone(name),
          })),
        footer: t("projects.count.footer"),
      },
      hours: {
        kicker: tp("tiles.hours.label"),
        title: t("projects.hours.title"),
        headline: hrs(totalHours),
        headlineValue: totalHours,
        check: "sum",
        subline: t("projectCount", { count: filtered.length }),
        rows: customers
          .filter(([, a]) => a.hours > 0)
          .sort((a, b) => b[1].hours - a[1].hours)
          .map(([name, a]) => ({
            name,
            value: `${hrs(a.hours)} · ${t("projectCount", { count: a.projects })}`,
            magnitude: a.hours,
            tone: customerTone(name),
          })),
        footer: t("projects.hours.footer"),
      },
      billable: {
        kicker: tp("tiles.billable.label"),
        title: t("projects.billable.title"),
        headline: billablePercent === null ? "—" : fmtPct(billablePercent, locale),
        headlineValue: billableHours,
        check: "sum",
        subline: t("projects.billable.subline", {
          billable: fmtNum(billableHours, locale, 1),
          total: fmtNum(totalHours, locale, 1),
        }),
        rows: filtered
          .filter((p) => p.billableHours > 0)
          .sort((a, b) => b.billableHours - a.billableHours)
          .map((p) => ({
            name: p.name,
            sub: p.customerName ?? undefined,
            value: `${hrs(p.billableHours)} · ${t("billableShare", {
              percent: p.actualHours > 0 ? Math.round((p.billableHours / p.actualHours) * 100) : 0,
            })}`,
            magnitude: p.billableHours,
            href: record(p),
          })),
        footer: t("projects.billable.footer"),
      },
      over: {
        kicker: tp("tiles.over.label"),
        title: t("projects.over.title"),
        headline: fmtInt(overBudget, locale),
        headlineValue: overBudget,
        check: "count",
        subline: t("projectCount", { count: filtered.length }),
        rows: filtered
          .filter((p) => p.isOver)
          .sort((a, b) => (b.burnPercent ?? 0) - (a.burnPercent ?? 0))
          .map((p) => ({
            name: p.name,
            sub: p.customerName ?? undefined,
            value: `${fmtPct(p.burnPercent ?? 0, locale)} · ${tp("drills.overBy", {
              hours: hrs(-(p.remainingHours ?? 0)),
            })}`,
            magnitude: p.burnPercent ?? 0,
            href: record(p),
            tone: "critical" as const,
          })),
        footer: t("projects.over.footer"),
      },
      noBudget: {
        kicker: tp("tiles.noBudget.label"),
        title: t("projects.noBudget.title"),
        headline: fmtInt(noBudget, locale),
        headlineValue: noBudget,
        check: "count",
        subline: t("projectCount", { count: filtered.length }),
        rows: filtered
          .filter((p) => p.burnPercent === null)
          .sort((a, b) => b.actualHours - a.actualHours)
          .map((p) => ({
            name: p.name,
            sub: p.customerName ?? undefined,
            value: hrs(p.actualHours),
            magnitude: p.actualHours,
            href: record(p),
            tone: "muted" as const,
          })),
        footer: t("projects.noBudget.footer"),
      },
    };
  }, [filtered, totalHours, billableHours, overBudget, noBudget, t, tp, locale]);

  const toggleFacet = (f: ProjectFacet) => {
    const next = new Set(filters.facets);
    if (next.has(f)) next.delete(f);
    else next.add(f);
    setFilters({ ...filters, facets: next });
  };

  const toggleCustomer = (name: string) => {
    const next = new Set(filters.customers);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setFilters({ ...filters, customers: next });
  };

  // The health donut maps to exactly one facet when a single one is active, so
  // it can ring that slice; with several selected it rings none.
  const soleFacet = filters.facets.size === 1 ? [...filters.facets][0] : null;

  /*
   * PHONE SUMMARIES for the two collapsed chart groups below.
   *
   * These are what the reader sees INSTEAD of the charts at 390px, so they carry
   * the finding rather than the topic: how many projects are over budget, and
   * how concentrated the customer base is. A summary that just repeated the
   * title would make the collapsed panel indistinguishable from an empty one,
   * which is the failure DESIGN.md rule 7 is about.
   */
  const topCustomer = portfolio.rows[0] ?? null;
  const chartsSummary =
    filtered.length === 0
      ? tp("disclosure.charts.empty")
      : tp("disclosure.charts.summary", {
          over: fmtInt(overBudget, locale),
          noBudget: fmtInt(noBudget, locale),
          projects: fmtInt(filtered.length, locale),
        });
  const customersSummary =
    portfolio.customerCount === 0
      ? tp("disclosure.customers.empty")
      : tp("disclosure.customers.summary", {
          count: fmtInt(portfolio.customerCount, locale),
          share: fmtPct(portfolio.top5SharePercent, locale),
        }) +
        (topCustomer
          ? tp("disclosure.customers.biggest", { name: displayCustomer(topCustomer.name) })
          : "");

  const clearAll = () =>
    setFilters({ query: "", customers: new Set(), facets: new Set(), billableOnly: null });

  const facetLabels: Record<ProjectFacet, string> = {
    over: tp("filters.facets.over"),
    risk: tp("filters.facets.risk"),
    healthy: tp("filters.facets.healthy"),
    nobudget: tp("filters.facets.nobudget"),
    idle: tp("filters.facets.idle"),
  };

  /*
   * CustomerMultiSelect draws no words of its own (see its header: the projects
   * gate renders it outside a request, where a next-intl hook throws), so the
   * explorer resolves them here and hands them over.
   */
  const customerLabels = {
    field: tp("customer.label"),
    summaryAll: (total: number) =>
      total ? tp("customer.all", { count: fmtInt(total, locale) }) : tp("customer.allNone"),
    summarySelected: (count: number) => tp("customer.selected", { count: fmtInt(count, locale) }),
    searchPlaceholder: tp("customer.searchPlaceholder"),
    counts: (shown: number, total: number, selected: number) =>
      `${
        shown !== total
          ? tp("customer.countOf", { shown: fmtInt(shown, locale), total: fmtInt(total, locale) })
          : fmtInt(shown, locale)
      } ${tp("customer.noun", { count: total })}${
        selected > 0 ? tp("customer.selectedSuffix", { count: fmtInt(selected, locale) }) : ""
      }`,
    noMatch: (query: string) => tp("customer.noMatch", { query }),
    clear: (count: number) => tp("customer.clear", { count: fmtInt(count, locale) }),
    listLabel: tp("customer.listLabel"),
    displayName: displayCustomer,
  };

  return (
    <div className="flex flex-col gap-4">
      {/* ------------------------------------------------------ the one filter bar */}
      {/*
        A flat control row, NOT a card. UI-CONVENTIONS: "Not a card: interactive
        chrome -- inputs, pills, tabs". The bar used to be a Card with card-elev,
        so it rose under the cursor like the tiles beside it while responding to
        nothing as an object; the controls inside it are the affordance.
      */}
      <div data-projects-explorer="1" className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput
            value={filters.query}
            onValueChange={(v) => setFilters({ ...filters, query: v })}
            label={tp("filters.searchLabel")}
            placeholder={tp("filters.searchPlaceholder")}
            className="w-full sm:w-64"
          />
          <CustomerMultiSelect
            options={customerOptions}
            selected={filters.customers}
            onChange={(next) => setFilters({ ...filters, customers: next })}
            locale={locale}
            labels={customerLabels}
          />
          {/*
            The billable trough is the house Segmented now that its state is in
            the URL: three nouns as real links (§5.7 "a <button> that only
            changes a URL param" is the thing to avoid), `aria-current` on the
            chosen one, and `onSelect` so a plain click re-projects the rows in
            place rather than round-tripping to the server.
          */}
          <Segmented
            ariaLabel={tp("filters.billableGroup")}
            current={hrefFor(filters)}
            options={[
              { href: hrefFor({ ...filters, billableOnly: null }), label: tp("filters.all") },
              { href: hrefFor({ ...filters, billableOnly: true }), label: tp("filters.billable") },
              { href: hrefFor({ ...filters, billableOnly: false }), label: tp("filters.nonBillable") },
            ]}
            onSelect={(href) => setFilters(filtersFromParams(new URL(href, "http://x").searchParams))}
          />

          <div className="flex items-center gap-3 sm:ml-auto">
            <span
              className="t-label text-[var(--text-muted)]"
              role="status"
              aria-live="polite"
            >
              {filtered.length === rows.length
                ? tp("filters.countAll", { count: fmtInt(rows.length, locale) })
                : tp("filters.countOf", {
                    shown: fmtInt(filtered.length, locale),
                    total: fmtInt(rows.length, locale),
                  })}
            </span>
            {active && (
              <Button variant="ghost" size="sm" onClick={clearAll}>
                {tp("filters.clear")}
              </Button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {FACETS.map((key) => (
            <FilterChip
              key={key}
              active={filters.facets.has(key)}
              onToggle={() => toggleFacet(key)}
              count={facetCounts[key]}
            >
              {facetLabels[key]}
            </FilterChip>
          ))}
        </div>
      </div>

      {/* Everything below reads `filtered` — one control, whole page. And the
          charts are themselves controls: clicking a health-donut slice or a
          customer slice toggles that filter, the cross-filtering BI tools do. */}
      {/* The totals strip stays open at every width: it is five short tiles, it
          IS the summary the panels below would collapse to, and hiding it would
          leave the phone with a filter bar and nothing to show for it. */}
      <ProjectTotalsStrip
        projectCount={filtered.length}
        totalHours={totalHours}
        billableHours={billableHours}
        overBudget={overBudget}
        noBudget={noBudget}
        drills={drills}
        locale={locale}
        wording={{
          projects: { label: tp("tiles.projects.label"), hint: tp("tiles.projects.hint") },
          hours: { label: tp("tiles.hours.label"), hint: tp("tiles.hours.hint") },
          billable: {
            label: tp("tiles.billable.label"),
            hint: tp("tiles.billable.hint", { hours: fmtNum(billableHours, locale, 1) }),
          },
          over: {
            label: tp("tiles.over.label"),
            hint: overBudget > 0 ? tp("tiles.over.needsAttention") : tp("tiles.over.allWithin"),
          },
          noBudget: { label: tp("tiles.noBudget.label"), hint: tp("tiles.noBudget.hint") },
        }}
      />

      {/*
        Both chart groups collapse on a PHONE only (see MobileDisclosure: the
        content keeps `sm:block`, so at 1440px this wrapper renders nothing but a
        div and the desktop layout is byte-for-byte what it was).

        Measured at 390px they were the second and third tallest blocks on the
        route -- "Portfolio health" 1,182px and "Biggest customers" 1,033px, i.e.
        2.6 of 7.1 screens -- because each is a `lg:grid-cols-12` row that stacks
        into one column. They are also the panels a phone reader is least likely
        to have come for: a donut and a share ring are a desktop scanning tool,
        and the figures inside them are already stated in the summary line and
        the totals strip above.
      */}
      <MobileDisclosure title={tp("disclosure.charts.title")} summary={chartsSummary}>
        <PortfolioCharts
          rows={filtered}
          onFacet={toggleFacet}
          activeFacet={soleFacet}
          locale={locale}
        />
      </MobileDisclosure>
      <MobileDisclosure title={tp("disclosure.customers.title")} summary={customersSummary}>
        <CustomerPortfolioCharts
          data={portfolio}
          onCustomer={toggleCustomer}
          activeCustomers={filters.customers}
          locale={locale}
        />
      </MobileDisclosure>

      <ProjectsLedger rows={filtered} initialSort={initialSort} locale={locale} />
    </div>
  );
}
