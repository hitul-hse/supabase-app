/*
 * The skeleton for /data-hygiene specifically.
 *
 * WHY THIS ROUTE NEEDS ITS OWN
 * ----------------------------
 * Paging is a server navigation: every PREV/NEXT click re-runs the page, so the
 * nearest loading boundary is shown fourteen times while somebody works through
 * one finding. Without this file that boundary is the group-level
 * `(app)/loading.tsx`, which renders a generic eight-row list — nothing like the
 * tile strip and two-column panel grid it stands in for, so every page turn
 * replaced the report with a differently-shaped placeholder and then jumped back.
 *
 * docs/UI-CONVENTIONS.md: "Loading skeletons mirror the card geometry they stand
 * in for, or the page visibly jumps when data arrives." The geometry below is
 * the page's own — four tiles, a scope strip, a filter row, and panels two
 * across from `lg` — so the layout holds still and only the content changes.
 *
 * Deliberately no row-level detail: a skeleton that draws ten fake table rows
 * invites reading them. Blocks in the right places are enough to keep the page
 * from moving.
 */
import { Card, CardHeader } from "@/components/ui/Card";
import { PageHeader } from "@/components/PageHeader";

const Bar = ({ className = "" }: { className?: string }) => (
  <div aria-hidden className={`animate-pulse rounded-sm bg-[var(--surface-2)] ${className}`} />
);

export default function Loading() {
  return (
    <>
      <PageHeader
        title="Data hygiene"
        meta="WHERE THE RECORDS DISAGREE WITH THEMSELVES · READ-ONLY · EXEC"
      />
      {/* One live region for the whole page. Announcing each block would be
          noise; announcing nothing leaves a screen-reader user with silence
          between clicking NEXT and the rows arriving. */}
      <div
        role="status"
        aria-live="polite"
        aria-busy="true"
        className="flex flex-col gap-[var(--card-gap)] px-4 py-4 sm:px-6"
      >
        <span className="sr-only">Loading the data hygiene report</span>

        <div className="grid grid-cols-2 gap-[var(--card-gap)] sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="card-elev flex flex-col gap-2 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-3.5"
            >
              <Bar className="h-2.5 w-2/3" />
              <Bar className="h-6 w-1/2" />
              <Bar className="h-2 w-full" />
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-4 border-y border-[var(--divider)] py-2">
          {[0, 1, 2, 3].map((i) => <Bar key={i} className="h-2.5 w-28" />)}
        </div>

        <div className="grid grid-cols-1 items-start gap-[var(--card-gap)] lg:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Card key={i} className="flex flex-col">
              <CardHeader title=" " />
              <div className="flex flex-col gap-2 px-4 pb-3">
                <Bar className="h-3 w-1/2" />
                <Bar className="h-2.5 w-full" />
                <Bar className="h-2.5 w-4/5" />
              </div>
              <div className="flex flex-col gap-1.5 border-t border-[var(--divider)] px-4 py-3">
                {[0, 1, 2, 3, 4].map((r) => <Bar key={r} className="h-3 w-full" />)}
              </div>
              <div className="border-t border-[var(--divider)] px-4 py-2">
                <Bar className="h-2.5 w-40" />
              </div>
            </Card>
          ))}
        </div>
      </div>
    </>
  );
}
