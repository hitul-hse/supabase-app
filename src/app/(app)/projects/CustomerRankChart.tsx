"use client";

/**
 * Customer rank trajectory, month by month — analysis #4 from the time-analytics
 * spec ("which customers are rising or fading?").
 *
 * WHY A BUMP CHART. The question is about ORDER, not magnitude: ENERCON has been
 * #1 every month and a line chart of hours would just show one line towering over
 * five flat ones. Rank lanes make the movement underneath visible — Hochtief's
 * jump to #2, VOI's one-month spike, Netto's re-entry. Magnitude is not lost:
 * the hover/focus readout lists that month's full ranking with hours.
 *
 * A lane breaks (null rank) when the customer falls out of the month's top 6,
 * which is itself the signal — a vanished lane IS "this customer went quiet".
 *
 * Client component because BumpChart carries hover/focus state; everything here
 * is computed server-side in projects-live.ts and passed down.
 */

import { Card, CardHeader } from "@/components/ui/Card";
import { LegendDot } from "@/components/ui/Charts";
import { BumpChart } from "@/components/ui/AnalyticsCharts";
import type { CustomerRankByMonth } from "@/lib/queries/projects-live";

/**
 * Six distinct tokens for up to ~10 lanes (customers that made the top 6 in ANY
 * month). Series arrive biggest-first, so the strongest hues land on the
 * customers the reader will look for; colours repeat past six, which the legend
 * disambiguates and the readout makes unambiguous.
 */
const LANE_COLORS = [
  "var(--accent)",
  "var(--good)",
  "var(--warning)",
  "var(--critical)",
  "var(--text-secondary)",
  "var(--text-faint)",
];

const h = (n: number) => n.toLocaleString("en-GB", { maximumFractionDigits: 1 });

export function CustomerRankChart({ data }: { data: CustomerRankByMonth }) {
  const { labels, series } = data;

  // BumpChart itself refuses <2 periods; say why instead of rendering nothing.
  if (labels.length < 2 || series.length === 0) {
    return (
      <Card className="flex flex-col">
        <CardHeader title="Customer rank by month" qualifier="TOP 6 BY HOURS" />
        <p className="px-4 pb-5 text-[12px] text-[var(--text-faint)]">
          Not enough monthly history to rank customers yet — this chart needs at
          least two months of entries.
        </p>
      </Card>
    );
  }

  const coloured = series.map((s, i) => ({
    name: s.name,
    color: LANE_COLORS[i % LANE_COLORS.length],
    ranks: s.ranks,
  }));

  /** "AUG: 1. ENERCON 256.8h · 2. Hochtief 111.7h · …" for month i. */
  const readoutFor = (i: number) => {
    const ranked = series
      .map((s) => ({ name: s.name, rank: s.ranks[i], hours: s.hoursByMonth[i] }))
      .filter((s): s is { name: string; rank: number; hours: number } => s.rank !== null)
      .sort((a, b) => a.rank - b.rank);
    if (ranked.length === 0) return `${labels[i]}: no customer hours`;
    return `${labels[i]}: ${ranked.map((s) => `${s.rank}. ${s.name} ${h(s.hours)}h`).join(" · ")}`;
  };

  return (
    <Card className="flex flex-col">
      <CardHeader
        title="Customer rank by month"
        qualifier="TOP 6 BY HOURS · CALENDAR TIME INCLUDED"
      />
      <div className="h-[240px] px-4">
        <BumpChart
          labels={labels}
          series={coloured}
          maxRank={6}
          label={`Customer rank by month across ${labels.length} months, top 6 customers by hours per month`}
          readoutFor={readoutFor}
        />
      </div>
      {/* Colour -> customer. The lanes cross and break, so an end-of-line label
          cannot be relied on; the legend is the stable key. */}
      <div className="flex flex-wrap gap-x-5 gap-y-1.5 px-4 pb-4 pt-3">
        {coloured.map((s) => (
          <LegendDot key={s.name} color={s.color}>
            {s.name.toUpperCase()}
          </LegendDot>
        ))}
      </div>
    </Card>
  );
}
