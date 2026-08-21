"use client";

/**
 * Customer portfolio: who our biggest customers are, and where capacity is
 * tight. Replaces the customer rank-by-month bump chart, which only showed
 * ORDER (ENERCON was #1 every month, so the lanes barely moved). The questions
 * that actually matter for a consultancy are concentration and capacity, and
 * this answers both from the same project ledger the page already has.
 *
 *   LEFT  — a donut of delivered-hours SHARE: the biggest customers at a glance,
 *           with the top-5 concentration called out (a dependency risk number).
 *   RIGHT — a capacity bar per customer: delivered against committed budget, so
 *           an OVERRUN (delivered past scope, no headroom left) reads
 *           differently from a customer with budget still to burn.
 *
 * Client component only because Donut carries hover state; every number is
 * computed server-side in projects-live.ts (customerPortfolio) and passed down.
 */

import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/Card";
import { Donut, LegendDot } from "@/components/ui/Charts";
import type { CustomerPortfolio } from "@/lib/queries/projects-live";

const h = (n: number) => n.toLocaleString("en-GB", { maximumFractionDigits: 1 });

/** Distinct hues for the donut's top slices; the tail folds into one grey. */
const SLICE_COLORS = [
  "var(--accent)",
  "var(--good)",
  "var(--warning)",
  "var(--critical)",
  "var(--chart-hue)",
  "var(--text-secondary)",
];

export function CustomerPortfolioCharts({ data }: { data: CustomerPortfolio }) {
  const { rows, totalHours, customerCount, top5SharePercent } = data;

  if (rows.length === 0) {
    return (
      <Card className="flex flex-col">
        <CardHeader title="Customers" qualifier="BY DELIVERED HOURS" />
        <p className="px-4 pb-5 text-[12px] text-[var(--text-faint)]">
          No customer hours logged yet.
        </p>
      </Card>
    );
  }

  const TOP = 6;
  const top = rows.slice(0, TOP);
  const tailHours = rows.slice(TOP).reduce((s, r) => s + r.hours, 0);

  const slices = top.map((r, i) => ({
    label: r.name,
    value: r.hours,
    color: SLICE_COLORS[i % SLICE_COLORS.length],
  }));
  if (tailHours > 0) {
    slices.push({ label: `${customerCount - TOP} more`, value: tailHours, color: "var(--border-strong)" });
  }

  // The capacity view lists customers that HAVE a budget to judge against,
  // worst headroom first — the overruns are the ones needing a conversation.
  const budgeted = rows
    .filter((r) => r.committedHours !== null && r.headroomHours !== null)
    .sort((a, b) => (a.headroomHours ?? 0) - (b.headroomHours ?? 0))
    .slice(0, 8);

  // A shared scale so bars are comparable: the largest of committed or delivered
  // across the shown customers is the full width.
  const capMax = Math.max(
    1,
    ...budgeted.map((r) => Math.max(r.committedHours ?? 0, r.hours)),
  );

  return (
    <div className="grid grid-cols-1 gap-[var(--card-gap)] lg:grid-cols-12">
      {/* ---------------------------------------- biggest customers (share) */}
      <Card className="flex flex-col lg:col-span-5">
        <CardHeader
          title="Biggest customers"
          qualifier={`TOP 5 = ${top5SharePercent}% OF ${h(totalHours)}H`}
        />
        <div className="flex flex-1 flex-col items-center gap-4 px-4 pb-5 sm:flex-row sm:items-center">
          <Donut
            slices={slices}
            centre={`${top[0].sharePercent}%`}
            centreLabel={top[0].name.split(" ")[0]}
            label={`Delivered-hours share by customer: ${top
              .map((r) => `${r.name} ${r.sharePercent}%`)
              .join(", ")}`}
            size={168}
            thickness={16}
          />
          <div className="flex w-full flex-col gap-1.5">
            {top.map((r, i) => (
              <div key={r.name} className="flex items-baseline justify-between gap-2">
                <LegendDot color={SLICE_COLORS[i % SLICE_COLORS.length]}>
                  <span className="max-w-[12rem] truncate">{r.name}</span>
                </LegendDot>
                <span className="font-mono text-[10px] tabular-nums text-[var(--text-muted)]">
                  {r.sharePercent}% · {h(r.hours)}h
                </span>
              </div>
            ))}
            {tailHours > 0 && (
              <div className="flex items-baseline justify-between gap-2">
                <LegendDot color="var(--border-strong)">{customerCount - TOP} more</LegendDot>
                <span className="font-mono text-[10px] tabular-nums text-[var(--text-muted)]">
                  {h(tailHours)}h
                </span>
              </div>
            )}
          </div>
        </div>
        {top[0].sharePercent >= 25 && (
          <p className="border-t border-[var(--border)] px-4 py-2.5 text-[10px] leading-relaxed text-[var(--text-faint)]">
            {top[0].name} alone is {top[0].sharePercent}% of delivered hours and the top
            five are {top5SharePercent}% — a concentration worth weighing when planning
            capacity or pricing.
          </p>
        )}
      </Card>

      {/* --------------------------------------------- capacity vs commitment */}
      <Card className="flex flex-col lg:col-span-7">
        <CardHeader
          title="Capacity against commitment"
          qualifier="DELIVERED vs BUDGETED HOURS · WORST HEADROOM FIRST"
          actions={
            <div className="flex items-center gap-3">
              <LegendDot color="var(--accent)">DELIVERED</LegendDot>
              <LegendDot color="var(--critical)">OVER BUDGET</LegendDot>
            </div>
          }
        />
        <div className="flex flex-col gap-2.5 px-4 pb-4">
          {budgeted.length === 0 ? (
            <p className="py-4 font-mono text-[11px] text-[var(--text-faint)]">
              No customer has a budgeted project to judge capacity against.
            </p>
          ) : (
            budgeted.map((r) => {
              const committed = r.committedHours ?? 0;
              const over = (r.headroomHours ?? 0) < 0;
              const deliveredPct = (r.hours / capMax) * 100;
              const committedPct = (committed / capMax) * 100;
              return (
                <div key={r.name} className="flex flex-col gap-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="max-w-[60%] truncate text-[12px] text-[var(--text-primary)]">
                      {r.name}
                    </span>
                    <span
                      className={`font-mono text-[10px] tabular-nums ${
                        over ? "text-[var(--critical)]" : "text-[var(--text-muted)]"
                      }`}
                    >
                      {h(r.hours)}h / {h(committed)}h ·{" "}
                      {over
                        ? `${h(Math.abs(r.headroomHours ?? 0))}h over`
                        : `${h(r.headroomHours ?? 0)}h left`}
                    </span>
                  </div>
                  {/* The track is the committed budget; the fill is delivered.
                      When delivered exceeds committed the fill runs past the
                      track marker and turns critical -- an overrun you can see. */}
                  <div className="relative h-3 w-full rounded-[3px] bg-[var(--surface-2)]">
                    {/* committed marker */}
                    <span
                      className="absolute top-0 h-full border-r border-[var(--border-strong)]"
                      style={{ width: `${Math.min(100, committedPct)}%` }}
                    />
                    <span
                      className="absolute left-0 top-0 h-full rounded-[3px] transition-all"
                      style={{
                        width: `${Math.min(100, deliveredPct)}%`,
                        background: over ? "var(--critical)" : "var(--accent)",
                        opacity: 0.9,
                      }}
                    />
                  </div>
                </div>
              );
            })
          )}
          <Link
            href="/projects?sort=burn"
            scroll={false}
            className="mt-1 self-start text-[11px] text-[var(--accent)] underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
          >
            See every project by burn →
          </Link>
        </div>
      </Card>
    </div>
  );
}
