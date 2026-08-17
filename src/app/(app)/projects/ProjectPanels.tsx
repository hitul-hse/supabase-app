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
import Link from "next/link";
import type { BurnPoint, ProjectContributor, ProjectListRow, ProjectTaskRow } from "@/lib/queries/projects-live";

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
    { label: "PROJECTS", value: projectCount.toLocaleString("en-GB") },
    { label: "TRACKED HOURS", value: `${h(totalHours)} h` },
    {
      label: "BILLABLE",
      value: billablePercent === null ? "—" : `${billablePercent}%`,
      hint: `${h(billableHours)} h`,
    },
    {
      label: "OVER BUDGET",
      value: overBudget.toLocaleString("en-GB"),
      color: overBudget > 0 ? "var(--critical)" : undefined,
    },
    { label: "NO BUDGET SET", value: noBudget.toLocaleString("en-GB") },
  ];

  return (
    <div className="grid grid-cols-2 border border-[var(--border)] bg-[var(--surface)] sm:grid-cols-3 lg:grid-cols-5">
      {cells.map((c, i) => (
        <div
          key={c.label}
          className={`flex flex-col gap-1.5 p-3 sm:p-3.5 ${
            i < cells.length - 1 ? "border-b border-[var(--border)] lg:border-b-0 lg:border-r" : ""
          }`}
        >
          <span className="font-mono text-[9.5px] tracking-[0.1em] text-[var(--text-muted)] sm:text-[10px]">
            {c.label}
          </span>
          <span
            className="font-mono text-[20px] font-semibold tracking-[-0.02em] sm:text-[24px]"
            style={{ color: c.color ?? "var(--text-primary)" }}
          >
            {c.value}
          </span>
          {c.hint && (
            <span className="font-mono text-[10.5px] text-[var(--text-faint)]">{c.hint}</span>
          )}
        </div>
      ))}
    </div>
  );
}

export function ProjectTable({ rows }: { rows: ProjectListRow[] }) {
  return (
    <div className="border border-[var(--border)] bg-[var(--surface)]">
      {/* Mobile cards */}
      <div className="flex flex-col divide-y divide-[var(--border)] sm:hidden">
        {rows.map((p) => (
          <Link
            key={p.id}
            href={`/projects/${p.id}`}
            className="flex flex-col gap-2 p-4 hover:bg-[var(--surface-hover)]"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="text-[13px] font-medium text-[var(--text-primary)]">{p.name}</span>
              <span
                className="shrink-0 font-mono text-[11px] font-semibold"
                style={{ color: burnColor(p.burnPercent) }}
              >
                {p.burnPercent === null ? "—" : `${p.burnPercent}%`}
              </span>
            </div>
            <span className="font-mono text-[10.5px] text-[var(--text-muted)]">
              {p.customerName ?? "No customer"}
              {p.isArchived ? " · ARCHIVED" : ""}
            </span>
            <div className="h-1.5 w-full bg-[var(--border)]">
              <div
                className="h-full"
                style={{
                  width: `${Math.min(p.burnPercent ?? 0, 100)}%`,
                  background: burnColor(p.burnPercent),
                }}
              />
            </div>
            <div className="flex gap-4 font-mono text-[10.5px] text-[var(--text-secondary)]">
              <span>{h(p.actualHours)} H LOGGED</span>
              <span>
                {p.estimatedHours && p.estimatedHours > 0 ? `${h(p.estimatedHours)} H BUDGET` : "NO BUDGET"}
              </span>
            </div>
          </Link>
        ))}
      </div>

      {/* Desktop table */}
      <div className="hidden overflow-x-auto sm:block">
        <div className="grid min-w-[860px] grid-cols-12 gap-3 border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-2 font-mono text-[10px] tracking-[0.1em] text-[var(--text-faint)]">
          <span className="col-span-4">PROJECT</span>
          <span className="col-span-2">CUSTOMER</span>
          <span className="col-span-1 text-right">BUDGET H</span>
          <span className="col-span-1 text-right">LOGGED H</span>
          <span className="col-span-2">CONSUMED</span>
          <span className="col-span-1 text-right">PEOPLE</span>
          <span className="col-span-1 text-right">LAST</span>
        </div>

        {rows.map((p) => (
          <div
            key={p.id}
            className="grid min-w-[860px] grid-cols-12 items-center gap-3 border-b border-[var(--border)] px-4 py-2.5 text-[12.5px] hover:bg-[var(--surface-hover)]"
          >
            <Link
              href={`/projects/${p.id}`}
              className="col-span-4 truncate font-medium text-[var(--text-primary)] hover:text-[var(--accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
            >
              {p.name}
              {p.isArchived && (
                <span className="ml-2 font-mono text-[9.5px] text-[var(--text-faint)]">ARCHIVED</span>
              )}
            </Link>
            <span className="col-span-2 truncate text-[var(--text-secondary)]">
              {p.customerName ?? "—"}
            </span>
            <span className="col-span-1 text-right font-mono text-[var(--text-secondary)]">
              {p.estimatedHours && p.estimatedHours > 0 ? h(p.estimatedHours) : "—"}
            </span>
            <span className="col-span-1 text-right font-mono text-[var(--text-primary)]">
              {h(p.actualHours)}
            </span>
            <div className="col-span-2 flex items-center gap-2">
              <div className="h-1.5 flex-1 bg-[var(--border)]">
                <div
                  className="h-full"
                  style={{
                    width: `${Math.min(p.burnPercent ?? 0, 100)}%`,
                    background: burnColor(p.burnPercent),
                  }}
                />
              </div>
              <span
                className="w-12 text-right font-mono text-[11px] font-medium"
                style={{ color: burnColor(p.burnPercent) }}
              >
                {p.burnPercent === null ? "n/a" : `${p.burnPercent}%`}
              </span>
            </div>
            <span className="col-span-1 text-right font-mono text-[11.5px] text-[var(--text-secondary)]">
              {p.memberCount || "—"}
            </span>
            <span className="col-span-1 text-right font-mono text-[11px] text-[var(--text-faint)]">
              {p.lastActivity ?? "never"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

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
        <span className="font-mono text-[10.5px] text-[var(--text-muted)]">
          CUMULATIVE · MONTHLY · OBSERVED
        </span>
        <div className="ml-auto flex items-center gap-4 font-mono text-[10.5px] text-[var(--text-secondary)]">
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

      <div className="flex justify-between font-mono text-[10.5px] text-[var(--text-faint)]">
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
        <span className="text-[12.5px] font-semibold text-[var(--text-primary)]">
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
            className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-2 text-[12.5px] last:border-b-0"
          >
            <span className="truncate text-[var(--text-primary)]">{r.memberName}</span>
            <span className="flex shrink-0 gap-4 font-mono text-[11.5px]">
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
        <span className="text-[12.5px] font-semibold text-[var(--text-primary)]">Time by task</span>
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
            className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-2 text-[12.5px] last:border-b-0"
          >
            <span className="truncate text-[var(--text-secondary)]">{r.taskName}</span>
            <span className="flex shrink-0 gap-4 font-mono text-[11.5px]">
              <span className="text-[var(--text-faint)]">{r.entryCount}×</span>
              <span className="w-16 text-right text-[var(--text-primary)]">{h(r.hours)} h</span>
            </span>
          </div>
        ))
      )}
    </div>
  );
}
