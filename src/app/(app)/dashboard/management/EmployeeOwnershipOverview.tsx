"use client";

import { useState } from "react";
import { Card, CardHeader } from "@/components/ui/Card";
import type { EmployeeOwnershipRow } from "@/lib/queries/management-employee-ownership";

const fmt = (value: number) => new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(value);

export function EmployeeOwnershipOverview({ rows }: { rows: EmployeeOwnershipRow[] }) {
  const [selectedPerson, setSelectedPerson] = useState(rows[0]?.person ?? null);
  const selected = rows.find((row) => row.person === selectedPerson) ?? rows[0] ?? null;

  if (!selected) return null;

  return (
    <div className="flex flex-col gap-[var(--card-gap)]">
      <Card className="overflow-hidden">
        <CardHeader title="Employee Overview" qualifier="KUNDENVERANTWORTUNG · VERTRETUNGSFÄHIGKEIT" />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse text-left text-[12px]">
            <thead className="bg-[var(--surface-2)] font-mono text-[10px] tracking-[0.08em] text-[var(--text-faint)]">
              <tr>
                <th className="px-4 py-3 font-medium">MITARBEITER</th>
                <th className="px-3 py-3 text-right font-medium">OFFENE PROJEKTE</th>
                <th className="px-3 py-3 text-right font-medium">VERTRAGSSTUNDEN</th>
                <th className="px-3 py-3 text-right font-medium">SERVICES</th>
                <th className="px-3 py-3 text-right font-medium">REPLACEMENT-ABDECKUNG</th>
                <th className="px-4 py-3 text-right font-medium">OHNE REPLACEMENT</th>
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
                  <td className="px-3 py-3 text-right font-mono tabular-nums text-[var(--text-secondary)]">{row.replacementCoveragePercent === null ? "n/a" : `${fmt(row.replacementCoveragePercent)}%`}</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-[var(--text-secondary)]">{row.projectsWithoutReplacement === null ? "n/a" : row.projectsWithoutReplacement}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-[var(--divider)] px-4 py-3 text-[11px] leading-relaxed text-[var(--text-muted)]">
          {rows.some((row) => row.replacementRelationAvailable)
            ? "Replacement aus den Masterdaten: eine Zuordnung mit 0% Anteil ist die benannte Vertretung (zugewiesen, trägt keine Stunden). Abdeckung = Projekte mit benannter Vertretung / offene Projekte."
            : "Im aktuellen Read Model existiert keine Replacement-Zuordnung; Abdeckung und Fehlmenge werden als n/a dargestellt."}
        </p>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader title={`Betreuerportfolio · ${selected.person}`} qualifier="OFFENE PROJEKTE" />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse text-left text-[12px]">
            <thead className="bg-[var(--surface-2)] font-mono text-[10px] tracking-[0.08em] text-[var(--text-faint)]">
              <tr>
                <th className="px-4 py-3 font-medium">KUNDE</th>
                <th className="px-3 py-3 font-medium">PROJEKT</th>
                <th className="px-3 py-3 font-medium">SERVICE</th>
                <th className="px-3 py-3 text-right font-medium">VERTRAGSSTUNDEN</th>
                <th className="px-3 py-3 font-medium">VERANTWORTLICHER</th>
                <th className="px-4 py-3 font-medium">REPLACEMENT</th>
              </tr>
            </thead>
            <tbody>
              {selected.projects.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-[var(--text-muted)]">Keine offenen Projekte im Read Model.</td></tr>
              ) : selected.projects.map((project) => (
                <tr key={`${selected.person}-${project.projectId}`} className="border-t border-[var(--divider)]">
                  <td className={`px-4 py-3 ${project.customerMappingMissing ? "text-[var(--warning)]" : "text-[var(--text-secondary)]"}`}>{project.customerName}{project.customerMappingMissing ? " · Mapping fehlt" : ""}</td>
                  <td className="px-3 py-3 text-[var(--text-primary)]">{project.projectName}</td>
                  <td className="px-3 py-3 text-[var(--text-secondary)]">{project.service}</td>
                  <td className="px-3 py-3 text-right font-mono tabular-nums text-[var(--text-secondary)]">{fmt(project.contractHours)} h</td>
                  <td className="px-3 py-3 text-[var(--text-secondary)]">{project.responsiblePerson ?? "n/a"}</td>
                  <td className="px-4 py-3 text-[var(--text-muted)]">{project.replacementPerson ?? "n/a"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
