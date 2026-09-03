"use client";

/**
 * The dashboard's billable-split donut, beside the trend.
 *
 * The TotalsStrip states 84% as text; the donut is the same fact as a shape, which is
 * what the reference dashboards do -- the number for reading, the ring for glancing.
 * The two links under it are the SAME drill-downs the strip's tiles carry, so the donut
 * is an entry point rather than a decoration.
 *
 * Every figure is formatted for the REQUEST LOCALE (see @/lib/locale-format): en
 * keeps en-GB exactly as before, de gets "5.638,4 Std" and "84 %".
 */

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Donut, LegendDot } from "@/components/ui/Charts";
import { fmtHours, fmtPct } from "@/lib/locale-format";
import type { Totals } from "@/lib/queries/trackingtime-report";

export function BillableDonut({
  totals,
  billableHref,
  nonBillableHref,
}: {
  totals: Totals;
  billableHref: string;
  nonBillableHref: string;
}) {
  const t = useTranslations("timeDashboard.donut");
  const locale = useLocale();
  const hrs = (seconds: number) => fmtHours(seconds / 3600, locale);

  if (totals.totalSeconds <= 0 || totals.billablePercent === null) return null;

  const percent = fmtPct(totals.billablePercent, locale);

  return (
    <section className="flex flex-col rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] card-elev">
      <header className="flex items-baseline justify-between border-b border-[var(--divider)] px-4 py-2.5">
        <h2 className="font-mono text-[10px] font-semibold tracking-[0.14em] text-[var(--text-primary)]">
          {t("title")}
        </h2>
        <span className="text-[10px] text-[var(--text-faint)]">{t("hint")}</span>
      </header>

      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 pt-4 pb-2">
        <Donut
          slices={[
            { label: t("billable"), value: totals.billableSeconds, color: "var(--accent)" },
            { label: t("nonBillable"), value: totals.nonBillableSeconds, color: "var(--text-faint)" },
          ]}
          centre={percent}
          centreLabel={t("centreLabel")}
          size={132}
          label={t("aria", { percent, hours: hrs(totals.totalSeconds) })}
        />
        <div className="flex flex-col gap-1.5">
          <Link href={billableHref} className="transition-opacity hover:opacity-80">
            <LegendDot color="var(--accent)">
              {t("legendBillable", { hours: hrs(totals.billableSeconds) })}
            </LegendDot>
          </Link>
          <Link href={nonBillableHref} className="transition-opacity hover:opacity-80">
            <LegendDot color="var(--text-faint)">
              {t("legendNonBillable", { hours: hrs(totals.nonBillableSeconds) })}
            </LegendDot>
          </Link>
        </div>
      </div>
      {/*
        This panel is not a Card, so it cannot use ChartNote; the classes below
        match ChartNote's so the two read identically wherever a reader meets
        them. The point worth stating is the flag's provenance: billable is a
        property TrackingTime carries on each entry, not something this app
        infers, so a wrong split is corrected there rather than here.
      */}
      <p className="px-4 pb-3 text-[10px] leading-[1.45] text-[var(--text-faint)]">
        {t("note")}
      </p>
    </section>
  );
}
