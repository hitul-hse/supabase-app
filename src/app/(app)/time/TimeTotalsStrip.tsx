import type { TimeTotals } from "@/lib/queries/time";
import { formatSeconds } from "@/lib/time-transform";

/**
 * The totals strip.
 *
 * Calendar time is shown as its own figure rather than folded into the total.
 * The measurement behind that: 1,427 of 4,189 live events have neither customer
 * nor project and every one is a GHOST/calendar placeholder
 * (docs/architecture/DISCOVERY-trackingtime.md). Presenting those hours as
 * ordinary tracked work would inflate every utilisation number on the page.
 */
function Tile({
  label,
  value,
  sub,
  accent = false,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 border-r border-[var(--border)] px-4 py-3 last:border-r-0">
      <span className="font-mono text-[10px] tracking-[0.12em] text-[var(--text-faint)]">
        {label}
      </span>
      <span
        className={`font-mono text-[19px] font-semibold tabular-nums ${
          accent ? "text-[var(--accent)]" : "text-[var(--text-primary)]"
        }`}
      >
        {value}
      </span>
      {sub && <span className="text-[11px] text-[var(--text-muted)]">{sub}</span>}
    </div>
  );
}

export function TimeTotalsStrip({ totals }: { totals: TimeTotals }) {
  return (
    <div className="grid grid-cols-2 border border-[var(--border)] bg-[var(--surface)] sm:grid-cols-4">
      <Tile
        label="LOGGED"
        value={formatSeconds(totals.totalSeconds)}
        sub={`${totals.entryCount} ${totals.entryCount === 1 ? "entry" : "entries"}`}
      />
      <Tile
        label="BILLABLE"
        value={formatSeconds(totals.billableSeconds)}
        // Null, not 0%, when nothing is logged: 0% billable of nothing is a
        // statement about the data that isn't true.
        sub={totals.billablePercent === null ? "—" : `${totals.billablePercent}% of logged`}
        accent
      />
      <Tile
        label="CALENDAR"
        value={formatSeconds(totals.calendarSeconds)}
        sub="placeholders, excluded from work"
      />
      <Tile
        label="DECIMAL"
        value={totals.totalHours.toFixed(2)}
        sub="hours, for invoicing"
      />
    </div>
  );
}
