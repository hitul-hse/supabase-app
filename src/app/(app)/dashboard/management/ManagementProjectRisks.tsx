import { Fragment, useState } from "react";
import { Card, CardHeader } from "@/components/ui/Card";
import type { ManagementProjectRiskRow } from "@/lib/queries/management-project-risks";

const fmt = (value: number) => new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(value);

export function ManagementProjectRisks({ rows }: { rows: ManagementProjectRiskRow[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <Card className="overflow-hidden">
      <CardHeader title="Project Risks" qualifier="OPERATIVE RISIKEN · READ MODEL" />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] border-collapse text-left text-[12px]">
          <thead className="bg-[var(--surface-2)] font-mono text-[10px] tracking-[0.08em] text-[var(--text-faint)]">
            <tr>
              <th className="px-4 py-3 font-medium">RISIKO</th>
              <th className="px-4 py-3 text-right font-medium">ANZAHL</th>
              <th className="px-4 py-3 font-medium">BEWERTUNG</th>
              <th className="px-4 py-3 font-medium">BETROFFENE PROJEKTE</th>
              <th className="px-4 py-3 font-medium">VERANTWORTLICHER</th>
              <th className="px-4 py-3 font-medium">SERVICE</th>
              <th className="px-4 py-3 text-right font-medium">VERTRAGSSTUNDEN</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isExpanded = expanded === row.category;
              const ratingClass = row.rating === "Kritisch"
                ? "bg-[var(--critical-wash)] text-[var(--critical)]"
                : "bg-[var(--warning-wash)] text-[var(--warning)]";
              const affectedProjects = row.affectedProjects.map((project) => project.project).join(", ");
              const responsible = row.responsible.join(", ");
              const services = row.services.join(", ");
              return (
                <Fragment key={row.category}>
                  <tr className="border-t border-[var(--divider)]">
                    <th className="px-4 py-3 font-medium text-[var(--text-primary)]">{row.risk}</th>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-[var(--text-secondary)]">
                      {row.count === null ? "n/a" : row.count}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-medium ${ratingClass}`}>
                        {row.rating}
                      </span>
                    </td>
                    <td className="max-w-[280px] px-4 py-3 text-[var(--text-muted)]">
                      {row.count === null ? "n/a" : affectedProjects || "Keine"}
                    </td>
                    <td className="max-w-[180px] px-4 py-3 text-[var(--text-muted)]">
                      {row.count === null ? "n/a" : responsible || "Nicht zugeordnet"}
                    </td>
                    <td className="max-w-[220px] px-4 py-3 text-[var(--text-muted)]">
                      {row.count === null ? "n/a" : services || "Nicht zugeordnet"}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-[var(--text-secondary)]">
                      {row.contractHours === null ? "n/a" : `${fmt(row.contractHours)} h`}
                    </td>
                  </tr>
                  {row.affectedProjects.length > 0 && (
                    <tr key={`${row.category}-detail`} className="border-t border-[var(--divider)] bg-[var(--surface-2)]">
                      <td colSpan={7} className="px-4 py-2">
                        <button
                          type="button"
                          className="text-[11px] font-medium text-[var(--accent)] hover:underline"
                          onClick={() => setExpanded(isExpanded ? null : row.category)}
                          aria-expanded={isExpanded}
                        >
                          {isExpanded ? "Projektrisiken ausblenden" : "Projektrisiken anzeigen"}
                        </button>
                        {isExpanded && (
                          <div className="mt-3 overflow-x-auto">
                            <table className="w-full min-w-[820px] border-collapse text-left text-[11px]">
                              <thead className="font-mono text-[10px] tracking-[0.08em] text-[var(--text-faint)]">
                                <tr>
                                  <th className="px-2 py-2 font-medium">KUNDE</th>
                                  <th className="px-2 py-2 font-medium">PROJEKT</th>
                                  <th className="px-2 py-2 font-medium">SERVICE</th>
                                  <th className="px-2 py-2 font-medium">VERANTWORTLICHER</th>
                                  <th className="px-2 py-2 font-medium">REPLACEMENT</th>
                                  <th className="px-2 py-2 text-right font-medium">VERTRAGSSTUNDEN</th>
                                  <th className="px-2 py-2 font-medium">STATUS</th>
                                </tr>
                              </thead>
                              <tbody>
                                {row.affectedProjects.map((project) => (
                                  <tr key={`${row.category}-${project.projectId}`} className="border-t border-[var(--divider)]">
                                    <td className="px-2 py-2 text-[var(--text-secondary)]">
                                      {project.customer} {project.customerMapping === "missing" && <span className="text-[var(--critical)]">· Mapping fehlt</span>}
                                    </td>
                                    <td className="px-2 py-2 text-[var(--text-primary)]">{project.project}</td>
                                    <td className="px-2 py-2 text-[var(--text-secondary)]">{project.service}</td>
                                    <td className="px-2 py-2 text-[var(--text-secondary)]">{project.responsible ?? "Nicht zugeordnet"}</td>
                                    <td className="px-2 py-2 text-[var(--text-secondary)]">{project.replacement ?? "n/a"}</td>
                                    <td className="px-2 py-2 text-right font-mono tabular-nums text-[var(--text-secondary)]">
                                      {project.contractHours === null ? "n/a" : `${fmt(project.contractHours)} h`}
                                    </td>
                                    <td className="px-2 py-2 text-[var(--text-secondary)]">{project.status ?? "Fehlt"}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="border-t border-[var(--divider)] px-4 py-3 text-[11px] leading-relaxed text-[var(--text-muted)]">
        High-Dependency- und Replacement-Risiken werden erst nach fachlicher Validierung der Schwellen bzw. der servicebezogenen Relation berechnet. Fehlende Grundlagen werden als n/a ausgewiesen.
      </p>
    </Card>
  );
}
