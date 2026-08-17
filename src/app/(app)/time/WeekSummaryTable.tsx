import type { WeekSummaryRow } from "@/lib/queries/time";
import { formatSeconds } from "@/lib/time-transform";

/**
 * Per-member weekly figures from `time.week_summary`.
 *
 * Reads the `security_invoker` view, so what appears here is exactly what RLS
 * permits: one row for a colleague, a department for a dept_head, everyone for
 * an exec. Deliberately shows no rates — `time.member_rate` is restricted to
 * exec and the member themselves, and a cost figure leaking into a team table
 * is the failure this module's RLS was written to prevent.
 */

/** Contracted hours are the honest denominator, not a 40-hour assumption. */
function Utilisation({ percent }: { percent: number | null }) {
  if (percent === null) {
    // No contracted hours on record. A dash is honest; "0%" would read as
    // "logged nothing against a full week".
    return <span className="font-mono text-[11.5px] text-[var(--text-faint)]">—</span>;
  }

  // Over 100% is real and worth seeing rather than clamping away: it means
  // someone logged more than their contract.
  const tone =
    percent > 100
      ? "text-[#fbbf24]"
      : percent >= 80
        ? "text-[var(--accent)]"
        : "text-[var(--text-secondary)]";

  return (
    <div className="flex items-center justify-end gap-2">
      <div className="hidden h-1 w-16 bg-[var(--border)] sm:block">
        <div
          className="h-full bg-current opacity-70"
          // The bar is capped so 130% cannot overflow its track, while the
          // number beside it still tells the truth.
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
      <span className={`font-mono text-[11.5px] tabular-nums ${tone}`}>{percent}%</span>
    </div>
  );
}

export function WeekSummaryTable({
  rows,
  weekStart,
}: {
  rows: WeekSummaryRow[];
  weekStart: string;
}) {
  return (
    <section className="border border-[var(--border)] bg-[var(--surface)]">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-2.5">
        <h2 className="text-[12.5px] font-medium text-[var(--text-primary)]">
          Week summary
        </h2>
        <span className="font-mono text-[10px] tracking-[0.12em] text-[var(--text-faint)]">
          WEEK OF {weekStart} · {rows.length} {rows.length === 1 ? "MEMBER" : "MEMBERS"}
        </span>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse">
          <thead>
            <tr className="border-b border-[var(--border)] text-left">
              {["Member", "Logged", "Billable", "Calendar", "Contracted", "Utilisation"].map(
                (h, i) => (
                  <th
                    key={h}
                    scope="col"
                    className={`px-4 py-2 font-mono text-[9.5px] tracking-[0.12em] text-[var(--text-faint)] ${
                      i === 0 ? "" : "text-right"
                    }`}
                  >
                    {h.toUpperCase()}
                  </th>
                ),
              )}
            </tr>
          </thead>

          <tbody>
            {rows.map((r) => (
              <tr
                key={r.memberId}
                className="border-b border-[var(--border)] transition-colors last:border-b-0 hover:bg-[var(--surface-hover)]"
              >
                <td className="px-4 py-2.5 text-[12.5px] text-[var(--text-primary)]">
                  {r.memberName}
                </td>
                <td className="px-4 py-2.5 text-right font-mono text-[12px] tabular-nums text-[var(--text-primary)]">
                  {formatSeconds(r.totalSeconds)}
                </td>
                <td className="px-4 py-2.5 text-right font-mono text-[12px] tabular-nums text-[var(--accent)]">
                  {formatSeconds(r.billableSeconds)}
                </td>
                <td className="px-4 py-2.5 text-right font-mono text-[12px] tabular-nums text-[var(--text-muted)]">
                  {formatSeconds(r.calendarSeconds)}
                </td>
                <td className="px-4 py-2.5 text-right font-mono text-[12px] tabular-nums text-[var(--text-secondary)]">
                  {formatSeconds(r.contractedSeconds)}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <Utilisation percent={r.utilisationPercent} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="border-t border-[var(--border)] px-4 py-2 text-[11px] leading-relaxed text-[var(--text-muted)]">
        Calendar time is shown separately because it is mostly synced placeholders
        rather than deliberate work, and folding it into the total would inflate
        every utilisation figure here.
      </p>
    </section>
  );
}
