"use client";

/**
 * Data Quality on the shared table primitive.
 *
 * The row count here is fixed by the check list rather than by a query, so a
 * hand-rolled table was defensible — but DESIGN.md rules 3, 5, 6 and 7 apply to
 * a bounded table too, and the primitive supplies the sticky header, the bounded
 * body and the count line for free. The BEDEUTUNG column stays full text: it is
 * the reason a reader is on this tab at all, and seven rows of it is not what
 * made this page 4.31 screens. Every caveat is carried verbatim.
 *
 * Check names, ratings and explanations arrive in German from the query module
 * and are translated at render through management-i18n (the module's values
 * are compared in code and stay untouched).
 */

import { useTranslations } from "next-intl";
import { DataTable, cmpNum, cmpText, type Column } from "@/components/data-table/DataTable";
import type { ManagementDataQualityRow } from "@/lib/queries/management-data-quality";
import { translateText } from "./management-i18n";

export function ManagementDataQuality({ rows }: { rows: ManagementDataQualityRow[] }) {
  const t = useTranslations("management.dataQuality");
  const tm = useTranslations("management");
  const tx = (text: string) => translateText(tm, text);
  const na = tm("values.notAvailable");

  // Totals over EVERY row. A null count is unknown, never zero, so unknowns are
  // counted separately and named rather than folded into the sum.
  const critical = rows.filter((row) => row.rating === "Kritisch").length;
  const countKnown = rows.filter((row) => row.count !== null);
  const findings = countKnown.reduce((sum, row) => sum + (row.count ?? 0), 0);
  const countUnknown = rows.length - countKnown.length;

  const columns: Column<ManagementDataQualityRow>[] = [
    {
      key: "check",
      header: t("columns.check"),
      className: "min-w-[14rem]",
      compare: (a, b) => cmpText(a.check, b.check),
      descFirst: false,
      cell: (row) => <span className="font-medium text-[var(--text-primary)]">{tx(row.check)}</span>,
      csv: (row) => tx(row.check),
      search: (row) => tx(row.check),
    },
    {
      key: "count",
      header: t("columns.count"),
      align: "right",
      compare: (a, b) => cmpNum(a.count, b.count),
      cell: (row) => (
        <span className="font-mono tabular-nums text-[var(--text-secondary)]">
          {row.count === null ? na : row.count}
        </span>
      ),
      csv: (row) => (row.count === null ? na : row.count),
    },
    {
      key: "rating",
      header: t("columns.rating"),
      className: "w-[7rem]",
      compare: (a, b) => cmpText(a.rating, b.rating),
      descFirst: false,
      cell: (row) => (
        <span
          className={`inline-flex rounded-full px-2 py-1 text-[10px] font-medium ${
            row.rating === "Kritisch"
              ? "bg-[var(--critical-wash)] text-[var(--critical)]"
              : "bg-[var(--warning-wash)] text-[var(--warning)]"
          }`}
        >
          {tx(row.rating)}
        </span>
      ),
      csv: (row) => tx(row.rating),
      search: (row) => tx(row.rating),
    },
    {
      key: "meaning",
      header: t("columns.meaning"),
      className: "max-w-[26rem]",
      cell: (row) => <span className="text-[var(--text-muted)]">{tx(row.meaning)}</span>,
      csv: (row) => tx(row.meaning),
      search: (row) => tx(row.meaning),
    },
  ];

  return (
    <DataTable
      rows={rows}
      columns={columns}
      rowKey={(row) => row.check}
      title={t("title")}
      hint={t("hint")}
      initialSort="count"
      exportName="data-quality"
      searchPlaceholder={t("searchPlaceholder")}
      defaultPageSize={25}
      maxBodyHeight="34vh"
      emptyText={t("empty")}
      footnote={
        <span className="block space-y-1 leading-relaxed">
          <span className="block text-[var(--text-secondary)]">
            {t("totals", { total: String(rows.length), critical: String(critical), findings: String(findings) })}
            {countUnknown > 0 ? t("unknown", { count: String(countUnknown) }) : ""}
          </span>
          <span className="block">
            {t("naNote")}
          </span>
        </span>
      }
    />
  );
}
