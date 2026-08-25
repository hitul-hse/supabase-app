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
import { Card, CardHeader, ChartNote } from "@/components/ui/Card";
import { Donut, LegendDot } from "@/components/ui/Charts";
import type { ProjectListRow } from "@/lib/queries/projects-live";
import { matchesFacet } from "./ProjectsLedger";
import { burnColor } from "./ProjectPanels";
import type { ProjectFacet } from "./project-insights";

/** Donut slice label -> the status facet clicking it should toggle. */
const SLICE_TO_FACET: Record<string, ProjectFacet> = {
  "Over budget": "over",
  "At risk": "risk",
  Healthy: "healthy",
  "No budget": "nobudget",
};

const h = (n: number) => n.toLocaleString("en-GB", { maximumFractionDigits: 1 });

export function PortfolioCharts({
  rows,
  onFacet,
  activeFacet = null,
}: {
  rows: ProjectListRow[];
  /** When given, the health donut cross-filters: clicking a slice toggles its
   * status facet on the page, the way clicking a mark filters in Power BI. */
  onFacet?: (facet: ProjectFacet) => void;
  activeFacet?: ProjectFacet | null;
}) {
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
            onSelect={onFacet ? (sliceLabel) => {
              const facet = SLICE_TO_FACET[sliceLabel];
              if (facet) onFacet(facet);
            } : undefined}
            activeLabel={
              activeFacet
                ? (Object.entries(SLICE_TO_FACET).find(([, f]) => f === activeFacet)?.[0] ?? null)
                : null
            }
          />
          <div className="flex flex-col gap-1.5">
            {slices.map((s) => {
              const facet = SLICE_TO_FACET[s.label];
              const isActive = activeFacet !== null && facet === activeFacet;
              // The legend rows are clickable too — a bigger hit target than the
              // ring, and the standard way to pick a category in a BI legend.
              return onFacet && facet ? (
                <button
                  key={s.label}
                  type="button"
                  onClick={() => onFacet(facet)}
                  aria-pressed={isActive}
                  className={`flex items-center rounded-[var(--radius-sm)] px-1 py-0.5 text-left transition-colors hover:bg-[var(--surface-hover)] ${
                    isActive ? "bg-[var(--surface-hover)]" : ""
                  }`}
                >
                  <LegendDot color={s.color}>
                    {s.value} {s.label.toUpperCase()}
                  </LegendDot>
                </button>
              ) : (
                <LegendDot key={s.label} color={s.color}>
                  {s.value} {s.label.toUpperCase()}
                </LegendDot>
              );
            })}
          </div>
        </div>
        {/*
          A figure that sorts projects into named buckets has to say where the
          boundaries are, or "at risk" is just a colour someone chose. These are
          the same thresholds the ledger filters on (matchesFacet), so clicking a
          slice and reading this line cannot disagree.
        */}
        <ChartNote>
          Projects by budget burn — logged hours as a share of the budget. Over
          budget is above 100%, at risk is 85–100%. Projects with no budget set
          are counted separately, never assumed healthy.
        </ChartNote>
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
        {/*
          The ranking is by logged hours, not by value or by burn. Saying so
          matters: a reader scanning for "our biggest engagements" would
          otherwise read effort as revenue, and the two diverge sharply on any
          project that is overrunning.
        */}
        <ChartNote>
          The ten projects with the most hours logged. Length is effort spent,
          not fee or budget — a long bar can be a large engagement or a small one
          running over.
        </ChartNote>
      </Card>

      <BurnDonutRow rows={rows} />
    </div>
  );
}

/**
 * Budget burn per project as a row of small donuts — analysis #8 from the
 * time-analytics spec.
 *
 * ONLY BUDGETED PROJECTS, AND ONLY REAL BUDGETS. Unbudgeted projects are already
 * a slice of the health donut above; repeating them here as empty rings would say
 * "0% burned" about projects with no budget to burn. The >= 10h floor exists
 * because 32 live projects carry a placeholder "2h" estimate (per the analysis
 * spec) — a 2h budget at 300% burn is an artefact of the placeholder, not a
 * finding, and it would crowd out every genuinely over-budget project.
 *
 * The ring is CAPPED at 100%: a 340% overrun drawn as 3.4 laps is unreadable.
 * Over-budget rings go full-circle in --critical, and the overrun magnitude
 * lives in the centre label ("64h over") where it can actually be read.
 */
function BurnDonutRow({ rows }: { rows: ProjectListRow[] }) {
  const budgeted = rows.filter(
    (p) => p.estimatedHours !== null && p.estimatedHours >= 10 && p.burnPercent !== null,
  );
  const top = [...budgeted]
    .sort((a, b) => (b.burnPercent ?? 0) - (a.burnPercent ?? 0))
    .slice(0, 5);

  return (
    <Card className="flex flex-col lg:col-span-12">
      <CardHeader
        title="Budget burn"
        qualifier="TOP 5 BUDGETED PROJECTS BY BURN · ESTIMATES UNDER 10H EXCLUDED AS PLACEHOLDERS"
      />
      {top.length === 0 ? (
        <p className="px-4 pb-5 text-[12px] text-[var(--text-faint)]">
          No projects carry a real budget yet — every estimate on file is below
          the 10h placeholder floor, so there is no burn to show.
        </p>
      ) : (
        <div className="flex flex-wrap items-start justify-around gap-x-6 gap-y-4 px-4 pb-5">
          {top.map((p) => {
            const est = p.estimatedHours!;
            const used = Math.min(p.actualHours, est);
            const slices = p.isOver
              ? [{ label: "Over budget", value: est, color: "var(--critical)" }]
              : [
                  { label: "Hours used", value: used, color: burnColor(p.burnPercent) },
                  { label: "Hours remaining", value: Math.max(est - used, 0), color: "var(--surface-2)" },
                ];
            const remaining = p.remainingHours ?? 0;
            const centreLabel = remaining >= 0 ? `${h(remaining)}h left` : `${h(-remaining)}h over`;
            return (
              <Link
                key={p.id}
                href={`/projects/${p.id}`}
                className="group flex w-[128px] flex-col items-center gap-1.5 rounded-[var(--radius-sm)] p-1.5 transition-colors hover:bg-[var(--surface-hover)]"
              >
                <Donut
                  slices={slices}
                  centre={`${Math.round(p.burnPercent ?? 0)}%`}
                  centreLabel={centreLabel}
                  size={104}
                  thickness={9}
                  label={`${p.name}: ${h(p.actualHours)} of ${h(est)} estimated hours used (${Math.round(p.burnPercent ?? 0)}% burned), ${centreLabel}`}
                />
                <span
                  className="w-full truncate text-center text-[11px] text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]"
                  title={p.name}
                >
                  {p.name}
                </span>
                <span className="font-mono text-[10px] tabular-nums text-[var(--text-faint)]">
                  {h(p.actualHours)}h / {h(est)}h
                </span>
              </Link>
            );
          })}
        </div>
      )}
      {/*
        The ring is capped at 100% (see this component's header comment), so a
        340% overrun and a 105% one look identical on the ring and differ only in
        the centre label. That is a deliberate readability trade, and a reader
        comparing two red rings deserves to know it rather than concluding the
        two projects are equally bad.
      */}
      <ChartNote>
        Hours logged against the estimate. The ring fills to 100% and no further,
        so overruns are told by the centre figure, not the arc — two full red
        rings are not necessarily equally over.
      </ChartNote>
    </Card>
  );
}
