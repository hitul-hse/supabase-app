import type { TimeTotals } from "@/lib/queries/time";
import { formatSeconds } from "@/lib/time-transform";
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
export function TimeTotalsStrip({ totals }: { totals: TimeTotals }) {
  return (
    /*
     * Four separate cards on the shared gap token, not a fused grid. These are
     * four independent facts; a shared border would claim they are columns of
     * one record.
     */
    <div className="grid grid-cols-2 gap-[var(--card-gap)] sm:grid-cols-4">
      <StatTile
        label="LOGGED"
        value={formatSeconds(totals.totalSeconds)}
        hint={`${totals.entryCount} ${totals.entryCount === 1 ? "entry" : "entries"}`}
      />
      <StatTile
        label="BILLABLE"
        value={formatSeconds(totals.billableSeconds)}
        // Null, not 0%, when nothing is logged: 0% billable of nothing is a
        // statement about the data that isn't true.
        hint={totals.billablePercent === null ? "—" : `${totals.billablePercent}% of logged`}
      />
      <StatTile
        label="CALENDAR"
        value={formatSeconds(totals.calendarSeconds)}
        hint="placeholders, excluded from work"
      />
      <StatTile
        label="DECIMAL"
        value={totals.totalHours.toFixed(2)}
        hint="hours, for invoicing"
      />
    </div>
  );
}
