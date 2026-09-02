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
 *
 * The service column labels (DGUV V2 SiFa, SiGeKo, Betriebsarzt …) are the
 * names of the services sold and stay as they are in both languages.
 */
import { useTranslations } from "next-intl";
import { DataTable, cmpNum, cmpText, type Column } from "@/components/data-table/DataTable";
import {
  MULTI_SERVICE_COLUMNS,
  type ManagementMultiServiceRow,
  type ManagementMultiServiceMatrix,
} from "@/lib/queries/management-multi-service-matrix.types";

const fmt = (value: number) => new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(value);

const labelOf = (key: string) => MULTI_SERVICE_COLUMNS.find((column) => column.key === key)?.label ?? key;

export function ManagementMultiServiceMatrix({ model }: { model: ManagementMultiServiceMatrix }) {
  const t = useTranslations("management.multiService");
  const tm = useTranslations("management");
  const na = tm("values.notAvailable");
  const rows = model.rows;

  const missingText = (row: ManagementMultiServiceRow) =>
    row.possibleMissingServices.length === 0 ? tm("values.none") : row.possibleMissingServices.map(labelOf).join(", ");

  // Totals over EVERY row, independent of paging, search or sort.
  const totalProjects = rows.reduce((sum, row) => sum + row.projectCount, 0);
  const hoursKnown = rows.filter((row) => row.contractHours !== null);
  const totalHours = hoursKnown.reduce((sum, row) => sum + (row.contractHours ?? 0), 0);
  const hoursUnknown = rows.length - hoursKnown.length;
  const singleService = rows.filter((row) => row.activeServiceCount === 1).length;

  const columns: Column<ManagementMultiServiceRow>[] = [
    {
      key: "customer",
      header: t("columns.customer"),
      // Frozen via freezeFirstColumn below; only the width is set here.
      className: "min-w-[14rem]",
      compare: (a, b) => cmpText(a.customer, b.customer),
      descFirst: false,
      cell: (row) => <span className="font-medium text-[var(--text-primary)]">{row.customer}</span>,
      csv: (row) => row.customer,
      search: (row) => row.customer,
      title: t("titles.customer"),
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
      title: t("titles.service", { label }),
    })),
    {
      key: "activeServiceCount",
      header: t("columns.services"),
      align: "right",
      compare: (a, b) => a.activeServiceCount - b.activeServiceCount,
      cell: (row) => <span className="font-mono tabular-nums text-[var(--text-primary)]">{row.activeServiceCount}</span>,
      csv: (row) => row.activeServiceCount,
      title: t("titles.services"),
    },
    {
      key: "projectCount",
      header: t("columns.projects"),
      align: "right",
      compare: (a, b) => a.projectCount - b.projectCount,
      cell: (row) => <span className="font-mono tabular-nums text-[var(--text-secondary)]">{row.projectCount}</span>,
      csv: (row) => row.projectCount,
    },
    {
      key: "contractHours",
      header: t("columns.contractHours"),
      align: "right",
      compare: (a, b) => cmpNum(a.contractHours, b.contractHours),
      cell: (row) => (
        <span className="font-mono tabular-nums text-[var(--text-secondary)]">
          {row.contractHours === null ? na : `${fmt(row.contractHours)} h`}
        </span>
      ),
      csv: (row) => (row.contractHours === null ? na : row.contractHours),
      title: t("titles.contractHours"),
    },
    {
      key: "possibleMissingServices",
      header: t("columns.missing"),
      className: "max-w-[280px]",
      compare: (a, b) => a.possibleMissingServices.length - b.possibleMissingServices.length,
      cell: (row) => <span className="text-[var(--text-muted)]">{missingText(row)}</span>,
      csv: (row) => missingText(row),
      search: (row) => missingText(row),
      title: t("titles.missing"),
    },
  ];

  return (
    <DataTable
      rows={rows}
      columns={columns}
      rowKey={(row) => row.legalEntityId}
      title={t("title")}
      hint={t("hint")}
      exportName="multi-service-matrix"
      searchPlaceholder={t("searchPlaceholder")}
      defaultPageSize={25}
      freezeFirstColumn
      maxBodyHeight="52vh"
      collapsible
      defaultOpen
      summary={t("summary", { customers: String(rows.length), projects: String(totalProjects), hours: fmt(totalHours) })}
      emptyText={model.customerMappingAvailable ? t("empty.noRows") : t("empty.noMapping")}
      footnote={
        <span className="block space-y-1 leading-relaxed">
          {/* Totals span every row, not the current page. */}
          <span className="block text-[var(--text-secondary)]">
            {t("totals", { customers: String(rows.length), projects: String(totalProjects), hours: fmt(totalHours) })}
            {hoursUnknown > 0 ? t("unknownHours", { count: String(hoursUnknown) }) : ""}
            {t("singleService", { count: String(singleService) })}
          </span>
          <span className="block">
            {t("note")}
          </span>
          {(model.activeProjectsWithoutCustomerMapping !== 0 || model.activeProjectsWithoutServiceMapping !== 0) && (
            <span className="block text-[var(--warning)]">
              {t("dataQuality", {
                customer: model.activeProjectsWithoutCustomerMapping === null
                  ? tm("values.customerMappingNa")
                  : t("withoutCustomerMapping", { count: String(model.activeProjectsWithoutCustomerMapping) }),
                service: model.activeProjectsWithoutServiceMapping === null
                  ? tm("values.serviceMappingNa")
                  : t("withoutServiceMapping", { count: String(model.activeProjectsWithoutServiceMapping) }),
              })}
            </span>
          )}
        </span>
      }
    />
  );
}
