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
 *
 * Risk strings and sentinel values ("Nicht zugeordnet") arrive in German from
 * the query module and are translated at render through management-i18n.
 */
import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { DataTable, cmpNum, cmpText, type Column } from "@/components/data-table/DataTable";
import { Button } from "@/components/ui/Button";
import { IconWarning } from "@/components/nav-icons";
import type { CustomerPortfolioRow, ManagementCustomerPortfolio } from "@/lib/queries/management-customer-portfolio";
import type { ManagementChangeRequest } from "@/lib/queries/management-change-requests";
import { decideResponsibleChange, type ManagementChangeActionState } from "./actions";
import { ReassignmentPicker } from "./ReassignmentPicker";
import { translateList, translateText } from "./management-i18n";

const fmt = (value: number) => new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(value);
const operationalLinks = ["Asana", "Chat", "TrackingTime", "Drive", "Microsoft Teams"] as const;

const IDLE: ManagementChangeActionState = { status: "idle" };

/**
 * Whole days a pending request has been waiting. Null for an unparseable
 * timestamp, which renders as "n/a" rather than a confident 0 days.
 */
function ageInDays(iso: string): number | null {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return null;
  return Math.max(0, Math.floor((Date.now() - then) / 86_400_000));
}

function ReplacementPlaceholder() {
  const t = useTranslations("management.portfolio.detail");
  return <button type="button" disabled title={t("replacementTitle")} className="cursor-not-allowed text-left text-[var(--text-faint)]">{t("replacementNa")}</button>;
}

/**
 * The pending four-eyes queue.
 *
 * PROMINENCE IS THE FEATURE. A request sits here until a SECOND authorised
 * person acts on it (request_project_responsible_change refuses to let the
 * requester approve their own), which means the handover has NOT happened yet:
 * the project still points at the person who is leaving or is off. A queue that
 * looks like a quiet footnote is a queue that rots, and a rotted queue here
 * means projects silently owned by somebody unavailable.
 *
 * So it is --warning-toned, it is ordered oldest-first (the opposite of the
 * query's newest-first read, because the one that has waited longest is the one
 * at risk), and every row states its age in days.
 */
function ChangeRequestQueue({ requests }: { requests: ManagementChangeRequest[] }) {
  const t = useTranslations("management.changeRequests");
  if (!requests.length) {
    // Said out loud rather than rendering nothing: an absent panel is
    // indistinguishable from a panel that failed to load.
    return (
      <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 card-elev">
        <p className="font-mono text-[10px] tracking-[0.08em] text-[var(--text-faint)]">
          {t("none")}
        </p>
      </div>
    );
  }

  // Oldest first: the request that has waited longest is the one blocking a
  // handover, so it must not sit at the bottom of the list.
  const ordered = [...requests].sort(
    (a, b) => new Date(a.requestedAt).getTime() - new Date(b.requestedAt).getTime(),
  );
  const oldest = ageInDays(ordered[0].requestedAt);

  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--warning,#d99b3d)] bg-[var(--surface)] px-4 py-4 card-elev">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="flex items-center gap-1.5 font-mono text-[10px] tracking-[0.08em] text-[var(--warning,#d99b3d)]">
          <IconWarning className="h-3 w-3 flex-none" />
          {t("heading", { count: String(requests.length) })}
        </p>
        <p className="font-mono text-[10px] tracking-[0.08em] text-[var(--text-faint)]">
          {oldest === null ? t("oldestNa") : t("oldest", { days: String(oldest) })}
        </p>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-muted)]">
        {t("note")}
      </p>
      <div className="mt-3 space-y-2">
        {ordered.map((request) => <ChangeRequestItem key={request.id} request={request} />)}
      </div>
    </div>
  );
}

function ChangeRequestItem({ request }: { request: ManagementChangeRequest }) {
  const t = useTranslations("management.changeRequests.item");
  const [state, action, pending] = useActionState(decideResponsibleChange, IDLE);
  const [reason, setReason] = useState("");
  const router = useRouter();
  const age = ageInDays(request.requestedAt);
  const reasonOk = reason.trim().length >= 3;

  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [router, state.status]);

  return (
    <form action={action} className="flex flex-wrap items-end gap-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] p-3 text-[11px]">
      <input type="hidden" name="request_id" value={request.id} />
      <div className="min-w-[220px] flex-1">
        <p className="font-medium text-[var(--text-primary)]">{request.projectName}</p>
        <p className="text-[var(--text-muted)]">
          {t("meta", { person: request.requestedPerson, reason: request.reason })}
        </p>
        <p className="mt-0.5 font-mono text-[10px] tracking-[0.08em] text-[var(--text-faint)]">
          {age === null ? t("openSinceNa") : t("openSince", { days: String(age) })}
        </p>
      </div>

      {/* Same mandatory-reason rule as the request side; the RPC rejects under 3. */}
      <label className="flex min-w-[180px] flex-col gap-1">
        <span className="font-mono text-[10px] tracking-[0.08em] text-[var(--text-faint)]">
          {t("reasonLabel")}
        </span>
        <input
          name="reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder={t("reasonPlaceholder")}
          className="rounded border border-[var(--border-strong)] bg-[var(--surface)] px-2 py-1.5 text-[11px] text-[var(--text-primary)] focus:border-[var(--accent)]"
          minLength={3}
          required
        />
      </label>

      <Button name="decision" value="reject" type="submit" variant="secondary" size="sm" disabled={pending || !reasonOk}>
        {t("reject")}
      </Button>
      <Button name="decision" value="approve" type="submit" variant="primary" size="sm" disabled={pending || !reasonOk} busy={pending}>
        {t("approve")}
      </Button>

      {!pending && !reasonOk && (
        <p className="basis-full text-[10px] text-[var(--text-faint)]">
          {t("reasonHint")}
        </p>
      )}

      <p role="status" aria-live="polite" className="basis-full">
        {state.message && (
          <span className={`text-[10px] ${state.status === "error" ? "text-[var(--critical)]" : "text-[var(--good)]"}`}>
            {state.message}
          </span>
        )}
      </p>
    </form>
  );
}

function CustomerDetail({ row, onClose }: { row: CustomerPortfolioRow; onClose: () => void }) {
  const t = useTranslations("management.portfolio.detail");
  const tm = useTranslations("management");
  const tx = (text: string) => translateText(tm, text);
  const na = tm("values.notAvailable");
  const notAssigned = tm("values.notAssigned");
  return (
    <div className="space-y-4 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface-2)] px-4 py-4 card-elev">
      <div className="flex items-start justify-between gap-4">
        <p className="font-mono text-[10px] tracking-[0.08em] text-[var(--text-faint)]">{t("kicker", { customer: row.customer.toUpperCase() })}</p>
        <button type="button" onClick={onClose} className="font-mono text-[10px] text-[var(--text-faint)] hover:text-[var(--critical)]">{t("close")}</button>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div><p className="font-mono text-[10px] tracking-[0.08em] text-[var(--text-faint)]">{t("masterData")}</p><p className="mt-1 text-[12px] text-[var(--text-primary)]">{row.customer}</p><p className="text-[11px] text-[var(--text-muted)]">{t("legalEntity", { name: row.legalEntity })}</p></div>
        <div><p className="font-mono text-[10px] tracking-[0.08em] text-[var(--text-faint)]">{t("locations")}</p><p className="mt-1 text-[11px] text-[var(--text-muted)]">{row.locationsAvailable ? row.locations.join(", ") || tm("values.none") : t("locationsNa")}</p></div>
        <div><p className="font-mono text-[10px] tracking-[0.08em] text-[var(--text-faint)]">{t("risks")}</p><p className="mt-1 text-[11px] text-[var(--text-muted)]">{row.risks.length > 0 ? translateList(tm, row.risks).join(" · ") : t("noRisks")}</p></div>
      </div>

      <div>
        <p className="font-mono text-[10px] tracking-[0.08em] text-[var(--text-faint)]">{t("services", { count: String(row.services.length) })}</p>
        <div className="mt-2 max-h-[16rem] overflow-auto"><table className="w-full min-w-[540px] border-collapse text-left text-[11px]"><thead className="sticky top-0 bg-[var(--surface-2)] font-mono text-[10px] tracking-[0.08em] text-[var(--text-faint)]"><tr><th className="px-2 py-2 font-medium">{t("columns.service")}</th><th className="px-2 py-2 text-right font-medium">{t("columns.contractHours")}</th><th className="px-2 py-2 font-medium">{t("columns.responsible")}</th></tr></thead><tbody>{row.services.map((service) => <tr key={service.service} className="border-t border-[var(--divider)]"><th className="px-2 py-2 font-medium text-[var(--text-primary)]">{tx(service.service)}</th><td className="px-2 py-2 text-right font-mono tabular-nums text-[var(--text-secondary)]">{service.contractHours === null ? na : `${fmt(service.contractHours)} h`}</td><td className="px-2 py-2 text-[var(--text-secondary)]">{translateList(tm, service.responsible).join(", ") || notAssigned}</td></tr>)}</tbody></table></div>
      </div>

      <div>
        <p className="font-mono text-[10px] tracking-[0.08em] text-[var(--text-faint)]">{t("projects", { count: String(row.projects.length) })}</p>
        <div className="mt-2 max-h-[20rem] overflow-auto"><table className="w-full min-w-[900px] border-collapse text-left text-[11px]"><thead className="sticky top-0 bg-[var(--surface-2)] font-mono text-[10px] tracking-[0.08em] text-[var(--text-faint)]"><tr><th className="px-2 py-2 font-medium">{t("columns.project")}</th><th className="px-2 py-2 font-medium">{t("columns.service")}</th><th className="px-2 py-2 text-right font-medium">{t("columns.hours")}</th><th className="px-2 py-2 font-medium">{t("columns.status")}</th><th className="px-2 py-2 font-medium">{t("columns.responsible")}</th><th className="px-2 py-2 font-medium">{t("columns.replacement")}</th></tr></thead><tbody>{row.projects.map((project) => <tr key={project.projectId} className="border-t border-[var(--divider)]"><th className="px-2 py-2 font-medium text-[var(--text-primary)]">{/* The masterdata order id keys /orders/[id], which reaches every order
                            including the 54 with no TrackingTime link. */}
                            <Link href={`/orders/${encodeURIComponent(project.projectId)}`} className="text-[var(--accent)] underline-offset-2 hover:underline" title={t("openOrder")}>{project.project}</Link></th><td className="px-2 py-2 text-[var(--text-secondary)]">{tx(project.service)}</td><td className="px-2 py-2 text-right font-mono tabular-nums text-[var(--text-secondary)]">{project.contractHours === null ? na : `${fmt(project.contractHours)} h`}</td><td className="px-2 py-2 text-[var(--text-secondary)]">{project.status ?? tm("values.missing")}</td><td className="px-2 py-2 text-[var(--text-secondary)]"><ReassignmentPicker project={project} /></td><td className="px-2 py-2 text-[var(--text-secondary)]"><ReplacementPlaceholder /></td></tr>)}</tbody></table></div>
      </div>

      <div><p className="font-mono text-[10px] tracking-[0.08em] text-[var(--text-faint)]">{t("links")}</p><div className="mt-2 flex flex-wrap gap-2">{operationalLinks.map((label) => <span key={label} className="rounded-full bg-[var(--surface)] px-2 py-1 text-[10px] text-[var(--text-muted)]">{t("linkNa", { label })}</span>)}</div><p className="mt-2 text-[11px] text-[var(--text-muted)]">{t("linksNote")}</p></div>
    </div>
  );
}

export function ManagementCustomerPortfolio({ model, changeRequests }: { model: ManagementCustomerPortfolio; changeRequests: ManagementChangeRequest[] }) {
  const t = useTranslations("management.portfolio");
  const tm = useTranslations("management");
  const na = tm("values.notAvailable");
  const notAssigned = tm("values.notAssigned");
  const none = tm("values.none");
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
      header: t("columns.customer"),
      className: "min-w-[13rem]",
      compare: (a, b) => cmpText(a.customer, b.customer),
      descFirst: false,
      cell: (row) => (
        <button
          type="button"
          className={`text-left font-medium hover:text-[var(--accent)] ${expanded === row.legalEntityId ? "text-[var(--accent)]" : "text-[var(--text-primary)]"}`}
          onClick={() => setExpanded(expanded === row.legalEntityId ? null : row.legalEntityId)}
          aria-expanded={expanded === row.legalEntityId}
          title={t("titles.customer")}
        >
          {row.customer}
        </button>
      ),
      csv: (row) => row.customer,
      search: (row) => row.customer,
    },
    {
      key: "legalEntity",
      header: t("columns.legalEntity"),
      compare: (a, b) => cmpText(a.legalEntity, b.legalEntity),
      descFirst: false,
      cell: (row) => <span className="text-[var(--text-secondary)]">{row.legalEntity}</span>,
      csv: (row) => row.legalEntity,
      search: (row) => row.legalEntity,
    },
    {
      key: "activeServices",
      header: t("columns.activeServices"),
      className: "max-w-[260px]",
      compare: (a, b) => a.activeServices.length - b.activeServices.length,
      cell: (row) => <span className="text-[var(--text-secondary)]">{translateList(tm, row.activeServices).join(", ") || notAssigned}</span>,
      csv: (row) => translateList(tm, row.activeServices).join(" | ") || notAssigned,
      search: (row) => row.activeServices.join(" "),
      title: t("titles.activeServices"),
    },
    {
      key: "projectCount",
      header: t("columns.projects"),
      align: "right",
      compare: (a, b) => a.projectCount - b.projectCount,
      cell: (row) => <span className="font-mono tabular-nums text-[var(--text-secondary)]">{row.projectCount}</span>,
      csv: (row) => row.projectCount,
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
    {
      key: "responsible",
      header: t("columns.responsible"),
      className: "max-w-[200px]",
      compare: (a, b) => cmpText(a.responsible[0] ?? null, b.responsible[0] ?? null),
      descFirst: false,
      cell: (row) => <span className="text-[var(--text-secondary)]">{translateList(tm, row.responsible).join(", ") || notAssigned}</span>,
      csv: (row) => translateList(tm, row.responsible).join(" | ") || notAssigned,
      search: (row) => row.responsible.join(" "),
    },
    {
      key: "risks",
      header: t("columns.risks"),
      className: "max-w-[240px]",
      compare: (a, b) => a.risks.length - b.risks.length,
      cell: (row) => <span className="text-[var(--text-muted)]">{row.risks.length > 0 ? translateList(tm, row.risks).join(" · ") : none}</span>,
      csv: (row) => (row.risks.length > 0 ? translateList(tm, row.risks).join(" | ") : none),
      search: (row) => row.risks.join(" "),
    },
  ];

  return (
    <div className="flex flex-col gap-[var(--card-gap)]">
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(row) => row.legalEntityId}
        title={t("title")}
        hint={t("hint")}
        exportName="customer-portfolio"
        searchPlaceholder={t("searchPlaceholder")}
        defaultPageSize={25}
        freezeFirstColumn
        maxBodyHeight="52vh"
        collapsible
        defaultOpen
        summary={t("summary", { customers: String(rows.length), projects: String(totalProjects), hours: fmt(totalHours), withRisks: String(withRisks) })}
        emptyText={model.customerMappingAvailable ? t("empty.noRows") : t("empty.noMapping")}
        footnote={
          <span className="block space-y-1 leading-relaxed">
            <span className="block text-[var(--text-secondary)]">
              {t("totals", { customers: String(rows.length), projects: String(totalProjects), hours: fmt(totalHours) })}
              {hoursUnknown > 0 ? t("unknownHours", { count: String(hoursUnknown) }) : ""}
              {t("withRisks", { count: String(withRisks) })}
            </span>
            <span className="block">
              {t("note")}
            </span>
            {(model.projectsWithoutCustomerMapping !== 0 || model.projectsWithoutServiceMapping !== 0) && (
              <span className="block text-[var(--warning)]">
                {t("dataQuality", {
                  customer: model.projectsWithoutCustomerMapping === null
                    ? tm("values.customerMappingNa")
                    : t("withoutCustomerMapping", { count: String(model.projectsWithoutCustomerMapping) }),
                  service: model.projectsWithoutServiceMapping === null
                    ? tm("values.serviceMappingNa")
                    : t("withoutServiceMapping", { count: String(model.projectsWithoutServiceMapping) }),
                })}
              </span>
            )}
          </span>
        }
      />

      {openRow && <CustomerDetail row={openRow} onClose={() => setExpanded(null)} />}

      <ChangeRequestQueue requests={changeRequests} />
    </div>
  );
}
