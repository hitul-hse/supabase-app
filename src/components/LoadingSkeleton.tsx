/**
 * Reusable loading skeleton primitives used by every loading.tsx in the app.
 * Matches the design tokens from globals.css so skeletons look like a
 * grey-out of the real page, not a generic spinner.
 */

/** A single rectangular shimmer block. */
export function SkeletonBlock({ className }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-[var(--radius-sm)] bg-[var(--surface-2)] ${className ?? ""}`}
    />
  );
}

/** A stat tile skeleton — matches the 5-column metric strip on the Overview page. */
export function SkeletonStatTile() {
  return (
    <div className="flex flex-col gap-2 p-3.5">
      <SkeletonBlock className="h-2.5 w-20" />
      <SkeletonBlock className="h-7 w-16" />
      <SkeletonBlock className="h-1 w-full" />
    </div>
  );
}

/** Skeleton for a full-width table row. */
export function SkeletonRow({ cols = 12 }: { cols?: number }) {
  return (
    <div className={`grid grid-cols-12 gap-3 px-4 py-2.5`}>
      {Array.from({ length: Math.min(cols, 5) }, (_, i) => (
        <SkeletonBlock
          key={i}
          className={`h-3 col-span-${[4, 2, 2, 2, 2][i] ?? 2}`}
        />
      ))}
    </div>
  );
}

/** Full page loading state — PageHeader skeleton + content area. */
export function PageLoadingSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="flex flex-col">
      {/* SyncBar placeholder */}
      <div className="h-9 border-b border-[var(--border)] bg-[var(--surface)] animate-pulse" />

      {/* PageHeader skeleton */}
      <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-3.5">
        <div className="flex flex-col gap-1.5">
          <SkeletonBlock className="h-2 w-24" />
          <SkeletonBlock className="h-5 w-40" />
          <SkeletonBlock className="h-2 w-32" />
        </div>
        <SkeletonBlock className="h-8 w-24" />
      </div>

      {/* Content skeleton */}
      <div className="flex flex-col gap-4 p-6">
        {/* Metric strip */}
        <div className="grid grid-cols-5 border border-[var(--border)] bg-[var(--surface)]">
          {Array.from({ length: 5 }, (_, i) => (
            <SkeletonStatTile key={i} />
          ))}
        </div>

        {/* Table skeleton */}
        <div className="border border-[var(--border)] bg-[var(--surface)]">
          <div className="h-9 border-b border-[var(--border)] bg-[var(--surface-2)] animate-pulse" />
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} className="border-b border-[var(--border)]">
              <SkeletonRow />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
