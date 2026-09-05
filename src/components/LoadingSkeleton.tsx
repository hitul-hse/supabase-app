/**
 * Reusable loading skeleton primitives used by every loading.tsx in the app.
 * Matches the design tokens from globals.css so skeletons look like a
 * grey-out of the real page, not a generic spinner.
 */

/** A single rectangular shimmer block. */
export function SkeletonBlock({
  className,
  style,
}: {
  className?: string;
  /**
   * For dimensions Tailwind cannot express as a class, such as the varying bar
   * heights in the dashboard's chart skeleton. Kept to `style` rather than
   * generating arbitrary-value classes, because those must exist at build time
   * and a computed one silently produces no CSS.
   */
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={`animate-pulse rounded-[var(--radius-sm)] bg-[var(--surface-2)] ${className ?? ""}`}
      style={style}
    />
  );
}

/** A stat tile skeleton — mirrors StatTile's rounded card geometry. */
export function SkeletonStatTile() {
  return (
    // card-elev mirrors StatTile's own elevation so skeleton geometry matches;
    // without it the tile appears flat until data arrives.
    <div className="card-elev flex flex-col gap-2 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-3">
      <SkeletonBlock className="h-2.5 w-20" />
      <SkeletonBlock className="h-7 w-16" />
      <SkeletonBlock className="h-1 w-full" />
    </div>
  );
}

/** Skeleton for a full-width table row. */
export function SkeletonRow({ cols = 12 }: { cols?: number }) {
  return (
    <div className="grid grid-cols-12 gap-3 px-4 py-2">
      {Array.from({ length: Math.min(cols, 5) }, (_, i) => (
        <SkeletonBlock
          key={i}
          className={`h-3 col-span-${[4, 2, 2, 2, 2][i] ?? 2}`}
        />
      ))}
    </div>
  );
}

/**
 * Full page loading state — PageHeader skeleton + content area.
 *
 * MIRRORS THE REAL GEOMETRY, or the page jumps when data lands
 * (UI-CONVENTIONS: "Loading skeletons mirror the card geometry they stand in
 * for"). Measured against PageHeader: 70px tall at desktop, a two-line title
 * block on the left and the 32px account chip on the right. The old skeleton
 * drew a 36px SyncBar ghost above it (a bar that no longer exists), a three-
 * line header whose first line was the banned eyebrow, and a --surface-2 band
 * as the table header -- so the real page landed 46px higher with a lighter
 * header than the ghost promised.
 */
export function PageLoadingSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="flex flex-col">
      {/* PageHeader: title + meta left, chrome right. */}
      <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--topbar)] px-4 py-3 sm:px-6">
        <div className="flex flex-col gap-1.5">
          <SkeletonBlock className="h-5 w-40" />
          <SkeletonBlock className="h-2.5 w-32" />
        </div>
        <div className="h-8 w-32 animate-pulse rounded-full bg-[var(--surface-2)]" />
      </div>

      {/* Content: the page shell's own padding and the 16px block gap. */}
      <div className="flex flex-col gap-4 page-shell">
        {/* Metric strip: separate tiles on --card-gap, the same breakpoints as
            the real strips (2 / 3 / 5 across). */}
        <div className="grid grid-cols-2 gap-[var(--card-gap)] sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }, (_, i) => (
            <SkeletonStatTile key={i} />
          ))}
        </div>

        {/* Table card: a CardHeader-height header on --surface with a
            --divider under it, then rows at the real 30px pitch. */}
        <div className="card-elev overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)]">
          <div className="flex items-center gap-2.5 border-b border-[var(--divider)] px-4 py-3">
            <SkeletonBlock className="h-3.5 w-28" />
            <SkeletonBlock className="h-2.5 w-20" />
          </div>
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} className="border-b border-[var(--divider)] last:border-b-0">
              <SkeletonRow />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
