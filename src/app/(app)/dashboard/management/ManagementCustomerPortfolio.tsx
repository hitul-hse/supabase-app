"use client";

/**
 * Customer Portfolio on the shared table primitive.
 *
 * WHY: 93 rows rendered unpaged made this card 6,666px tall on its own. The rows
 * are paged (25 by default) and the body is bounded, so the card is a fixed,
 * predictable height whatever the data does. Nothing is removed: the totals in
 * the footnote are computed over ALL rows, the row count is always on screen,
 * and every caveat the old markup carried is still rendered.
 *
 * The per-customer drilldown (Stammdaten / Services / Projekte / Links) used to
 * be an extra <tr> injected under the clicked row. DataTable owns the row markup,
 * so the drilldown now opens beneath the table instead — same content, same
 * actions, and it no longer doubles the table's height when opened.
 */
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DataTable, cmpNum, cmpText, type Column } from "@/components/data-table/DataTable";
import type { CustomerPortfolioRow, ManagementCustomerPortfolio } from "@/lib/queries/management-customer-portfolio";
import type { ManagementChangeRequest } from "@/lib/queries/management-change-requests";
import { decideResponsibleChange, requestResponsibleChange, type ManagementChangeActionState } from "./actions";

const fmt = (value: number) => new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(value);
const operationalLinks = ["Asana", "Chat", "TrackingTime", "Drive", "Microsoft Teams"] as const;

const IDLE: ManagementChangeActionState = { status: "idle" };

function ResponsibleEditor({ project, people }: { project: CustomerPortfolioRow["projects"][number]; people: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(requestResponsibleChange, IDLE);
  const [selected, setSelected] = useState(project.responsiblePersonId ?? "");
  const router = useRouter();
  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [router, state.status]);

  return (
    <details className="group">
      <summary className="cursor-pointer list-none text-[var(--accent)] underline-offset-2 hover:underline">
        {project.responsible.join(", ") || "Nicht zugeordnet"} <span className="text-[10px]">▾</span>
      </summary>
      <form action={action} className="mt-2 flex min-w-[240px] flex-col gap-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] p-2">
        <input type="hidden" name="project_id" value={project.projectId} />
        <label className="font-mono text-[9px] tracking-[0.08em] text-[var(--text-faint)]">NEUER VERANTWORTLICHER</label>
        <select name="person_id" value={selected} onChange={(event) => setSelected(event.target.value)} className="rounded border border-[var(--border-strong)] bg-[var(--surface)] px-2 py-1.5 text-[11px] text-[var(--text-primary)]" required>
          <option value="">Auswählen …</option>
          {people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
        </select>
        <input name="reason" placeholder="Grund, z. B. Urlaub / Ausscheiden" className="rounded border border-[var(--border-strong)] bg-[var(--surface)] px-2 py-1.5 text-[11px] text-[var(--text-primary)]" minLength={3} required />
        <button type="submit" disabled={pending || !selected} className="rounded bg-[var(--accent)] px-2 py-1.5 text-[10px] font-medium text-white disabled:opacity-50">{pending ? "Antrag wird erstellt …" : "Änderungsantrag erstellen"}</button>
        {state.message && <p className={`text-[10px] ${state.status === "error" ? "text-[var(--critical)]" : "text-[var(--good)]"}`}>{state.message}</p>}
      </form>
    </details>
  );
}

function ReplacementPlaceholder() {
  return <button type="button" disabled title="Replacement benötigt ein bestätigtes servicebezogenes Modell" className="cursor-not-allowed text-left text-[var(--text-faint)]">Replacement: n/a</button>;
}

function ChangeRequestQueue({ requests }: { requests: ManagementChangeRequest[] }) {
  if (!requests.length) return null;
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] px-4 py-4 card-elev">
      <p className="font-mono text-[10px] tracking-[0.08em] text-[var(--text-faint)]">OFFENE ÄNDERUNGSANTRÄGE · VIER-AUGEN-FREIGABE · {requests.length}</p>
      <div className="mt-2 space-y-2">
        {requests.map((request) => <ChangeRequestItem key={request.id} request={request} />)}
      </div>
    </div>
  );
}

function ChangeRequestItem({ request }: { request: ManagementChangeRequest }) {
  const [state, action, pending] = useActionState(decideResponsibleChange, IDLE);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] p-3 text-[11px]">
      <input type="hidden" name="request_id" value={request.id} />
      <div className="min-w-[220px] flex-1"><p className="font-medium text-[var(--text-primary)]">{request.projectName}</p><p className="text-[var(--text-muted)]">→ {request.requestedPerson} · {request.reason}</p></div>
      <input name="reason" placeholder="Entscheidungsgrund" className="min-w-[180px] rounded border border-[var(--border-strong)] bg-[var(--surface)] px-2 py-1.5 text-[11px] text-[var(--text-primary)]" minLength={3} required />
      <button name="decision" value="reject" type="submit" disabled={pending} className="rounded border border-[var(--border-strong)] px-2 py-1.5 text-[10px] text-[var(--text-secondary)] disabled:opacity-50">Ablehnen</button>
      <button name="decision" value="approve" type="submit" disabled={pending} className="rounded bg-[var(--good)] px-2 py-1.5 text-[10px] font-medium text-white disabled:opacity-50">Freigeben</button>
      {state.message && <p className={`basis-full text-[10px] ${state.status === "error" ? "text-[var(--critical)]" : "text-[var(--good)]"}`}>{state.message}</p>}
    </form>
  );
}

function CustomerDetail({ row, people, onClose }: { row: CustomerPortfolioRow; people: { id: string; name: string }[]; onClose: () => void }) {
  return (
    <div className="space-y-4 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface-2)] px-4 py-4 card-elev">
      <div className="flex items-start justify-between gap-4">
        <p className="font-mono text-[10px] tracking-[0.08em] text-[var(--text-faint)]">DETAIL · {row.customer.toUpperCase()}</p>
        <button type="button" onClick={onClose} className="font-mono text-[10px] text-[var(--text-faint)] hover:text-[var(--critical)]">SCHLIESSEN ×</button>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div><p className="font-mono text-[10px] tracking-[0.08em] text-[var(--text-faint)]">STAMMDATEN</p><p className="mt-1 text-[12px] text-[var(--text-primary)]">{row.customer}</p><p className="text-[11px] text-[var(--text-muted)]">Legal Entity: {row.legalEntity}</p></div>
        <div><p className="font-mono text-[10px] tracking-[0.08em] text-[var(--text-faint)]">STANDORTE</p><p className="mt-1 text-[11px] text-[var(--text-muted)]">{row.locationsAvailable ? row.locations.join(", ") || "Keine" : "n/a · Standortmodell nicht verfügbar"}</p></div>
        <div><p className="font-mono text-[10px] tracking-[0.08em] text-[var(--text-faint)]">RISIKEN</p><p className="mt-1 text-[11px] text-[var(--text-muted)]">{row.risks.length > 0 ? row.risks.join(" · ") : "Keine erkannten Risiken"}</p></div>
      </div>

      <div>
        <p className="font-mono text-[10px] tracking-[0.08em] text-[var(--text-faint)]">SERVICES · {row.services.length}</p>
        <div className="mt-2 max-h-[16rem] overflow-auto"><table className="w-full min-w-[540px] border-collapse text-left text-[11px]"><thead className="sticky top-0 bg-[var(--surface-2)] font-mono text-[10px] tracking-[0.08em] text-[var(--text-faint)]"><tr><th className="px-2 py-2 font-medium">SERVICE</th><th className="px-2 py-2 text-right font-medium">VERTRAGSH</th><th className="px-2 py-2 font-medium">VERANTWORTLICHER</th></tr></thead><tbody>{row.services.map((service) => <tr key={service.service} className="border-t border-[var(--divider)]"><th className="px-2 py-2 font-medium text-[var(--text-primary)]">{service.service}</th><td className="px-2 py-2 text-right font-mono tabular-nums text-[var(--text-secondary)]">{service.contractHours === null ? "n/a" : `${fmt(service.contractHours)} h`}</td><td className="px-2 py-2 text-[var(--text-secondary)]">{service.responsible.join(", ") || "Nicht zugeordnet"}</td></tr>)}</tbody></table></div>
      </div>

      <div>
        <p className="font-mono text-[10px] tracking-[0.08em] text-[var(--text-faint)]">PROJEKTE · {row.projects.length}</p>
        <div className="mt-2 max-h-[20rem] overflow-auto"><table className="w-full min-w-[900px] border-collapse text-left text-[11px]"><thead className="sticky top-0 bg-[var(--surface-2)] font-mono text-[10px] tracking-[0.08em] text-[var(--text-faint)]"><tr><th className="px-2 py-2 font-medium">PROJEKT</th><th className="px-2 py-2 font-medium">SERVICE</th><th className="px-2 py-2 text-right font-medium">STUNDEN</th><th className="px-2 py-2 font-medium">STATUS</th><th className="px-2 py-2 font-medium">VERANTWORTLICHER</th><th className="px-2 py-2 font-medium">REPLACEMENT</th></tr></thead><tbody>{row.projects.map((project) => <tr key={project.projectId} className="border-t border-[var(--divider)]"><th className="px-2 py-2 font-medium text-[var(--text-primary)]">{project.project}</th><td className="px-2 py-2 text-[var(--text-secondary)]">{project.service}</td><td className="px-2 py-2 text-right font-mono tabular-nums text-[var(--text-secondary)]">{project.contractHours === null ? "n/a" : `${fmt(project.contractHours)} h`}</td><td className="px-2 py-2 text-[var(--text-secondary)]">{project.status ?? "Fehlt"}</td><td className="px-2 py-2 text-[var(--text-secondary)]"><ResponsibleEditor project={project} people={people} /></td><td className="px-2 py-2 text-[var(--text-secondary)]"><ReplacementPlaceholder /></td></tr>)}</tbody></table></div>
      </div>

      <div><p className="font-mono text-[10px] tracking-[0.08em] text-[var(--text-faint)]">OPERATIVE LINKS · NUR ANZEIGE</p><div className="mt-2 flex flex-wrap gap-2">{operationalLinks.map((label) => <span key={label} className="rounded-full bg-[var(--surface)] px-2 py-1 text-[10px] text-[var(--text-muted)]">{label}: n/a</span>)}</div><p className="mt-2 text-[11px] text-[var(--text-muted)]">Im aktuellen Projekt-Read-Model sind keine belastbaren URL-Felder für diese Linktypen vorhanden.</p></div>
    </div>
  );
}

export function ManagementCustomerPortfolio({ model, people, changeRequests }: { model: ManagementCustomerPortfolio; people: { id: string; name: string }[]; changeRequests: ManagementChangeRequest[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const rows = model.rows;
  const openRow = rows.find((row) => row.legalEntityId === expanded) ?? null;

  // Totals over EVERY row, never over the page on screen.
  const totalProjects = rows.reduce((sum, row) => sum + row.projectCount, 0);
  const hoursKnown = rows.filter((row) => row.contractHours !== null);
  const totalHours = hoursKnown.reduce((sum, row) => sum + (row.contractHours ?? 0), 0);
  const hoursUnknown = rows.length - hoursKnown.length;
  const withRisks = rows.filter((row) => row.risks.length > 0).length;

  const columns: Column<CustomerPortfolioRow>[] = [
    {
      key: "customer",
      header: "KUNDE",
      className: "min-w-[13rem]",
      compare: (a, b) => cmpText(a.customer, b.customer),
      descFirst: false,
      cell: (row) => (
        <button
          type="button"
          className={`text-left font-medium hover:text-[var(--accent)] ${expanded === row.legalEntityId ? "text-[var(--accent)]" : "text-[var(--text-primary)]"}`}
          onClick={() => setExpanded(expanded === row.legalEntityId ? null : row.legalEntityId)}
          aria-expanded={expanded === row.legalEntityId}
          title="Detail zu Services, Projekten und Links öffnen"
        >
          {row.customer}
        </button>
      ),
      csv: (row) => row.customer,
      search: (row) => row.customer,
    },
    {
      key: "legalEntity",
      header: "LEGAL ENTITY",
      compare: (a, b) => cmpText(a.legalEntity, b.legalEntity),
      descFirst: false,
      cell: (row) => <span className="text-[var(--text-secondary)]">{row.legalEntity}</span>,
      csv: (row) => row.legalEntity,
      search: (row) => row.legalEntity,
    },
    {
      key: "activeServices",
      header: "AKTIVE SERVICES",
      className: "max-w-[260px]",
      compare: (a, b) => a.activeServices.length - b.activeServices.length,
      cell: (row) => <span className="text-[var(--text-secondary)]">{row.activeServices.join(", ") || "Nicht zugeordnet"}</span>,
      csv: (row) => row.activeServices.join(" | ") || "Nicht zugeordnet",
      search: (row) => row.activeServices.join(" "),
      title: "Sortiert nach Anzahl aktiver Services",
    },
    {
      key: "projectCount",
      header: "PROJEKTE",
      align: "right",
      compare: (a, b) => a.projectCount - b.projectCount,
      cell: (row) => <span className="font-mono tabular-nums text-[var(--text-secondary)]">{row.projectCount}</span>,
      csv: (row) => row.projectCount,
    },
    {
      key: "contractHours",
      header: "VERTRAGSH",
      align: "right",
      compare: (a, b) => cmpNum(a.contractHours, b.contractHours),
      cell: (row) => (
        <span className="font-mono tabular-nums text-[var(--text-secondary)]">
          {row.contractHours === null ? "n/a" : `${fmt(row.contractHours)} h`}
        </span>
      ),
      csv: (row) => (row.contractHours === null ? "n/a" : row.contractHours),
    },
    {
      key: "responsible",
      header: "VERANTWORTLICHE",
      className: "max-w-[200px]",
      compare: (a, b) => cmpText(a.responsible[0] ?? null, b.responsible[0] ?? null),
      descFirst: false,
      cell: (row) => <span className="text-[var(--text-secondary)]">{row.responsible.join(", ") || "Nicht zugeordnet"}</span>,
      csv: (row) => row.responsible.join(" | ") || "Nicht zugeordnet",
      search: (row) => row.responsible.join(" "),
    },
    {
      key: "risks",
      header: "RISIKEN",
      className: "max-w-[240px]",
      compare: (a, b) => a.risks.length - b.risks.length,
      cell: (row) => <span className="text-[var(--text-muted)]">{row.risks.length > 0 ? row.risks.join(" · ") : "Keine"}</span>,
      csv: (row) => (row.risks.length > 0 ? row.risks.join(" | ") : "Keine"),
      search: (row) => row.risks.join(" "),
    },
  ];

  return (
    <div className="flex flex-col gap-[var(--card-gap)]">
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(row) => row.legalEntityId}
        title="Customer Portfolio"
        hint="KUNDEN · LEGAL ENTITIES · OPERATIVE STEUERUNG · Kunde anklicken für Detail"
        exportName="customer-portfolio"
        searchPlaceholder="Kunde, Service, Person…"
        defaultPageSize={25}
        freezeFirstColumn
        maxBodyHeight="52vh"
        collapsible
        defaultOpen
        summary={`${rows.length} Kunden · ${totalProjects} Projekte · ${fmt(totalHours)} h · ${withRisks} mit Risiken`}
        emptyText={
          model.customerMappingAvailable
            ? "Keine aktiven, stabil zugeordneten Kundenprojekte verfügbar."
            : "Customer-Master-Mapping nicht verfügbar."
        }
        footnote={
          <span className="block space-y-1 leading-relaxed">
            <span className="block text-[var(--text-secondary)]">
              Gesamt über alle {rows.length} Kunden: {totalProjects} Projekte · {fmt(totalHours)} h Vertragsstunden
              {hoursUnknown > 0 ? ` (${hoursUnknown} Kunden ohne belastbare Stunden: n/a)` : ""} · {withRisks} Kunden mit Risiken
            </span>
            <span className="block">
              Nur Projekte mit aktivem/offenem Status und stabiler Legal-Entity-Zuordnung werden in Kundenzeilen aggregiert.
            </span>
            {(model.projectsWithoutCustomerMapping !== 0 || model.projectsWithoutServiceMapping !== 0) && (
              <span className="block text-[var(--warning)]">
                Datenqualität:{" "}
                {model.projectsWithoutCustomerMapping === null
                  ? "Customer Mapping n/a"
                  : `${model.projectsWithoutCustomerMapping} Projekte ohne Customer Mapping`}{" "}
                ·{" "}
                {model.projectsWithoutServiceMapping === null
                  ? "Service Mapping n/a"
                  : `${model.projectsWithoutServiceMapping} Projekte ohne Service Mapping`}
                .
              </span>
            )}
          </span>
        }
      />

      {openRow && <CustomerDetail row={openRow} people={people} onClose={() => setExpanded(null)} />}

      <ChangeRequestQueue requests={changeRequests} />
    </div>
  );
}
