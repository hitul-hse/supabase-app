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
