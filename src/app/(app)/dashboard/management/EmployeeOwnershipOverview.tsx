"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Card, CardHeader } from "@/components/ui/Card";
import type { EmployeeOwnershipRow } from "@/lib/queries/management-employee-ownership";
import { translateText } from "./management-i18n";

const fmt = (value: number) => new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(value);

export function EmployeeOwnershipOverview({ rows }: { rows: EmployeeOwnershipRow[] }) {
  const t = useTranslations("management.employees");
  const tm = useTranslations("management");
  const na = tm("values.notAvailable");
  const [selectedPerson, setSelectedPerson] = useState(rows[0]?.person ?? null);
  const selected = rows.find((row) => row.person === selectedPerson) ?? rows[0] ?? null;

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
                  <td className="px-3 py-3 text-right font-mono tabular-nums text-[var(--text-secondary)]">{row.openProjects}</td>
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

      <Card className="overflow-hidden">
        <CardHeader title={t("portfolio.title", { person: selected.person })} qualifier={t("portfolio.qualifier")} />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse text-left text-[12px]">
            <thead className="bg-[var(--surface-2)] font-mono text-[10px] tracking-[0.08em] text-[var(--text-faint)]">
              <tr>
                <th className="px-4 py-3 font-medium">{t("portfolio.columns.customer")}</th>
                <th className="px-3 py-3 font-medium">{t("portfolio.columns.project")}</th>
                <th className="px-3 py-3 font-medium">{t("portfolio.columns.service")}</th>
                <th className="px-3 py-3 text-right font-medium">{t("portfolio.columns.contractHours")}</th>
                <th className="px-3 py-3 font-medium">{t("portfolio.columns.responsible")}</th>
                <th className="px-4 py-3 font-medium">{t("portfolio.columns.replacement")}</th>
              </tr>
            </thead>
            <tbody>
              {selected.projects.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-[var(--text-muted)]">{t("portfolio.empty")}</td></tr>
              ) : selected.projects.map((project) => (
                <tr key={`${selected.person}-${project.projectId}`} className="border-t border-[var(--divider)]">
                  <td className={`px-4 py-3 ${project.customerMappingMissing ? "text-[var(--warning)]" : "text-[var(--text-secondary)]"}`}>{project.customerName}{project.customerMappingMissing ? ` · ${tm("values.mappingMissing")}` : ""}</td>
                  <td className="px-3 py-3 text-[var(--text-primary)]">{project.projectName}</td>
                  <td className="px-3 py-3 text-[var(--text-secondary)]">{translateText(tm, project.service)}</td>
                  <td className="px-3 py-3 text-right font-mono tabular-nums text-[var(--text-secondary)]">{fmt(project.contractHours)} h</td>
                  <td className="px-3 py-3 text-[var(--text-secondary)]">{project.responsiblePerson ?? na}</td>
                  <td className="px-4 py-3 text-[var(--text-muted)]">{project.replacementPerson ?? na}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
