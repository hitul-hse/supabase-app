/**
 * Client-safe pure derivations for the Projects explorer.
 *
 * WHY A SEPARATE MODULE. projects-live.ts is the server query layer; importing
 * it into a Client Component would be wrong in principle (it exists to run under
 * a server Supabase client) even though its functions happen to be pure. These
 * are the folds the filterable charts need, over data ALREADY in the browser —
 * the full ProjectListRow[] the server sent to compute the totals strip — so
 * filtering and re-charting is instant and needs no round trip.
 *
 * Everything here is a pure function of rows, unit-testable without a database,
 * and obeys the app's rule: a missing measurement is null, never a misleading
 * zero.
 */
import type { ProjectListRow } from "@/lib/queries/projects-live";

/* --------------------------------------------------------------- filtering */

/**
 * The filter surface for the Projects page, shared by the charts AND the
 * ledger so one control moves the whole page — the TrackingTime dashboard's
 * model, brought to Projects.
 *
 * An EMPTY set/blank means "no constraint", never "match nothing": a page that
 * empties itself because a picker was cleared reads as data loss.
 */
export type ProjectFilters = {
  /** Free-text over name, customer and code. */
  query: string;
  /** Customer names to keep (OR within). Empty = all customers. */
  customers: Set<string>;
  /** Budget-status facets (OR within). Empty = all statuses. */
  facets: Set<ProjectFacet>;
  /** null = both billable and non-billable projects. */
  billableOnly: boolean | null;
};

export type ProjectFacet = "over" | "risk" | "healthy" | "nobudget" | "idle";

/**
 * The bucket a project with no customer falls into.
 *
 * It is a KEY, not a label: the filter set, the customer options and the
 * portfolio rows all agree on this exact string, and `filterProjectRows` tests
 * membership with it. Translating it in place would silently unselect the
 * bucket the moment the reader switches language, so the key stays English and
 * the components render `drill.noCustomer` in its place.
 */
export const NO_CUSTOMER = "(no customer)";

export const EMPTY_PROJECT_FILTERS: ProjectFilters = {
  query: "",
  customers: new Set(),
  facets: new Set(),
  billableOnly: null,
};

/** Does one row belong to a budget-status facet? Pure, so a gate can exercise it. */
export function matchesProjectFacet(p: ProjectListRow, facet: ProjectFacet): boolean {
  switch (facet) {
    case "over":
      return p.burnPercent !== null && p.burnPercent > 100;
    case "risk":
      return p.burnPercent !== null && p.burnPercent >= 85 && p.burnPercent <= 100;
    case "healthy":
      return p.burnPercent !== null && p.burnPercent < 85;
    case "nobudget":
      return p.burnPercent === null;
    case "idle":
      return p.actualHours === 0;
  }
}

/**
 * Apply the filter surface to the project list.
 *
 * Facets are OR'd within the dimension (over/risk/healthy are disjoint, so
 * AND-ing would always empty the list), customers OR'd within theirs, and the
 * dimensions AND'd together — the behaviour every reporting tool has.
 */
export function filterProjectRows(rows: ProjectListRow[], f: ProjectFilters): ProjectListRow[] {
  const q = f.query.trim().toLowerCase();
  return rows.filter((p) => {
    const matchesSearch =
      q === "" ||
      p.name.toLowerCase().includes(q) ||
      (p.customerName ?? "").toLowerCase().includes(q) ||
      (p.code ?? "").toLowerCase().includes(q);
    const matchesCustomer =
      f.customers.size === 0 || f.customers.has(p.customerName ?? NO_CUSTOMER);
    const matchesFacet =
      f.facets.size === 0 || [...f.facets].some((x) => matchesProjectFacet(p, x));
    const matchesBillable =
      f.billableOnly === null || p.isBillable === f.billableOnly;
    return matchesSearch && matchesCustomer && matchesFacet && matchesBillable;
  });
}

/** True when any constraint is active — drives the "Clear" affordance. */
export function hasActiveProjectFilters(f: ProjectFilters): boolean {
  return (
    f.query.trim() !== "" ||
    f.customers.size > 0 ||
    f.facets.size > 0 ||
    f.billableOnly !== null
  );
}

/* --------------------------------------------------- customer portfolio (client) */

export type CustomerShareRow = {
  name: string;
  hours: number;
  billablePercent: number | null;
  sharePercent: number;
  activeProjects: number;
  committedHours: number | null;
  headroomHours: number | null;
};

export type CustomerPortfolioView = {
  rows: CustomerShareRow[];
  totalHours: number;
  customerCount: number;
  top5SharePercent: number;
};

/**
 * Aggregate a (possibly filtered) project list by customer.
 *
 * This mirrors customerPortfolio() in projects-live.ts but folds only the ROWS
 * — no per-entry recency window — because it recomputes on every filter change
 * in the browser, where the entries are not shipped. The two agree on the
 * numbers the UI actually shows (share, committed, headroom); recency was
 * computed server-side and never rendered, so nothing is lost.
 */
export function customerPortfolioFromRows(rows: ProjectListRow[]): CustomerPortfolioView {
  type Acc = {
    hours: number;
    billableHours: number;
    projects: number;
    committed: number;
    committedDelivered: number;
    hasBudget: boolean;
  };
  const byCustomer = new Map<string, Acc>();
  for (const p of rows) {
    if (p.actualHours <= 0 && (p.estimatedHours ?? 0) <= 0) continue;
    const name = p.customerName ?? NO_CUSTOMER;
    let a = byCustomer.get(name);
    if (!a) {
      a = { hours: 0, billableHours: 0, projects: 0, committed: 0, committedDelivered: 0, hasBudget: false };
      byCustomer.set(name, a);
    }
    a.hours += p.actualHours;
    a.billableHours += p.billableHours;
    if (p.actualHours > 0) a.projects += 1;
    if (p.estimatedHours !== null && p.estimatedHours > 0) {
      a.committed += p.estimatedHours;
      a.committedDelivered += p.actualHours;
      a.hasBudget = true;
    }
  }

  const totalHours = [...byCustomer.values()].reduce((s, a) => s + a.hours, 0);
  const out: CustomerShareRow[] = [...byCustomer.entries()]
    .filter(([, a]) => a.hours > 0)
    .map(([name, a]) => ({
      name,
      hours: Math.round(a.hours * 10) / 10,
      billablePercent: a.hours > 0 ? Math.round((a.billableHours / a.hours) * 100) : null,
      sharePercent: totalHours > 0 ? Math.round((a.hours / totalHours) * 1000) / 10 : 0,
      activeProjects: a.projects,
      committedHours: a.hasBudget ? Math.round(a.committed * 10) / 10 : null,
      headroomHours: a.hasBudget ? Math.round((a.committed - a.committedDelivered) * 10) / 10 : null,
    }))
    .sort((x, y) => y.hours - x.hours);

  const top5SharePercent =
    totalHours > 0
      ? Math.round((out.slice(0, 5).reduce((s, r) => s + r.hours, 0) / totalHours) * 100)
      : 0;

  return {
    rows: out,
    totalHours: Math.round(totalHours * 10) / 10,
    customerCount: out.length,
    top5SharePercent,
  };
}
