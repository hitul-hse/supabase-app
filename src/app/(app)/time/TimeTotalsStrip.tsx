import { getLocale, getTranslations } from "next-intl/server";
import type { TimeTotals } from "@/lib/queries/time";
import { formatSeconds } from "@/lib/time-transform";
import { fmtPct, tagFor } from "@/lib/locale-format";
import { StatTile } from "@/components/ui/Card";

/**
 * The totals strip.
 *
 * Calendar time is shown as its own figure rather than folded into the total.
 * The measurement behind that: 1,427 of 4,189 live events have neither customer
 * nor project and every one is a GHOST/calendar placeholder
 * (docs/architecture/DISCOVERY-trackingtime.md). Presenting those hours as
 * ordinary tracked work would inflate every utilisation number on the page.
 */
export async function TimeTotalsStrip({ totals }: { totals: TimeTotals }) {
  const t = await getTranslations("time.totals");
  const d = await getTranslations("drill");
  const locale = await getLocale();
  return (
    /*
     * Four separate cards on the shared gap token, not a fused grid. These are
     * four independent facts; a shared border would claim they are columns of
     * one record.
     */
    <div className="grid grid-cols-2 gap-[var(--card-gap)] sm:grid-cols-4">
      <StatTile
        label={t("logged")}
        value={formatSeconds(totals.totalSeconds)}
        hint={d("entries", { count: totals.entryCount })}
      />
      <StatTile
        label={t("billable")}
        value={formatSeconds(totals.billableSeconds)}
        // Null, not 0%, when nothing is logged: 0% billable of nothing is a
        // statement about the data that isn't true.
        hint={
          totals.billablePercent === null
            ? "—"
            : t("billableHint", { percent: fmtPct(totals.billablePercent, locale) })
        }
      />
      <StatTile
        label={t("calendar")}
        value={formatSeconds(totals.calendarSeconds)}
        hint={t("calendarHint")}
      />
      <StatTile
        label={t("decimal")}
        /* Two decimals ALWAYS and no thousands separator, which is what
           toFixed(2) gave before: this is the figure people paste into an
           invoice, so "7.50" must not collapse to "7.5" and "1234.50" must not
           acquire a comma. Only the DECIMAL MARK follows the locale, so German
           reads 1234,50. */
        value={totals.totalHours.toLocaleString(tagFor(locale), {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
          useGrouping: false,
        })}
        hint={t("decimalHint")}
      />
    </div>
  );
}
