import { getLocale, getTranslations } from "next-intl/server";
import type { WeekSummaryRow } from "@/lib/queries/time";
import { formatSeconds } from "@/lib/time-transform";
import { fmtPct } from "@/lib/locale-format";
import { Card } from "@/components/ui/Card";

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
function Utilisation({ percent, locale }: { percent: number | null; locale: string }) {
  if (percent === null) {
    // No contracted hours on record. A dash is honest; "0%" would read as
    // "logged nothing against a full week".
    return <span className="font-mono text-[11px] text-[var(--text-faint)]">—</span>;
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
      <span className={`font-mono text-[11px] tabular-nums ${tone}`}>
        {fmtPct(percent, locale)}
      </span>
    </div>
  );
}

export async function WeekSummaryTable({
  rows,
  weekStart,
}: {
  rows: WeekSummaryRow[];
  weekStart: string;
}) {
  const t = await getTranslations("time.weekSummary");
  const locale = await getLocale();
  // The column order is the reading order and does not change with the
  // language; only the words do. `contracted` and `utilisation` deliberately
  // resolve to Management's canonical German (VERTRAGSSTUNDEN, AUSLASTUNG).
  const COLUMNS = ["member", "logged", "billable", "calendar", "contracted", "utilisation"];
  return (
    <Card as="section" className="overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--divider)] px-4 py-2.5">
        <h2 className="text-[12px] font-medium text-[var(--text-primary)]">{t("title")}</h2>
        <span className="font-mono text-[10px] tracking-[0.12em] text-[var(--text-faint)]">
          {/* The week is its ISO Monday, which is an identifier rather than a
              date a reader parses -- it is what the ?week= parameter carries,
              so it stays ISO in both languages. */}
          {t("meta", { week: weekStart, count: rows.length })}
        </span>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse">
          <thead>
            <tr className="border-b border-[var(--divider)] text-left">
              {COLUMNS.map((key, i) => (
                <th
                  key={key}
                  scope="col"
                  className={`px-4 py-2 font-mono text-[10px] tracking-[0.12em] text-[var(--text-faint)] ${
                    i === 0 ? "" : "text-right"
                  }`}
                >
                  {t(key).toUpperCase()}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {rows.map((r) => (
              <tr
                key={r.memberId}
                className="border-b border-[var(--divider)] transition-colors last:border-b-0 hover:bg-[var(--surface-hover)]"
              >
                <td className="px-4 py-2.5 text-[12px] text-[var(--text-primary)]">
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
                  <Utilisation percent={r.utilisationPercent} locale={locale} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="border-t border-[var(--divider)] px-4 py-2 text-[11px] leading-relaxed text-[var(--text-muted)]">
        {t("note")}
      </p>
    </Card>
  );
}
