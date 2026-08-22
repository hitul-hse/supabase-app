"use client";

import { useState } from "react";
import { Card, CardHeader, StatTile } from "@/components/ui/Card";
import type { ManagementContractHours, ManagementPerson } from "@/lib/queries/management-contract-hours";
import { ANNUAL_PLAN_HOURS, PEOPLE } from "@/lib/queries/management-contract-hours";
import type { EmployeeOwnershipRow } from "@/lib/queries/management-employee-ownership";
import { EmployeeOwnershipOverview } from "./EmployeeOwnershipOverview";

const fmt = (value: number) => new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(value);

export function ManagementMatrix({ model, ownershipRows }: { model: ManagementContractHours; ownershipRows: EmployeeOwnershipRow[] }) {
  const [expanded, setExpanded] = useState<ManagementPerson | null>(null);
  const totalByPerson = Object.fromEntries(
    PEOPLE.map((person) => [person, model.rows.reduce((sum, row) => sum + row.cells[person], 0)]),
  ) as Record<ManagementPerson, number>;
  const overallUtilisation = Math.round(
    (model.utilisationOutlook.reduce((sum, row) => sum + row.boundContractHours, 0) /
      (model.utilisationOutlook.length * ANNUAL_PLAN_HOURS)) * 1000,
  ) / 10;

  return (
    <div className="flex flex-col gap-[var(--card-gap)]">
      <div className="grid gap-[var(--card-gap)] sm:grid-cols-3">
        <StatTile label="GESAMT VERTRAGSSTUNDEN" value={fmt(model.totalContractHours)} unit="h" tone="good" data-metric="management-contract-hours" />
        <StatTile label="PROJEKTE IM READ MODEL" value={model.projectCount} hint="public.projects · keine Dummy-Daten" />
        <StatTile label="AUSLASTUNGSAUSBLICK" value={fmt(overallUtilisation)} unit="%" hint="1.304 Planstunden/Jahr je Mitarbeiter" data-metric="management-utilisation-outlook" />
      </div>

      <EmployeeOwnershipOverview rows={ownershipRows} />

      <Card className="overflow-hidden">
        <CardHeader title="Auslastungsausblick" qualifier={`GEBUNDENE VERTRAGSSTUNDEN / ${ANNUAL_PLAN_HOURS.toLocaleString("de-DE")} PLANSTUNDEN · 75% BILLABLE CAPACITY`} />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] border-collapse text-left text-[12px]">
            <thead className="bg-[var(--surface-2)] font-mono text-[10px] tracking-[0.08em] text-[var(--text-faint)]">
              <tr>
                <th className="px-4 py-3 font-medium">MITARBEITER</th>
                <th className="px-4 py-3 text-right font-medium">PLANSTUNDEN / JAHR</th>
                <th className="px-4 py-3 text-right font-medium">GEBUNDEN</th>
                <th className="px-4 py-3 text-right font-medium">AUSLASTUNG</th>
                <th className="px-4 py-3 text-right font-medium">STATUS</th>
              </tr>
            </thead>
            <tbody>
              {model.utilisationOutlook.map((row) => {
                const statusClass = row.status === "Kapazitätsrisiko"
                  ? "bg-[var(--critical-wash)] text-[var(--critical)]"
                  : row.status === "Gesunde Auslastung"
                    ? "bg-[var(--good-wash)] text-[var(--good)]"
                    : "bg-[var(--warning-wash)] text-[var(--warning)]";
                return (
                  <tr key={row.person} className="border-t border-[var(--divider)]">
                    <th className="px-4 py-3 font-medium text-[var(--text-primary)]">{row.person}</th>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-[var(--text-secondary)]">{fmt(row.planHoursPerYear)}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-[var(--text-secondary)]">{fmt(row.boundContractHours)} h</td>
                    <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums text-[var(--text-primary)]">{fmt(row.utilisationPercent)}%</td>
                    <td className="px-4 py-3 text-right"><span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-medium ${statusClass}`}>{row.status}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="border-t border-[var(--divider)] px-4 py-3 text-[11px] leading-relaxed text-[var(--text-muted)]">
          Ampel: &lt;50% Unterauslastung · 50–90% Gesunde Auslastung · &gt;90% Kapazitätsrisiko. Die {ANNUAL_PLAN_HOURS.toLocaleString("de-DE")} Planstunden entsprechen 75% billable capacity.
        </p>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader title="Service × Mitarbeiter" qualifier="VERTRAGSSTUNDEN · ASSIGNMENT-ANTEIL" />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-left text-[12px]">
            <thead className="bg-[var(--surface-2)] font-mono text-[10px] tracking-[0.08em] text-[var(--text-faint)]">
              <tr>
                <th className="sticky left-0 z-10 bg-[var(--surface-2)] px-4 py-3 font-medium">SERVICE</th>
                {PEOPLE.map((person) => (
                  <th key={person} className="px-3 py-3 text-right font-medium">{person.toUpperCase()}</th>
                ))}
                <th className="px-4 py-3 text-right font-medium">SUM</th>
              </tr>
            </thead>
            <tbody>
              {model.rows.map((row) => (
                <tr key={row.service} className="border-t border-[var(--divider)]">
                  <th className="sticky left-0 bg-[var(--surface)] px-4 py-3 font-medium text-[var(--text-primary)]">{row.service}</th>
                  {PEOPLE.map((person) => (
                    <td key={person} className="px-3 py-3 text-right font-mono tabular-nums text-[var(--text-secondary)]">{fmt(row.cells[person])}</td>
                  ))}
                  <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums text-[var(--text-primary)]">{fmt(row.totalHours)}</td>
                </tr>
              ))}
              <tr className="border-t border-[var(--border-strong)] bg-[var(--surface-2)] font-semibold">
                <th className="sticky left-0 bg-[var(--surface-2)] px-4 py-3 text-[var(--text-primary)]">TOTAL</th>
                {PEOPLE.map((person) => (
                  <td key={person} className="px-3 py-3 text-right font-mono tabular-nums text-[var(--text-primary)]">{fmt(totalByPerson[person])}</td>
                ))}
                <td className="px-4 py-3 text-right font-mono tabular-nums text-[var(--accent)]">{fmt(Object.values(totalByPerson).reduce((sum, value) => sum + value, 0))}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="border-t border-[var(--divider)] px-4 py-3 text-[11px] leading-relaxed text-[var(--text-muted)]">
          Zellen = Projekt-Vertragsstunden × `person_assignments.share_percent`. Projekte ohne belastbare Service-Verknüpfung werden separat als „Nicht zugeordnet“ ausgewiesen.
        </p>
      </Card>

      <Card>
        <CardHeader title="Drilldown" qualifier="MITARBEITER → PROJEKTE → KUNDEN" />
        <div className="divide-y divide-[var(--divider)]">
          {PEOPLE.map((person) => {
            const projects = model.drilldown[person];
            const isOpen = expanded === person;
            return (
              <div key={person}>
                <button type="button" className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-[var(--surface-hover)]" onClick={() => setExpanded(isOpen ? null : person)} aria-expanded={isOpen}>
                  <span className="font-medium text-[var(--text-primary)]">{person}</span>
                  <span className="font-mono text-[11px] text-[var(--text-muted)]">{projects.length} Projekte · {fmt(totalByPerson[person])} h <span className="ml-2 text-[var(--accent)]">{isOpen ? "−" : "+"}</span></span>
                </button>
                {isOpen && (
                  <div className="bg-[var(--surface-2)] px-4 pb-3">
                    {projects.length === 0 ? <p className="py-2 text-[11px] text-[var(--text-muted)]">Keine zugeordneten Vertragsstunden im Read Model.</p> : projects.map((project) => (
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

      {model.unmappedContractHours > 0 && <p className="text-[11px] text-[var(--warning)]">{fmt(model.unmappedContractHours)} h sind aktuell nicht über `time.project.hub_project_id` einem Service zugeordnet.</p>}
    </div>
  );
}
