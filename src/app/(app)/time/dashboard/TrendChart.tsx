"use client";
/**
 * The trend chart, as an interactive figure.
 *
 * WHY THIS IS A CLIENT COMPONENT while everything else that can be stayed on the
 * server: the previous version put the facts in a `title` attribute, which is a
 * native tooltip — it takes about a second to appear, cannot be triggered from
 * the keyboard, and never shows on touch. On a chart whose bars are eight pixels
 * wide, the tooltip IS the chart; the bars alone only show shape. So it now
 * tracks hover and focus itself and renders the readout in the panel header,
 * where it does not cover the bars it describes.
 *
 * Clicking a bar narrows the report to that bucket, which is the question a
 * spike immediately raises: "what happened that week?"
 */
import Link from "next/link";
import { useState } from "react";
import type { TrendPoint } from "@/lib/queries/trackingtime-report";
import { isoWeekNumber } from "@/lib/time-transform";

function hrs(h: number): string {
  return `${h.toLocaleString("en-GB", { maximumFractionDigits: 1 })}h`;
}

function label(isoDay: string, bucket: string): string {
  const d = new Date(`${isoDay}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return isoDay;
  if (bucket === "month") {
    return d.toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });
  }
  if (bucket === "week") {
    // The calendar week, because that is the unit this business plans in --
    // "CW 34" is what appears in the emails these hours get discussed in, while
    // "17 Aug" has to be converted in the reader's head every time.
    return `CW ${isoWeekNumber(d)}`;
  }
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

/**
 * The same label, plus the date the week starts on.
 *
 * A bare week number is ambiguous the moment a range crosses a year -- CW 1
 * appears twice in a 13-month selection and the two bars look identical. The
 * axis has room for three short labels and uses the compact form; the hover
 * readout and the screen-reader description have room for both, and those are
 * the two places a reader is asking "which week exactly?".
 */
function labelWithDate(isoDay: string, bucket: string): string {
  if (bucket !== "week") return label(isoDay, bucket);
  const d = new Date(`${isoDay}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return isoDay;
  const day = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  return `${label(isoDay, bucket)} · from ${day}`;
}

export function TrendChart({
  points,
  bucket,
  hrefFor,
}: {
  points: TrendPoint[];
  bucket: string;
  /**
   * Drill-down target per bucket start, e.g. { "2026-08-10": "/time/dashboard?…" }.
   *
   * A RECORD rather than a callback, because this is a Client Component and a
   * function cannot cross that boundary -- React refuses with "Functions cannot
   * be passed directly to Client Components", which surfaces as the page's error
   * boundary rather than as a type error. Only the server knows the rest of the
   * filter state, so it precomputes the links; buckets absent from the record
   * simply do not link.
   */
  hrefFor?: Record<string, string>;
}) {
  const [active, setActive] = useState<string | null>(null);

  if (points.length === 0) return null;

  const bucketLabel = bucket === "day" ? "DAILY" : bucket === "month" ? "MONTHLY" : "WEEKLY";

  // The most RECENT window, because that is what a reader scanning a trend
  // cares about. Beyond ~90 bars each is a sliver and the axis labels collide.
  const WINDOW = 90;
  const shown = points.slice(-WINDOW);
  // Scale to the SHOWN bars, not to every point. Scaling to an off-screen
  // all-time peak would flatten a visible range into a row of stubs and hide
  // exactly the variation the chart exists to show.
  const max = Math.max(...shown.map((p) => p.totalSeconds), 1);

  const hot = active ? shown.find((p) => p.bucket === active) : undefined;
  const peak = shown.reduce((a, b) => (b.totalSeconds > a.totalSeconds ? b : a), shown[0]);

  return (
    <section className="border border-[var(--border)] bg-[var(--surface)]">
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-[var(--border)] px-4 py-2.5">
        <h2 className="font-mono text-[10px] font-semibold tracking-[0.14em] text-[var(--text-primary)]">
          {bucketLabel} TREND
        </h2>
        {/* The readout replaces the hint in place rather than appearing beside
            it, so the header never reflows and the bars never shift under the
            cursor mid-hover. */}
        {hot ? (
          <span className="font-mono text-[10.5px] tabular-nums text-[var(--text-primary)]">
            {labelWithDate(hot.bucket, bucket)} ·{" "}
            <span className="text-[var(--accent)]">{hrs(hot.billableHours)} billable</span> of{" "}
            {hrs(hot.totalHours)} · {hot.entryCount} {hot.entryCount === 1 ? "entry" : "entries"}
          </span>
        ) : (
          <span className="text-[10.5px] text-[var(--text-faint)]">
            {shown.length === points.length
              ? `${points.length} ${points.length === 1 ? "bucket" : "buckets"}`
              : `last ${shown.length} of ${points.length} buckets`}{" "}
            · solid = billable · dashed = total · hover the line{hrefFor ? " · click to filter to it" : ""}
          </span>
        )}
      </header>

      {/*
        The figure. An AREA, not bars.

        Bars were right for 90 daily buckets and wrong for 4 weekly ones: at four buckets
        each bar became a quarter-screen slab and the card read as a rendering mistake --
        which is how it was reported. A smooth area with a gradient reads correctly at any
        bucket count, and it is the reference design's shape for exactly this figure.

        The billable series is drawn as the solid line and fill; total hours are the
        dashed line above it, so the gap between the two IS the non-billable share.
        Everything interactive is unchanged: hover/focus feeds the header readout, and a
        click filters the report to that bucket.
      */}
      <div
        className="relative px-4 py-4"
        style={{ height: 188 }}
        onMouseLeave={() => setActive(null)}
      >
        {(() => {
          const W = 1000;
          const H = 300;
          const PAD_TOP = 14;
          const PAD_BOTTOM = 4;
          const x = (i: number) =>
            shown.length === 1 ? W / 2 : (i / (shown.length - 1)) * W;
          const y = (v: number) => PAD_TOP + (1 - v / max) * (H - PAD_TOP - PAD_BOTTOM);

          const spline = (values: number[]) => {
            const pts = values.map((v, i) => ({ px: x(i), py: y(v) }));
            if (pts.length === 1) {
              // A single bucket has no trend; draw a flat line through it so the
              // figure still shows the level rather than nothing.
              return `M 0 ${pts[0].py} L ${W} ${pts[0].py}`;
            }
            let d = `M ${pts[0].px} ${pts[0].py}`;
            for (let i = 0; i < pts.length - 1; i += 1) {
              const p0 = pts[i - 1] ?? pts[i];
              const p1 = pts[i];
              const p2 = pts[i + 1];
              const p3 = pts[i + 2] ?? p2;
              d += ` C ${p1.px + (p2.px - p0.px) / 6} ${p1.py + (p2.py - p0.py) / 6}, ${p2.px - (p3.px - p1.px) / 6} ${p2.py - (p3.py - p1.py) / 6}, ${p2.px} ${p2.py}`;
            }
            return d;
          };

          const billPath = spline(shown.map((p) => p.billableSeconds));
          const totalPath = spline(shown.map((p) => p.totalSeconds));
          const area = `${billPath} L ${W} ${H} L 0 ${H} Z`;
          const activeIndex = active ? shown.findIndex((p) => p.bucket === active) : -1;

          return (
            <svg
              viewBox={`0 0 ${W} ${H}`}
              preserveAspectRatio="none"
              className="h-full w-full"
              role="img"
              aria-label={`${bucketLabel.toLowerCase()} trend, ${shown.length} buckets: billable and total hours over time`}
            >
              <defs>
                <linearGradient id="tt-trend-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.26" />
                  <stop offset="60%" stopColor="var(--accent)" stopOpacity="0.07" />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
                </linearGradient>
              </defs>

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
                    vectorEffect="non-scaling-stroke"
                  />
                );
              })}

              <path d={area} fill="url(#tt-trend-fill)" />
              {/* Total: the quieter dashed line. It sits above billable by
                  construction, and the gap between them is the non-billable share. */}
              <path
                d={totalPath}
                fill="none"
                stroke="var(--text-faint)"
                strokeWidth="1.5"
                strokeDasharray="4 4"
                vectorEffect="non-scaling-stroke"
              />
              <path
                d={billPath}
                fill="none"
                stroke="var(--accent)"
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
                strokeLinejoin="round"
                strokeLinecap="round"
              />

              {activeIndex >= 0 && (
                <>
                  <line
                    x1={x(activeIndex)}
                    x2={x(activeIndex)}
                    y1={0}
                    y2={H}
                    stroke="var(--text-faint)"
                    strokeOpacity="0.6"
                    strokeDasharray="3 3"
                    vectorEffect="non-scaling-stroke"
                  />
                  <circle
                    cx={x(activeIndex)}
                    cy={y(shown[activeIndex].billableSeconds)}
                    r="5"
                    fill="var(--accent)"
                    stroke="var(--surface)"
                    strokeWidth="2"
                    vectorEffect="non-scaling-stroke"
                  />
                </>
              )}
            </svg>
          );
        })()}

        {/*
          Hit targets over the figure: one per bucket, focusable, linking to the
          filtered report exactly as the bars did. The chart stays one image to a
          screen reader; the targets carry the per-bucket names.
        */}
        <div className="absolute inset-0 flex px-4 py-4">
          {shown.map((p) => {
            const on = active === p.bucket;
            const href = hrefFor?.[p.bucket] ?? null;
            const shared = {
              onMouseEnter: () => setActive(p.bucket),
              onFocus: () => setActive(p.bucket),
              onBlur: () => setActive(null),
              "aria-label": `${labelWithDate(p.bucket, bucket)}: ${hrs(p.totalHours)} total, ${hrs(p.billableHours)} billable, ${p.entryCount} entries`,
              className: `h-full flex-1 ${on ? "" : ""}cursor-default focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]`,
            };
            return href ? (
              <Link key={p.bucket} href={href} scroll={false} {...shared} />
            ) : (
              <button key={p.bucket} type="button" {...shared} />
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-[var(--border)] px-4 py-1.5 font-mono text-[9.5px] text-[var(--text-faint)]">
        <span>{label(shown[0].bucket, bucket)}</span>
        <span>
          peak {label(peak.bucket, bucket)} · {hrs(peak.totalHours)}
        </span>
        <span>{label(shown[shown.length - 1].bucket, bucket)}</span>
      </div>
    </section>
  );
}
