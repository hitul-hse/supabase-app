"use client";

/**
 * The ANALYTIC chart vocabulary: the shapes for comparison and distribution,
 * complementing Charts.tsx (trend area/bars, donut, gauge).
 *
 * Added for the in-depth analysis pass (spec: .context-bridge/analysis-spec.md,
 * derived from the live data by the data-analysis agent). Each shape answers a
 * different QUESTION and the pairing is deliberate:
 *
 *   MultiLine      "how do a few series move together?"   (billable % vs travel %)
 *   HeatmapMatrix  "where in a person x week grid is the load?" (utilisation)
 *   DivergingBars  "who moved up, who moved down?"        (month-over-month delta)
 *   StackedBarsH   "what is each person's time made of?"  (client/travel/internal)
 *   StackedColumns "how does the mix shift over months?"  (service mix, % stacked)
 *   Waffle         "how big is each share of one whole?"  (customer concentration)
 *   BumpChart      "who is rising and who is fading?"     (customer rank by month)
 *
 * Same rules as Charts.tsx: hand-rolled SVG on var(--*) tokens (no chart
 * library), absence renders as absence (callers name their empty states), and
 * every figure carries a text alternative -- SVG is silent to a screen reader,
 * so interactive cells/columns are REAL focusable buttons with their own names
 * and the pinned readout is aria-hidden decoration for sighted users.
 */

import { useState } from "react";

/* ------------------------------------------------------------------ shared */

/** The hover/focus readout, pinned so charts never reflow under the cursor. */
function Readout({ text }: { text: string | null }) {
  return (
    <div className="pointer-events-none absolute left-0 right-0 top-0 z-10 flex justify-end px-1">
      <span
        aria-hidden
        className={`rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface-2)] px-2 py-1 font-mono text-[10px] tabular-nums text-[var(--text-primary)] shadow-lg transition-opacity duration-100 ${
          text ? "opacity-100" : "opacity-0"
        }`}
      >
        {text ?? "\u00A0"}
      </span>
    </div>
  );
}

/* --------------------------------------------------------------- MultiLine */

export type LineSeries = {
  name: string;
  /** A CSS colour, usually a var(--*) token. */
  color: string;
  /** One value per label; null = a gap (no data that period, not zero). */
  values: (number | null)[];
};

/**
 * A few series over the same x-labels, with markers on every point -- the
 * reference images' multi-line-with-dots shape. Capped at a handful of series
 * by design: eight lines over twelve weeks is spaghetti, and the utilisation
 * question that would tempt that is answered by HeatmapMatrix instead.
 */
export function MultiLine({
  labels,
  series,
  yDomain,
  label,
  readoutFor,
}: {
  labels: string[];
  series: LineSeries[];
  /** Fixed y-range, e.g. [0, 100] for percentages. Defaults to [0, max]. */
  yDomain?: [number, number];
  label: string;
  /** One line for the readout at column i, e.g. "W23 · billable 84% · travel 21%". */
  readoutFor: (i: number) => string;
}) {
  const [active, setActive] = useState<number | null>(null);
  if (labels.length === 0 || series.length === 0) return null;

  const W = 1000;
  const H = 300;
  const PAD_X = 14;
  const PAD_TOP = 30;
  const PAD_BOTTOM = 8;

  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const lo = yDomain ? yDomain[0] : 0;
  const hi = yDomain ? yDomain[1] : Math.max(...all, 1);
  const span = hi - lo || 1;

  const x = (i: number) =>
    labels.length === 1 ? W / 2 : PAD_X + (i / (labels.length - 1)) * (W - PAD_X * 2);
  const y = (v: number) => PAD_TOP + (1 - (v - lo) / span) * (H - PAD_TOP - PAD_BOTTOM);

  /** Polyline segments, broken at nulls so gaps stay gaps. */
  const pathFor = (values: (number | null)[]) => {
    let d = "";
    let pen = false;
    values.forEach((v, i) => {
      if (v === null) {
        pen = false;
        return;
      }
      d += `${pen ? " L" : " M"} ${x(i)} ${y(v)}`;
      pen = true;
    });
    return d.trim();
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <Readout text={active !== null ? readoutFor(active) : null} />
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-full w-full flex-1"
        role="img"
        aria-label={label}
      >
        {[0.25, 0.5, 0.75].map((f) => {
          const gy = PAD_TOP + f * (H - PAD_TOP - PAD_BOTTOM);
          return (
            <line
              key={f}
              x1={0}
              x2={W}
              y1={gy}
              y2={gy}
              stroke="var(--border)"
              strokeOpacity="0.5"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          );
        })}

        {active !== null && (
          <line
            x1={x(active)}
            x2={x(active)}
            y1={PAD_TOP - 6}
            y2={H}
            stroke="var(--text-faint)"
            strokeOpacity="0.6"
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
        )}

        {series.map((s) => (
          <g key={s.name}>
            <path
              d={pathFor(s.values)}
              fill="none"
              stroke={s.color}
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {s.values.map((v, i) =>
              v === null ? null : (
                <circle
                  key={i}
                  cx={x(i)}
                  cy={y(v)}
                  r={active === i ? 5 : 3}
                  fill={s.color}
                  stroke="var(--surface)"
                  strokeWidth="1.5"
                  vectorEffect="non-scaling-stroke"
                />
              ),
            )}
          </g>
        ))}
      </svg>

      {/* Focusable per-column strips, the AreaTrend convention. */}
      <div className="absolute inset-0 flex" onMouseLeave={() => setActive(null)}>
        {labels.map((l, i) => (
          <button
            key={l + i}
            type="button"
            aria-label={readoutFor(i)}
            onMouseEnter={() => setActive(i)}
            onFocus={() => setActive(i)}
            onBlur={() => setActive(null)}
            className="h-full flex-1 cursor-default focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
          />
        ))}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- HeatmapMatrix */

export type HeatCell = {
  /** null = no data (renders as an empty socket, not as zero). */
  value: number | null;
  /** Full sentence for hover/focus and assistive tech. */
  readout: string;
};

/**
 * Rows x columns of colour-scaled cells -- the densest shape here, for
 * person x week utilisation. HTML grid, not SVG: cells must be real buttons,
 * and a few hundred DOM nodes is nothing next to focusable-SVG contortions.
 *
 * The scale is a diverging judgement, not a linear ramp: utilisation has a
 * "right" band, and both chronic overload and dead weeks need to jump out.
 * Callers pass `tone` to make the judgement; this component only paints.
 */
export function HeatmapMatrix({
  rowLabels,
  colLabels,
  cells,
  tone,
  label,
  rowLabelWidth = "8rem",
}: {
  rowLabels: string[];
  colLabels: string[];
  /** cells[row][col]. */
  cells: HeatCell[][];
  /** Cell colour: a CSS colour string for a value, judged by the caller. */
  tone: (value: number) => string;
  label: string;
  rowLabelWidth?: string;
}) {
  const [active, setActive] = useState<string | null>(null);
  if (rowLabels.length === 0 || colLabels.length === 0) return null;

  return (
    <div className="relative" role="group" aria-label={label}>
      <Readout text={active} />
      <div className="overflow-x-auto pt-7">
        <div
          className="grid gap-[3px]"
          style={{
            gridTemplateColumns: `${rowLabelWidth} repeat(${colLabels.length}, minmax(1.4rem, 1fr))`,
          }}
        >
          {/* Header row */}
          <span aria-hidden />
          {colLabels.map((c) => (
            <span
              key={c}
              className="pb-1 text-center font-mono text-[9px] tracking-[0.06em] text-[var(--text-faint)]"
            >
              {c}
            </span>
          ))}

          {rowLabels.map((r, ri) => (
            // Fragment-free: a flat grid keeps the template simple.
            [
              <span
                key={`${r}-label`}
                className="truncate pr-2 text-right text-[11px] leading-[1.6rem] text-[var(--text-secondary)]"
                title={r}
              >
                {r}
              </span>,
              ...colLabels.map((c, ci) => {
                const cell = cells[ri]?.[ci];
                const v = cell?.value ?? null;
                return (
                  <button
                    key={`${r}-${c}`}
                    type="button"
                    aria-label={cell?.readout ?? `${r}, ${c}: no data`}
                    onMouseEnter={() => setActive(cell?.readout ?? null)}
                    onFocus={() => setActive(cell?.readout ?? null)}
                    onMouseLeave={() => setActive(null)}
                    onBlur={() => setActive(null)}
                    className="h-6 rounded-[3px] border border-[var(--border)] transition-transform focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] hover:scale-[1.15]"
                    style={{
                      background: v === null ? "transparent" : tone(v),
                      borderStyle: v === null ? "dashed" : "solid",
                    }}
                  />
                );
              }),
            ]
          ))}
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- DivergingBars */

export type DivergingItem = {
  label: string;
  /** Signed value: negative goes left, positive right. */
  value: number;
  /** e.g. "+55.3h vs July". */
  readout: string;
};

/**
 * Signed horizontal bars around a centre axis -- the comparison shape. The
 * whole point is the SIGN, so zero sits mid-figure and the two directions get
 * the app's good/critical tones rather than arbitrary series colours.
 */
export function DivergingBars({
  items,
  label,
  formatValue,
}: {
  items: DivergingItem[];
  label: string;
  formatValue: (v: number) => string;
}) {
  if (items.length === 0) return null;
  const max = Math.max(...items.map((d) => Math.abs(d.value)), 1);

  return (
    <div role="group" aria-label={label} className="flex flex-col gap-1">
      {items.map((d) => {
        const frac = Math.abs(d.value) / max;
        const positive = d.value >= 0;
        return (
          <div
            key={d.label}
            className="group flex items-center gap-2"
            title={d.readout}
          >
            <span className="w-[7.5rem] flex-none truncate text-right text-[11px] text-[var(--text-secondary)]">
              {d.label}
            </span>
            <div className="relative h-4 flex-1">
              {/* Centre axis */}
              <span className="absolute left-1/2 top-0 h-full w-px bg-[var(--border-strong)]" />
              <span
                className="absolute top-[2px] h-3 rounded-[2px] transition-all"
                style={{
                  background: positive ? "var(--good)" : "var(--critical)",
                  opacity: 0.85,
                  left: positive ? "50%" : `${50 - frac * 50}%`,
                  width: `${frac * 50}%`,
                }}
              />
            </div>
            <span
              className={`w-14 flex-none text-right font-mono text-[10px] tabular-nums ${
                positive ? "text-[var(--good)]" : "text-[var(--critical)]"
              }`}
              aria-label={d.readout}
            >
              {formatValue(d.value)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------ StackedBarsH */

export type StackSegment = { label: string; value: number; color: string };

/**
 * One horizontal bar per row, segments stacked left to right -- composition
 * per person. Absolute widths against the longest row, so "who does most"
 * and "of what" are one glance.
 */
export function StackedBarsH({
  rows,
  label,
  formatTotal,
}: {
  rows: { label: string; segments: StackSegment[] }[];
  label: string;
  formatTotal: (total: number) => string;
}) {
  if (rows.length === 0) return null;
  const totals = rows.map((r) => r.segments.reduce((s, x) => s + Math.max(0, x.value), 0));
  const max = Math.max(...totals, 1);

  return (
    <div role="group" aria-label={label} className="flex flex-col gap-1.5">
      {rows.map((r, i) => {
        const total = totals[i];
        const desc = `${r.label}: ${formatTotal(total)} — ${r.segments
          .filter((s) => s.value > 0)
          .map((s) => `${s.label} ${formatTotal(s.value)}`)
          .join(", ")}`;
        return (
          <div key={r.label} className="flex items-center gap-2" title={desc}>
            <span className="w-[7.5rem] flex-none truncate text-right text-[11px] text-[var(--text-secondary)]">
              {r.label}
            </span>
            <div
              className="flex h-4 flex-1 overflow-hidden rounded-[3px]"
              role="img"
              aria-label={desc}
            >
              {r.segments.map((s) =>
                s.value <= 0 ? null : (
                  <span
                    key={s.label}
                    className="h-full"
                    style={{
                      width: `${(s.value / max) * 100}%`,
                      background: s.color,
                    }}
                  />
                ),
              )}
            </div>
            <span className="w-14 flex-none text-right font-mono text-[10px] tabular-nums text-[var(--text-muted)]">
              {formatTotal(total)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------- StackedColumns100 */

/**
 * Percent-stacked columns, one per period -- mix over time. Percent because the
 * question is SHARE ("is consulting growing?"), and an absolute-volume chart
 * always sits next to it elsewhere on the page.
 */
export function StackedColumns100({
  columns,
  label,
}: {
  columns: { label: string; segments: StackSegment[]; readout: string }[];
  label: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  if (columns.length === 0) return null;

  return (
    <div className="relative flex h-full min-h-0 flex-col" role="group" aria-label={label}>
      <Readout text={active !== null ? columns[active].readout : null} />
      <div className="flex flex-1 items-end gap-1.5 pt-7" onMouseLeave={() => setActive(null)}>
        {columns.map((c, i) => {
          const total = c.segments.reduce((s, x) => s + Math.max(0, x.value), 0);
          return (
            <button
              key={c.label}
              type="button"
              aria-label={c.readout}
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
              className={`flex h-full flex-1 flex-col justify-end overflow-hidden rounded-[3px] transition-opacity focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${
                active !== null && active !== i ? "opacity-50" : ""
              }`}
            >
              {/* Top-to-bottom = first-to-last segment, consistent across columns. */}
              {c.segments.map((s) =>
                s.value <= 0 || total <= 0 ? null : (
                  <span
                    key={s.label}
                    className="w-full"
                    style={{
                      height: `${(s.value / total) * 100}%`,
                      background: s.color,
                    }}
                  />
                ),
              )}
            </button>
          );
        })}
      </div>
      <div className="flex gap-1.5 pt-1">
        {columns.map((c) => (
          <span
            key={c.label}
            className="flex-1 text-center font-mono text-[9px] tracking-[0.06em] text-[var(--text-faint)]"
          >
            {c.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Waffle */

export type WaffleSlice = { label: string; value: number; color: string };

/**
 * A 10x10 grid where one cell = 1% of the whole -- the concentration shape.
 * "ENERCON is 32 of these 100 squares" lands in a way 32% in a donut does not,
 * which is exactly what the customer-dependency figure needs.
 */
export function Waffle({
  slices,
  label,
  otherColor = "var(--surface-2)",
}: {
  /** Ordered biggest-first; anything past the listed slices renders as `other`. */
  slices: WaffleSlice[];
  label: string;
  otherColor?: string;
}) {
  const [active, setActive] = useState<string | null>(null);
  const total = slices.reduce((s, x) => s + Math.max(0, x.value), 0);
  if (total <= 0) return null;

  // Integer cells via largest remainder, so they always sum to exactly 100.
  const exact = slices.map((s) => (s.value / total) * 100);
  const floors = exact.map(Math.floor);
  let used = floors.reduce((a, b) => a + b, 0);
  const order = exact
    .map((v, i) => ({ i, rem: v - floors[i] }))
    .sort((a, b) => b.rem - a.rem);
  for (let k = 0; used < 100 && k < order.length; k += 1, used += 1) {
    floors[order[k].i] += 1;
  }

  const cellOwner: number[] = [];
  floors.forEach((n, i) => {
    for (let k = 0; k < n; k += 1) cellOwner.push(i);
  });
  while (cellOwner.length < 100) cellOwner.push(-1);

  return (
    <div className="relative" role="group" aria-label={label}>
      <Readout text={active} />
      <div className="grid grid-cols-10 gap-[3px] pt-7" onMouseLeave={() => setActive(null)}>
        {cellOwner.map((owner, i) => {
          const s = owner >= 0 ? slices[owner] : null;
          const readout = s
            ? `${s.label}: ${floors[owner]}% of the whole`
            : "Everything else";
          return (
            <button
              key={i}
              type="button"
              aria-label={readout}
              onMouseEnter={() => setActive(readout)}
              onFocus={() => setActive(readout)}
              onBlur={() => setActive(null)}
              className="aspect-square rounded-[2px] transition-transform focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] hover:scale-125"
              style={{ background: s?.color ?? otherColor }}
            />
          );
        })}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- BumpChart */

export type BumpSeries = {
  name: string;
  color: string;
  /** Rank per period (1 = top). null = out of the ranking that period. */
  ranks: (number | null)[];
};

/**
 * Rank lanes over time -- "who is rising". Ranks, not values, because the
 * question is ORDER; magnitude lives in the readout so it is not lost.
 */
export function BumpChart({
  labels,
  series,
  maxRank,
  label,
  readoutFor,
}: {
  labels: string[];
  series: BumpSeries[];
  maxRank: number;
  label: string;
  /** Readout for period i, e.g. "Aug: 1. ENERCON 132h · 2. Hochtief 112h". */
  readoutFor: (i: number) => string;
}) {
  const [active, setActive] = useState<number | null>(null);
  if (labels.length < 2 || series.length === 0) return null;

  const W = 1000;
  const H = 300;
  const PAD_X = 16;
  const PAD_TOP = 34;
  const PAD_BOTTOM = 10;

  const x = (i: number) => PAD_X + (i / (labels.length - 1)) * (W - PAD_X * 2);
  const y = (rank: number) =>
    PAD_TOP + ((rank - 1) / Math.max(1, maxRank - 1)) * (H - PAD_TOP - PAD_BOTTOM);

  const pathFor = (ranks: (number | null)[]) => {
    let d = "";
    let pen = false;
    ranks.forEach((r, i) => {
      if (r === null) {
        pen = false;
        return;
      }
      d += `${pen ? " L" : " M"} ${x(i)} ${y(r)}`;
      pen = true;
    });
    return d.trim();
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <Readout text={active !== null ? readoutFor(active) : null} />
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-full w-full flex-1"
        role="img"
        aria-label={label}
      >
        {active !== null && (
          <line
            x1={x(active)}
            x2={x(active)}
            y1={PAD_TOP - 6}
            y2={H}
            stroke="var(--text-faint)"
            strokeOpacity="0.6"
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {series.map((s) => (
          <g key={s.name}>
            <path
              d={pathFor(s.ranks)}
              fill="none"
              stroke={s.color}
              strokeWidth="2.5"
              strokeOpacity="0.85"
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {s.ranks.map((r, i) =>
              r === null ? null : (
                <circle
                  key={i}
                  cx={x(i)}
                  cy={y(r)}
                  r={active === i ? 6 : 4}
                  fill={s.color}
                  stroke="var(--surface)"
                  strokeWidth="2"
                  vectorEffect="non-scaling-stroke"
                />
              ),
            )}
          </g>
        ))}
      </svg>
      <div className="absolute inset-0 flex" onMouseLeave={() => setActive(null)}>
        {labels.map((l, i) => (
          <button
            key={l + i}
            type="button"
            aria-label={readoutFor(i)}
            onMouseEnter={() => setActive(i)}
            onFocus={() => setActive(i)}
            onBlur={() => setActive(null)}
            className="h-full flex-1 cursor-default focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
          />
        ))}
      </div>
    </div>
  );
}
