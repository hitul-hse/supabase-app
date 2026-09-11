"use client";

/**
 * The employees tab: a roster table, and the selected person's portfolio.
 *
 * WHY THE PORTFOLIO IS A DataTable AND THE ROSTER IS NOT (2026-09-10)
 * ------------------------------------------------------------------
 * The portfolio was hand-rolled markup with a plain <thead> and no bound on its
 * rows. check-table-scroll-budget.mjs measured it on production as
 * "Owner portfolio · Thorsten (22 rows, 6 cols) has no sticky header": past
 * ~15 rows the header scrolls away and the columns become unlabelled numbers.
 * Nothing capped the row count either -- 22 is whoever happens to own the most
 * projects today, and the page would render 200 the same way.
 *
 * Adding `sticky` to the old <thead> would have turned the gate green and pinned
 * NOTHING: the header sat in an `overflow-x-auto` wrapper with no bounded
 * height, so there was no scroll container for it to stick inside. The gate
 * reads COMPUTED STYLE precisely to catch that trick, and the honest fix is the
 * house primitive, which bounds the body (`maxBodyHeight`) so the sticky header
 * has something to be sticky in, pages at 25, and states "1-25 of N".
 * ManagementProjectRisks on the sibling tab already reads this way.
 *
 * The roster above it stays hand-rolled: it is one row per person in the core
 * team (nine today, and it is a fixed roster rather than a growing list), it is
 * under the 15-row floor, and each row is the selector for the panel below --
 * a selection control, not a ledger.
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Card, CardHeader } from "@/components/ui/Card";
import { DataTable, cmpNum, cmpText, type Column } from "@/components/data-table/DataTable";
import type { EmployeeOwnershipRow } from "@/lib/queries/management-employee-ownership";
import { translateText } from "./management-i18n";

const fmt = (value: number) => new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(value);

type PortfolioProject = EmployeeOwnershipRow["projects"][number];

export function EmployeeOwnershipOverview({ rows }: { rows: EmployeeOwnershipRow[] }) {
  const t = useTranslations("management.employees");
  const tm = useTranslations("management");
  const na = tm("values.notAvailable");
  const [selectedPerson, setSelectedPerson] = useState(rows[0]?.person ?? null);
  const selected = rows.find((row) => row.person === selectedPerson) ?? rows[0] ?? null;

  const portfolioColumns: Column<PortfolioProject>[] = [
    {
      key: "customer",
      header: t("portfolio.columns.customer"),
      compare: (a, b) => cmpText(a.customerName, b.customerName),
      descFirst: false,
      cell: (project) => (
        <span className={project.customerMappingMissing ? "text-[var(--warning)]" : "text-[var(--text-secondary)]"}>
          {project.customerName}
          {project.customerMappingMissing ? ` · ${tm("values.mappingMissing")}` : ""}
        </span>
      ),
      csv: (project) => project.customerName,
      search: (project) => project.customerName,
    },
    {
      key: "project",
      header: t("portfolio.columns.project"),
      compare: (a, b) => cmpText(a.projectName, b.projectName),
      descFirst: false,
      cell: (project) => <span className="text-[var(--text-primary)]">{project.projectName}</span>,
      csv: (project) => project.projectName,
      search: (project) => project.projectName,
    },
    {
      key: "service",
      header: t("portfolio.columns.service"),
      compare: (a, b) => cmpText(a.service, b.service),
      descFirst: false,
      cell: (project) => <span className="text-[var(--text-secondary)]">{translateText(tm, project.service)}</span>,
      csv: (project) => translateText(tm, project.service),
      search: (project) => translateText(tm, project.service),
    },
    {
      key: "contractHours",
      header: t("portfolio.columns.contractHours"),
      align: "right",
      compact: true,
      compare: (a, b) => cmpNum(a.contractHours, b.contractHours),
      // The one figure in an owner's portfolio row, so it reads at full
      // contrast instead of at the weight of the names around it.
      cell: (project) => (
        <span className="font-mono tabular-nums text-[var(--text-primary)]">{fmt(project.contractHours)} h</span>
      ),
      csv: (project) => project.contractHours,
    },
    {
      key: "responsible",
      header: t("portfolio.columns.responsible"),
      compare: (a, b) => cmpText(a.responsiblePerson ?? "", b.responsiblePerson ?? ""),
      descFirst: false,
      nullish: (project) => project.responsiblePerson === null,
      cell: (project) => <span className="text-[var(--text-secondary)]">{project.responsiblePerson ?? na}</span>,
      csv: (project) => project.responsiblePerson ?? na,
      search: (project) => project.responsiblePerson ?? "",
    },
    {
      key: "replacement",
      header: t("portfolio.columns.replacement"),
      compare: (a, b) => cmpText(a.replacementPerson ?? "", b.replacementPerson ?? ""),
      descFirst: false,
      nullish: (project) => project.replacementPerson === null,
      cell: (project) => <span className="text-[var(--text-muted)]">{project.replacementPerson ?? na}</span>,
      csv: (project) => project.replacementPerson ?? na,
      search: (project) => project.replacementPerson ?? "",
    },
  ];

  if (!selected) return null;

  return (
    <div className="flex flex-col gap-[var(--card-gap)]">
      <Card className="overflow-hidden">
        <CardHeader title={t("title")} qualifier={t("qualifier")} />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse text-left text-[12px]">
            <thead className="bg-[var(--surface-2)] font-mono text-[10px] tracking-[0.08em] text-[var(--text-faint)]">
              <tr>
                <th className="px-4 py-3 font-medium">{t("columns.person")}</th>
                <th className="px-3 py-3 text-right font-medium">{t("columns.openProjects")}</th>
                <th className="px-3 py-3 text-right font-medium">{t("columns.contractHours")}</th>
                <th className="px-3 py-3 text-right font-medium">{t("columns.services")}</th>
                <th className="px-3 py-3 text-right font-medium">{t("columns.coverage")}</th>
                <th className="px-4 py-3 text-right font-medium">{t("columns.withoutReplacement")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.person} className={`border-t border-[var(--divider)] ${selected.person === row.person ? "bg-[var(--accent-wash)]" : ""}`}>
                  <th className="px-4 py-3 font-medium text-[var(--text-primary)]">
                    <button type="button" className="text-left hover:text-[var(--accent)]" onClick={() => setSelectedPerson(row.person)} aria-pressed={selected.person === row.person}>
                      {row.person}
                    </button>
                  </th>
                  {/* Open projects is the load this roster compares person to
                      person, so it is the figure at full contrast. */}
                  <td className="px-3 py-3 text-right font-mono tabular-nums text-[var(--text-primary)]">{row.openProjects}</td>
                  <td className="px-3 py-3 text-right font-mono tabular-nums text-[var(--text-secondary)]">{fmt(row.contractHours)} h</td>
                  <td className="px-3 py-3 text-right font-mono tabular-nums text-[var(--text-secondary)]">{row.servicesInPortfolio.length}</td>
                  <td className="px-3 py-3 text-right font-mono tabular-nums text-[var(--text-secondary)]">{row.replacementCoveragePercent === null ? na : `${fmt(row.replacementCoveragePercent)}%`}</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-[var(--text-secondary)]">{row.projectsWithoutReplacement === null ? na : row.projectsWithoutReplacement}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-[var(--divider)] px-4 py-3 text-[11px] leading-relaxed text-[var(--text-muted)]">
          {rows.some((row) => row.replacementRelationAvailable)
            ? t("footnote.withRelation")
            : t("footnote.withoutRelation")}
        </p>
      </Card>

      {/*
        `key` on the person: the portfolio is a different list for every person,
        so a page or a sort left over from the last selection would apply to rows
        it was never chosen for. Remounting resets both.
      */}
      <DataTable
        key={selected.person}
        rows={selected.projects}
        columns={portfolioColumns}
        rowKey={(project) => `${selected.person}-${project.projectId}`}
        title={t("portfolio.title", { person: selected.person })}
        hint={t("portfolio.qualifier")}
        emptyText={t("portfolio.empty")}
        exportName="owner-portfolio"
        defaultPageSize={25}
        density="compact"
        /* The same bound the risks panel on the sibling tab uses: the body
           scrolls inside the card instead of growing the document, which is
           what gives the sticky header a container to stick in. */
        maxBodyHeight="42vh"
      />
    </div>
  );
}
