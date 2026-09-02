"use client";

/**
 * Project Risks on the shared table primitive.
 *
 * WHY: measured at 1440×900 this card was 3,052px on its own — 10 rows in
 * 2,962px, ~296px per row — which put the tab at 4.31 screens. Paging was never
 * the problem; the ROW CONTENT was. Two things made each row a paragraph:
 *
 *   1. Three columns held a comma-joined LIST inside a cell (every affected
 *      project name, every responsible person, every service). At 280px wide a
 *      15-project list wraps to eight lines, so one row was ~200px of prose.
 *   2. Every risk with affected projects rendered a SECOND <tr> underneath
 *      carrying the drilldown toggle, and opening one injected a whole nested
 *      table into the row — the two tall rows measured at 1,033px and 1,393px.
 *
 * WHAT REPLACES THEM. The scan columns state the SIZE of each list on one line
 * and carry the full list in the cell's title, and the drilldown moved out of
 * the table into a panel BENEATH it (the pattern ManagementCustomerPortfolio
 * already uses), where the affected projects render as a real table with its own
 * bounded body. Nothing is hidden: every project, person and service the old
 * markup printed is still reachable, the counts are computed over all rows, and
 * the footnote is carried verbatim.
 *
 * Risk names, ratings and explanations arrive in German from the query module
 * and are translated at render through management-i18n; the module's values
 * are compared in code and stay untouched.
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { DataTable, cmpNum, cmpText, type Column } from "@/components/data-table/DataTable";
import type { ManagementProjectRiskRow } from "@/lib/queries/management-project-risks";
import { translateList, translateText } from "./management-i18n";

const fmt = (value: number) => new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(value);

/** Rating pill, unchanged from the hand-rolled markup. */
function RatingPill({ rating }: { rating: ManagementProjectRiskRow["rating"] }) {
  const tm = useTranslations("management");
  const cls =
    rating === "Kritisch"
      ? "bg-[var(--critical-wash)] text-[var(--critical)]"
      : "bg-[var(--warning-wash)] text-[var(--warning)]";
  return <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-medium ${cls}`}>{translateText(tm, rating)}</span>;
}

/**
 * A list column that stays one line high.
 *
 * The count is the scannable fact ("11 Projekte"), the full list is on the cell
 * so hovering reads it out, and the drilldown below the table renders it in
 * full. A wrapped list inside a cell is the same information at eight times the
 * height.
 */
function ListCell({ items, noun, empty }: { items: string[]; noun: string; empty: string }) {
  if (items.length === 0) return <span className="text-[var(--text-faint)]">{empty}</span>;
  return (
    <span
      title={items.join(", ")}
      className="block max-w-[16rem] truncate text-[var(--text-muted)]"
    >
      <span className="font-mono tabular-nums text-[var(--text-secondary)]">{items.length}</span>{" "}
      {noun} · {items.join(", ")}
    </span>
  );
}

/** The affected-project detail for one risk, opened beneath the table. */
function RiskDetail({ row, onClose }: { row: ManagementProjectRiskRow; onClose: () => void }) {
  const t = useTranslations("management.risks");
  const tm = useTranslations("management");
  const tx = (text: string) => translateText(tm, text);
  const na = tm("values.notAvailable");
  const notAssigned = tm("values.notAssigned");
  return (
    <div className="space-y-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface-2)] px-4 py-4 card-elev">
      <div className="flex items-start justify-between gap-4">
        <p className="font-mono text-[10px] tracking-[0.08em] text-[var(--text-faint)]">
          {t("detail.kicker", { risk: tx(row.risk).toUpperCase(), count: String(row.affectedProjects.length) })}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="font-mono text-[10px] text-[var(--text-faint)] hover:text-[var(--critical)]"
        >
          {t("detail.close")}
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <p className="font-mono text-[10px] tracking-[0.08em] text-[var(--text-faint)]">
            {t("detail.responsible", { count: String(row.responsible.length) })}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-muted)]">
            {row.count === null ? na : translateList(tm, row.responsible).join(", ") || notAssigned}
          </p>
        </div>
        <div>
          <p className="font-mono text-[10px] tracking-[0.08em] text-[var(--text-faint)]">
            {t("detail.services", { count: String(row.services.length) })}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-muted)]">
            {row.count === null ? na : translateList(tm, row.services).join(", ") || notAssigned}
          </p>
        </div>
      </div>

      <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">{tx(row.meaning)}</p>

      {/* The nested table keeps its own bounded body so opening a 40-project
          risk does not grow the page past the card it lives in. */}
      <div className="max-h-[20rem] overflow-auto">
        <table className="w-full min-w-[820px] border-collapse text-left text-[11px]">
          <thead className="sticky top-0 bg-[var(--surface-2)] font-mono text-[10px] tracking-[0.08em] text-[var(--text-faint)]">
            <tr>
              <th scope="col" className="px-2 py-2 font-medium">{t("detail.columns.customer")}</th>
              <th scope="col" className="px-2 py-2 font-medium">{t("detail.columns.project")}</th>
              <th scope="col" className="px-2 py-2 font-medium">{t("detail.columns.service")}</th>
              <th scope="col" className="px-2 py-2 font-medium">{t("detail.columns.responsible")}</th>
              <th scope="col" className="px-2 py-2 font-medium">{t("detail.columns.replacement")}</th>
              <th scope="col" className="px-2 py-2 text-right font-medium">{t("detail.columns.contractHours")}</th>
              <th scope="col" className="px-2 py-2 font-medium">{t("detail.columns.status")}</th>
            </tr>
          </thead>
          <tbody>
            {row.affectedProjects.map((project) => (
              <tr key={`${row.category}-${project.projectId}`} className="border-t border-[var(--divider)]">
                <td className="px-2 py-2 text-[var(--text-secondary)]">
                  {project.customer}{" "}
                  {project.customerMapping === "missing" && (
                    <span className="text-[var(--critical)]">· {tm("values.mappingMissing")}</span>
                  )}
                </td>
                <td className="px-2 py-2 text-[var(--text-primary)]">{project.project}</td>
                <td className="px-2 py-2 text-[var(--text-secondary)]">{tx(project.service)}</td>
                <td className="px-2 py-2 text-[var(--text-secondary)]">
                  {project.responsible === null ? notAssigned : tx(project.responsible)}
                </td>
                <td className="px-2 py-2 text-[var(--text-secondary)]">{project.replacement ?? na}</td>
                <td className="px-2 py-2 text-right font-mono tabular-nums text-[var(--text-secondary)]">
                  {project.contractHours === null ? na : `${fmt(project.contractHours)} h`}
                </td>
                <td className="px-2 py-2 text-[var(--text-secondary)]">{project.status ?? tm("values.missing")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ManagementProjectRisks({ rows }: { rows: ManagementProjectRiskRow[] }) {
  const t = useTranslations("management.risks");
  const tm = useTranslations("management");
  const tx = (text: string) => translateText(tm, text);
  const na = tm("values.notAvailable");
  const notAssigned = tm("values.notAssigned");
  const [expanded, setExpanded] = useState<string | null>(null);
  const openRow = rows.find((row) => row.category === expanded) ?? null;

  // Totals over EVERY row, never over the page on screen. A risk whose count is
  // null is unknown, not zero, so it is counted as unknown and named as such.
  const critical = rows.filter((row) => row.rating === "Kritisch").length;
  const countKnown = rows.filter((row) => row.count !== null);
  const affected = countKnown.reduce((sum, row) => sum + (row.count ?? 0), 0);
  const countUnknown = rows.length - countKnown.length;
  const hoursKnown = rows.filter((row) => row.contractHours !== null);
  const totalHours = hoursKnown.reduce((sum, row) => sum + (row.contractHours ?? 0), 0);

  const columns: Column<ManagementProjectRiskRow>[] = [
    {
      key: "risk",
      header: t("columns.risk"),
      className: "min-w-[13rem]",
      compare: (a, b) => cmpText(a.risk, b.risk),
      descFirst: false,
      cell: (row) =>
        row.affectedProjects.length > 0 ? (
          <button
            type="button"
            onClick={() => setExpanded(expanded === row.category ? null : row.category)}
            aria-expanded={expanded === row.category}
            title={t("titles.risk")}
            className={`text-left font-medium hover:text-[var(--accent)] ${
              expanded === row.category ? "text-[var(--accent)]" : "text-[var(--text-primary)]"
            }`}
          >
            {tx(row.risk)}
          </button>
        ) : (
          <span className="font-medium text-[var(--text-primary)]">{tx(row.risk)}</span>
        ),
      csv: (row) => tx(row.risk),
      search: (row) => `${tx(row.risk)} ${tx(row.meaning)}`,
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
      cell: (row) => <RatingPill rating={row.rating} />,
      csv: (row) => tx(row.rating),
      search: (row) => tx(row.rating),
    },
    {
      key: "projects",
      header: t("columns.projects"),
      className: "max-w-[17rem]",
      compare: (a, b) => a.affectedProjects.length - b.affectedProjects.length,
      cell: (row) =>
        row.count === null ? (
          <span className="text-[var(--text-faint)]">{na}</span>
        ) : (
          <ListCell
            items={row.affectedProjects.map((project) => project.project)}
            noun={t("nouns.projects")}
            empty={tm("values.none")}
          />
        ),
      csv: (row) =>
        row.count === null ? na : row.affectedProjects.map((p) => p.project).join(" | ") || tm("values.none"),
      search: (row) => row.affectedProjects.map((p) => `${p.project} ${p.customer}`).join(" "),
      title: t("titles.projects"),
    },
    {
      key: "responsible",
      header: t("columns.responsible"),
      className: "max-w-[15rem]",
      compare: (a, b) => a.responsible.length - b.responsible.length,
      cell: (row) =>
        row.count === null ? (
          <span className="text-[var(--text-faint)]">{na}</span>
        ) : (
          <ListCell items={translateList(tm, row.responsible)} noun={t("nouns.people")} empty={notAssigned} />
        ),
      csv: (row) => (row.count === null ? na : translateList(tm, row.responsible).join(" | ") || notAssigned),
      search: (row) => row.responsible.join(" "),
    },
    {
      key: "services",
      header: t("columns.service"),
      className: "max-w-[15rem]",
      compare: (a, b) => a.services.length - b.services.length,
      cell: (row) =>
        row.count === null ? (
          <span className="text-[var(--text-faint)]">{na}</span>
        ) : (
          <ListCell items={translateList(tm, row.services)} noun={t("nouns.services")} empty={notAssigned} />
        ),
      csv: (row) => (row.count === null ? na : translateList(tm, row.services).join(" | ") || notAssigned),
      search: (row) => row.services.join(" "),
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
    },
  ];

  return (
    <div className="flex flex-col gap-[var(--card-gap)]">
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(row) => row.category}
        title={t("title")}
        hint={t("hint")}
        initialSort="count"
        exportName="project-risks"
        searchPlaceholder={t("searchPlaceholder")}
        defaultPageSize={25}
        maxBodyHeight="42vh"
        emptyText={t("empty")}
        footnote={
          <span className="block space-y-1 leading-relaxed">
            <span className="block text-[var(--text-secondary)]">
              {t("totals", { total: String(rows.length), critical: String(critical), affected: String(affected) })}
              {countUnknown > 0 ? t("unknown", { count: String(countUnknown) }) : ""}
              {t("totalHours", { hours: fmt(totalHours) })}
            </span>
            <span className="block">
              {t("note")}
            </span>
          </span>
        }
      />

      {openRow && <RiskDetail row={openRow} onClose={() => setExpanded(null)} />}
    </div>
  );
}
