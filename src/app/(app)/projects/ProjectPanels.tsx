/**
 * Presentational panels for the Projects module.
 *
 * Server components by design — every one takes already-computed data and does
 * no fetching, so the page owns all I/O and these stay trivially testable and
 * cheap to render.
 *
 * WORDS ARE DATA HERE TOO, AND THAT IS DELIBERATE
 * ----------------------------------------------
 * These panels take their wording as props rather than calling
 * `useTranslations`/`getTranslations` themselves. Two reasons, and the second
 * is the load-bearing one:
 *
 *  1. It is the same contract the file already had for figures: the caller
 *     computes, the panel draws.
 *  2. `scripts/check-projects-module.mjs` compiles this module with Next's own
 *     SWC and renders `ProjectTotalsStrip` and `BurnChart` with
 *     `renderToStaticMarkup`, OUTSIDE a request. A next-intl hook throws there
 *     — there is no provider — and would take the whole gate down rather than
 *     fail one check. The gate renders those two with data props only, so both
 *     took an English default for their wording. That default is gone: an
 *     optional wording prop with an English fallback is precisely how English
 *     creeps back onto the German page when a new caller forgets to pass it.
 *     Every panel here now takes its wording as a REQUIRED prop and holds no
 *     wording of its own; check-projects-module.mjs builds the English it
 *     renders with from messages/en.json, so the gate reads the same words the
 *     page does.
 *
 * `locale` is likewise a prop, not `useLocale()`: same reason, and it lets the
 * bare gate render keep en-GB digits exactly as before (`tagFor(undefined)`).
 *
 * The colour rule is shared across all of them and stated once here: a project
 * WITHOUT a budget is grey and reads "no budget", never green and never 0%.
 * 83 of 334 live projects have `estimated_hours = 0`, and painting them as
 * healthy would be a confident false claim about a quarter of the portfolio.
 */
import type { BurnPoint, ProjectContributor, ProjectTaskRow } from "@/lib/queries/projects-live";
import { Card, StatTile } from "@/components/ui/Card";
import { DrillTrigger, type Drill } from "@/components/DrillDialog";
import { fmtInt, fmtNum } from "@/lib/locale-format";

/** The five tiles of the totals strip, as the keys a caller supplies drills under. */
export type ProjectTotalsTile = "projects" | "hours" | "billable" | "over" | "noBudget";

/** Red over budget, amber approaching it, green healthy, grey when unbudgeted. */
export function burnColor(percent: number | null): string {
  if (percent === null) return "var(--text-faint)";
  if (percent > 100) return "var(--critical)";
  if (percent >= 85) return "var(--warning)";
  return "var(--accent)";
}

/**
 * The same thresholds as `burnColor`, expressed as a StatTile tone.
 *
 * StatTile takes a tone name, not a colour, on purpose: a `color` prop lets any
 * caller paint any figure any colour, which is how "tone means something" dies.
 * So the mapping lives HERE, next to burnColor, where the two sets of
 * thresholds cannot drift apart unnoticed.
 *
 * Note "good" for healthy but NOT for unbudgeted: 83 of 334 live projects have
 * estimated_hours = 0, and green on those would be a confident false claim
 * about a quarter of the portfolio. Unbudgeted is neutral, and the value itself
 * says "not set".
 */
export function burnTone(percent: number | null): "neutral" | "good" | "warning" | "critical" {
  if (percent === null) return "neutral";
  if (percent > 100) return "critical";
  if (percent >= 85) return "warning";
  return "good";
}

/* ------------------------------------------------------------------ list */

/** One tile's words: what the reader sees, and the footnote under it. */
type TileWords = { label: string; hint: string };

/** Every word the totals strip draws, resolved by the caller in its locale. */
export type ProjectTotalsWording = Record<ProjectTotalsTile, TileWords>;

/**
 * The tile's handle for gates and scripts (`data-tile`), always the English
 * label whatever the locale, so a check that waits for OVER BUDGET finds it on
 * the German page too. The visible label comes from `wording`.
 */
const TILE_HANDLE: Record<ProjectTotalsTile, string> = {
  projects: "PROJECTS",
  hours: "TRACKED HOURS",
  billable: "BILLABLE",
  over: "OVER BUDGET",
  noBudget: "NO BUDGET SET",
};

export function ProjectTotalsStrip({
  projectCount,
  totalHours,
  billableHours,
  overBudget,
  noBudget,
  drills,
  locale,
  wording,
}: {
  projectCount: number;
  totalHours: number;
  billableHours: number;
  overBudget: number;
  noBudget: number;
  /**
   * What sits behind each tile, built by the explorer from the SAME filtered
   * rows these five figures are folded from. A tile with a drill becomes a
   * button (card-elev, like the Management tiles); without one it stays the
   * plain StatTile it was, so the strip renders identically for a caller that
   * has nothing to open.
   */
  drills?: Partial<Record<ProjectTotalsTile, Drill>>;
  /** The request locale; absent means en-GB, which is what the gate renders. */
  locale?: string;
  /** The five tiles' words, already resolved. Falls back to English. */
  wording: ProjectTotalsWording;
}) {
  // Billable share of tracked time. Guarded against a zero denominator, which
  // is not hypothetical: a filtered view can legitimately contain no hours, and
  // 0/0 renders as "NaN%" — a number-shaped thing that looks like a bug.
  const billablePercent = totalHours > 0 ? Math.round((billableHours / totalHours) * 100) : null;
  const words = wording;

  const cells: {
    key: ProjectTotalsTile;
    label: string;
    value: string;
    unit?: string;
    hint: string;
    tone?: "critical";
  }[] = [
    {
      key: "projects",
      label: words.projects.label,
      value: fmtInt(projectCount, locale),
      hint: words.projects.hint,
    },
    {
      key: "hours",
      label: words.hours.label,
      value: fmtNum(totalHours, locale, 1),
      unit: "h",
      hint: words.hours.hint,
    },
    {
      key: "billable",
      label: words.billable.label,
      value: billablePercent === null ? "—" : String(billablePercent),
      unit: billablePercent === null ? undefined : "%",
      hint: words.billable.hint,
    },
    {
      key: "over",
      label: words.over.label,
      value: fmtInt(overBudget, locale),
      // Only paint it red when there is something to act on. A permanent red
      // "0" trains the reader to stop seeing the colour, which costs us the
      // one moment it needs to work.
      tone: overBudget > 0 ? ("critical" as const) : undefined,
      hint: words.over.hint,
    },
    {
      key: "noBudget",
      label: words.noBudget.label,
      value: fmtInt(noBudget, locale),
      hint: words.noBudget.hint,
    },
  ];

  return (
    // Separate cards on a gap, rather than five cells fused inside one outlined
    // box. The old strip shared every border, so the eye read it as a single
    // table row and the five figures competed instead of reading as five
    // independent facts. Gap does the grouping work that a shared border cannot.
    <div
      data-testid="project-totals"
      className="grid grid-cols-2 gap-[var(--card-gap)] sm:grid-cols-3 lg:grid-cols-5"
    >
      {/*
       * StatTile, not a local tile: it already encodes the baseline-aligned
       * unit, the n/a-never-0 rule, and the tone scale. Every tile still
       * carries a hint so the five cards keep equal height on one row -- the
       * two-with-hints version had a visibly ragged row.
       */}
      {cells.map((c) => {
        const tile = (
          <StatTile
            data-tile={TILE_HANDLE[c.key]}
            label={c.label}
            value={c.value}
            unit={c.unit}
            hint={c.hint}
            tone={c.tone ?? "neutral"}
            // Inside a button the tile must fill it, or the hit target and the
            // card outline disagree about where the tile ends.
            className={drills?.[c.key] ? "h-full" : ""}
          />
        );
        const drill = drills?.[c.key];
        return drill ? (
          <DrillTrigger
            key={c.key}
            drill={drill}
            id={`projects-${c.key}`}
            className="card-elev block w-full rounded-[var(--radius-card)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
          >
            {tile}
          </DrillTrigger>
        ) : (
          <div key={c.key}>{tile}</div>
        );
      })}
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

/** Every word the burn chart draws. Mirrors `projects.burnChart.*`. */
export type BurnChartWording = {
  title: string;
  empty: string;
  qualifier: string;
  logged: string;
  budget: string;
};

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
  wording,
}: {
  points: BurnPoint[];
  estimatedHours: number | null;
  wording: BurnChartWording;
}) {
  if (points.length === 0) {
    return (
      <Card className="p-5">
        <span className="text-[13px] font-semibold text-[var(--text-primary)]">{wording.title}</span>
        <p className="mt-3 font-mono text-[11px] text-[var(--text-faint)]">{wording.empty}</p>
      </Card>
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
    <Card tone="hero" className="flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-baseline gap-3">
        <span className="text-[13px] font-semibold text-[var(--text-primary)]">{wording.title}</span>
        <span className="font-mono text-[10px] text-[var(--text-muted)]">{wording.qualifier}</span>
        <div className="ml-auto flex items-center gap-4 font-mono text-[10px] text-[var(--text-secondary)]">
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-3 bg-[var(--accent)]" /> {wording.logged}
          </span>
          {budget !== null && (
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-3 bg-[var(--warning)]" /> {wording.budget}
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
    </Card>
  );
}

export function ContributorTable({
  rows,
  locale,
  wording,
}: {
  rows: ProjectContributor[];
  locale?: string;
  /** Mirrors `projects.contributors.*`; required, this panel holds no words. */
  wording: { title: string; empty: string; billableUnit: string; hoursUnit: string };
}) {
  return (
    <Card className="flex flex-col">
      <div className="border-b border-[var(--divider)] px-4 py-3">
        <span className="text-[12px] font-semibold text-[var(--text-primary)]">{wording.title}</span>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-center font-mono text-[11px] text-[var(--text-faint)]">
          {wording.empty}
        </p>
      ) : (
        rows.map((r) => (
          <div
            key={r.memberId}
            className="flex items-center justify-between gap-3 border-b border-[var(--divider)] px-4 py-2 text-[12px] last:border-b-0"
          >
            <span className="truncate text-[var(--text-primary)]">{r.memberName}</span>
            <span className="flex shrink-0 gap-4 font-mono text-[11px]">
              <span className="text-[var(--text-faint)]">{r.entryCount}×</span>
              <span className="w-16 text-right text-[var(--accent)]">
                {fmtNum(r.billableHours, locale, 1)} {wording.billableUnit}
              </span>
              <span className="w-16 text-right text-[var(--text-primary)]">
                {fmtNum(r.hours, locale, 1)} {wording.hoursUnit}
              </span>
            </span>
          </div>
        ))
      )}
    </Card>
  );
}

export function TaskTable({
  rows,
  locale,
  wording,
}: {
  rows: ProjectTaskRow[];
  locale?: string;
  /** Mirrors `projects.taskTable.*`; required, this panel holds no words. */
  wording: { title: string; empty: string; hoursUnit: string; topOf: (shown: number, total: number) => string };
}) {
  const shown = rows.slice(0, 20);
  return (
    <Card className="flex flex-col">
      <div className="flex items-baseline justify-between border-b border-[var(--divider)] px-4 py-3">
        <span className="text-[12px] font-semibold text-[var(--text-primary)]">{wording.title}</span>
        {rows.length > shown.length && (
          <span className="font-mono text-[10px] text-[var(--text-faint)]">
            {wording.topOf(shown.length, rows.length)}
          </span>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-center font-mono text-[11px] text-[var(--text-faint)]">
          {wording.empty}
        </p>
      ) : (
        shown.map((r) => (
          <div
            key={r.taskName}
            className="flex items-center justify-between gap-3 border-b border-[var(--divider)] px-4 py-2 text-[12px] last:border-b-0"
          >
            <span className="truncate text-[var(--text-secondary)]">{r.taskName}</span>
            <span className="flex shrink-0 gap-4 font-mono text-[11px]">
              <span className="text-[var(--text-faint)]">{r.entryCount}×</span>
              <span className="w-16 text-right text-[var(--text-primary)]">
                {fmtNum(r.hours, locale, 1)} {wording.hoursUnit}
              </span>
            </span>
          </div>
        ))
      )}
    </Card>
  );
}
