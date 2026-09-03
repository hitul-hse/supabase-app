"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Card, CardHeader, StatTile } from "@/components/ui/Card";
import { Segmented } from "@/components/ui/Segmented";
import type { ManagementContractHours, ManagementPerson } from "@/lib/queries/management-contract-hours";
import { ANNUAL_PLAN_HOURS, PEOPLE } from "@/lib/queries/management-contract-hours";
import type { EmployeeOwnershipRow } from "@/lib/queries/management-employee-ownership";
import type { ManagementDataQualityRow } from "@/lib/queries/management-data-quality";
import type { ManagementProjectRiskRow } from "@/lib/queries/management-project-risks";
import type { ManagementMultiServiceMatrix as ManagementMultiServiceMatrixModel } from "@/lib/queries/management-multi-service-matrix";
import type { ManagementCustomerPortfolio } from "@/lib/queries/management-customer-portfolio";
import type { ManagementChangeRequest } from "@/lib/queries/management-change-requests";
import type { BrokenCoverSummary } from "@/lib/queries/broken-cover";
import { ManagementDrilldown, type Drill } from "./ManagementDrilldown";
import { BrokenCoverPanel } from "./BrokenCoverPanel";
import { EmployeeOwnershipOverview } from "./EmployeeOwnershipOverview";
import { ManagementDataQuality } from "./ManagementDataQuality";
import { ManagementProjectRisks } from "./ManagementProjectRisks";
import { ManagementMultiServiceMatrix } from "./ManagementMultiServiceMatrix";
import { ManagementCustomerPortfolio as ManagementCustomerPortfolioView } from "./ManagementCustomerPortfolio";
import { STATUS_KEY } from "./management-i18n";

// Numbers stay de-DE in both languages (house rule): 1.304, not 1,304.
const fmt = (value: number) => new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(value);
const planHours = ANNUAL_PLAN_HOURS.toLocaleString("de-DE");

export function ManagementMatrix({ model, ownershipRows, dataQualityRows, projectRiskRows, multiServiceModel, customerPortfolio, changeRequests, brokenCover }: { model: ManagementContractHours; ownershipRows: EmployeeOwnershipRow[]; dataQualityRows: ManagementDataQualityRow[]; projectRiskRows: ManagementProjectRiskRow[]; multiServiceModel: ManagementMultiServiceMatrixModel; customerPortfolio: ManagementCustomerPortfolio; changeRequests: ManagementChangeRequest[]; brokenCover: BrokenCoverSummary }) {
  const t = useTranslations("management");
  const [expanded, setExpanded] = useState<ManagementPerson | null>(null);
  const [drill, setDrill] = useState<Drill | null>(null);
  /*
   * The active tab lives in the URL (?tab=), not in useState: a management
   * reader shares "the risk view" as a link, and a reload must not dump them
   * back at the first tab. Unknown values fall back to the overview rather
   * than rendering nothing.
   */
  const TABS = [
    { key: "overview", label: t("tabs.overview") },
    { key: "employees", label: t("tabs.employees") },
    { key: "customers", label: t("tabs.customers") },
    { key: "risks", label: t("tabs.risks") },
  ] as const;
  const params = useSearchParams();
  const requested = params.get("tab");
  const tab = TABS.some((candidate) => candidate.key === requested) ? requested : "overview";
  const totalByPerson = Object.fromEntries(
    PEOPLE.map((person) => [person, model.rows.reduce((sum, row) => sum + row.cells[person], 0)]),
  ) as Record<ManagementPerson, number>;
  const overallUtilisation = Math.round(
    (model.utilisationOutlook.reduce((sum, row) => sum + row.boundContractHours, 0) /
      (model.utilisationOutlook.length * ANNUAL_PLAN_HOURS)) * 1000,
  ) / 10;

  // Drill-down builders: pure re-projections of the read model already on the
  // client, so the popup can never disagree with the table it opened from.
  const openContractHoursDrill = () => {
    // The tile counts ALL contract hours; the service rows only count hours
    // bound to the core team via person_assignments. The difference is real
    // (projects nobody is assigned to) and must appear as its own row --
    // bars that silently do not add up to the headline are a lie.
    const assignedTotal = model.rows.reduce((sum, row) => sum + row.totalHours, 0);
    const unassigned = Math.round((model.totalContractHours - assignedTotal) * 10) / 10;
    const rows: { name: string; hours: number }[] = [...model.rows]
      .sort((left, right) => right.totalHours - left.totalHours)
      .map((row) => ({ name: row.service as string, hours: row.totalHours }));
    if (unassigned > 0.05) {
      rows.push({ name: t("drill.contractHours.unassigned"), hours: unassigned });
    }
    setDrill({
      kicker: t("drill.contractHours.kicker"),
      title: t("drill.contractHours.title"),
      headline: `${fmt(model.totalContractHours)} h`,
      subline: t("drill.contractHours.subline", { services: String(model.rows.length), projects: String(model.projectCount) }),
      rows,
      footer: t("drill.contractHours.footer"),
    });
  };

  const openUtilisationDrill = () =>
    setDrill({
      kicker: t("drill.utilisation.kicker"),
      title: t("drill.utilisation.title"),
      headline: `${fmt(overallUtilisation)}%`,
      subline: t("drill.utilisation.subline", { hours: planHours }),
      rows: [...model.utilisationOutlook]
        .sort((left, right) => right.utilisationPercent - left.utilisationPercent)
        .map((row) => ({ name: row.person, hours: row.boundContractHours, percent: row.utilisationPercent })),
      footer: t("drill.utilisation.footer"),
    });

  const openPersonDrill = (person: ManagementPerson, boundContractHours: number, utilisationPercent: number) => {
    const projects = [...model.drilldown[person]].sort(
      (left, right) => right.allocatedHours - left.allocatedHours,
    );
    setDrill({
      kicker: t("drill.person.kicker"),
      title: person,
      headline: `${fmt(boundContractHours)} h`,
      subline: t("drill.person.subline", { percent: fmt(utilisationPercent), projects: String(projects.length) }),
      rows: projects.map((project) => ({
        name: project.projectName,
        sub: project.customerName,
        hours: project.allocatedHours,
      })),
      footer: t("drill.person.footer"),
    });
  };

  const openServiceDrill = (service: string, cells: Record<ManagementPerson, number>, totalHours: number) => {
    const rows = PEOPLE.map((person) => ({ name: person, hours: cells[person] }))
      .filter((row) => row.hours > 0)
      .sort((left, right) => right.hours - left.hours);
    setDrill({
      kicker: t("drill.service.kicker"),
      title: service,
      headline: `${fmt(totalHours)} h`,
      subline: t("drill.service.subline", { count: String(rows.length) }),
      rows,
      footer: t("drill.service.footer"),
    });
  };

  return (
    <div className="flex flex-col gap-[var(--card-gap)]">
      {/*
        Commercial contract hours are withheld from a caller without
        projects:contracts:read. This page is reached on hr:contract:read, which
        is EMPLOYMENT contracts -- a different permission over different data --
        so an hr reader lands here holding one and not the other. Every hour in
        the matrix below is 0 for them because the column was never selected, so
        the banner is what stops that reading as a real allocation of zero.
      */}
      {model.budgetsWithheld && (
        <p
          data-testid="management-budgets-withheld"
          className="border border-[var(--border-strong)] bg-[var(--surface)] px-4 py-2.5 text-[12px] text-[var(--text-secondary)]"
        >
          {t("budgetsWithheld")}
        </p>
      )}

      <div className="grid gap-[var(--card-gap)] sm:grid-cols-3">
        {model.budgetsWithheld ? (
          <StatTile
            label={t("tiles.contractHours.label")}
            value="n/a"
            data-metric="management-contract-hours"
            hint={t("tiles.contractHoursWithheld")}
          />
        ) : (
        <button type="button" onClick={openContractHoursDrill} aria-label={t("tiles.contractHours.aria")} className="card-elev block w-full cursor-pointer text-left"><StatTile label={t("tiles.contractHours.label")} value={fmt(model.totalContractHours)} unit="h" tone="good" data-metric="management-contract-hours" hint={t("tiles.contractHours.hint")} /></button>
        )}
        <StatTile label={t("tiles.projects.label")} value={model.projectCount} hint={t("tiles.projects.hint")} />
        <button type="button" onClick={openUtilisationDrill} aria-label={t("tiles.outlook.aria")} className="card-elev block w-full cursor-pointer text-left"><StatTile label={t("tiles.outlook.label")} value={fmt(overallUtilisation)} unit="%" hint={t("tiles.outlook.hint", { hours: planHours })} data-metric="management-utilisation-outlook" /></button>
      </div>

      <Segmented
        ariaLabel={t("tabs.ariaLabel")}
        current={`/dashboard/management?tab=${tab}`}
        options={TABS.map(({ key, label }) => ({ href: `/dashboard/management?tab=${key}`, label }))}
      />

      {tab === "employees" && <EmployeeOwnershipOverview rows={ownershipRows} />}

      {/* Risks and data quality answer the same question ("what needs my
          attention"), so they share a tab. */}
      {/* Broken cover leads the risks tab: it is the one finding with a repair
          action attached (the picker on every row), and a pair failing together
          is more urgent than any single-project risk below. */}
      {tab === "risks" && <BrokenCoverPanel summary={brokenCover} />}

      {tab === "risks" && <ManagementProjectRisks rows={projectRiskRows} />}

      {tab === "risks" && <ManagementDataQuality rows={dataQualityRows} />}

      {tab === "customers" && <ManagementMultiServiceMatrix model={multiServiceModel} />}

      {tab === "customers" && <ManagementCustomerPortfolioView model={customerPortfolio} changeRequests={changeRequests} />}

      {tab === "overview" && (<>
      <Card className="overflow-hidden">
        <CardHeader title={t("outlook.title")} qualifier={t("outlook.qualifier", { hours: planHours })} />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] border-collapse text-left text-[12px]">
            <thead className="bg-[var(--surface-2)] font-mono text-[10px] tracking-[0.08em] text-[var(--text-faint)]">
              <tr>
                <th className="px-4 py-3 font-medium">{t("outlook.columns.person")}</th>
                <th className="px-4 py-3 text-right font-medium">{t("outlook.columns.planHours")}</th>
                <th className="px-4 py-3 text-right font-medium">{t("outlook.columns.bound")}</th>
                <th className="px-4 py-3 text-right font-medium">{t("outlook.columns.utilisation")}</th>
                <th className="px-4 py-3 text-right font-medium">{t("outlook.columns.status")}</th>
              </tr>
            </thead>
            <tbody>
              {model.utilisationOutlook.map((row) => {
                // The status value is the query module's German and is compared
                // as such; only its rendering goes through the catalogue.
                const statusClass = row.status === "Kapazitätsrisiko"
                  ? "bg-[var(--critical-wash)] text-[var(--critical)]"
                  : row.status === "Gesunde Auslastung"
                    ? "bg-[var(--good-wash)] text-[var(--good)]"
                    : "bg-[var(--warning-wash)] text-[var(--warning)]";
                return (
                  <tr
                    key={row.person}
                    className="cursor-pointer border-t border-[var(--divider)] transition-colors hover:bg-[var(--surface-hover)]"
                    onClick={() => openPersonDrill(row.person, row.boundContractHours, row.utilisationPercent)}
                  >
                    <th className="px-4 py-3 font-medium text-[var(--text-primary)]">
                      <button
                        type="button"
                        className="cursor-pointer text-left underline-offset-4 hover:text-[var(--accent)] hover:underline"
                        onClick={() => openPersonDrill(row.person, row.boundContractHours, row.utilisationPercent)}
                      >
                        {row.person}
                      </button>
                    </th>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-[var(--text-secondary)]">{fmt(row.planHoursPerYear)}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-[var(--text-secondary)]">{fmt(row.boundContractHours)} h</td>
                    <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums text-[var(--text-primary)]">{fmt(row.utilisationPercent)}%</td>
                    <td className="px-4 py-3 text-right"><span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-medium ${statusClass}`}>{t(STATUS_KEY[row.status])}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="border-t border-[var(--divider)] px-4 py-3 text-[11px] leading-relaxed text-[var(--text-muted)]">
          {t("outlook.footnote", { hours: planHours })}
        </p>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader title={t("matrix.title")} qualifier={t("matrix.qualifier")} />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-left text-[12px]">
            <thead className="bg-[var(--surface-2)] font-mono text-[10px] tracking-[0.08em] text-[var(--text-faint)]">
              <tr>
                <th className="sticky left-0 z-10 bg-[var(--surface-2)] px-4 py-3 font-medium">{t("matrix.columns.service")}</th>
                {PEOPLE.map((person) => (
                  <th key={person} className="px-3 py-3 text-right font-medium">{person.toUpperCase()}</th>
                ))}
                <th className="px-4 py-3 text-right font-medium">{t("matrix.columns.sum")}</th>
              </tr>
            </thead>
            <tbody>
              {model.rows.map((row) => (
                <tr
                  key={row.service}
                  className="cursor-pointer border-t border-[var(--divider)] transition-colors hover:bg-[var(--surface-hover)]"
                  onClick={() => openServiceDrill(row.service, row.cells, row.totalHours)}
                >
                  <th className="sticky left-0 bg-[var(--surface)] px-4 py-3 font-medium text-[var(--text-primary)]">
                    <button
                      type="button"
                      className="cursor-pointer text-left underline-offset-4 hover:text-[var(--accent)] hover:underline"
                      onClick={() => openServiceDrill(row.service, row.cells, row.totalHours)}
                    >
                      {row.service}
                    </button>
                  </th>
                  {PEOPLE.map((person) => (
                    <td key={person} className="px-3 py-3 text-right font-mono tabular-nums text-[var(--text-secondary)]">{fmt(row.cells[person])}</td>
                  ))}
                  <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums text-[var(--text-primary)]">{fmt(row.totalHours)}</td>
                </tr>
              ))}
              <tr className="border-t border-[var(--border-strong)] bg-[var(--surface-2)] font-semibold">
                <th className="sticky left-0 bg-[var(--surface-2)] px-4 py-3 text-[var(--text-primary)]">{t("matrix.total")}</th>
                {PEOPLE.map((person) => (
                  <td key={person} className="px-3 py-3 text-right font-mono tabular-nums text-[var(--text-primary)]">{fmt(totalByPerson[person])}</td>
                ))}
                <td className="px-4 py-3 text-right font-mono tabular-nums text-[var(--accent)]">{fmt(Object.values(totalByPerson).reduce((sum, value) => sum + value, 0))}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="border-t border-[var(--divider)] px-4 py-3 text-[11px] leading-relaxed text-[var(--text-muted)]">
          {t("matrix.footnote")}
        </p>
      </Card>

      </>)}

      {tab === "employees" && (
      <Card>
        <CardHeader title={t("drilldown.title")} qualifier={t("drilldown.qualifier")} />
        <div className="divide-y divide-[var(--divider)]">
          {PEOPLE.map((person) => {
            const projects = model.drilldown[person];
            const isOpen = expanded === person;
            return (
              <div key={person}>
                <button type="button" className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-[var(--surface-hover)]" onClick={() => setExpanded(isOpen ? null : person)} aria-expanded={isOpen}>
                  <span className="font-medium text-[var(--text-primary)]">{person}</span>
                  <span className="font-mono text-[11px] text-[var(--text-muted)]">{t("drilldown.projectsHours", { count: String(projects.length), hours: fmt(totalByPerson[person]) })} <span className="ml-2 text-[var(--accent)]">{isOpen ? "−" : "+"}</span></span>
                </button>
                {isOpen && (
                  <div className="bg-[var(--surface-2)] px-4 pb-3">
                    {projects.length === 0 ? <p className="py-2 text-[11px] text-[var(--text-muted)]">{t("drilldown.empty")}</p> : projects.map((project) => (
                      <div key={`${person}-${project.projectId}`} className="flex items-center justify-between gap-4 border-t border-[var(--divider)] py-2 text-[11px]">
                        <span className="min-w-0 truncate text-[var(--text-secondary)]"><span className="text-[var(--text-primary)]">{project.projectName}</span><span className="ml-2 text-[var(--text-faint)]">{project.customerName}</span></span>
                        <span className="shrink-0 font-mono tabular-nums text-[var(--text-muted)]">{fmt(project.allocatedHours)} h</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>
      )}

      {drill && <ManagementDrilldown drill={drill} onClose={() => setDrill(null)} />}

      {model.unmappedContractHours > 0 && <p className="text-[11px] text-[var(--warning)]">{t("matrix.unmapped", { hours: fmt(model.unmappedContractHours) })}</p>}
    </div>
  );
}
