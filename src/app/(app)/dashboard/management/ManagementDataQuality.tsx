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
 */

import { DataTable, cmpNum, cmpText, type Column } from "@/components/data-table/DataTable";
import type { ManagementDataQualityRow } from "@/lib/queries/management-data-quality";

export function ManagementDataQuality({ rows }: { rows: ManagementDataQualityRow[] }) {
  // Totals over EVERY row. A null count is unknown, never zero, so unknowns are
  // counted separately and named rather than folded into the sum.
  const critical = rows.filter((row) => row.rating === "Kritisch").length;
  const countKnown = rows.filter((row) => row.count !== null);
  const findings = countKnown.reduce((sum, row) => sum + (row.count ?? 0), 0);
  const countUnknown = rows.length - countKnown.length;

  const columns: Column<ManagementDataQualityRow>[] = [
    {
      key: "check",
      header: "PRÜFUNG",
      className: "min-w-[14rem]",
      compare: (a, b) => cmpText(a.check, b.check),
      descFirst: false,
      cell: (row) => <span className="font-medium text-[var(--text-primary)]">{row.check}</span>,
      csv: (row) => row.check,
      search: (row) => row.check,
    },
    {
      key: "count",
      header: "ANZAHL",
      align: "right",
      compare: (a, b) => cmpNum(a.count, b.count),
      cell: (row) => (
        <span className="font-mono tabular-nums text-[var(--text-secondary)]">
          {row.count === null ? "n/a" : row.count}
        </span>
      ),
      csv: (row) => (row.count === null ? "n/a" : row.count),
    },
    {
      key: "rating",
      header: "BEWERTUNG",
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
          {row.rating}
        </span>
      ),
      csv: (row) => row.rating,
      search: (row) => row.rating,
    },
    {
      key: "meaning",
      header: "BEDEUTUNG",
      className: "max-w-[26rem]",
      cell: (row) => <span className="text-[var(--text-muted)]">{row.meaning}</span>,
      csv: (row) => row.meaning,
      search: (row) => row.meaning,
    },
  ];

  return (
    <DataTable
      rows={rows}
      columns={columns}
      rowKey={(row) => row.check}
      title="Data Quality"
      hint="OPERATIVE STEUERBARKEIT · READ MODEL"
      initialSort="count"
      exportName="data-quality"
      searchPlaceholder="Prüfung, Bedeutung…"
      defaultPageSize={25}
      maxBodyHeight="34vh"
      emptyText="Keine Prüfungen im aktuellen Read Model."
      footnote={
        <span className="block space-y-1 leading-relaxed">
          <span className="block text-[var(--text-secondary)]">
            Gesamt über alle {rows.length} Prüfungen: {critical} kritisch · {findings} Befunde
            {countUnknown > 0 ? ` (${countUnknown} Prüfungen ohne belastbare Grundlage: n/a)` : ""}
          </span>
          <span className="block">
            n/a bedeutet, dass die zugrunde liegende bestätigte Relation im aktuellen Read Model nicht verfügbar ist; es wird kein Wert geschätzt.
          </span>
        </span>
      }
    />
  );
}
