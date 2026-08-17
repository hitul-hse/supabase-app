import { SkeletonBlock } from "@/components/LoadingSkeleton";

/**
 * Loading state for the TrackingTime Dashboard.
 *
 * WHY THIS ROUTE NEEDS ITS OWN, when the (app) group already has a loading.tsx:
 * the generic one draws a 5-tile strip and one table. This page is a 6-tile KPI
 * strip, a filter bar, a bar chart and four panels, and it is the SLOWEST page in
 * the product -- measured against the live database, 492ms for a month and up to
 * 3.3s for an all-time selection with calendar time included, because Postgres
 * evaluates the entry read policy per row (see the note in schema.sql). A skeleton
 * whose shape does not match what arrives makes that wait feel like a redraw: the
 * layout jumps when the real content lands.
 *
 * The proportions below deliberately mirror page.tsx -- 6 KPI tiles, a filter bar
 * of roughly the right height, a chart block, then one open table and three
 * collapsed headers, which is exactly what the page renders by default. The point
 * is that nothing MOVES when the data arrives; only the grey turns into numbers.
 */
export default function Loading() {
  return (
    <div className="flex flex-col">
      {/* PageHeader */}
      <div className="flex flex-col gap-1.5 border-b border-[var(--border)] px-4 py-3.5 sm:px-6">
        <SkeletonBlock className="h-2 w-40" />
        <SkeletonBlock className="h-4 w-64" />
        <SkeletonBlock className="h-2 w-52" />
      </div>

      <div className="flex flex-col gap-5 p-4 sm:p-6">
        {/* Filter bar: three rows of controls, same height as the real one. */}
        <div className="flex flex-col gap-3 border border-[var(--border)] bg-[var(--surface)] p-3">
          <div className="flex flex-wrap gap-2">
            <SkeletonBlock className="h-8 w-[26rem]" />
            <SkeletonBlock className="h-8 w-[15rem]" />
          </div>
          <div className="flex flex-wrap gap-2">
            {/* Four pickers, the billable segment, and the calendar toggle --
                the same six controls, at the same widths, as row 2 of the real
                filter bar. */}
            <SkeletonBlock className="h-8 w-[9rem]" />
            <SkeletonBlock className="h-8 w-[9rem]" />
            <SkeletonBlock className="h-8 w-[9rem]" />
            <SkeletonBlock className="h-8 w-[9rem]" />
            <SkeletonBlock className="h-8 w-[11rem]" />
            <SkeletonBlock className="h-8 w-[8rem]" />
          </div>
          <div className="flex flex-wrap gap-3 border-t border-[var(--border)] pt-3">
            <SkeletonBlock className="h-7 w-[19rem]" />
            <SkeletonBlock className="h-7 w-[12rem]" />
          </div>
        </div>

        {/* KPI strip — six tiles, the same grid as TotalsStrip. */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }, (_, i) => (
            <div
              key={i}
              className="flex flex-col gap-1.5 border border-[var(--border)] bg-[var(--surface)] px-4 py-3"
            >
              <SkeletonBlock className="h-2 w-16" />
              <SkeletonBlock className="h-6 w-20" />
              <SkeletonBlock className="h-2 w-14" />
            </div>
          ))}
        </div>

        {/* Trend chart. Bars of varying height rather than one flat block, so the
            shape reads as a chart and not as a missing panel. */}
        <div className="border border-[var(--border)] bg-[var(--surface)]">
          <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-2.5">
            <SkeletonBlock className="h-2 w-28" />
            <SkeletonBlock className="h-2 w-56" />
          </div>
          <div className="flex items-end gap-[3px] px-4 py-4" style={{ height: 168 }}>
            {Array.from({ length: 40 }, (_, i) => (
              <SkeletonBlock
                key={i}
                className="flex-1"
                // A fixed pseudo-random pattern: deterministic, so server and
                // client markup match and React does not warn about a hydration
                // mismatch on a decorative element.
                style={{ height: `${30 + ((i * 37) % 60)}%` }}
              />
            ))}
          </div>
        </div>

        {/* One open table… */}
        <div className="border border-[var(--border)] bg-[var(--surface)]">
          <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-2.5">
            <div className="flex flex-col gap-1">
              <SkeletonBlock className="h-2 w-24" />
              <SkeletonBlock className="h-2 w-44" />
            </div>
            <div className="flex gap-1.5">
              <SkeletonBlock className="h-6 w-[12rem]" />
              <SkeletonBlock className="h-6 w-24" />
            </div>
          </div>
          {Array.from({ length: 10 }, (_, i) => (
            <div
              key={i}
              className="grid grid-cols-12 items-center gap-3 border-b border-[var(--border)] px-4 py-3 last:border-0"
            >
              <SkeletonBlock className="col-span-4 h-3" />
              <SkeletonBlock className="col-span-2 h-3" />
              <SkeletonBlock className="col-span-2 h-3" />
              <SkeletonBlock className="col-span-1 h-3" />
              <SkeletonBlock className="col-span-1 h-3" />
              <SkeletonBlock className="col-span-2 h-1.5" />
            </div>
          ))}
        </div>

        {/* …and three collapsed panel headers, which is what the page ships. */}
        {Array.from({ length: 3 }, (_, i) => (
          <div
            key={i}
            className="flex flex-col gap-1 border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5"
          >
            <SkeletonBlock className="h-2 w-32" />
            <SkeletonBlock className="h-2 w-64" />
          </div>
        ))}
      </div>
    </div>
  );
}
