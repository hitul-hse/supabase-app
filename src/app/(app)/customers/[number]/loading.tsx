import { useTranslations } from "next-intl";
import { SkeletonBlock, SkeletonRow, SkeletonStatTile } from "@/components/LoadingSkeleton";

/**
 * The skeleton for /customers/[number] specifically.
 *
 * WHY THIS ROUTE NEEDS ITS OWN
 * ----------------------------
 * Without this file the nearest boundary is the group-level `(app)/loading.tsx`,
 * which draws a five-tile strip over an eight-row table — nothing like the hero
 * card, the two-card pair, the ledger and the three collapsed panels it would be
 * standing in for. docs/UI-CONVENTIONS.md: "Loading skeletons mirror the card
 * geometry they stand in for, or the page visibly jumps when data arrives." The
 * tiles here are FOUR and sit in the same `grid-cols-2 lg:contents` arrangement
 * as the real ones, so the strip does not reflow when the figures land.
 *
 * Deliberately no row-level detail beyond blocks: a skeleton that draws ten fake
 * table rows invites reading them.
 */
const Bar = ({ className = "" }: { className?: string }) => <SkeletonBlock className={className} />;

export default function Loading() {
  // The screen-reader announcement is COPY, so it comes from the catalogue like
  // every other string. A German literal here would read the page's one spoken
  // sentence in German to an English reader.
  const t = useTranslations("customer");
  return (
    <div className="flex flex-col">
      {/* PageHeader: title + meta left, the account chip right. */}
      <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--topbar)] px-4 py-3 sm:px-6">
        <div className="flex flex-col gap-1.5">
          <Bar className="h-5 w-56" />
          <Bar className="h-2.5 w-64" />
        </div>
        <div className="h-8 w-32 animate-pulse rounded-full bg-[var(--surface-2)]" />
      </div>

      <div
        role="status"
        aria-live="polite"
        aria-busy="true"
        className="flex flex-col gap-4 page-shell"
      >
        <span className="sr-only">{t("loading")}</span>

        {/* The hero card: identity block left, four tiles right. */}
        <div className="card-elev-raised rounded-[var(--radius-card)] border border-[var(--surface-accent-border)] bg-[var(--surface-accent)]">
          <div className="flex items-center gap-2.5 px-4 py-3">
            <Bar className="h-3.5 w-24" />
            <Bar className="h-2.5 w-40" />
          </div>
          <div aria-hidden className="h-px bg-[var(--divider)]" />
          <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1.2fr)_repeat(4,minmax(120px,1fr))]">
            <div className="flex flex-col gap-2">
              {[0, 1, 2, 3].map((i) => (
                <Bar key={i} className="h-3 w-full" />
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3 lg:contents">
              {[0, 1, 2, 3].map((i) => (
                <SkeletonStatTile key={i} />
              ))}
            </div>
          </div>
        </div>

        {/* Standorte and Ansprechpartner, two across from lg. */}
        <div className="grid gap-4 lg:grid-cols-2">
          {[0, 1].map((i) => (
            <CardSkeleton key={i} rows={3} />
          ))}
        </div>

        {/* The orders ledger. */}
        <div className="card-elev overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)]">
          <div className="flex items-center gap-2.5 border-b border-[var(--divider)] px-4 py-3">
            <Bar className="h-3.5 w-28" />
            <Bar className="h-2.5 w-32" />
          </div>
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="border-b border-[var(--divider)] last:border-b-0">
              <SkeletonRow />
            </div>
          ))}
        </div>

        {/* Betreuung and Links, then the master record. */}
        <div className="grid gap-4 lg:grid-cols-2">
          {[0, 1].map((i) => (
            <CardSkeleton key={i} rows={2} />
          ))}
        </div>
        <CardSkeleton rows={4} />
      </div>
    </div>
  );
}

/** One Card's geometry: header, divider, N content lines. */
function CardSkeleton({ rows }: { rows: number }) {
  return (
    <div className="card-elev rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex items-center gap-2.5 px-4 py-3">
        <Bar className="h-3.5 w-28" />
        <Bar className="h-2.5 w-20" />
      </div>
      <div aria-hidden className="h-px bg-[var(--divider)]" />
      <div className="flex flex-col gap-2 px-4 py-3">
        {Array.from({ length: rows }, (_, i) => (
          <Bar key={i} className="h-3 w-full" />
        ))}
      </div>
    </div>
  );
}
