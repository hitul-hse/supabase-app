import { Card, CardHeader } from "@/components/ui/Card";
import { MULTI_SERVICE_COLUMNS, type ManagementMultiServiceMatrix } from "@/lib/queries/management-multi-service-matrix.types";

const fmt = (value: number) => new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(value);

export function ManagementMultiServiceMatrix({ model }: { model: ManagementMultiServiceMatrix }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader title="Multi-Service Matrix" qualifier="KUNDEN / LEGAL ENTITIES × AKTIVE SERVICES" />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1180px] border-collapse text-left text-[12px]">
          <thead className="bg-[var(--surface-2)] font-mono text-[10px] tracking-[0.08em] text-[var(--text-faint)]">
            <tr>
              <th className="sticky left-0 z-10 bg-[var(--surface-2)] px-4 py-3 font-medium">KUNDE / LEGAL ENTITY</th>
              {MULTI_SERVICE_COLUMNS.map(({ key, label }) => (
                <th key={key} className="px-3 py-3 text-center font-medium">{label.toUpperCase()}</th>
              ))}
              <th className="px-3 py-3 text-right font-medium">SERVICES</th>
              <th className="px-3 py-3 text-right font-medium">PROJEKTE</th>
              <th className="px-4 py-3 text-right font-medium">VERTRAGSH</th>
              <th className="px-4 py-3 font-medium">MÖGLICHERWEISE FEHLEND</th>
            </tr>
          </thead>
          <tbody>
            {model.rows.length === 0 ? (
              <tr className="border-t border-[var(--divider)]">
                <td colSpan={MULTI_SERVICE_COLUMNS.length + 5} className="px-4 py-6 text-center text-[var(--text-muted)]">
                  {model.customerMappingAvailable ? "Keine aktiven, stabil zugeordneten Kundenprojekte verfügbar." : "Customer-Master-Mapping nicht verfügbar."}
                </td>
              </tr>
            ) : model.rows.map((row) => (
              <tr key={row.legalEntityId} className="border-t border-[var(--divider)]">
                <th className="sticky left-0 bg-[var(--surface)] px-4 py-3 font-medium text-[var(--text-primary)]">{row.customer}</th>
                {MULTI_SERVICE_COLUMNS.map(({ key }) => (
                  <td key={key} className="px-3 py-3 text-center font-mono tabular-nums text-[var(--text-secondary)]">
                    {row.services[key] > 0 ? row.services[key] : "·"}
                  </td>
                ))}
                <td className="px-3 py-3 text-right font-mono tabular-nums text-[var(--text-primary)]">{row.activeServiceCount}</td>
                <td className="px-3 py-3 text-right font-mono tabular-nums text-[var(--text-secondary)]">{row.projectCount}</td>
                <td className="px-4 py-3 text-right font-mono tabular-nums text-[var(--text-secondary)]">
                  {row.contractHours === null ? "n/a" : `${fmt(row.contractHours)} h`}
                </td>
                <td className="max-w-[280px] px-4 py-3 text-[var(--text-muted)]">
                  {row.possibleMissingServices.length === 0
                    ? "Keine"
                    : row.possibleMissingServices.map((key) => MULTI_SERVICE_COLUMNS.find((column) => column.key === key)?.label).join(", ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="border-t border-[var(--divider)] px-4 py-3 text-[11px] leading-relaxed text-[var(--text-muted)]">
        <p>Eine Zelle zeigt die Anzahl aktiver/offener Projekte des Kunden für den Service. „Möglicherweise fehlend“ ist ein transparenter Cross-Selling-Hinweis, keine Verkaufslogik.</p>
        {(model.activeProjectsWithoutCustomerMapping !== 0 || model.activeProjectsWithoutServiceMapping !== 0) && (
          <p className="mt-2 text-[var(--warning)]">
            Datenqualität: {model.activeProjectsWithoutCustomerMapping === null ? "Customer Mapping n/a" : `${model.activeProjectsWithoutCustomerMapping} aktive Projekte ohne Customer Mapping`} · {model.activeProjectsWithoutServiceMapping === null ? "Service Mapping n/a" : `${model.activeProjectsWithoutServiceMapping} aktive Projekte ohne Service Mapping`}.
          </p>
        )}
      </div>
    </Card>
  );
}
