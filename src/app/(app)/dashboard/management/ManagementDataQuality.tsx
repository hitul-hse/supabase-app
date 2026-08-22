import { Card, CardHeader } from "@/components/ui/Card";
import type { ManagementDataQualityRow } from "@/lib/queries/management-data-quality";

export function ManagementDataQuality({ rows }: { rows: ManagementDataQualityRow[] }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader title="Data Quality" qualifier="OPERATIVE STEUERBARKEIT · READ MODEL" />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-left text-[12px]">
          <thead className="bg-[var(--surface-2)] font-mono text-[10px] tracking-[0.08em] text-[var(--text-faint)]">
            <tr>
              <th className="px-4 py-3 font-medium">PRÜFUNG</th>
              <th className="px-4 py-3 text-right font-medium">ANZAHL</th>
              <th className="px-4 py-3 font-medium">BEWERTUNG</th>
              <th className="px-4 py-3 font-medium">BEDEUTUNG</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const ratingClass = row.rating === "Kritisch"
                ? "bg-[var(--critical-wash)] text-[var(--critical)]"
                : "bg-[var(--warning-wash)] text-[var(--warning)]";
              return (
                <tr key={row.check} className="border-t border-[var(--divider)]">
                  <th className="px-4 py-3 font-medium text-[var(--text-primary)]">{row.check}</th>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-[var(--text-secondary)]">
                    {row.count === null ? "n/a" : row.count}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-medium ${ratingClass}`}>
                      {row.rating}
                    </span>
                  </td>
                  <td className="max-w-[420px] px-4 py-3 text-[var(--text-muted)]">{row.meaning}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="border-t border-[var(--divider)] px-4 py-3 text-[11px] leading-relaxed text-[var(--text-muted)]">
        n/a bedeutet, dass die zugrunde liegende bestätigte Relation im aktuellen Read Model nicht verfügbar ist; es wird kein Wert geschätzt.
      </p>
    </Card>
  );
}
