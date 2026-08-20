"use client";

/**
 * The portfolio figures: a status donut and a top-projects bar list.
 *
 * WHY THESE TWO SHAPES. The portfolio page's two standing questions are "what state is
 * the portfolio in?" and "where do the hours actually go?". The first is a proportion
 * over four disjoint states (over budget / at risk / healthy / unbudgeted-or-idle), which
 * is the donut's shape. The second is a ranking, which is horizontal bars -- the one
 * place bars beat an area, because the axis is projects, not time.
 *
 * A client component only because the donut's slices come from Charts.tsx, which is
 * client-side; everything here is computed by the caller and passed down.
 */

import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/Card";
import { Donut, LegendDot } from "@/components/ui/Charts";
import type { ProjectListRow } from "@/lib/queries/projects-live";
import { matchesFacet } from "./ProjectsLedger";
import { burnColor } from "./ProjectPanels";

const h = (n: number) => n.toLocaleString("en-GB", { maximumFractionDigits: 1 });

export function PortfolioCharts({ rows }: { rows: ProjectListRow[] }) {
  if (rows.length === 0) return null;

  /*
   * The four states are made DISJOINT here even though the ledger's facets overlap
   * (a project can be both "no budget" and "no activity"): a donut of overlapping
   * sets would sum past 100% and the angles would lie. Priority order: over > risk >
   * healthy-with-budget > everything else, so each project lands in exactly one slice.
   */
  const over = rows.filter((p) => matchesFacet(p, "over"));
  const risk = rows.filter((p) => !matchesFacet(p, "over") && matchesFacet(p, "risk"));
  const healthy = rows.filter(
    (p) => p.burnPercent !== null && !matchesFacet(p, "over") && !matchesFacet(p, "risk"),
  );
  const unbudgeted = rows.filter((p) => p.burnPercent === null);

  const slices = [
    { label: "Over budget", value: over.length, color: "var(--critical)" },
    { label: "At risk", value: risk.length, color: "var(--warning)" },
    { label: "Healthy", value: healthy.length, color: "var(--accent)" },
    { label: "No budget", value: unbudgeted.length, color: "var(--text-faint)" },
  ];

  const measured = over.length + risk.length + healthy.length;

  /*
   * Top 10 by logged hours. Ten, not eight or twelve: on live data the tenth project
   * still carries ~2% of all hours, and past ten the bars become slivers whose labels
   * take more space than their information. The ledger below pages through the rest.
   */
  const top = [...rows].sort((a, b) => b.actualHours - a.actualHours).slice(0, 10);
  const maxHours = Math.max(...top.map((p) => p.actualHours), 1);

  return (
    <div className="grid grid-cols-1 gap-[var(--card-gap)] lg:grid-cols-12">
      <Card className="flex flex-col lg:col-span-4">
        <CardHeader title="Portfolio health" qualifier={`${rows.length} PROJECTS`} />
        <div className="flex flex-1 flex-wrap items-center justify-center gap-x-7 gap-y-3 px-4 pb-5">
          <Donut
            slices={slices}
            centre={String(measured)}
            centreLabel="budgeted"
            label={`Portfolio health across ${rows.length} projects: ${over.length} over budget, ${risk.length} at risk, ${healthy.length} healthy, ${unbudgeted.length} without a budget`}
          />
          <div className="flex flex-col gap-1.5">
            {slices.map((s) => (
              <LegendDot key={s.label} color={s.color}>
                {s.value} {s.label.toUpperCase()}
              </LegendDot>
            ))}
          </div>
        </div>
      </Card>

      <Card tone="hero" className="flex flex-col lg:col-span-8">
        <CardHeader title="Where the hours go" qualifier="TOP 10 BY LOGGED HOURS" />
        <div className="flex flex-1 flex-col justify-center gap-1.5 px-4 pb-4">
          {top.map((p) => (
            /*
             * Each bar links to its project. A ranking of clickable names beats a
             * chart the reader has to cross-reference against the table below.
             */
            <Link
              key={p.id}
              href={`/projects/${p.id}`}
              className="group grid grid-cols-12 items-center gap-2 rounded-[var(--radius-sm)] px-1.5 py-0.5 transition-colors hover:bg-[var(--surface-hover)]"
            >
              <span
                className="col-span-4 truncate text-[11.5px] text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] sm:col-span-3"
                title={p.name}
              >
                {p.name}
              </span>
              <div className="col-span-6 h-[14px] overflow-hidden rounded-[3px] bg-[var(--surface-2)] sm:col-span-7">
                <div
                  className="h-full rounded-[3px] transition-[filter] duration-150 group-hover:brightness-110"
                  style={{
                    width: `${Math.max(1.5, (p.actualHours / maxHours) * 100)}%`,
                    // The bar carries the project's burn judgement, so the ranking
                    // doubles as a health check without a second glance at the donut.
                    background: burnColor(p.burnPercent),
                  }}
                />
              </div>
              <span className="col-span-2 text-right font-mono text-[11px] tabular-nums text-[var(--text-primary)]">
                {h(p.actualHours)}h
              </span>
            </Link>
          ))}
        </div>
      </Card>
    </div>
  );
}
