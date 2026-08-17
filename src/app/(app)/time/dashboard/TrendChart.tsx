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

function hrs(h: number): string {
  return `${h.toLocaleString("en-GB", { maximumFractionDigits: 1 })}h`;
}

function label(isoDay: string, bucket: string): string {
  const d = new Date(`${isoDay}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return isoDay;
  if (bucket === "month") {
    return d.toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });
  }
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
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
            {label(hot.bucket, bucket)} ·{" "}
            <span className="text-[var(--accent)]">{hrs(hot.billableHours)} billable</span> of{" "}
            {hrs(hot.totalHours)} · {hot.entryCount} {hot.entryCount === 1 ? "entry" : "entries"}
          </span>
        ) : (
          <span className="text-[10.5px] text-[var(--text-faint)]">
            {shown.length === points.length
              ? `${points.length} ${points.length === 1 ? "bucket" : "buckets"}`
              : `last ${shown.length} of ${points.length} buckets`}{" "}
            · solid = billable · hover a bar{hrefFor ? " · click to filter to it" : ""}
          </span>
        )}
      </header>

      <div
        className="flex items-end gap-[3px] overflow-x-auto px-4 py-4"
        style={{ height: 168 }}
        onMouseLeave={() => setActive(null)}
      >
        {shown.map((p) => {
          const h = (p.totalSeconds / max) * 100;
          const billShare = p.totalSeconds > 0 ? (p.billableSeconds / p.totalSeconds) * 100 : 0;
          const on = active === p.bucket;
          const href = hrefFor?.[p.bucket] ?? null;

          const bar = (
            <span
              className="flex h-full w-full flex-col justify-end"
              // A one-line accessible description per bar. A bar chart is
              // otherwise silent to a screen reader.
              aria-label={`${label(p.bucket, bucket)}: ${hrs(p.totalHours)} total, ${hrs(p.billableHours)} billable, ${p.entryCount} entries`}
            >
              <span
                className="relative block w-full transition-[background-color,filter] duration-150"
                style={{
                  height: `${Math.max(h, 1.5)}%`,
                  background: on ? "var(--border-strong)" : "var(--border)",
                }}
              >
                <span
                  className="absolute bottom-0 left-0 block w-full transition-[background-color] duration-150"
                  style={{
                    height: `${billShare}%`,
                    background: on ? "var(--accent-hover)" : "var(--accent)",
                  }}
                />
              </span>
            </span>
          );

          const shared = {
            onMouseEnter: () => setActive(p.bucket),
            onFocus: () => setActive(p.bucket),
            onBlur: () => setActive(null),
            className:
              "group flex min-w-[7px] flex-1 items-end focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]",
            style: { height: "100%" },
          };

          return href ? (
            <Link key={p.bucket} href={href} scroll={false} {...shared}>
              {bar}
            </Link>
          ) : (
            <button key={p.bucket} type="button" {...shared}>
              {bar}
            </button>
          );
        })}
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
