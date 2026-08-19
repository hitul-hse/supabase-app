/**
 * Presentational panels for the Projects module.
 *
 * Server components by design — every one takes already-computed data and does
 * no fetching, so the page owns all I/O and these stay trivially testable and
 * cheap to render.
 *
 * The colour rule is shared across all of them and stated once here: a project
 * WITHOUT a budget is grey and reads "no budget", never green and never 0%.
 * 83 of 334 live projects have `estimated_hours = 0`, and painting them as
 * healthy would be a confident false claim about a quarter of the portfolio.
 */
import type { BurnPoint, ProjectContributor, ProjectTaskRow } from "@/lib/queries/projects-live";

const h = (n: number) => n.toLocaleString("en-GB", { maximumFractionDigits: 1 });

/** Red over budget, amber approaching it, green healthy, grey when unbudgeted. */
export function burnColor(percent: number | null): string {
  if (percent === null) return "var(--text-faint)";
  if (percent > 100) return "var(--critical)";
  if (percent >= 85) return "var(--warning)";
  return "var(--accent)";
}

/* ------------------------------------------------------------------ list */

export function ProjectTotalsStrip({
  projectCount,
  totalHours,
  billableHours,
  overBudget,
  noBudget,
}: {
  projectCount: number;
  totalHours: number;
  billableHours: number;
  overBudget: number;
  noBudget: number;
}) {
  // Billable share of tracked time. Guarded against a zero denominator, which
  // is not hypothetical: a filtered view can legitimately contain no hours, and
  // 0/0 renders as "NaN%" — a number-shaped thing that looks like a bug.
  const billablePercent = totalHours > 0 ? Math.round((billableHours / totalHours) * 100) : null;

  const cells = [
    { label: "PROJECTS", value: projectCount.toLocaleString("en-GB"), hint: "in this view" },
    { label: "TRACKED HOURS", value: h(totalHours), unit: "h", hint: "logged to date" },
    {
      label: "BILLABLE",
      value: billablePercent === null ? "—" : String(billablePercent),
      unit: billablePercent === null ? undefined : "%",
      hint: `${h(billableHours)} h billable`,
    },
    {
      label: "OVER BUDGET",
      value: overBudget.toLocaleString("en-GB"),
      // Only paint it red when there is something to act on. A permanent red
      // "0" trains the reader to stop seeing the colour, which costs us the
      // one moment it needs to work.
      color: overBudget > 0 ? "var(--critical)" : undefined,
      hint: overBudget > 0 ? "needs attention" : "all within budget",
    },
    {
      label: "NO BUDGET SET",
      value: noBudget.toLocaleString("en-GB"),
      hint: "burn unknowable",
    },
  ];

  return (
    // Separate cards on a gap, rather than five cells fused inside one outlined
    // box. The old strip shared every border, so the eye read it as a single
    // table row and the five figures competed instead of reading as five
    // independent facts. Gap does the grouping work that a shared border cannot.
    <div
      data-testid="project-totals"
      className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 lg:grid-cols-5"
    >
      {cells.map((c) => (
        <div
          key={c.label}
          data-tile={c.label}
          className="flex flex-col gap-2 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-3.5 sm:p-4"
        >
          <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--text-muted)] sm:text-[10px]">
            {c.label}
          </span>
          {/* Baseline-aligned so the unit sits ON the number's baseline rather
              than centred against a 24px glyph, which reads as a typo. */}
          <span className="flex items-baseline gap-1">
            <span
              className="font-mono text-[22px] font-semibold leading-none tracking-[-0.02em] sm:text-[26px]"
              style={{ color: c.color ?? "var(--text-primary)" }}
            >
              {c.value}
            </span>
            {c.unit && (
              <span className="font-mono text-[12px] leading-none text-[var(--text-muted)]">
                {c.unit}
              </span>
            )}
          </span>
          {/* Every tile carries a hint, so the five cards stay the same height
              on a row. Without it the two that had one were taller and the row
              looked broken. */}
          <span className="font-mono text-[10px] leading-tight text-[var(--text-faint)]">
            {c.hint}
          </span>
        </div>
      ))}
    </div>
  );
}

/*
 * `ProjectTable` used to live here: a server-rendered list of ALL 334 projects
 * with no search, no paging and no status filter. It was replaced by
 * ProjectsLedger.tsx, a client component that pages to 50 rows and filters —
 * see that file's header for the measurements that forced the change. It is
 * deleted rather than left in place because an unrendered 100-line table is
 * exactly the kind of dead code that later gets "fixed" instead of removed.
 */

/* ---------------------------------------------------------------- detail */

/**
 * Observed cumulative hours, with the budget as a horizontal reference line.
 *
 * Deliberately NOT a classic burn-down against a planned trajectory: the vendor
 * sends no start or due date (verified against the DDL), so any downward
 * "planned" line would be invented. This plots what actually happened and marks
 * where the budget sits — the honest version of the same question.
 */
export function BurnChart({
  points,
  estimatedHours,
}: {
  points: BurnPoint[];
  estimatedHours: number | null;
}) {
  if (points.length === 0) {
    return (
      <div className="border border-[var(--border)] bg-[var(--surface)] p-5">
        <span className="text-[13px] font-semibold text-[var(--text-primary)]">Hours over time</span>
        <p className="mt-3 font-mono text-[11px] text-[var(--text-faint)]">
          No time has been logged against this project yet.
        </p>
      </div>
    );
  }

  const peak = Math.max(...points.map((p) => p.cumulativeHours));
  const budget = estimatedHours && estimatedHours > 0 ? estimatedHours : null;
  // Scale to whichever is taller so the budget line is always on-canvas. Without
  // this, a project at 300% burn pushes the reference line off the top and the
  // chart silently stops showing the thing it exists to compare against.
  const max = Math.max(peak, budget ?? 0) || 1;

  const W = 900;
  const H = 170;
  const x = (i: number) => (points.length === 1 ? W / 2 : (i / (points.length - 1)) * W);
  const y = (v: number) => H - (v / max) * H;

  const line = points.map((p, i) => `${x(i)},${y(p.cumulativeHours)}`).join(" ");
  const budgetY = budget === null ? null : y(budget);

  return (
    <div className="flex flex-col gap-3 border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="flex flex-wrap items-baseline gap-3">
        <span className="text-[13px] font-semibold text-[var(--text-primary)]">Hours over time</span>
        <span className="font-mono text-[10px] text-[var(--text-muted)]">
          CUMULATIVE · MONTHLY · OBSERVED
        </span>
        <div className="ml-auto flex items-center gap-4 font-mono text-[10px] text-[var(--text-secondary)]">
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-3 bg-[var(--accent)]" /> LOGGED
          </span>
          {budget !== null && (
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-3 bg-[var(--warning)]" /> BUDGET
            </span>
          )}
        </div>
      </div>

      <div className="relative h-[180px] w-full border-b border-l border-[var(--border-strong)] pt-2">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
          {budgetY !== null && (
            <line
              x1="0"
              y1={budgetY}
              x2={W}
              y2={budgetY}
              stroke="var(--warning)"
              strokeWidth="2"
              strokeDasharray="6 5"
              vectorEffect="non-scaling-stroke"
            />
          )}
          <polyline
            points={line}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="2.5"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>

      <div className="flex justify-between font-mono text-[10px] text-[var(--text-faint)]">
        <span>{points[0].label}</span>
        {points.length > 2 && <span>{points[Math.floor(points.length / 2)].label}</span>}
        <span>{points[points.length - 1].label}</span>
      </div>
    </div>
  );
}

export function ContributorTable({ rows }: { rows: ProjectContributor[] }) {
  return (
    <div className="flex flex-col border border-[var(--border)] bg-[var(--surface)]">
      <div className="border-b border-[var(--border)] px-4 py-3">
        <span className="text-[12px] font-semibold text-[var(--text-primary)]">
          Who worked on this
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-center font-mono text-[11px] text-[var(--text-faint)]">
          Nobody has logged time yet.
        </p>
      ) : (
        rows.map((r) => (
          <div
            key={r.memberId}
            className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-2 text-[12px] last:border-b-0"
          >
            <span className="truncate text-[var(--text-primary)]">{r.memberName}</span>
            <span className="flex shrink-0 gap-4 font-mono text-[11px]">
              <span className="text-[var(--text-faint)]">{r.entryCount}×</span>
              <span className="w-16 text-right text-[var(--accent)]">{h(r.billableHours)} b</span>
              <span className="w-16 text-right text-[var(--text-primary)]">{h(r.hours)} h</span>
            </span>
          </div>
        ))
      )}
    </div>
  );
}

export function TaskTable({ rows }: { rows: ProjectTaskRow[] }) {
  const shown = rows.slice(0, 20);
  return (
    <div className="flex flex-col border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex items-baseline justify-between border-b border-[var(--border)] px-4 py-3">
        <span className="text-[12px] font-semibold text-[var(--text-primary)]">Time by task</span>
        {rows.length > shown.length && (
          <span className="font-mono text-[10px] text-[var(--text-faint)]">
            TOP {shown.length} OF {rows.length}
          </span>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-center font-mono text-[11px] text-[var(--text-faint)]">
          No tasks recorded.
        </p>
      ) : (
        shown.map((r) => (
          <div
            key={r.taskName}
            className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-2 text-[12px] last:border-b-0"
          >
            <span className="truncate text-[var(--text-secondary)]">{r.taskName}</span>
            <span className="flex shrink-0 gap-4 font-mono text-[11px]">
              <span className="text-[var(--text-faint)]">{r.entryCount}×</span>
              <span className="w-16 text-right text-[var(--text-primary)]">{h(r.hours)} h</span>
            </span>
          </div>
        ))
      )}
    </div>
  );
}
