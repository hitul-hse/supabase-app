"use client";

/**
 * The TrackingTime dashboard's deep-analysis panels: customer concentration
 * (waffle), the weekday x hour work pattern (heatmap), and the service mix by
 * month (percent-stacked columns).
 *
 * All three fold the same filtered entries the tables render, so the filter
 * bar governs them for free and they can never disagree with the totals strip.
 * Shapes per the analysis spec (.context-bridge/analysis-spec.md #3, #5, #10).
 */

import { Card, CardHeader } from "@/components/ui/Card";
import {
  HeatmapMatrix,
  StackedColumns100,
  Waffle,
} from "@/components/ui/AnalyticsCharts";
import { LegendDot } from "@/components/ui/Charts";
import { MobileDisclosure } from "@/components/MobileDisclosure";
import type {
  CustomerShare,
  ServiceMixMonth,
  WeekPatternCell,
} from "@/lib/queries/time-insights";
import { WEEKDAY_LABELS } from "@/lib/queries/time-insights";

const h = (n: number) => n.toLocaleString("en-GB", { maximumFractionDigits: 1 });

/** Stable series palette: distinguishable in both themes, all tokens. */
const SERIES = [
  "var(--accent)",
  "var(--good)",
  "var(--warning)",
  "var(--critical)",
  "var(--text-secondary)",
  "var(--text-faint)",
];

export function InsightPanels({
  customers,
  otherHours,
  totalHours,
  pattern,
  serviceMix,
}: {
  customers: CustomerShare[];
  otherHours: number;
  totalHours: number;
  pattern: { hourLabels: string[]; cells: WeekPatternCell[][]; maxHours: number };
  serviceMix: ServiceMixMonth[];
}) {
  /* ---------------------------------------------------------- waffle */
  const waffleSlices = customers.map((c, i) => ({
    label: c.name,
    value: c.hours,
    color: SERIES[i % SERIES.length],
  }));

  /* --------------------------------------------------------- heatmap */
  // Weekend rows are dropped when empty -- the healthy, usual case -- so the
  // five real rows get the vertical room. When weekend work exists, it shows.
  const rowsWithWork = WEEKDAY_LABELS.map((label, i) => ({
    label,
    cells: pattern.cells[i],
    any: pattern.cells[i]?.some((c) => c.hours !== null) ?? false,
  })).filter((r, i) => i < 5 || r.any);

  const heatCells = rowsWithWork.map((r) =>
    r.cells.map((c, hi) => ({
      value: c.hours,
      readout:
        c.hours === null
          ? `${r.label} ${pattern.hourLabels[hi]}:00: nothing tracked`
          : `${r.label} ${pattern.hourLabels[hi]}:00–${pattern.hourLabels[hi]}:59: ${h(c.hours)}h tracked`,
    })),
  );

  // Perceptual, not linear: tracked hours are heavily skewed to the 08:00
  // spike (site visits start on the hour), and a linear ramp paints everything
  // else near-black. sqrt keeps the midday texture readable.
  const tone = (v: number) => {
    const f = pattern.maxHours > 0 ? Math.sqrt(v / pattern.maxHours) : 0;
    return `color-mix(in srgb, var(--accent) ${Math.round(f * 100)}%, var(--surface-2))`;
  };

  /* ------------------------------------------------------ service mix */
  const serviceNames = serviceMix[0]?.segments.map((s) => s.name) ?? [];
  const columns = serviceMix.map((m) => ({
    label: m.label,
    segments: m.segments.map((s, i) => ({
      label: s.name,
      value: s.hours,
      color: SERIES[i % SERIES.length],
    })),
    readout: `${m.label}: ${h(m.totalHours)}h — ${m.segments
      .filter((s) => s.hours > 0)
      .map((s) => `${s.name} ${Math.round((s.hours / m.totalHours) * 100)}%`)
      .join(" · ")}`,
  }));

  return (
    <div
      data-insight-panels="1"
      className="grid grid-cols-1 gap-[var(--card-gap)] lg:grid-cols-12"
    >
      {/* --------------------------------------- customer concentration */}
      {/*
        PHONE ONLY: collapsed. Measured at 390x844 against a production build,
        this panel is 968px -- the single tallest block on the route, and
        /time/dashboard was 4,388px = 5.2 screens against a budget of 5. It is
        over by only 168px, so collapsing this one clears it with room to spare.

        Why this panel and not the heatmap below it: a waffle chart is a
        desktop scanning tool. Its finding is one sentence ("the top customers
        hold N% of the hours"), which the summary states in full, so a phone
        reader loses nothing but the pixels. The heatmap's finding IS its shape
        and cannot be summarised, so it stays open.

        MobileDisclosure keeps `sm:block` on its content, so from sm up this is
        a bare wrapper div and the lg:grid-cols-12 layout is untouched. The
        wrapper carries the col-span the Card used to carry, or the grid would
        place the wrapper instead of the panel.
      */}
      <MobileDisclosure
        className="lg:col-span-4"
        title="Customer concentration"
        summary={
          customers.length === 0
            ? "No customers in this selection"
            : `top ${customers.length} hold ${customers.reduce((s, c) => s + c.percent, 0)}% of ${h(totalHours)}h` +
              (customers[0] ? ` · biggest ${customers[0].name} ${customers[0].percent}%` : "")
        }
      >
        <Card className="flex h-full flex-col">
        <CardHeader
          title="Customer concentration"
          qualifier={`1 SQUARE = 1% OF ${h(totalHours)}H`}
        />
        <div className="flex flex-1 flex-col gap-3 px-4 pb-4">
          {customers.length === 0 ? (
            <p className="font-mono text-[11px] text-[var(--text-faint)]">
              No customers in this selection.
            </p>
          ) : (
            <>
              <Waffle
                slices={waffleSlices}
                label={`Customer concentration: ${customers
                  .map((c) => `${c.name} ${c.percent}%`)
                  .join(", ")}, everything else ${h(otherHours)}h`}
              />
              <div className="flex flex-col gap-1">
                {customers.map((c, i) => (
                  <span key={c.name} className="flex items-baseline justify-between gap-2">
                    <LegendDot color={SERIES[i % SERIES.length]}>
                      <span className="max-w-[11rem] truncate">{c.name}</span>
                    </LegendDot>
                    <span className="font-mono text-[10px] tabular-nums text-[var(--text-muted)]">
                      {c.percent}% · {h(c.hours)}h
                    </span>
                  </span>
                ))}
                {otherHours > 0 && (
                  <span className="flex items-baseline justify-between gap-2">
                    <LegendDot color="var(--surface-2)">everything else</LegendDot>
                    <span className="font-mono text-[10px] tabular-nums text-[var(--text-muted)]">
                      {h(otherHours)}h
                    </span>
                  </span>
                )}
              </div>
              {/* The waffle's reason to exist: dependency, said plainly. */}
              {customers[0] && customers[0].percent >= 25 && (
                <p className="mt-auto border-t border-[var(--border)] pt-2 text-[10px] leading-relaxed text-[var(--text-faint)]">
                  {customers[0].name} alone is {customers[0].percent}% of this
                  selection&rsquo;s hours — a concentration worth knowing when planning
                  capacity or pricing.
                </p>
              )}
            </>
          )}
        </div>
        </Card>
      </MobileDisclosure>

      {/* ----------------------------------------------- weekday pattern */}
      {/* Stays OPEN at every width. The heatmap's finding is its shape -- where
          the week's work actually falls -- and no summary line can carry that,
          so collapsing it would cost the reader the answer rather than the
          scrolling. Collapsing the panel above already brings the route inside
          budget, so there is nothing to buy here. */}
      <Card className="flex flex-col lg:col-span-8">
        <CardHeader
          title="When the work happens"
          qualifier="TRACKED HOURS BY WEEKDAY × START HOUR · EUROPE/BERLIN"
        />
        <div className="px-4 pb-4">
          {pattern.maxHours === 0 ? (
            <p className="font-mono text-[11px] text-[var(--text-faint)]">
              No tracked time in this selection.
            </p>
          ) : (
            <>
              <HeatmapMatrix
                rowLabels={rowsWithWork.map((r) => r.label)}
                colLabels={pattern.hourLabels}
                cells={heatCells}
                tone={tone}
                label="Tracked hours by weekday and start hour"
                rowLabelWidth="3.5rem"
              />
              <p className="pt-2 text-[10px] leading-relaxed text-[var(--text-faint)]">
                Colour is square-root scaled: the on-the-hour morning spike (site
                visits) would otherwise flatten the rest of the week. Weekend rows
                appear only when weekend work exists.
              </p>
            </>
          )}
        </div>
      </Card>

      {/* -------------------------------------------------- service mix */}
      {columns.length >= 2 && (
        <Card className="flex flex-col lg:col-span-12">
          <CardHeader
            title="Service mix by month"
            qualifier="SHARE OF EACH MONTH'S HOURS"
            actions={
              <div className="flex flex-wrap items-center gap-3">
                {serviceNames.map((name, i) => (
                  <LegendDot key={name} color={SERIES[i % SERIES.length]}>
                    {name.toUpperCase()}
                  </LegendDot>
                ))}
              </div>
            }
          />
          <div className="flex flex-col px-4 pb-4">
            <div className="h-[190px]">
              <StackedColumns100
                columns={columns}
                label="Service mix per month, as a share of that month's hours"
              />
            </div>
            <p className="pt-2 text-[10px] leading-relaxed text-[var(--text-faint)]">
              Share, not volume, on purpose: the trend chart above already shows how
              much was worked; this shows what KIND of work it was and how that mix
              shifts month to month.
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}
