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

import { useId, useState, useSyncExternalStore } from "react";

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
}: {
  points: AreaPoint[];
  /** Description of the whole figure for assistive tech. */
  label: string;
  /** Fixed y-range, e.g. [0, 100] for percentages. Defaults to [0, max]. */
  yDomain?: [number, number];
  className?: string;
  showDots?: boolean;
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
          className={`rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface-2)] px-2 py-1 font-mono text-[10px] tabular-nums text-[var(--text-primary)] shadow-lg transition-opacity duration-100 ${
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

        <path d={area} fill={`url(#${gradientId})`} />
        <path
          d={d}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

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
            className="h-full flex-1 cursor-default focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
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
          <span className="font-mono text-[22px] font-semibold leading-none tracking-tight text-[var(--text-primary)]">
            {centre}
          </span>
          {centreLabel && (
            <span className="mt-1 font-mono text-[9.5px] uppercase tracking-[0.1em] text-[var(--text-faint)]">
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
  color = "var(--accent)",
  centre,
  centreLabel,
  label,
  width = 168,
}: {
  value: number;
  max: number;
  color?: string;
  /** Text in the middle; defaults to the value. */
  centre?: string;
  centreLabel?: string;
  label: string;
  width?: number;
}) {
  const thickness = 12;
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
            stroke={color}
            strokeWidth={thickness}
            strokeLinecap="round"
            strokeDasharray={`${fraction * semi} ${semi}`}
          />
          <circle cx={dotX} cy={dotY} r={thickness / 2 + 2} fill="var(--surface)" stroke={color} strokeWidth="3" />
        </svg>
        <div className="absolute inset-x-0 bottom-0 flex flex-col items-center">
          <span className="font-mono text-[24px] font-semibold leading-none tracking-tight text-[var(--text-primary)]">
            {centre ?? String(value)}
            <span className="text-[13px] font-normal text-[var(--text-faint)]">/{max}</span>
          </span>
          {centreLabel && (
            <span className="mt-1 font-mono text-[9.5px] uppercase tracking-[0.1em] text-[var(--text-faint)]">
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
    <span className="flex items-center gap-1.5 font-mono text-[10px] text-[var(--text-secondary)]">
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
}: {
  points: AreaPoint[];
  label: string;
  yDomain?: [number, number];
  className?: string;
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
          className={`rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface-2)] px-2 py-1 font-mono text-[10px] tabular-nums text-[var(--text-primary)] shadow-lg transition-opacity duration-100 ${
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
              className="flex h-full flex-1 cursor-default items-end focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
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
}: {
  /** Stable per-figure key for the persisted preference, e.g. "overview-hero". */
  id: string;
  points: AreaPoint[];
  label: string;
  yDomain?: [number, number];
  defaultKind?: "area" | "bars";
  className?: string;
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
            className={`rounded-full px-2 py-0.5 font-mono text-[9px] tracking-[0.08em] transition-colors ${
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
        <BarTrend points={points} label={label} yDomain={yDomain} />
      ) : (
        <AreaTrend points={points} label={label} yDomain={yDomain} />
      )}
    </div>
  );
}
