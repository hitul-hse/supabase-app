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
 * round trip. The filter lives in component state (not the URL) because a
 * customer multi-select over dozens of names is awkward as a query string and
 * the page is not one people deep-link into a specific slice of; the date-less
 * portfolio has no other URL state to preserve.
 */

import { useMemo, useState } from "react";
import { FilterChip, SearchInput } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import type { ProjectListRow } from "@/lib/queries/projects-live";
import {
  customerPortfolioFromRows,
  filterProjectRows,
  hasActiveProjectFilters,
  matchesProjectFacet,
  type ProjectFacet,
  type ProjectFilters,
} from "./project-insights";
import { ProjectTotalsStrip } from "./ProjectPanels";
import { PortfolioCharts } from "./PortfolioCharts";
import { CustomerPortfolioCharts } from "./CustomerPortfolioCharts";
import { ProjectsLedger, type LedgerSort } from "./ProjectsLedger";
import { CustomerMultiSelect } from "./CustomerMultiSelect";

const FACETS: { key: ProjectFacet; label: string }[] = [
  { key: "over", label: "OVER BUDGET" },
  { key: "risk", label: "AT RISK" },
  { key: "healthy", label: "HEALTHY" },
  { key: "nobudget", label: "NO BUDGET" },
  { key: "idle", label: "NO ACTIVITY" },
];

export function ProjectsExplorer({
  rows,
  initialSort = "burn",
}: {
  rows: ProjectListRow[];
  initialSort?: LedgerSort;
}) {
  const [filters, setFilters] = useState<ProjectFilters>({
    query: "",
    customers: new Set<string>(),
    facets: new Set<ProjectFacet>(),
    billableOnly: null,
  });

  // Facet counts come from the FULL list, never the filtered one: a chip whose
  // count shrinks to match the current filter tells the reader nothing they
  // cannot already see, and makes it impossible to judge before clicking.
  const facetCounts = useMemo(
    () =>
      Object.fromEntries(
        FACETS.map(({ key }) => [key, rows.filter((p) => matchesProjectFacet(p, key)).length]),
      ) as Record<ProjectFacet, number>,
    [rows],
  );

  // Customer options, biggest-first by hours, for the multi-select.
  const customerOptions = useMemo(() => {
    const byName = new Map<string, number>();
    for (const p of rows) {
      const name = p.customerName ?? "(no customer)";
      byName.set(name, (byName.get(name) ?? 0) + p.actualHours);
    }
    return [...byName.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, hours]) => ({ name, hours }));
  }, [rows]);

  const filtered = useMemo(() => filterProjectRows(rows, filters), [rows, filters]);
  const portfolio = useMemo(() => customerPortfolioFromRows(filtered), [filtered]);

  const active = hasActiveProjectFilters(filters);

  const totalHours = filtered.reduce((s, p) => s + p.actualHours, 0);
  const billableHours = filtered.reduce((s, p) => s + p.billableHours, 0);
  const overBudget = filtered.filter((p) => p.isOver).length;
  const noBudget = filtered.filter((p) => p.burnPercent === null).length;

  const toggleFacet = (f: ProjectFacet) =>
    setFilters((prev) => {
      const next = new Set(prev.facets);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return { ...prev, facets: next };
    });

  const clearAll = () =>
    setFilters({ query: "", customers: new Set(), facets: new Set(), billableOnly: null });

  return (
    <div className="flex flex-col gap-5">
      {/* ------------------------------------------------------ the one filter bar */}
      <div
        data-projects-explorer="1"
        className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-3 card-elev"
      >
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput
            value={filters.query}
            onValueChange={(v) => setFilters((prev) => ({ ...prev, query: v }))}
            label="Search projects by name, customer or code"
            placeholder="Search projects…"
            className="w-full sm:w-64"
          />
          <CustomerMultiSelect
            options={customerOptions}
            selected={filters.customers}
            onChange={(next) => setFilters((prev) => ({ ...prev, customers: next }))}
          />
          <div className="flex items-center gap-0.5 rounded-full border border-[var(--border)] bg-[var(--surface-2)] p-0.5">
            <BillableToggle
              on={filters.billableOnly === null}
              onClick={() => setFilters((prev) => ({ ...prev, billableOnly: null }))}
            >
              All
            </BillableToggle>
            <BillableToggle
              on={filters.billableOnly === true}
              onClick={() => setFilters((prev) => ({ ...prev, billableOnly: true }))}
            >
              Billable
            </BillableToggle>
            <BillableToggle
              on={filters.billableOnly === false}
              onClick={() => setFilters((prev) => ({ ...prev, billableOnly: false }))}
            >
              Non-bill.
            </BillableToggle>
          </div>

          <div className="flex items-center gap-3 sm:ml-auto">
            <span
              className="font-mono text-[10px] tracking-[0.06em] text-[var(--text-muted)]"
              role="status"
              aria-live="polite"
            >
              {filtered.length === rows.length
                ? `${rows.length} PROJECTS`
                : `${filtered.length} OF ${rows.length}`}
            </span>
            {active && (
              <Button variant="ghost" size="sm" onClick={clearAll}>
                Clear
              </Button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {FACETS.map(({ key, label }) => (
            <FilterChip
              key={key}
              active={filters.facets.has(key)}
              onToggle={() => toggleFacet(key)}
              count={facetCounts[key]}
            >
              {label}
            </FilterChip>
          ))}
        </div>
      </div>

      {/* Everything below reads `filtered` — one control, whole page. */}
      <ProjectTotalsStrip
        projectCount={filtered.length}
        totalHours={totalHours}
        billableHours={billableHours}
        overBudget={overBudget}
        noBudget={noBudget}
      />
      <PortfolioCharts rows={filtered} />
      <CustomerPortfolioCharts data={portfolio} />
      <ProjectsLedger rows={filtered} initialSort={initialSort} />
    </div>
  );
}

/** A segment button for the billable trough; hoisted so it keeps focus. */
function BillableToggle({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`rounded-full px-3 py-1 text-[12px] transition-colors ${
        on
          ? "bg-[var(--accent)] font-medium text-[var(--accent-contrast)]"
          : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
      }`}
    >
      {children}
    </button>
  );
}
