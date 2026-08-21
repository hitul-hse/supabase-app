"use client";

/**
 * The Team Lead deep-analysis figures, from the analysis spec
 * (.context-bridge/analysis-spec.md) ranked by value to a managing director:
 *
 *   #1  Month-over-month per-person deviation  -> DivergingBars
 *   #2  Weekly utilisation per person          -> HeatmapMatrix
 *   #7  Travel burden per person               -> StackedBarsH
 *
 * All three read the SAME board data the grid renders, so the analysis and the
 * grid cannot disagree — the rule TeamLeadCharts established. The month
 * comparison is the one exception: it is anchored to calendar months at today
 * (its own scan), because "this month vs last" must not change meaning when the
 * range filter moves. Its card says so.
 */

import { Card, CardHeader } from "@/components/ui/Card";
import {
  DivergingBars,
  HeatmapMatrix,
  StackedBarsH,
} from "@/components/ui/AnalyticsCharts";
import { LegendDot } from "@/components/ui/Charts";
import type { TeamLeadBoardData } from "@/lib/queries/team-lead-live";

const h = (n: number) => n.toLocaleString("en-GB", { maximumFractionDigits: 1 });

/**
 * Utilisation cell colour: a judgement, not a ramp. Centred on the healthy
 * band, because both chronic overload AND dead weeks are what a lead scans for.
 * Alpha-composited from the app's own status tones so both themes inherit it.
 */
function utilisationTone(pct: number): string {
  if (pct > 115) return "var(--critical)";
  if (pct >= 90) return "color-mix(in srgb, var(--critical) 45%, var(--surface-2))";
  if (pct >= 50) return "var(--good)";
  if (pct >= 25) return "color-mix(in srgb, var(--good) 45%, var(--surface-2))";
  return "color-mix(in srgb, var(--warning) 55%, var(--surface-2))";
}

export function TeamDeepAnalysis({ board }: { board: TeamLeadBoardData }) {
  const { weeks, rows, monthComparison, travelRows } = board;

  /* ---- utilisation heatmap: person x week, % of contracted hours ---- */
  const activeRows = rows.filter((r) => !r.isArchived && r.totalHours > 0);
  const heat = activeRows.map((r) =>
    r.cells.map((c, i) => {
      if (c.hours === null || r.weeklyHours <= 0) {
        return {
          value: null,
          readout: `${r.name}, ${weeks[i]?.label}: nothing logged`,
        };
      }
      const pct = Math.round((c.hours / r.weeklyHours) * 100);
      return {
        value: pct,
        readout: `${r.name}, ${weeks[i]?.label}: ${h(c.hours)}h = ${pct}% of ${r.weeklyHours}h${weeks[i]?.isCurrent ? " (week in progress)" : ""}`,
      };
    }),
  );

  const monthDeltas = (monthComparison?.deltas ?? []).map((d) => ({
    label: d.name,
    value: d.deltaHours,
    readout: `${d.name}: ${h(d.prevHours)}h in ${monthComparison!.prevLabel} → ${h(d.currHours)}h in ${monthComparison!.currLabel} (${d.deltaHours >= 0 ? "+" : ""}${h(d.deltaHours)}h)`,
  }));

  const travel = travelRows.map((t) => ({
    label: t.name,
    segments: [
      { label: "Client work", value: t.clientHours, color: "var(--accent)" },
      { label: "Paid travel", value: t.paidTravelHours, color: "var(--warning)" },
      { label: "Unpaid travel", value: t.unpaidTravelHours, color: "var(--critical)" },
      { label: "Internal", value: t.internalHours, color: "var(--text-faint)" },
    ],
  }));

  const orgTravelUnpaid = travelRows.reduce((s, t) => s + t.unpaidTravelHours, 0);
  const orgTravelPaid = travelRows.reduce((s, t) => s + t.paidTravelHours, 0);
  const orgTotal = travelRows.reduce((s, t) => s + t.totalHours, 0);
  const travelSharePct =
    orgTotal > 0 ? Math.round(((orgTravelPaid + orgTravelUnpaid) / orgTotal) * 100) : 0;

  return (
    <div
      data-deep-analysis="1"
      className="grid grid-cols-1 gap-[var(--card-gap)] px-4 pb-4 sm:px-6 lg:grid-cols-12"
    >
      {/* -------------------------------------------- month over month */}
      <Card className="flex flex-col lg:col-span-5">
        <CardHeader
          title="Month over month"
          qualifier={
            monthComparison
              ? `${monthComparison.prevLabel} → ${monthComparison.currLabel} · CALENDAR MONTHS`
              : "CALENDAR MONTHS"
          }
        />
        {monthComparison === null ? (
          <p className="px-4 pb-4 font-mono text-[11px] text-[var(--text-faint)]">
            No tracked time in either month yet.
          </p>
        ) : (
          <div className="flex flex-1 flex-col gap-3 px-4 pb-4">
            <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
              <span className="font-mono text-[11px] text-[var(--text-secondary)]">
                {monthComparison.prevLabel}{" "}
                <strong className="text-[15px] text-[var(--text-primary)]">
                  {h(monthComparison.orgPrevHours)}h
                </strong>
                {monthComparison.orgPrevBillablePercent !== null &&
                  ` · ${monthComparison.orgPrevBillablePercent}% billable`}
              </span>
              <span aria-hidden className="text-[var(--text-faint)]">
                →
              </span>
              <span className="font-mono text-[11px] text-[var(--text-secondary)]">
                {monthComparison.currLabel}{" "}
                <strong className="text-[15px] text-[var(--text-primary)]">
                  {h(monthComparison.orgCurrHours)}h
                </strong>
                {monthComparison.orgCurrBillablePercent !== null &&
                  ` · ${monthComparison.orgCurrBillablePercent}% billable`}
              </span>
            </div>
            {/* A partial month next to a complete one always reads as a
                collapse; the run-rate line is what makes the comparison fair. */}
            {monthComparison.orgPaceHours !== null && (
              <p className="font-mono text-[10px] text-[var(--text-faint)]">
                {monthComparison.currLabel} pace: ~{h(monthComparison.orgPaceHours)}h by
                month end at the current working-day rate.
              </p>
            )}
            <DivergingBars
              items={monthDeltas}
              label={`Hours moved per person between ${monthComparison.prevLabel} and ${monthComparison.currLabel}`}
              formatValue={(v) => `${v >= 0 ? "+" : ""}${h(v)}h`}
            />
            <p className="mt-auto border-t border-[var(--border)] pt-2 text-[10px] leading-relaxed text-[var(--text-faint)]">
              Fixed to calendar months on purpose: this card answers &ldquo;are we doing
              more than last month?&rdquo; and must not change meaning when the period
              filter above moves. Someone dropping to zero here is the finding
              this card exists for.
            </p>
          </div>
        )}
      </Card>

      {/* ------------------------------------------ utilisation heatmap */}
      <Card className="flex flex-col lg:col-span-7">
        <CardHeader
          title="Utilisation heatmap"
          qualifier={`${weeks[0]?.label}–${weeks[weeks.length - 1]?.label} · % OF NOMINAL 40H WEEK`}
          actions={
            <div className="flex items-center gap-3">
              <LegendDot color="var(--warning)">&lt;25%</LegendDot>
              <LegendDot color="var(--good)">50–90%</LegendDot>
              <LegendDot color="var(--critical)">&gt;115%</LegendDot>
            </div>
          }
        />
        <div className="px-4 pb-4">
          {activeRows.length === 0 ? (
            <p className="font-mono text-[11px] text-[var(--text-faint)]">
              Nobody logged time in this period.
            </p>
          ) : (
            <>
              <HeatmapMatrix
                rowLabels={activeRows.map((r) => r.name)}
                colLabels={weeks.map((w) => w.label)}
                cells={heat}
                tone={utilisationTone}
                label={`Weekly utilisation per person, ${weeks[0]?.label} to ${weeks[weeks.length - 1]?.label}: each cell is that week's hours as a share of the nominal 40-hour week`}
              />
              <p className="pt-2 text-[10px] leading-relaxed text-[var(--text-faint)]">
                Reading it: a red streak is chronic overload, not a bad week. Dashed
                cells are absences of data, not zeros — consultancy weeks also hold
                unlogged office work, so 30–50% is a normal band, and the current
                week is always part-filled.
              </p>
            </>
          )}
        </div>
      </Card>

      {/* ------------------------------------------------ travel burden */}
      {travel.length > 0 && (
        <Card className="flex flex-col lg:col-span-12">
          <CardHeader
            title="Where the hours go"
            qualifier={`TRAVEL IS ${travelSharePct}% OF TRACKED TIME IN THIS PERIOD`}
            actions={
              <div className="flex flex-wrap items-center gap-3">
                <LegendDot color="var(--accent)">CLIENT WORK</LegendDot>
                <LegendDot color="var(--warning)">PAID TRAVEL</LegendDot>
                <LegendDot color="var(--critical)">UNPAID TRAVEL</LegendDot>
                <LegendDot color="var(--text-faint)">INTERNAL</LegendDot>
              </div>
            }
          />
          <div className="px-4 pb-4">
            <StackedBarsH
              rows={travel}
              label="Composition of each person's tracked time: client work, paid travel, unpaid travel, internal"
              formatTotal={(t) => `${h(t)}h`}
            />
            <p className="pt-2 text-[10px] leading-relaxed text-[var(--text-faint)]">
              The red segment is the actionable one: unpaid travel
              {orgTravelUnpaid > 0 ? ` (${h(orgTravelUnpaid)}h in this period)` : ""} is
              cost the engagement absorbs. Classified by each entry&rsquo;s service, so
              it matches TrackingTime&rsquo;s own travel services exactly.
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}
