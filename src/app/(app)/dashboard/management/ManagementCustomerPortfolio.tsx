"use client";

import { Fragment, useState } from "react";
import { Card, CardHeader } from "@/components/ui/Card";
import type { CustomerPortfolioRow, ManagementCustomerPortfolio } from "@/lib/queries/management-customer-portfolio";

const fmt = (value: number) => new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(value);
const operationalLinks = ["Asana", "Chat", "TrackingTime", "Drive", "Microsoft Teams"] as const;

function CustomerDetail({ row }: { row: CustomerPortfolioRow }) {
  return (
    <div className="space-y-4 bg-[var(--surface-2)] px-4 py-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <div><p className="font-mono text-[10px] tracking-[0.08em] text-[var(--text-faint)]">STAMMDATEN</p><p className="mt-1 text-[12px] text-[var(--text-primary)]">{row.customer}</p><p className="text-[11px] text-[var(--text-muted)]">Legal Entity: {row.legalEntity}</p></div>
        <div><p className="font-mono text-[10px] tracking-[0.08em] text-[var(--text-faint)]">STANDORTE</p><p className="mt-1 text-[11px] text-[var(--text-muted)]">{row.locationsAvailable ? row.locations.join(", ") || "Keine" : "n/a · Standortmodell nicht verfügbar"}</p></div>
        <div><p className="font-mono text-[10px] tracking-[0.08em] text-[var(--text-faint)]">RISIKEN</p><p className="mt-1 text-[11px] text-[var(--text-muted)]">{row.risks.length > 0 ? row.risks.join(" · ") : "Keine erkannten Risiken"}</p></div>
      </div>

      <div>
        <p className="font-mono text-[10px] tracking-[0.08em] text-[var(--text-faint)]">SERVICES</p>
        <div className="mt-2 overflow-x-auto"><table className="w-full min-w-[540px] border-collapse text-left text-[11px]"><thead className="font-mono text-[10px] tracking-[0.08em] text-[var(--text-faint)]"><tr><th className="px-2 py-2 font-medium">SERVICE</th><th className="px-2 py-2 text-right font-medium">VERTRAGSH</th><th className="px-2 py-2 font-medium">VERANTWORTLICHER</th></tr></thead><tbody>{row.services.map((service) => <tr key={service.service} className="border-t border-[var(--divider)]"><th className="px-2 py-2 font-medium text-[var(--text-primary)]">{service.service}</th><td className="px-2 py-2 text-right font-mono tabular-nums text-[var(--text-secondary)]">{service.contractHours === null ? "n/a" : `${fmt(service.contractHours)} h`}</td><td className="px-2 py-2 text-[var(--text-secondary)]">{service.responsible.join(", ") || "Nicht zugeordnet"}</td></tr>)}</tbody></table></div>
      </div>

      <div>
        <p className="font-mono text-[10px] tracking-[0.08em] text-[var(--text-faint)]">PROJEKTE</p>
        <div className="mt-2 overflow-x-auto"><table className="w-full min-w-[820px] border-collapse text-left text-[11px]"><thead className="font-mono text-[10px] tracking-[0.08em] text-[var(--text-faint)]"><tr><th className="px-2 py-2 font-medium">PROJEKT</th><th className="px-2 py-2 font-medium">SERVICE</th><th className="px-2 py-2 text-right font-medium">STUNDEN</th><th className="px-2 py-2 font-medium">STATUS</th><th className="px-2 py-2 font-medium">VERANTWORTLICHER</th></tr></thead><tbody>{row.projects.map((project) => <tr key={project.projectId} className="border-t border-[var(--divider)]"><th className="px-2 py-2 font-medium text-[var(--text-primary)]">{project.project}</th><td className="px-2 py-2 text-[var(--text-secondary)]">{project.service}</td><td className="px-2 py-2 text-right font-mono tabular-nums text-[var(--text-secondary)]">{project.contractHours === null ? "n/a" : `${fmt(project.contractHours)} h`}</td><td className="px-2 py-2 text-[var(--text-secondary)]">{project.status ?? "Fehlt"}</td><td className="px-2 py-2 text-[var(--text-secondary)]">{project.responsible.join(", ") || "Nicht zugeordnet"}</td></tr>)}</tbody></table></div>
      </div>

      <div><p className="font-mono text-[10px] tracking-[0.08em] text-[var(--text-faint)]">OPERATIVE LINKS · NUR ANZEIGE</p><div className="mt-2 flex flex-wrap gap-2">{operationalLinks.map((label) => <span key={label} className="rounded-full bg-[var(--surface)] px-2 py-1 text-[10px] text-[var(--text-muted)]">{label}: n/a</span>)}</div><p className="mt-2 text-[11px] text-[var(--text-muted)]">Im aktuellen Projekt-Read-Model sind keine belastbaren URL-Felder für diese Linktypen vorhanden.</p></div>
    </div>
  );
}

export function ManagementCustomerPortfolio({ model }: { model: ManagementCustomerPortfolio }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <Card className="overflow-hidden">
      <CardHeader title="Customer Portfolio" qualifier="KUNDEN · LEGAL ENTITIES · OPERATIVE STEUERUNG" />
      <div className="overflow-x-auto"><table className="w-full min-w-[980px] border-collapse text-left text-[12px]"><thead className="bg-[var(--surface-2)] font-mono text-[10px] tracking-[0.08em] text-[var(--text-faint)]"><tr><th className="px-4 py-3 font-medium">KUNDE</th><th className="px-4 py-3 font-medium">LEGAL ENTITY</th><th className="px-4 py-3 font-medium">AKTIVE SERVICES</th><th className="px-4 py-3 text-right font-medium">PROJEKTE</th><th className="px-4 py-3 text-right font-medium">VERTRAGSH</th><th className="px-4 py-3 font-medium">VERANTWORTLICHE</th><th className="px-4 py-3 font-medium">RISIKEN</th></tr></thead><tbody>{model.rows.length === 0 ? <tr className="border-t border-[var(--divider)]"><td colSpan={7} className="px-4 py-6 text-center text-[var(--text-muted)]">{model.customerMappingAvailable ? "Keine aktiven, stabil zugeordneten Kundenprojekte verfügbar." : "Customer-Master-Mapping nicht verfügbar."}</td></tr> : model.rows.map((row) => { const isExpanded = expanded === row.legalEntityId; return <Fragment key={row.legalEntityId}><tr className="border-t border-[var(--divider)]"><th className="px-4 py-3 font-medium text-[var(--text-primary)]"><button type="button" className="text-left hover:text-[var(--accent)]" onClick={() => setExpanded(isExpanded ? null : row.legalEntityId)} aria-expanded={isExpanded}>{row.customer}</button></th><td className="px-4 py-3 text-[var(--text-secondary)]">{row.legalEntity}</td><td className="max-w-[260px] px-4 py-3 text-[var(--text-secondary)]">{row.activeServices.join(", ") || "Nicht zugeordnet"}</td><td className="px-4 py-3 text-right font-mono tabular-nums text-[var(--text-secondary)]">{row.projectCount}</td><td className="px-4 py-3 text-right font-mono tabular-nums text-[var(--text-secondary)]">{row.contractHours === null ? "n/a" : `${fmt(row.contractHours)} h`}</td><td className="max-w-[200px] px-4 py-3 text-[var(--text-secondary)]">{row.responsible.join(", ") || "Nicht zugeordnet"}</td><td className="max-w-[240px] px-4 py-3 text-[var(--text-muted)]">{row.risks.length > 0 ? row.risks.join(" · ") : "Keine"}</td></tr>{isExpanded && <tr className="border-t border-[var(--divider)]"><td colSpan={7}><CustomerDetail row={row} /></td></tr>}</Fragment>; })}</tbody></table></div>
      <div className="border-t border-[var(--divider)] px-4 py-3 text-[11px] leading-relaxed text-[var(--text-muted)]"><p>Nur Projekte mit aktivem/offenem Status und stabiler Legal-Entity-Zuordnung werden in Kundenzeilen aggregiert.</p>{(model.projectsWithoutCustomerMapping !== 0 || model.projectsWithoutServiceMapping !== 0) && <p className="mt-2 text-[var(--warning)]">Datenqualität: {model.projectsWithoutCustomerMapping === null ? "Customer Mapping n/a" : `${model.projectsWithoutCustomerMapping} Projekte ohne Customer Mapping`} · {model.projectsWithoutServiceMapping === null ? "Service Mapping n/a" : `${model.projectsWithoutServiceMapping} Projekte ohne Service Mapping`}.</p>}</div>
    </Card>
  );
}
