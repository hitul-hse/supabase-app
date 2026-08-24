"use client";

/**
 * Multi-Service Matrix as a paged, sortable crosstab.
 *
 * WHY: 84 customer rows rendered in one unpaged block made ?tab=customers 17.7
 * screens tall. The rows are not deleted, they are paged (25 by default, ALL is
 * one click away) and the totals below the table are computed over the FULL set,
 * never over the visible page — a pager must not be able to change a total.
 *
 * The first column is frozen (sticky left) because this is a wide crosstab: the
 * customer name has to stay readable while scrolling sideways through the seven
 * service columns.
 */
import { DataTable, cmpNum, cmpText, type Column } from "@/components/data-table/DataTable";
import {
  MULTI_SERVICE_COLUMNS,
  type ManagementMultiServiceRow,
  type ManagementMultiServiceMatrix,
} from "@/lib/queries/management-multi-service-matrix.types";

const fmt = (value: number) => new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(value);

const labelOf = (key: string) => MULTI_SERVICE_COLUMNS.find((column) => column.key === key)?.label ?? key;

const missingText = (row: ManagementMultiServiceRow) =>
  row.possibleMissingServices.length === 0 ? "Keine" : row.possibleMissingServices.map(labelOf).join(", ");

export function ManagementMultiServiceMatrix({ model }: { model: ManagementMultiServiceMatrix }) {
  const rows = model.rows;

  // Totals over EVERY row, independent of paging, search or sort.
  const totalProjects = rows.reduce((sum, row) => sum + row.projectCount, 0);
  const hoursKnown = rows.filter((row) => row.contractHours !== null);
  const totalHours = hoursKnown.reduce((sum, row) => sum + (row.contractHours ?? 0), 0);
  const hoursUnknown = rows.length - hoursKnown.length;
  const singleService = rows.filter((row) => row.activeServiceCount === 1).length;

  const columns: Column<ManagementMultiServiceRow>[] = [
    {
      key: "customer",
      header: "KUNDE / LEGAL ENTITY",
      // Frozen via freezeFirstColumn below; only the width is set here.
      className: "min-w-[14rem]",
      compare: (a, b) => cmpText(a.customer, b.customer),
      descFirst: false,
      cell: (row) => <span className="font-medium text-[var(--text-primary)]">{row.customer}</span>,
      csv: (row) => row.customer,
      search: (row) => row.customer,
      title: "Kunde bzw. Legal Entity",
    },
    ...MULTI_SERVICE_COLUMNS.map(({ key, label }) => ({
      key,
      header: label.toUpperCase(),
      align: "right" as const,
      compare: (a: ManagementMultiServiceRow, b: ManagementMultiServiceRow) => a.services[key] - b.services[key],
      cell: (row: ManagementMultiServiceRow) => (
        <span className="font-mono tabular-nums text-[var(--text-secondary)]">
          {row.services[key] > 0 ? row.services[key] : "·"}
        </span>
      ),
      csv: (row: ManagementMultiServiceRow) => row.services[key],
      title: `Aktive/offene Projekte für ${label}`,
    })),
    {
      key: "activeServiceCount",
      header: "SERVICES",
      align: "right",
      compare: (a, b) => a.activeServiceCount - b.activeServiceCount,
      cell: (row) => <span className="font-mono tabular-nums text-[var(--text-primary)]">{row.activeServiceCount}</span>,
      csv: (row) => row.activeServiceCount,
      title: "Anzahl aktiver Services",
    },
    {
      key: "projectCount",
      header: "PROJEKTE",
      align: "right",
      compare: (a, b) => a.projectCount - b.projectCount,
      cell: (row) => <span className="font-mono tabular-nums text-[var(--text-secondary)]">{row.projectCount}</span>,
      csv: (row) => row.projectCount,
    },
    {
      key: "contractHours",
      header: "VERTRAGSH",
      align: "right",
      compare: (a, b) => cmpNum(a.contractHours, b.contractHours),
      cell: (row) => (
        <span className="font-mono tabular-nums text-[var(--text-secondary)]">
          {row.contractHours === null ? "n/a" : `${fmt(row.contractHours)} h`}
        </span>
      ),
      csv: (row) => (row.contractHours === null ? "n/a" : row.contractHours),
      title: "Vertragsstunden der aktiven Projekte",
    },
    {
      key: "possibleMissingServices",
      header: "MÖGLICHERWEISE FEHLEND",
      className: "max-w-[280px]",
      compare: (a, b) => a.possibleMissingServices.length - b.possibleMissingServices.length,
      cell: (row) => <span className="text-[var(--text-muted)]">{missingText(row)}</span>,
      csv: (row) => missingText(row),
      search: (row) => missingText(row),
      title: "Transparenter Cross-Selling-Hinweis, keine Verkaufslogik",
    },
  ];

  return (
    <DataTable
      rows={rows}
      columns={columns}
      rowKey={(row) => row.legalEntityId}
      title="Multi-Service Matrix"
      hint="KUNDEN / LEGAL ENTITIES × AKTIVE SERVICES"
      exportName="multi-service-matrix"
      searchPlaceholder="Kunde suchen…"
      defaultPageSize={25}
      freezeFirstColumn
      maxBodyHeight="52vh"
      collapsible
      defaultOpen
      summary={`${rows.length} Kunden · ${totalProjects} aktive Projekte · ${fmt(totalHours)} h`}
      emptyText={
        model.customerMappingAvailable
          ? "Keine aktiven, stabil zugeordneten Kundenprojekte verfügbar."
          : "Customer-Master-Mapping nicht verfügbar."
      }
      footnote={
        <span className="block space-y-1 leading-relaxed">
          {/* Totals span every row, not the current page. */}
          <span className="block text-[var(--text-secondary)]">
            Gesamt über alle {rows.length} Kunden: {totalProjects} aktive Projekte ·{" "}
            {fmt(totalHours)} h Vertragsstunden
            {hoursUnknown > 0 ? ` (${hoursUnknown} Kunden ohne belastbare Stunden: n/a)` : ""} ·{" "}
            {singleService} Kunden mit nur einem Service
          </span>
          <span className="block">
            Eine Zelle zeigt die Anzahl aktiver/offener Projekte des Kunden für den Service.
            „Möglicherweise fehlend“ ist ein transparenter Cross-Selling-Hinweis, keine Verkaufslogik.
          </span>
          {(model.activeProjectsWithoutCustomerMapping !== 0 || model.activeProjectsWithoutServiceMapping !== 0) && (
            <span className="block text-[var(--warning)]">
              Datenqualität:{" "}
              {model.activeProjectsWithoutCustomerMapping === null
                ? "Customer Mapping n/a"
                : `${model.activeProjectsWithoutCustomerMapping} aktive Projekte ohne Customer Mapping`}{" "}
              ·{" "}
              {model.activeProjectsWithoutServiceMapping === null
                ? "Service Mapping n/a"
                : `${model.activeProjectsWithoutServiceMapping} aktive Projekte ohne Service Mapping`}
              .
            </span>
          )}
        </span>
      }
    />
  );
}
