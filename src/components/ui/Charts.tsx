"use client";

/**
 * The chart vocabulary for the Hub: an area trend, a donut, and a gauge.
 *
 * WHY HAND-ROLLED SVG AND NOT A CHART LIBRARY. The app has no charting dependency
 * and the three shapes needed here are each under a hundred lines. A library would
 * bring its own theming system to fight the CSS tokens, its own tooltip layer to
 * fight the app's focus/hover conventions, and 300KB to ship for three figures.
 * These take their colours from the same var(--*) tokens as everything else, so a
 * theme change reaches them for free.
 *
 * WHY A SHARED FILE. The reference design (Screenshot 2026-08-19 153131) uses one
 * visual language across its charts: a smooth area with a soft gradient, a thin
 * donut with a dominant centre figure, a semicircular gauge with a needle-dot.
 * Building each chart where it is used is how the Overview and the TrackingTime
 * dashboard drift into two dialects; one file is one language.
 *
 * THE RULE INHERITED FROM THE REST OF THE APP: a missing number renders as absence
 * (an empty state named by the caller), never as zero. These components render
 * DATA; deciding that data is absent is the caller's job.
 *
 * ACCESSIBILITY. Every figure carries a text alternative. An SVG area chart is
 * silent to a screen reader, so each component takes a `label` that describes the
 * whole figure, and interactive points are real focusable elements with their own
 * names -- the convention TrendChart.tsx established.
 */

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";

/* ------------------------------------------------------------------ AreaTrend */

export type AreaPoint = {
  /** Stable key, e.g. the ISO week start. */
  key: string;
  /** Axis label, e.g. "W23". */
  label: string;
  /** The plotted value. */
  value: number;
  /** One line for the hover/focus readout, e.g. "W23: 84% billable (…h of …h)". */
  readout: string;
};

/**
 * A smooth area chart with a gradient fill -- the reference's hero figure.
 *
 * The curve is a Catmull-Rom spline converted to cubic Béziers. A polyline of 12
 * weekly points reads as jagged noise; the reference smooths it, and the smoothing
 * is honest here because the underlying series is weekly aggregates, not
 * individual observations -- nothing between the knots is being invented, only
 * interpolated for the eye.
 *
 * Height is a prop and the SVG fills its container, because the fix this component
 * exists for was a FIXED 140px chart inside a card stretched much taller by its
 * neighbour -- the "space at the bottom of the graph" the user reported. The
 * caller gives the chart the card's real height; the chart uses all of it.
 */
export function AreaTrend({
  points,
  label,
  yDomain,
  className = "",
  showDots = false,
  onSelect,
}: {
  points: AreaPoint[];
  /** Description of the whole figure for assistive tech. */
  label: string;
  /** Fixed y-range, e.g. [0, 100] for percentages. Defaults to [0, max]. */
  yDomain?: [number, number];
  className?: string;
  showDots?: boolean;
  /** Click a point to open it. Cursor + role stay honest when absent. */
  onSelect?: (key: string) => void;
}) {
  const gradientId = useId();
  const [active, setActive] = useState<number | null>(null);

  if (points.length === 0) return null;

  // The viewBox is a fixed abstract canvas; preserveAspectRatio="none" stretches
  // it to the container. Text is NOT rendered inside the SVG for that reason --
  // stretched glyphs are the classic tell of a scaled viewBox -- labels live in
  // HTML around it.
  const W = 1000;
  const H = 300;
  const PAD_X = 8;
  const PAD_TOP = 30;
  const PAD_BOTTOM = 6;

  const lo = yDomain ? yDomain[0] : 0;
  const hi = yDomain ? yDomain[1] : Math.max(...points.map((p) => p.value), 1);
  const span = hi - lo || 1;

  const x = (i: number) =>
    points.length === 1
      ? W / 2
      : PAD_X + (i / (points.length - 1)) * (W - PAD_X * 2);
  const y = (v: number) =>
    PAD_TOP + (1 - (v - lo) / span) * (H - PAD_TOP - PAD_BOTTOM);

  const pts = points.map((p, i) => ({ px: x(i), py: y(p.value) }));

  /*
   * Catmull-Rom -> Bézier, with every y CLAMPED into the canvas.
   *
   * The spline's smoothness comes from overshooting its knots, and a series that
   * touches its own extreme near the edge pushes CONTROL POINTS above PAD_TOP --
   * where the viewBox clips them, slicing the crest off the curve. Seen in the
   * wild on a four-point series with a hard swing (a two-person team's weekly
   * hours). Clamping the control points flattens the overshoot exactly at the
   * edge and nowhere else.
   */
  const clampY = (v: number) => Math.max(3, Math.min(H - 3, v));
  let d = `M ${pts[0].px} ${clampY(pts[0].py)}`;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1.px + (p2.px - p0.px) / 6;
    const c1y = clampY(p1.py + (p2.py - p0.py) / 6);
    const c2x = p2.px - (p3.px - p1.px) / 6;
    const c2y = clampY(p2.py - (p3.py - p1.py) / 6);
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.px} ${clampY(p2.py)}`;
  }
  const area = `${d} L ${pts[pts.length - 1].px} ${H} L ${pts[0].px} ${H} Z`;

  const hot = active !== null ? points[active] : null;

  return (
    <div className={`relative flex h-full min-h-0 flex-col ${className}`}>
      {/* The readout: pinned to the top of the figure, so the curve never shifts
          under the cursor. Reserved height whether or not a point is active,
          because content appearing on hover must not reflow the chart. */}
      <div className="pointer-events-none absolute left-0 right-0 top-0 z-10 flex justify-end px-1">
        <span
          className={`rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface-raised)] px-2 py-1 fig text-[var(--text-primary)] card-elev-raised transition-opacity duration-100 ${
            hot ? "opacity-100" : "opacity-0"
          }`}
          aria-hidden
        >
          {hot?.readout ?? "\u00A0"}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-full w-full flex-1"
        role="img"
        aria-label={label}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            {/* The reference fill: strong at the line, gone by the baseline, so
                the area reads as glow rather than as a solid block. */}
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.28" />
            <stop offset="55%" stopColor="var(--accent)" stopOpacity="0.08" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Faint horizontal gridlines: kept to three, at quarter intervals. */}
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

        <path d={area} fill={`url(#${gradientId})`} className="chart-fill-in" />
        <path
          d={d}
          pathLength={1}
          className="chart-draw"
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
          strokeLinecap="round"
        />


        {/* Resting emphasis on the LATEST point: the newest figure is the one
            the eye should land on. The hover marker below still outranks it
            the moment a colleague points at anything. */}
        {pts.length > 0 && (
          <g aria-hidden>
            <circle
              className="endpoint-halo"
              cx={pts[pts.length - 1].px}
              cy={pts[pts.length - 1].py}
              r="8"
              fill="var(--accent)"
            />
            <circle
              cx={pts[pts.length - 1].px}
              cy={pts[pts.length - 1].py}
              r="3"
              fill="var(--accent)"
              stroke="var(--surface-accent)"
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
            />
          </g>
        )}
        {/* The active point's marker. */}
        {hot && (
          <>
            <line
              x1={pts[active!].px}
              x2={pts[active!].px}
              y1={PAD_TOP - 6}
              y2={H}
              stroke="var(--text-faint)"
              strokeOpacity="0.6"
              strokeDasharray="3 3"
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={pts[active!].px}
              cy={pts[active!].py}
              r="5"
              fill="var(--accent)"
              stroke="var(--surface-accent)"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
          </>
        )}

        {showDots &&
          pts.map((p, i) => (
            <circle
              key={points[i].key}
              cx={p.px}
              cy={p.py}
              r="3"
              fill="var(--accent)"
              opacity={active === i ? 0 : 0.6}
            />
          ))}
      </svg>

      {/*
        The hit targets: one focusable strip per point, over the SVG. Rendered as
        real buttons so the keyboard reaches every week -- the convention
        TrendChart.tsx set. They carry the accessible names; the SVG is one image.
      */}
      <div className="absolute inset-0 flex" onMouseLeave={() => setActive(null)}>
        {points.map((p, i) => (
          <button
            key={p.key}
            type="button"
            tabIndex={0}
            aria-label={p.readout}
            onMouseEnter={() => setActive(i)}
            onFocus={() => setActive(i)}
            onBlur={() => setActive(null)}
            onClick={onSelect ? () => onSelect(p.key) : undefined}
            className={`h-full flex-1  focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]`}
          />
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- Donut */

export type DonutSlice = {
  label: string;
  value: number;
  /** A CSS colour, usually a var(--*) token. */
  color: string;
};

/**
 * A thin donut with a dominant centre figure -- the reference's proportion shape.
 *
 * Thin ring, big number: the number IS the answer, the ring is the proportion at
 * a glance. A pie with fat slices inverts that emphasis and gets angles wrong at
 * a glance anyway; nobody reads a 16% slice as 16%.
 */
export function Donut({
  slices,
  centre,
  centreLabel,
  label,
  size = 148,
  thickness = 12,
  onSelect,
  activeLabel = null,
}: {
  slices: DonutSlice[];
  /** The big number in the middle, e.g. "84%". */
  centre: string;
  /** The small line under it, e.g. "billable". */
  centreLabel?: string;
  label: string;
  size?: number;
  thickness?: number;
  /**
   * When given, each slice becomes a CLICKABLE filter control — the
   * cross-filtering that BI tools (Tableau, Power BI) offer: clicking a slice
   * calls back with its label so the page can filter to it. Without it the
   * donut is a plain read-only figure, unchanged.
   */
  onSelect?: (label: string) => void;
  /** The currently-filtered slice label, so it reads as pressed and the rest dim. */
  activeLabel?: string | null;
}) {
  const total = slices.reduce((s, x) => s + Math.max(0, x.value), 0);
  if (total <= 0) return null;

  const r = (size - thickness) / 2;
  const c = size / 2;
  const circumference = 2 * Math.PI * r;

  // Each slice is a stroked arc offset by the running total. A 2.5-unit gap is
  // carved between slices so adjacent colours never touch -- the reference keeps
  // its ring segments separated. Built with a fold rather than a mutated counter,
  // because reassigning a closure variable during render trips the compiler's
  // immutability rule (and rightly: a re-render would double-advance it).
  const GAP = total > 0 && slices.filter((s) => s.value > 0).length > 1 ? 2.5 : 0;

  const arcs = slices
    .filter((s) => s.value > 0)
    .reduce<{ list: (DonutSlice & { dasharray: string; dashoffset: number })[]; offset: number }>(
      (acc, s) => {
        const fraction = s.value / total;
        const length = Math.max(0, fraction * circumference - GAP);
        return {
          list: [
            ...acc.list,
            { ...s, dasharray: `${length} ${circumference - length}`, dashoffset: -acc.offset },
          ],
          offset: acc.offset + fraction * circumference,
        };
      },
      { list: [], offset: 0 },
    ).list;

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg
          viewBox={`0 0 ${size} ${size}`}
          width={size}
          height={size}
          role="img"
          aria-label={label}
          // Start at 12 o'clock, not 3 o'clock.
          style={{ transform: "rotate(-90deg)" }}
        >
          <circle
            cx={c}
            cy={c}
            r={r}
            fill="none"
            stroke="var(--border)"
            strokeOpacity="0.45"
            strokeWidth={thickness}
          />
          {arcs.map((a) => {
            // When a slice is filtered, the others fade so the selection reads at
            // a glance — the emphasis Power BI gives a clicked mark.
            const dim = activeLabel !== null && activeLabel !== a.label;
            const arc = (
              <circle
                key={a.label}
                cx={c}
                cy={c}
                r={r}
                fill="none"
                stroke={a.color}
                strokeWidth={activeLabel === a.label ? thickness + 3 : thickness}
                strokeDasharray={a.dasharray}
                strokeDashoffset={a.dashoffset}
                strokeLinecap="round"
                opacity={dim ? 0.28 : 1}
                style={onSelect ? { cursor: "pointer" } : undefined}
                onClick={onSelect ? () => onSelect(a.label) : undefined}
              />
            );
            return arc;
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="fig-lg text-[var(--text-primary)]">
            {centre}
          </span>
          {centreLabel && (
            <span className="mt-1 t-label uppercase text-[var(--text-faint)]">
              {centreLabel}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- Gauge */

/**
 * A semicircular gauge -- the reference's "risk" shape.
 *
 * For a single bounded value with a judgement attached (64/100 and whether that
 * is fine). The colour carries the judgement, the arc carries the magnitude, and
 * the number carries the fact. The caller decides the colour, because "what
 * counts as bad" is domain knowledge this component must not invent.
 */
export function Gauge({
  value,
  max,
  color,
  tone,
  centre,
  centreLabel,
  label,
  width = 168,
  unit,
  figure = "default",
}: {
  value: number;
  max: number;
  /** Explicit CSS colour; wins over `tone`. */
  color?: string;
  /** The status vocabulary the Meter and HBar share; `color` still wins. */
  tone?: Tone;
  /** Text in the middle; defaults to the value. */
  centre?: string;
  centreLabel?: string;
  label: string;
  width?: number;
  /**
   * The small qualifier after the centre figure. Defaults to "/max"; a ratio
   * that IS a percentage says "%" instead, because "99.6/100 cache hit %"
   * states the ceiling twice and crowds a 130px arc.
   */
  unit?: string;
  /**
   * `hero` sets the centre in the display sans at 48px with proportional
   * figures -- the one number a page leads with (dataviz: hero figure >= 48px,
   * same sans as everything else, never tabular at display size). `default`
   * keeps the mono 24px figure the smaller gauges share.
   */
  figure?: "default" | "hero";
}) {
  const stroke = color ?? (tone ? toneColor(tone) : "var(--accent)");
  const thickness = figure === "hero" ? 14 : 12;
  const w = width;
  const r = (w - thickness) / 2;
  const cx = w / 2;
  const cy = w / 2;
  const height = w / 2 + thickness;

  const clamped = Math.max(0, Math.min(value, max));
  const fraction = max > 0 ? clamped / max : 0;
  const semi = Math.PI * r;

  // The dot marking the needle position, on the arc.
  const angle = Math.PI * (1 - fraction);
  const dotX = cx + r * Math.cos(angle);
  const dotY = cy - r * Math.sin(angle);

  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: w, height }}>
        <svg viewBox={`0 0 ${w} ${height}`} width={w} height={height} role="img" aria-label={label}>
          <path
            d={`M ${thickness / 2} ${cy} A ${r} ${r} 0 0 1 ${w - thickness / 2} ${cy}`}
            fill="none"
            stroke="var(--border)"
            strokeOpacity="0.45"
            strokeWidth={thickness}
            strokeLinecap="round"
          />
          <path
            d={`M ${thickness / 2} ${cy} A ${r} ${r} 0 0 1 ${w - thickness / 2} ${cy}`}
            fill="none"
            stroke={stroke}
            strokeWidth={thickness}
            strokeLinecap="round"
            strokeDasharray={`${fraction * semi} ${semi}`}
          />
          <circle cx={dotX} cy={dotY} r={thickness / 2 + 2} fill="var(--surface)" stroke={stroke} strokeWidth="3" />
        </svg>
        <div className="absolute inset-x-0 bottom-0 flex flex-col items-center">
          <span
            className={
              figure === "hero"
                ? "text-[48px] font-semibold leading-none tracking-[-0.03em] text-[var(--text-primary)]"
                : "fig-lg text-[var(--text-primary)]"
            }
          >
            {centre ?? String(value)}
            <span
              className={
                figure === "hero"
                  ? "ml-0.5 font-mono text-[15px] font-normal tracking-normal text-[var(--text-faint)]"
                  : "fig text-[var(--text-faint)]"
              }
            >
              {unit ?? `/${max}`}
            </span>
          </span>
          {centreLabel && (
            <span className="mt-1 t-label uppercase text-[var(--text-faint)]">
              {centreLabel}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- LegendDot */

/** The little legend marker every chart card uses; one shape, not five ad-hoc spans. */
export function LegendDot({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 t-label text-[var(--text-secondary)]">
      <span className="h-2 w-2 rounded-full" style={{ background: color }} />
      {children}
    </span>
  );
}


/* ------------------------------------------------------------------- BarTrend */

/**
 * The same series as AreaTrend, drawn as rounded vertical bars.
 *
 * Bars where the reader counts discrete periods; the area where they read a shape.
 * Which is right depends on the reader, which is why TrendFigure below lets them
 * choose. The interaction contract is identical to AreaTrend: hover/focus readout
 * pinned top-right, one focusable target per point carrying its own name.
 */
export function BarTrend({
  points,
  label,
  yDomain,
  className = "",
  onSelect,
}: {
  points: AreaPoint[];
  label: string;
  yDomain?: [number, number];
  className?: string;
  onSelect?: (key: string) => void;
}) {
  const [active, setActive] = useState<number | null>(null);

  if (points.length === 0) return null;

  const lo = yDomain ? yDomain[0] : 0;
  const hi = yDomain ? yDomain[1] : Math.max(...points.map((p) => p.value), 1);
  const span = hi - lo || 1;
  const hot = active !== null ? points[active] : null;

  return (
    <div className={`relative flex h-full min-h-0 flex-col ${className}`}>
      <div className="pointer-events-none absolute left-0 right-0 top-0 z-10 flex justify-end px-1">
        <span
          className={`rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface-raised)] px-2 py-1 fig text-[var(--text-primary)] card-elev-raised transition-opacity duration-100 ${
            hot ? "opacity-100" : "opacity-0"
          }`}
          aria-hidden
        >
          {hot?.readout ?? "\u00A0"}
        </span>
      </div>

      {/* Plain flex bars, not an SVG: rounded caps and per-bar hover come free, and
          there is no aspect-ratio stretching to fight. The 26px top padding reserves
          the readout's space so it never overlaps a tall bar. */}
      <div
        role="img"
        aria-label={label}
        className="flex h-full min-h-0 flex-1 items-end gap-[6px] pt-[26px]"
        onMouseLeave={() => setActive(null)}
      >
        {points.map((p, i) => {
          const fraction = Math.max(0.02, (p.value - lo) / span);
          const on = active === i;
          return (
            <button
              key={p.key}
              type="button"
              aria-label={p.readout}
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
              onClick={onSelect ? () => onSelect(p.key) : undefined}
              className={`flex h-full flex-1  items-end focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]`}
            >
              <span
                className="block w-full rounded-[5px] transition-[height,filter] duration-200"
                style={{
                  height: `${fraction * 100}%`,
                  background: on ? "var(--accent-hover)" : "var(--accent)",
                  opacity: on ? 1 : 0.85,
                }}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- TrendFigure */

/**
 * A trend with a reader-selectable shape: area or bars.
 *
 * WHY THE CHOICE EXISTS. An area reads a season's shape; bars read discrete weeks.
 * Both are honest renderings of the same numbers, and which lands depends on the
 * reader -- so the reader decides, per figure, and the choice persists.
 *
 * PERSISTENCE is localStorage through useSyncExternalStore, the same pattern as the
 * theme toggle and for the same reason: the stored choice is external state, the
 * server cannot know it, and reading it in an effect trips the compiler's
 * setState-in-effect rule. Until hydration the default shape renders, which keeps
 * server and client HTML identical.
 */
const chartKindListeners = new Set<() => void>();
function chartKindSubscribe(onChange: () => void): () => void {
  chartKindListeners.add(onChange);
  return () => chartKindListeners.delete(onChange);
}
function setChartKind(id: string, kind: "area" | "bars"): void {
  try {
    localStorage.setItem(`hse-hub-chart:${id}`, kind);
  } catch {
    /* storage may be blocked; the choice still applies via the re-render below */
  }
  for (const l of chartKindListeners) l();
}

export function TrendFigure({
  id,
  points,
  label,
  yDomain,
  defaultKind = "area",
  className = "",
  onSelect,
}: {
  /** Stable per-figure key for the persisted preference, e.g. "overview-hero". */
  id: string;
  points: AreaPoint[];
  label: string;
  yDomain?: [number, number];
  defaultKind?: "area" | "bars";
  className?: string;
  onSelect?: (key: string) => void;
}) {
  const kind = useSyncExternalStore(
    chartKindSubscribe,
    () => {
      try {
        const stored = localStorage.getItem(`hse-hub-chart:${id}`);
        return stored === "bars" || stored === "area" ? stored : defaultKind;
      } catch {
        return defaultKind;
      }
    },
    () => defaultKind,
  );

  return (
    <div className={`relative flex h-full min-h-0 flex-col ${className}`}>
      {/*
        The switcher, top-LEFT: the readout owns the top-right. Two tiny pills;
        aria-pressed carries the state, the labels say what you get.
      */}
      <div className="absolute left-0 top-0 z-20 flex gap-0.5 rounded-full border border-[var(--border)] bg-[var(--surface-2)] p-0.5">
        {(["area", "bars"] as const).map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={kind === k}
            aria-label={`Draw this figure as ${k === "area" ? "an area" : "bars"}`}
            onClick={() => setChartKind(id, k)}
            className={`rounded-full px-2 py-0.5 t-label transition-colors ${
              kind === k
                ? "bg-[var(--accent)] text-[var(--accent-contrast)]"
                : "text-[var(--text-faint)] hover:text-[var(--text-primary)]"
            }`}
          >
            {k.toUpperCase()}
          </button>
        ))}
      </div>

      {kind === "bars" ? (
        <BarTrend points={points} label={label} yDomain={yDomain} onSelect={onSelect} />
      ) : (
        <AreaTrend points={points} label={label} yDomain={yDomain} onSelect={onSelect} />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * The System Health vocabulary: horizontal bars, stacks, a proportion bar, a
 * timeline of events, a sparkline and a meter.
 *
 * Same rules as the figures above. Marks wear the var(--*) tokens; every label,
 * value and legend wears a TEXT token, never the series colour. Bars stay under
 * 24px and are rounded only at the data end. Touching fills are separated by a
 * 2px gap in the surface colour, never by a stroke. The hover/focus readout is
 * pinned so nothing under the cursor ever moves, and every mark that has a
 * readout is a real <button> so the keyboard reaches what the mouse reaches.
 * ═══════════════════════════════════════════════════════════════════════ */


/** The status/emphasis vocabulary every horizontal figure shares. */
export type Tone = "accent" | "good" | "warning" | "critical" | "muted" | "neutral";

/**
 * One mapping from judgement to token, so the page never spells a colour and
 * Gauge, Meter and HBar agree on what "warning" looks like.
 */
export function toneColor(tone: Tone | undefined): string {
  switch (tone) {
    case "good":
      return "var(--good)";
    case "warning":
      return "var(--warning)";
    case "critical":
      return "var(--critical)";
    case "muted":
    case "neutral":
      return "var(--text-faint)";
    default:
      return "var(--accent)";
  }
}

/**
 * The pinned readout the horizontal figures share. It owns the figure's
 * top-right corner and keeps its height whether or not anything is active, so
 * a readout appearing on hover never reflows the marks beneath it.
 */
function PinnedReadout({ text }: { text: string | null }) {
  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute right-0 top-0 z-10 max-w-full truncate rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface-raised)] px-2 py-0.5 fig text-[var(--text-primary)] card-elev-raised transition-opacity duration-100 ${
        text ? "opacity-100" : "opacity-0"
      }`}
    >
      {text ?? "\u00A0"}
    </span>
  );
}

/**
 * The strip above a figure that holds its legend (if any) and the pinned
 * readout. It is `relative` with a fixed minimum height, and the readout is
 * absolutely positioned inside it, so a long readout on a narrow card overlays
 * the legend for the moment it is shown instead of wrapping and pushing the
 * marks down.
 */
function FigureStrip({ children, text }: { children?: React.ReactNode; text: string | null }) {
  return (
    <div className="relative flex min-h-[22px] items-start">
      {children}
      <PinnedReadout text={text} />
    </div>
  );
}

/**
 * The rendered width of an element, in CSS pixels, so a label is only drawn
 * inside a mark when it is KNOWN to fit. Zero until mounted -- the server
 * cannot measure -- which means no inline label in the first paint and no
 * hydration mismatch. Measured, not guessed: the dataviz rule is that text
 * never overflows or is clipped by its own mark.
 */
function useMeasuredWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setWidth(Math.round(w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/** Mono text at 10px is ~6px per character; 11px is ~6.6px. Generous on purpose. */
const monoWidth = (text: string, px: number) => text.length * px * 0.62;

/* ----------------------------------------------------------------------- HBar */

export type HBarRow = {
  key: string;
  label: string;
  value: number;
  /** One line for the hover/focus readout, e.g. "trackingtime: 3h old (SLA 24h)". */
  readout: string;
  tone?: Tone;
  /** Optional grouping; rows are listed under a small group header. */
  group?: string;
  /**
   * A muted prefix before the label -- the schema of a relation name. It sits
   * on the same line when the column has room and wraps onto its own line on
   * a phone, so "crm.factorial_person_reference" never truncates to "crm.fac".
   */
  prefix?: string;
  /** A second, muted mono line under the label: "1,204 calls x 3.5 ms mean". */
  sub?: string;
};

/**
 * The label column of every horizontal figure. `narrow` is the default 7.5rem;
 * `wide` is for relation and statement names (up to ~34 characters), which at
 * 7.5rem truncated to a shared prefix and were indistinguishable. On a phone a
 * wide label takes the whole row and the bar sits under it -- a 15rem column
 * would leave a 311px card no room for the bar.
 */
export type LabelWidth = "narrow" | "wide";
const LABEL_COLS: Record<LabelWidth, string> = {
  narrow: "grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)]",
  wide: "grid-cols-1 gap-y-0.5 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]",
};

/** Bars grow in 400ms, row by row, and finish well inside the page's 500ms motion budget. */
const barMotion = (i: number) => ({ animationDuration: "0.4s", animationDelay: `${90 + Math.min(i, 8) * 35}ms` });

function RowLabel({ label, prefix, sub, wide }: { label: string; prefix?: string; sub?: string; wide?: boolean }) {
  return (
    <span className="flex min-w-0 flex-col">
      <span className="flex min-w-0 flex-wrap items-baseline t-callout text-[var(--text-secondary)]">
        {prefix && <span className="t-label text-[var(--text-faint)]">{prefix}</span>}
        {/* A wide label (free-text SQL) wraps to two lines rather than losing its end. */}
        <span className={wide ? "line-clamp-2 [overflow-wrap:anywhere]" : "truncate"}>{label}</span>
      </span>
      {sub && <span className="truncate t-label text-[var(--text-faint)]">{sub}</span>}
    </span>
  );
}

/**
 * Horizontal bars for "magnitude by category" -- ages against an SLA, ranked
 * statement cost, typed-layer row counts.
 *
 * Horizontal because the categories have names, and a name reads left-to-right
 * beside its bar; the same data as columns forces angled labels. The value is
 * the direct label and sits at the bar's tip -- there is no axis to carry it, so
 * it is always drawn. An optional `limit` draws a vertical hairline rule with a
 * label, the honest way to show "against a limit" without a second axis.
 *
 * The bars are plain HTML, not an SVG: rounded ends, per-row hover and a text
 * label that never stretches come free, and the label column can truncate.
 */
export function HBar({
  rows,
  label,
  max,
  limit,
  valueFormat = (v) => String(v),
  onSelect,
  groupOrder,
  thickness = 12,
  labelWidth = "narrow",
  className = "",
}: {
  rows: HBarRow[];
  /** Description of the whole figure for assistive tech. */
  label: string;
  /** Scale maximum; defaults to the largest value (and never below the limit). */
  max?: number;
  /** A vertical rule at this value, e.g. the SLA, labelled in text tokens. */
  limit?: { value: number; label: string };
  /** Formats the value drawn at the bar tip. */
  valueFormat?: (v: number) => string;
  /** Click a row to open it. Rows are plain divs when absent. */
  onSelect?: (key: string) => void;
  /** Order of group headers; unlisted groups follow in first-seen order. */
  groupOrder?: string[];
  /** Bar thickness in px; capped at 24 by the mark spec. */
  thickness?: number;
  labelWidth?: LabelWidth;
  className?: string;
}) {
  const [active, setActive] = useState<string | null>(null);
  if (rows.length === 0) return null;

  const t = Math.min(24, Math.max(6, thickness));
  const dataMax = Math.max(...rows.map((r) => r.value), limit?.value ?? 0, 0);
  const top = max !== undefined ? max : dataMax;
  const scale = top > 0 ? top : 1;

  // The value label lives at the bar tip, so the scale leaves it room: the
  // longest formatted value plus a gap, in `ch` of the mono face, is held back
  // from the track and no tip label can run past the row.
  const values = rows.map((r) => valueFormat(r.value));
  const reserveCh = Math.max(...values.map((v) => v.length)) + 1.5;
  const reserve = `${reserveCh}ch`;
  const xOf = (v: number) => `calc((100% - ${reserve}) * ${Math.max(0, Math.min(1, v / scale))})`;

  // Group order: the caller's list first, then first-seen. Rows without a
  // group come first, under no header.
  const seen: string[] = [];
  for (const r of rows) if (r.group && !seen.includes(r.group)) seen.push(r.group);
  const groups = [
    ...(groupOrder ?? []).filter((g) => seen.includes(g)),
    ...seen.filter((g) => !(groupOrder ?? []).includes(g)),
  ];
  const ungrouped = rows.filter((r) => !r.group);
  const sections: { group: string | null; rows: HBarRow[] }[] = [
    ...(ungrouped.length ? [{ group: null, rows: ungrouped }] : []),
    ...groups.map((g) => ({ group: g, rows: rows.filter((r) => r.group === g) })),
  ];

  const hot = active !== null ? rows.find((r) => r.key === active) ?? null : null;
  const limitX = limit ? xOf(limit.value) : null;
  const limitRight = limit ? limit.value / scale > 0.6 : false;

  const gridCols = LABEL_COLS[labelWidth];

  return (
    <div className={`flex flex-col ${className}`} onMouseLeave={() => setActive(null)}>
      <FigureStrip text={hot?.readout ?? null} />

      <div role="img" aria-label={label} className="flex flex-col gap-1">
        {/* The limit label rides above the tracks, in the track column, so it
            never collides with a bar's tip value. */}
        {limit && limitX && (
          <div className={`grid ${gridCols} gap-x-3`}>
            <span />
            <span className="relative h-[14px]">
              <span
                className="absolute top-0 whitespace-nowrap t-label text-[var(--text-faint)]"
                style={
                  limitRight
                    ? { right: `calc(100% - ${limitX})`, marginRight: 5 }
                    : { left: limitX, marginLeft: 5 }
                }
              >
                {limit.label}
              </span>
            </span>
          </div>
        )}

        {sections.map((s) => (
          <div key={s.group ?? "__none"} className="flex flex-col gap-1">
            {s.group && (
              <div className="pt-2 t-label uppercase text-[var(--text-faint)] first:pt-0">
                {s.group}
              </div>
            )}
            {s.rows.map((r, i) => {
              const on = active === r.key;
              const fraction = Math.max(0, Math.min(1, r.value / scale));
              const rowClass = `grid ${gridCols} items-center gap-x-3 rounded-[var(--radius-sm)] py-[3px] text-left transition-colors ${
                on ? "bg-[var(--surface-hover)]" : ""
              } ${onSelect ? "cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]" : ""}`;
              const inner = (
                <>
                  <RowLabel label={r.label} prefix={r.prefix} sub={r.sub} wide={labelWidth === "wide"} />
                  <span className="relative block" style={{ height: Math.max(t, 16) }}>
                    {limitX && (
                      <span
                        aria-hidden
                        className="absolute -bottom-1 -top-1 w-px bg-[var(--border-strong)]"
                        style={{ left: limitX }}
                      />
                    )}
                    <span
                      className="bar-grow absolute left-0 top-1/2 block -translate-y-1/2 rounded-r-[4px] transition-opacity duration-150"
                      style={{
                        width: xOf(r.value),
                        height: t,
                        background: toneColor(r.tone),
                        opacity: on ? 1 : 0.85,
                        // An empty bar still shows a 2px stub so "zero" is not "absent".
                        minWidth: r.value > 0 ? 2 : 0,
                        ...barMotion(i),
                      }}
                    />
                    {/* With a limit rule the tip label wears the row's own surface
                        colour, so where it crosses the rule it cuts a gap instead of
                        colliding -- the surface doing the separating, as everywhere. */}
                    <span
                      className="absolute top-1/2 -translate-y-1/2 whitespace-nowrap rounded-[2px] fig text-[var(--text-primary)]"
                      style={{
                        left: `calc(${xOf(r.value)} + ${fraction > 0 ? 4 : 0}px)`,
                        padding: limit ? "0 2px" : undefined,
                        background: limit ? (on ? "var(--surface-hover)" : "var(--surface)") : undefined,
                      }}
                    >
                      {values[rows.indexOf(r)]}
                    </span>
                  </span>
                </>
              );
              return onSelect ? (
                <button
                  key={r.key}
                  type="button"
                  aria-label={r.readout}
                  onMouseEnter={() => setActive(r.key)}
                  onFocus={() => setActive(r.key)}
                  onBlur={() => setActive(null)}
                  onClick={() => onSelect(r.key)}
                  className={rowClass}
                >
                  {inner}
                </button>
              ) : (
                <div key={r.key} onMouseEnter={() => setActive(r.key)} className={rowClass}>
                  <span className="sr-only">{r.readout}</span>
                  {inner}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- Segments */

export type Segment = {
  key: string;
  label: string;
  value: number;
  /** A CSS colour, usually a var(--*) token. */
  color: string;
  /**
   * Ink for a label drawn INSIDE this segment. Defaults to --accent-contrast,
   * which clears every status token in both themes; a caller painting a
   * segment in a gray must say which ink reads on it.
   */
  ink?: string;
};

/** The legend every multi-segment figure shows: one LegendDot per segment kind. */
function SegmentLegend({
  kinds,
  values,
}: {
  kinds: { key: string; label: string; color: string }[];
  values?: Map<string, string>;
}) {
  if (kinds.length < 2) return null;
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1">
      {kinds.map((k) => (
        <LegendDot key={k.key} color={k.color}>
          {k.label}
          {values?.has(k.key) && (
            <span className="tabular-nums text-[var(--text-primary)]">{values.get(k.key)}</span>
          )}
        </LegendDot>
      ))}
    </div>
  );
}

/** Distinct segment kinds in first-seen order; colour follows the key, never the row. */
function segmentKinds(rows: { segments: Segment[] }[]) {
  const kinds: { key: string; label: string; color: string }[] = [];
  for (const r of rows)
    for (const s of r.segments)
      if (!kinds.some((k) => k.key === s.key)) kinds.push({ key: s.key, label: s.label, color: s.color });
  return kinds;
}

/* ---------------------------------------------------------------- StackedHBar */

export type StackedHBarRow = {
  key: string;
  label: string;
  segments: Segment[];
  readout: string;
};

/**
 * HBar with each bar split into segments -- profiles per role split into
 * active/inactive, relation sizes split into the eight largest plus "other".
 *
 * Segments are separated by a 2px gap in the SURFACE colour, never a stroke;
 * the gap is the mechanism that keeps two neighbouring fills distinct. Only the
 * last segment is rounded, because the rounded end marks the data end and an
 * interior segment has none. The row total sits at the tip; per-segment values
 * live in the readout and the legend, not on every segment.
 */
export function StackedHBar({
  rows,
  label,
  max,
  valueFormat = (v) => String(v),
  onSelect,
  thickness = 12,
  labelWidth = "narrow",
  className = "",
}: {
  rows: StackedHBarRow[];
  label: string;
  /** Scale maximum; defaults to the largest row total. */
  max?: number;
  /** Formats the row total at the tip. */
  valueFormat?: (v: number) => string;
  onSelect?: (key: string) => void;
  thickness?: number;
  labelWidth?: LabelWidth;
  className?: string;
}) {
  const [active, setActive] = useState<string | null>(null);
  if (rows.length === 0) return null;

  const t = Math.min(24, Math.max(6, thickness));
  const totals = rows.map((r) => r.segments.reduce((s, x) => s + Math.max(0, x.value), 0));
  const top = max !== undefined ? max : Math.max(...totals, 0);
  const scale = top > 0 ? top : 1;
  const values = totals.map(valueFormat);
  const reserve = `${Math.max(...values.map((v) => v.length)) + 1.5}ch`;
  const kinds = segmentKinds(rows);
  const hot = active !== null ? rows.find((r) => r.key === active) ?? null : null;
  const gridCols = LABEL_COLS[labelWidth];

  return (
    <div className={`flex flex-col gap-2 ${className}`} onMouseLeave={() => setActive(null)}>
      <FigureStrip text={hot?.readout ?? null}>
        <SegmentLegend kinds={kinds} />
      </FigureStrip>

      <div role="img" aria-label={label} className="flex flex-col gap-1">
        {rows.map((r, i) => {
          const on = active === r.key;
          const total = totals[i];
          const fraction = Math.max(0, Math.min(1, total / scale));
          const visible = r.segments.filter((s) => s.value > 0);
          const rowClass = `grid ${gridCols} items-center gap-x-3 rounded-[var(--radius-sm)] py-[3px] text-left transition-colors ${
            on ? "bg-[var(--surface-hover)]" : ""
          } ${onSelect ? "cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]" : ""}`;
          const inner = (
            <>
              <span className="truncate t-callout text-[var(--text-secondary)]">{r.label}</span>
              <span className="relative block" style={{ height: Math.max(t, 16) }}>
                <span
                  className="bar-grow absolute left-0 top-1/2 flex -translate-y-1/2 gap-[2px] transition-opacity duration-150"
                  style={{
                    width: `calc((100% - ${reserve}) * ${fraction})`,
                    height: t,
                    opacity: on ? 1 : 0.85,
                    ...barMotion(i),
                  }}
                >
                  {visible.map((s, j) => (
                    <span
                      key={s.key}
                      className={`block h-full ${j === visible.length - 1 ? "rounded-r-[4px]" : ""}`}
                      style={{ flex: `${s.value} ${s.value} 0%`, background: s.color, minWidth: 2 }}
                    />
                  ))}
                </span>
                <span
                  className="absolute top-1/2 -translate-y-1/2 whitespace-nowrap fig text-[var(--text-primary)]"
                  style={{ left: `calc((100% - ${reserve}) * ${fraction} + ${fraction > 0 ? 6 : 0}px)` }}
                >
                  {values[i]}
                </span>
              </span>
            </>
          );
          return onSelect ? (
            <button
              key={r.key}
              type="button"
              aria-label={r.readout}
              onMouseEnter={() => setActive(r.key)}
              onFocus={() => setActive(r.key)}
              onBlur={() => setActive(null)}
              onClick={() => onSelect(r.key)}
              className={rowClass}
            >
              {inner}
            </button>
          ) : (
            <div key={r.key} onMouseEnter={() => setActive(r.key)} className={rowClass}>
              <span className="sr-only">{r.readout}</span>
              {inner}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- ProportionBar */

/**
 * One horizontal part-to-whole bar -- commits against rollbacks, the eight
 * largest relations against the rest.
 *
 * A two-part proportion is NOT a donut: a 2-slice pie is the anti-pattern the
 * dataviz skill names first. A bar reads the split at a glance and the legend
 * carries the numbers in text tokens. A value is drawn inside a segment only
 * when the segment is measured wide enough to hold it with padding on both
 * sides; otherwise the legend and the readout carry it, and nothing is clipped.
 */
export function ProportionBar({
  segments,
  label,
  valueFormat = (v) => String(v),
  height = 14,
  onSelect,
  legend = "strip",
  className = "",
}: {
  segments: Segment[];
  label: string;
  /** Formats the legend values and the in-segment labels. */
  valueFormat?: (v: number) => string;
  /** Bar height in px; capped at 24 by the mark spec. */
  height?: number;
  onSelect?: (key: string) => void;
  /**
   * `strip` (default) lists the legend inline above the bar -- right for two
   * or three segments. `grid` lists it UNDER the bar as columns with the
   * value right-aligned in tabular digits: the table twin of a nine-segment
   * bar, which as a wrapped strip read as a paragraph of chips.
   */
  legend?: "strip" | "grid";
  className?: string;
}) {
  const [active, setActive] = useState<string | null>(null);
  const [ref, width] = useMeasuredWidth<HTMLDivElement>();
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0);
  if (total <= 0) return null;

  const h = Math.min(24, Math.max(6, height));
  const visible = segments.filter((s) => s.value > 0);
  const GAP = 2;
  const usable = Math.max(0, width - GAP * (visible.length - 1));
  const hot = active !== null ? visible.find((s) => s.key === active) ?? null : null;
  const values = new Map(visible.map((s) => [s.key, valueFormat(s.value)]));

  return (
    <div className={`flex flex-col gap-2 ${className}`} onMouseLeave={() => setActive(null)}>
      <FigureStrip
        text={hot ? `${hot.label}: ${values.get(hot.key)} (${Math.round((hot.value / total) * 100)}%)` : null}
      >
        {legend === "strip" && <SegmentLegend kinds={visible} values={values} />}
      </FigureStrip>
      <div
        ref={ref}
        role="img"
        aria-label={label}
        className="flex w-full"
        style={{ height: h, gap: GAP }}
      >
        {visible.map((s, j) => {
          const px = (s.value / total) * usable;
          const text = values.get(s.key) ?? "";
          const fits = width > 0 && px >= monoWidth(text, 10) + 16;
          const on = active === s.key;
          return (
            <button
              key={s.key}
              type="button"
              aria-label={`${s.label}: ${text}`}
              onMouseEnter={() => setActive(s.key)}
              onFocus={() => setActive(s.key)}
              onBlur={() => setActive(null)}
              onClick={onSelect ? () => onSelect(s.key) : undefined}
              className={`relative block h-full min-w-[2px] transition-opacity duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${
                j === 0 ? "rounded-l-[4px]" : ""
              } ${j === visible.length - 1 ? "rounded-r-[4px]" : ""} ${onSelect ? "cursor-pointer" : "cursor-default"}`}
              style={{
                flex: `${s.value} ${s.value} 0%`,
                background: s.color,
                opacity: on ? 1 : 0.85,
              }}
            >
              {fits && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 flex items-center justify-center whitespace-nowrap t-label"
                  style={{ color: s.ink ?? "var(--accent-contrast)" }}
                >
                  {text}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {legend === "grid" && (
        <ul className="grid grid-cols-1 gap-x-6 gap-y-1 pt-1 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((s) => {
            const on = active === s.key;
            return (
              <li
                key={s.key}
                onMouseEnter={() => setActive(s.key)}
                className={`flex items-baseline gap-2 rounded-[var(--radius-sm)] px-1 py-0.5 t-label transition-colors ${
                  on ? "bg-[var(--surface-hover)]" : ""
                }`}
              >
                <span className="h-2 w-2 shrink-0 self-center rounded-full" style={{ background: s.color }} />
                <span className="min-w-0 flex-1 truncate text-[var(--text-secondary)]">{s.label}</span>
                <span className="shrink-0 tabular-nums text-[var(--text-primary)]">{values.get(s.key)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ Timeline */

export type TimelineLane = {
  key: string;
  label: string;
  /** A right-aligned mono figure at the lane's end, e.g. "25 runs" or "none". */
  meta?: string;
};
export type TimelineEvent = {
  key: string;
  lane: string;
  /** ISO timestamp. */
  at: string;
  kind: "ok" | "failed" | "running";
  readout: string;
};

const DAY_MS = 86_400_000;

/**
 * The three event marks. Shape AND colour carry the state, so a failed run is a
 * cross in --critical and never "the red one". The 2px surface ring is drawn as
 * a first pass in the surface colour, so overlapping marks stay separable.
 */
function EventMark({ kind, size = 12 }: { kind: TimelineEvent["kind"]; size?: number }) {
  const c = size / 2;
  const r = size / 2 - 2;
  const ring = <circle cx={c} cy={c} r={size / 2} fill="var(--surface)" />;
  if (kind === "ok")
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        {ring}
        <circle cx={c} cy={c} r={r} fill="var(--good)" />
      </svg>
    );
  if (kind === "running")
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        {ring}
        <circle cx={c} cy={c} r={r - 1} fill="none" stroke="var(--warning)" strokeWidth="2" />
      </svg>
    );
  const k = r * 0.72;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      {ring}
      <path
        d={`M ${c - k} ${c - k} L ${c + k} ${c + k} M ${c + k} ${c - k} L ${c - k} ${c + k}`}
        stroke="var(--critical)"
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

const KIND_LABEL: Record<TimelineEvent["kind"], string> = {
  ok: "ok",
  failed: "failed",
  running: "running",
};

/**
 * Events over time, one lane per source -- thirty days of sync runs.
 *
 * A mark per event, positioned by time on a hairline baseline; a lane is a row,
 * not a colour, so three sources never need three hues. Marks on the same day
 * sit side by side inside that day's slot rather than on top of each other, and
 * each carries a surface ring so the overlap still reads. Day ticks along the
 * bottom are thinned to what the measured width can hold without collisions.
 */
export function Timeline({
  lanes,
  events,
  from,
  to,
  label,
  onSelect,
  tickEvery = 5,
  tickFormat = (d) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }),
  kindLabels,
  className = "",
}: {
  lanes: TimelineLane[];
  events: TimelineEvent[];
  /** ISO start of the window. */
  from: string;
  /** ISO end of the window. */
  to: string;
  label: string;
  onSelect?: (key: string) => void;
  /** Label every Nth day; thinned further when labels would collide. */
  tickEvery?: number;
  /** Formats a day tick; pass a locale-aware formatter so "3 Aug" can be "3. Aug.". */
  tickFormat?: (d: Date) => string;
  /** The legend words for the three states, translated by the caller; English by default. */
  kindLabels?: Partial<Record<TimelineEvent["kind"], string>>;
  className?: string;
}) {
  const [active, setActive] = useState<string | null>(null);
  const [ref, width] = useMeasuredWidth<HTMLDivElement>();
  if (lanes.length === 0) return null;

  const t0 = new Date(from).getTime();
  const t1 = new Date(to).getTime();
  const span = Math.max(t1 - t0, DAY_MS);
  const days = Math.max(1, Math.ceil(span / DAY_MS));

  // Ticks: every `tickEvery` days, doubled until the labels fit the measured
  // width with a gap between them. Unknown width (first paint) keeps the ask.
  const sampleLabel = tickFormat(new Date(t0));
  const labelPx = monoWidth(sampleLabel, 10) + 10;
  let every = Math.max(1, tickEvery);
  if (width > 0) while ((days / every) * labelPx > width && every < days) every *= 2;
  const ticks: number[] = [];
  for (let d = 0; d < days; d += every) ticks.push(d);

  // Events grouped per lane and per day so same-day marks share a slot.
  const byLane = new Map<string, Map<number, TimelineEvent[]>>();
  for (const e of events) {
    const t = new Date(e.at).getTime();
    if (Number.isNaN(t) || t < t0 || t > t1) continue;
    const day = Math.min(days - 1, Math.floor((t - t0) / DAY_MS));
    const laneMap = byLane.get(e.lane) ?? new Map<number, TimelineEvent[]>();
    laneMap.set(day, [...(laneMap.get(day) ?? []), e]);
    byLane.set(e.lane, laneMap);
  }
  const hot = active !== null ? events.find((e) => e.key === active) ?? null : null;
  // Marks are 12px where a day slot can hold them and step down to the 8px
  // floor on a narrow card, where 30 twelve-pixel dots would fuse into a chain.
  const slotPx = width > 0 ? width / days : Infinity;
  const MARK = slotPx >= 16 ? 12 : 8;
  const HIT = 24;
  const laneLabelClass = "w-[5.5rem] shrink-0 truncate pr-3 t-label text-[var(--text-faint)]";
  const hasMeta = lanes.some((l) => l.meta);
  const laneMetaClass = "w-[4.5rem] shrink-0 pl-3 text-right fig text-[var(--text-muted)]";

  return (
    <div className={`flex flex-col gap-2 ${className}`} onMouseLeave={() => setActive(null)}>
      <FigureStrip text={hot?.readout ?? null}>
        <div className="flex flex-wrap gap-x-3 gap-y-1" aria-hidden>
          {(["ok", "failed", "running"] as const).map((k) => (
            <span key={k} className="flex items-center gap-1 t-label text-[var(--text-secondary)]">
              <EventMark kind={k} size={12} />
              {kindLabels?.[k] ?? KIND_LABEL[k]}
            </span>
          ))}
        </div>
      </FigureStrip>

      <div role="img" aria-label={label} className="flex flex-col">
        {lanes.map((lane) => {
          const laneMap = byLane.get(lane.key) ?? new Map<number, TimelineEvent[]>();
          return (
            <div key={lane.key} className="flex items-center" style={{ height: HIT + 8 }}>
              <span className={laneLabelClass}>{lane.label}</span>
              <div className="relative h-full min-w-0 flex-1">
                <span aria-hidden className="absolute left-0 right-0 top-1/2 h-px bg-[var(--divider)]" />
                {[...laneMap.entries()].map(([day, evs]) =>
                  evs.map((e, i) => {
                    // Same-day marks fan out 8px apart around the day's centre.
                    const offset = (i - (evs.length - 1) / 2) * (MARK - 4);
                    const on = active === e.key;
                    return (
                      <button
                        key={e.key}
                        type="button"
                        aria-label={e.readout}
                        onMouseEnter={() => setActive(e.key)}
                        onFocus={() => setActive(e.key)}
                        onBlur={() => setActive(null)}
                        onClick={onSelect ? () => onSelect(e.key) : undefined}
                        className={`absolute top-1/2 flex items-center justify-center rounded-full transition-transform duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${
                          onSelect ? "cursor-pointer" : "cursor-default"
                        }`}
                        style={{
                          width: HIT,
                          height: HIT,
                          left: `calc(${((day + 0.5) / days) * 100}% + ${offset}px)`,
                          transform: `translate(-50%, -50%) scale(${on ? 1.25 : 1})`,
                          zIndex: on ? 2 : 1,
                        }}
                      >
                        <EventMark kind={e.kind} size={MARK} />
                      </button>
                    );
                  }),
                )}
              </div>
              {hasMeta && <span className={laneMetaClass}>{lane.meta ?? ""}</span>}
            </div>
          );
        })}

        {/* Day ticks: small mono labels in text tokens, thinned to fit. */}
        <div className="flex items-start pt-1">
          <span className={laneLabelClass} aria-hidden />
          <div ref={ref} className="relative h-[16px] min-w-0 flex-1">
            {ticks.map((d) => (
              <span
                key={d}
                className="absolute top-0 whitespace-nowrap t-label text-[var(--text-faint)]"
                style={{
                  left: `${((d + 0.5) / days) * 100}%`,
                  transform: "translateX(-50%)",
                }}
              >
                {tickFormat(new Date(t0 + d * DAY_MS))}
              </span>
            ))}
          </div>
          {hasMeta && <span className={laneMetaClass} aria-hidden />}
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- Sparkline */

export type SparkPoint = { key: string; value: number; readout: string };

/**
 * A tiny single-series line: the trend beside a number, nothing more.
 *
 * No axes, no grid -- the shape is the message and the neighbouring figure is
 * the value. The last point carries the emphasis (an 8px marker with a surface
 * ring) because the newest reading is the one the eye should land on. Fewer
 * than two points renders nothing: a line through one dot is a lie, and what
 * to say instead ("n/a -- no history yet") is the caller's decision.
 *
 * Drawn at its real pixel size, not stretched, so the stroke stays 2px and the
 * marker stays round.
 */
export function Sparkline({
  points,
  label,
  width = 120,
  height = 32,
  yDomain,
  color = "var(--accent)",
  wash = true,
  className = "",
}: {
  points: SparkPoint[];
  label: string;
  width?: number;
  height?: number;
  /** Fixed y-range; defaults to [0, max]. */
  yDomain?: [number, number];
  color?: string;
  /** The ~10% area wash under the line. */
  wash?: boolean;
  className?: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  if (points.length < 2) return null;

  const PAD = 5;
  const lo = yDomain ? yDomain[0] : 0;
  const hi = yDomain ? yDomain[1] : Math.max(...points.map((p) => p.value), 1);
  const span = hi - lo || 1;
  const x = (i: number) => PAD + (i / (points.length - 1)) * (width - PAD * 2);
  const y = (v: number) => PAD + (1 - Math.max(0, Math.min(1, (v - lo) / span))) * (height - PAD * 2);
  const pts = points.map((p, i) => ({ px: x(i), py: y(p.value) }));
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.px} ${p.py}`).join(" ");
  const area = `${d} L ${pts[pts.length - 1].px} ${height - PAD} L ${pts[0].px} ${height - PAD} Z`;
  const last = pts[pts.length - 1];
  const hot = active !== null ? points[active] : null;

  return (
    <span
      className={`relative inline-block align-middle ${className}`}
      style={{ width, height }}
      onMouseLeave={() => setActive(null)}
    >
      {/* The readout floats above the figure; a 32px-tall chart has no room
          to reserve, and floating never reflows. */}
      <span className="pointer-events-none absolute bottom-full right-0 z-10 mb-1" aria-hidden>
        <span
          className={`block whitespace-nowrap rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface-raised)] px-2 py-0.5 fig text-[var(--text-primary)] card-elev-raised transition-opacity duration-100 ${
            hot ? "opacity-100" : "opacity-0"
          }`}
        >
          {hot?.readout ?? "\u00A0"}
        </span>
      </span>

      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="block">
        {wash && <path d={area} fill={color} fillOpacity="0.1" className="chart-fill-in" style={{ animationDuration: "0.3s", animationDelay: "0.3s" }} />}
        <path
          d={d}
          pathLength={1}
          className="chart-draw"
          style={{ animationDuration: "0.45s", animationDelay: "0.1s" }}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {hot && active !== points.length - 1 && (
          <circle cx={pts[active!].px} cy={pts[active!].py} r="4" fill={color} stroke="var(--surface)" strokeWidth="2" />
        )}
        <circle cx={last.px} cy={last.py} r="4" fill={color} stroke="var(--surface)" strokeWidth="2" />
      </svg>

      <span className="absolute inset-0 flex">
        {points.map((p, i) => (
          <button
            key={p.key}
            type="button"
            aria-label={p.readout}
            onMouseEnter={() => setActive(i)}
            onFocus={() => setActive(i)}
            onBlur={() => setActive(null)}
            className="h-full flex-1 cursor-default focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
          />
        ))}
      </span>
    </span>
  );
}

/* --------------------------------------------------------------------- Meter */

/**
 * A bounded ratio as a horizontal fill -- the four sub-scores in the hero.
 *
 * The fill carries the judgement in the tone token; the track is --border so
 * the unfilled remainder reads as "room", not as a second series. Six pixels
 * tall: it is a figure beside a label, not a bar chart. The caption is a lone
 * number, so it is set in the proportional face -- tabular digits at this
 * weight make "121" look loose.
 */
export function Meter({
  value,
  max,
  tone = "neutral",
  label,
  qualifier,
  caption,
  className = "",
}: {
  value: number;
  max: number;
  tone?: Tone;
  /** The visible name on the left, e.g. "Freshness". Also the figure's aria-label. */
  label: string;
  /** A muted mono qualifier after the label, e.g. the weight "30". */
  qualifier?: string;
  /** The value text on the right, e.g. "72" or "n/a". Defaults to `value`. */
  caption?: string;
  className?: string;
}) {
  const fraction = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const text = caption ?? String(value);
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="truncate t-body text-[var(--text-primary)]">{label}</span>
          {qualifier && (
            <span className="shrink-0 t-label text-[var(--text-faint)]">
              {qualifier}
            </span>
          )}
        </span>
        {/* Four meters stack in a column, so the scores align on tabular digits. */}
        <span className="shrink-0 fig-md text-[var(--text-primary)]">{text}</span>
      </div>
      <div
        role="img"
        aria-label={`${label}: ${text} of ${max}`}
        className="h-[6px] w-full overflow-hidden rounded-full bg-[var(--border)]"
      >
        <div
          className="bar-grow h-full rounded-full"
          style={{ width: `${fraction * 100}%`, background: toneColor(tone), ...barMotion(0) }}
        />
      </div>
    </div>
  );
}
