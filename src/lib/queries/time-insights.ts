/**
 * Pure derivations for the TrackingTime dashboard's deep-analysis panels.
 *
 * Every function here folds the SAME ReportEntry[] the page already fetched
 * for its tables, so the analyses obey the filter bar for free and can never
 * disagree with the totals above them. No queries, no dates invented: pure
 * functions over fetched rows, unit-testable without a database.
 *
 * The analyses and their shapes come from the analysis spec
 * (.context-bridge/analysis-spec.md): customer concentration (#3, waffle),
 * weekday x start-hour pattern (#5, heatmap -- supported because entries carry
 * real start timestamps), service mix by month (#10, percent-stacked columns).
 */
import type { ReportEntry } from "./trackingtime-report";
import { secondsToHours } from "@/lib/time-transform";

/* -------------------------------------------- customer concentration (#3) */

export type CustomerShare = {
  name: string;
  hours: number;
  /** Share of the selection's hours, 0-100, one decimal. */
  percent: number;
};

/**
 * Hours per customer, biggest first, with the long tail folded into `other`.
 * The reference number this exists to surface: one customer is a third of all
 * delivered hours (ENERCON, 32% YTD when measured).
 */
export function customerConcentration(
  entries: ReportEntry[],
  topN = 6,
): { top: CustomerShare[]; otherHours: number; totalHours: number } {
  const byCustomer = new Map<string, number>();
  let total = 0;
  for (const e of entries) {
    const name = e.customerName ?? "(no customer)";
    byCustomer.set(name, (byCustomer.get(name) ?? 0) + e.durationSeconds);
    total += e.durationSeconds;
  }
  const ranked = [...byCustomer.entries()].sort((a, b) => b[1] - a[1]);
  const top = ranked.slice(0, topN).map(([name, seconds]) => ({
    name,
    hours: secondsToHours(seconds),
    percent: total > 0 ? Math.round((seconds / total) * 1000) / 10 : 0,
  }));
  const otherSeconds = ranked.slice(topN).reduce((s, [, v]) => s + v, 0);
  return {
    top,
    otherHours: secondsToHours(otherSeconds),
    totalHours: secondsToHours(total),
  };
}

/* --------------------------------------------- weekday x hour pattern (#5) */

export type WeekPatternCell = {
  /** Tracked hours in this weekday x hour bucket. null = none. */
  hours: number | null;
};

export const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/**
 * Hours bucketed by weekday x local start hour.
 *
 * Hours are shifted to Europe/Berlin (the workforce's zone -- entries carry
 * "GMT+02:00") via Intl rather than a hardcoded +2, so the figure stays right
 * across DST. Only hours 5-21 are returned: measured, the live data holds
 * near-zero outside them, and 24 columns of black flatten the contrast the
 * heatmap exists for. Calendar entries are the caller's decision -- the page
 * passes its filtered set, so the calendar toggle applies here too.
 */
export function weekdayHourPattern(entries: ReportEntry[]): {
  hourLabels: string[];
  /** cells[weekday][hourIndex], weekday 0 = Monday. */
  cells: WeekPatternCell[][];
  maxHours: number;
} {
  const HOUR_LO = 5;
  const HOUR_HI = 21;
  const hourCount = HOUR_HI - HOUR_LO + 1;
  const grid: number[][] = Array.from({ length: 7 }, () => new Array(hourCount).fill(0));

  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Berlin",
    weekday: "short",
    hour: "2-digit",
    hour12: false,
  });
  const dayIndex: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

  for (const e of entries) {
    const d = new Date(e.startedAt);
    if (Number.isNaN(d.getTime())) continue;
    const parts = fmt.formatToParts(d);
    const wd = dayIndex[parts.find((p) => p.type === "weekday")?.value ?? ""];
    const hour = Number(parts.find((p) => p.type === "hour")?.value);
    if (wd === undefined || Number.isNaN(hour)) continue;
    if (hour < HOUR_LO || hour > HOUR_HI) continue;
    grid[wd][hour - HOUR_LO] += e.durationSeconds;
  }

  let max = 0;
  const cells: WeekPatternCell[][] = grid.map((row) =>
    row.map((seconds) => {
      const hours = seconds > 0 ? secondsToHours(seconds) : null;
      if (hours !== null && hours > max) max = hours;
      return { hours };
    }),
  );

  return {
    hourLabels: Array.from({ length: hourCount }, (_, i) => `${HOUR_LO + i}`),
    cells,
    maxHours: max,
  };
}

/* -------------------------------------------------- service mix by month (#10) */

export type ServiceMixMonth = {
  /** "2026-03" */
  month: string;
  /** "MAR" */
  label: string;
  totalHours: number;
  /** Top services + "Other", in a stable order across months. */
  segments: { name: string; hours: number }[];
};

/**
 * Hours per service per month, with the same top-N service set across every
 * month so colours stay stable column to column. Percent-stacking is the
 * COMPONENT's job; this returns real hours.
 */
export function serviceMixByMonth(entries: ReportEntry[], topN = 5): ServiceMixMonth[] {
  const byMonth = new Map<string, Map<string, number>>();
  const serviceTotals = new Map<string, number>();

  for (const e of entries) {
    const month = e.startedAt.slice(0, 7);
    const service = e.serviceName ?? "(no service)";
    if (!byMonth.has(month)) byMonth.set(month, new Map());
    const m = byMonth.get(month)!;
    m.set(service, (m.get(service) ?? 0) + e.durationSeconds);
    serviceTotals.set(service, (serviceTotals.get(service) ?? 0) + e.durationSeconds);
  }

  const topServices = [...serviceTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([name]) => name);

  const monthLabel = (iso: string) =>
    new Date(`${iso}-01T00:00:00Z`)
      .toLocaleString("en-GB", { month: "short", timeZone: "UTC" })
      .toUpperCase();

  return [...byMonth.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([month, services]) => {
      let other = 0;
      const named = topServices.map((name) => ({
        name,
        hours: secondsToHours(services.get(name) ?? 0),
      }));
      for (const [name, seconds] of services) {
        if (!topServices.includes(name)) other += seconds;
      }
      const totalSeconds = [...services.values()].reduce((s, v) => s + v, 0);
      return {
        month,
        label: monthLabel(month),
        totalHours: secondsToHours(totalSeconds),
        segments: [...named, { name: "Other", hours: secondsToHours(other) }],
      };
    });
}

/* ------------------------------------------------ capacity to take on work */

export type CapacityRow = {
  memberId: number;
  name: string;
  /** Tracked hours in the selected period. */
  trackedHours: number;
  /** Billable share of those hours, 0-100, or null with nothing logged. */
  billablePercent: number | null;
  /** Nominal capacity for the period = 40h × working weeks in range. */
  nominalHours: number;
  /** trackedHours / nominalHours, 0-100+ (can exceed 100 when overloaded). */
  loadPercent: number;
  /** nominalHours − trackedHours, rounded. Negative = over capacity. */
  spareHours: number;
  /** How to read the load, so the UI does not re-derive the thresholds. */
  band: "over" | "full" | "steady" | "light" | "open";
};

export type CapacityView = {
  rows: CapacityRow[];
  /** Weeks spanned by the range, the nominal denominator basis. */
  weeks: number;
  /** People with meaningful spare capacity (light or open), most-spare first. */
  available: CapacityRow[];
};

/**
 * Who has capacity to take on more work — the panel that answers "who can pick
 * up this project" and "who can cover while X is on holiday".
 *
 * WHAT "CAPACITY" MEANS HERE, stated plainly because it is a claim about people.
 * Nominal capacity is 40h per working week across the selected period (every
 * member reports the account-default 40h; there is no negotiated figure in the
 * data, so the UI must say "nominal"). Load is tracked hours over that nominal.
 * LOW LOAD IS NOT IDLENESS: consultancy weeks hold unlogged office work, and
 * someone at 45% tracked is not half-free. So the bands are deliberately wide
 * and the panel is framed as "logged load", a planning signal, not a verdict.
 *
 * Pure over the entries the dashboard already holds, so it obeys the filter bar
 * (pick a service or a customer and it answers "who has room on THIS kind of
 * work"). The period comes from the same from/to the report is scoped to.
 */
export function capacityByMember(
  entries: ReportEntry[],
  fromIso: string,
  toIso: string,
): CapacityView {
  // Working weeks in the range, clamped so a huge custom range does not produce
  // an absurd nominal. Whole weeks, minimum one — a two-day range still has a
  // week's worth of "could they take on more today" meaning.
  const from = new Date(`${fromIso}T00:00:00Z`);
  const to = new Date(`${toIso}T00:00:00Z`);
  const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1);
  const weeks = Math.max(1, Math.min(53, Math.round((days / 7) * 10) / 10));
  const nominalHours = Math.round(40 * weeks * 10) / 10;

  const tally = new Map<number, { name: string; total: number; billable: number }>();
  for (const e of entries) {
    let a = tally.get(e.memberId);
    if (!a) {
      a = { name: e.memberName, total: 0, billable: 0 };
      tally.set(e.memberId, a);
    }
    a.total += e.durationSeconds;
    if (e.isBillable) a.billable += e.durationSeconds;
  }

  const band = (loadPercent: number): CapacityRow["band"] => {
    if (loadPercent > 105) return "over";
    if (loadPercent >= 80) return "full";
    if (loadPercent >= 55) return "steady";
    if (loadPercent >= 25) return "light";
    return "open";
  };

  const rows: CapacityRow[] = [...tally.entries()]
    .map(([memberId, a]) => {
      const trackedHours = secondsToHours(a.total);
      const loadPercent = nominalHours > 0 ? Math.round((trackedHours / nominalHours) * 100) : 0;
      return {
        memberId,
        name: a.name,
        trackedHours,
        billablePercent: a.total > 0 ? Math.round((a.billable / a.total) * 100) : null,
        nominalHours,
        loadPercent,
        spareHours: Math.round((nominalHours - trackedHours) * 10) / 10,
        band: band(loadPercent),
      };
    })
    // Busiest first: the panel reads top-down from "at capacity" to "wide open",
    // so an overloaded person and an available one are both easy to spot.
    .sort((x, y) => y.loadPercent - x.loadPercent);

  const available = rows
    .filter((r) => r.band === "light" || r.band === "open")
    .sort((x, y) => y.spareHours - x.spareHours);

  return { rows, weeks, available };
}

