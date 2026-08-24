"use client";

/**
 * The dashboard's billable-split donut, beside the trend.
 *
 * The TotalsStrip states 84% as text; the donut is the same fact as a shape, which is
 * what the reference dashboards do -- the number for reading, the ring for glancing.
 * The two links under it are the SAME drill-downs the strip's tiles carry, so the donut
 * is an entry point rather than a decoration.
 */

import Link from "next/link";
import { Donut, LegendDot } from "@/components/ui/Charts";
import type { Totals } from "@/lib/queries/trackingtime-report";

function hrs(seconds: number): string {
  return `${(seconds / 3600).toLocaleString("en-GB", { maximumFractionDigits: 1 })}h`;
}

export function BillableDonut({
  totals,
  billableHref,
  nonBillableHref,
}: {
  totals: Totals;
  billableHref: string;
  nonBillableHref: string;
}) {
  if (totals.totalSeconds <= 0 || totals.billablePercent === null) return null;

  return (
    <section className="flex flex-col rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] card-elev">
      <header className="flex items-baseline justify-between border-b border-[var(--divider)] px-4 py-2.5">
        <h2 className="font-mono text-[10px] font-semibold tracking-[0.14em] text-[var(--text-primary)]">
          BILLABLE SPLIT
        </h2>
        <span className="text-[10px] text-[var(--text-faint)]">click a share to filter</span>
      </header>

      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-4">
        <Donut
          slices={[
            { label: "Billable", value: totals.billableSeconds, color: "var(--accent)" },
            { label: "Non-billable", value: totals.nonBillableSeconds, color: "var(--text-faint)" },
          ]}
          centre={`${totals.billablePercent}%`}
          centreLabel="billable"
          size={132}
          label={`Billable split: ${totals.billablePercent}% of ${hrs(totals.totalSeconds)} billable`}
        />
        <div className="flex flex-col gap-1.5">
          <Link href={billableHref} className="transition-opacity hover:opacity-80">
            <LegendDot color="var(--accent)">{hrs(totals.billableSeconds)} BILLABLE</LegendDot>
          </Link>
          <Link href={nonBillableHref} className="transition-opacity hover:opacity-80">
            <LegendDot color="var(--text-faint)">{hrs(totals.nonBillableSeconds)} NON-BILLABLE</LegendDot>
          </Link>
        </div>
      </div>
    </section>
  );
}
