/**
 * One masterdata ORDER — the record `/projects/[id]` structurally cannot show.
 *
 * WHY THIS ROUTE EXISTS AT ALL
 * ---------------------------
 * `/projects/[id]` is keyed on `time.project.id`, a bigint, and validates
 * `/^\d+$/` before it queries. That guard is correct there and fatal here: 54
 * orders carrying 1,724h have no `time.project` row, so no bigint exists to
 * address them by. This page is keyed on the MASTERDATA text id
 * (`10110_00358_104_01`) and treats the TrackingTime link as optional
 * enrichment, which is the only shape that reaches all 231 orders.
 *
 * So there is deliberately NO numeric guard below. There is still a SHAPE guard:
 * the id reaches PostgREST as `id=eq.<param>`, and a wild param should 404
 * rather than round-trip. The guard is loose on purpose — one live order is
 * `10905_00357__01`, with an empty middle segment, and a tidy
 * `\d+_\d+_\d+_\d+` pattern would 404 a real record to satisfy a format nobody
 * promised.
 *
 * THE HOURS ARE SHOWN TWICE WHEN THEY DISAGREE
 * -------------------------------------------
 * `getOrderDetail` returns `loggedHoursStored` (the `projects.logged_hours`
 * snapshot, all-time, and it can include FUTURE-dated planned entries) AND
 * `loggedHoursLive` (summed from `time.entry`, bounded at today), plus
 * `hoursDisagree`. When they disagree this page shows BOTH and names which is
 * which. Picking one silently is the failure mode the query layer was built to
 * prevent: a detail page is exactly where somebody checks a figure they already
 * distrust, and 59 of 177 linked orders currently disagree.
 *
 * `loggedHoursLive === null` means "no TrackingTime link", which renders "n/a".
 * Never 0 — an unlinked order with 35 contracted hours reading "0.0 h logged"
 * is a confident lie about a live commitment.
 *
 * ACCESS mirrors /projects/[id] exactly: `projects:read_all`, hand-rolled rather
 * than via requirePermission(), because the portal tile for this module is shown
 * to anyone holding ANY `projects` permission and all four roles hold
 * `projects:read_own`. requirePermission() redirects a failure to "/", so three
 * of four roles would click their own module's tile and be thrown to the Hub
 * with no explanation. They get an explanatory panel instead.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import PageTransition from "@/components/animations/PageTransition";
import { MobileDisclosure } from "@/components/MobileDisclosure";
import { Card, CardHeader, CardDivider, StatTile } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Segmented";
import { createClient } from "@/utils/supabase/server";
import {
  enforceRoleRouteAccess,
  requireProfile,
  userHasPermission,
} from "@/utils/supabase/require-profile";
import { PERMISSIONS } from "@/lib/permissions";
import { getOrderDetail, type OrderRole } from "@/lib/queries/order-detail";

/** Hours to one decimal, always. `null` never reaches here. */
const h = (n: number) => n.toLocaleString("en-GB", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
/** Percent as an integer. */
const pct = (n: number) => `${Math.round(n)}%`;
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "n/a");

const LABEL = "font-mono text-[10px] tracking-[0.08em] text-[var(--text-faint)]";

/*
 * A loose plausibility guard, not a format contract. Digits and underscores,
 * starts with a digit, carries at least one underscore (that is what separates
 * an order id from the bigint the OTHER route owns), and bounded so a
 * pathological param never becomes a query.
 */
const ORDER_ID = /^\d[\d_]{4,62}$/;

/** 'masterdata' came from the workbook; 'change_control' from an approved handover. */
function provenanceOf(source: string): { text: string; title: string } {
  if (source === "masterdata")
    return { text: "AUS STAMMDATEN", title: "Imported from the masterdata workbook." };
  if (source === "change_control")
    return {
      text: "AUS FREIGEGEBENEM ANTRAG",
      title: "Set by an approved in-product handover (change control), not by the workbook.",
    };
  return { text: source.toUpperCase(), title: `Recorded source: ${source}` };
}

function RolePanel({ label, role }: { label: string; role: OrderRole | null }) {
  const prov = role ? provenanceOf(role.source) : null;
  return (
    <div className="flex min-w-0 flex-col gap-1 px-4 py-3">
      <span className={LABEL}>{label}</span>
      {role === null ? (
        <>
          {/* Honest null: nobody is recorded, which is not the same as nobody being needed. */}
          <span className="text-[13px] font-medium text-[var(--text-faint)]">n/a</span>
          <span className="text-[11px] text-[var(--text-muted)]">Keine Person hinterlegt.</span>
        </>
      ) : (
        <>
          <span className="truncate text-[13px] font-medium text-[var(--text-primary)]">
            {role.personName}
          </span>
          <span className={LABEL} title={prov!.title}>
            {prov!.text}
          </span>
        </>
      )}
    </div>
  );
}

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireProfile("/dashboard/management");
  // Guarded on its OWN route root, not on the management path it borrows for
  // the post-login return. /orders/<id> is a real, linkable URL and has to be
  // refused as one.
  await enforceRoleRouteAccess("/orders");

  const { id: rawId } = await params;
  // Shape, not type: see the header note on why there is no /^\d+$/ here.
  if (!ORDER_ID.test(rawId)) notFound();

  if (!(await userHasPermission(PERMISSIONS.PROJECTS_READ_ALL))) {
    return (
      <PageTransition>
        <div className="flex flex-col">
          <PageHeader title="Auftrag" />
          <div className="p-6">
            <EmptyState
              title="You don't have access to this order"
              description="Viewing an order record needs the 'View All Projects' permission, which your role doesn't hold. An administrator can grant it under Role Permissions."
              action={
                <Link
                  href="/time"
                  className="text-[12px] font-medium text-[var(--accent)] hover:underline"
                >
                  Go to Time
                </Link>
              }
            />
          </div>
        </div>
      </PageTransition>
    );
  }

  const supabase = await createClient();
  const order = await getOrderDetail(supabase, rawId);

  // null covers both "no such order" and "RLS hides it", deliberately
  // indistinguishable: telling an unauthorised reader that the order exists but
  // is not theirs leaks the portfolio's shape.
  if (!order) notFound();

  const {
    contractHours,
    loggedHoursStored,
    loggedHoursLive,
    hoursDisagree,
    service,
    serviceFallback,
    assignees,
    customerServices,
  } = order;

  // The service is named by TrackingTime when linked, and by the order's own
  // contract_type when not. Which one is stated, because they are different
  // claims about how well this order is wired up.
  const serviceName = service ?? serviceFallback;
  const serviceIsFallback = service === null && serviceFallback !== null;

  /*
   * Burn is computed against the LIVE figure only. Deriving a percentage from
   * the stored snapshot would launder a number this page has just told the
   * reader not to trust, and there is no live figure at all for an unlinked
   * order — so the tile reads n/a rather than inventing one.
   */
  const burnBase = loggedHoursLive;
  const burnPercent =
    burnBase !== null && contractHours !== null && contractHours > 0
      ? Math.round((burnBase / contractHours) * 100)
      : null;
  const burnTone =
    burnPercent === null ? "neutral" : burnPercent >= 100 ? "critical" : burnPercent >= 85 ? "warning" : "good";

  const carriers = assignees.filter((a) => a.sharePercent > 0);
  const covers = assignees.filter((a) => a.sharePercent <= 0);

  const statusTone =
    order.status === "CRITICAL"
      ? "var(--critical)"
      : order.status === "WARNING"
        ? "var(--warning, #d99b3d)"
        : "var(--accent)";

  return (
    <PageTransition>
      <div className="flex flex-col">
        <PageHeader
          title={order.name || order.id}
          meta={`${order.customer || "KEIN KUNDE"}${order.code ? ` · ${order.code}` : ""}`}
          actions={
            <Link
              href="/dashboard/management"
              className="rounded-[var(--radius-sm)] border border-[var(--border-strong)] px-3 py-1.5 text-[11.5px] font-medium text-[var(--text-primary)] hover:bg-[var(--surface-hover)]"
            >
              Zum Management-Dashboard
            </Link>
          }
        />

        <div className="page-shell flex flex-col gap-5">
          {/* The identity row: the text id is the page's key, so it is shown
              verbatim in font-mono rather than prettified. */}
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface-2)] px-2 py-1 font-mono text-[11px] tabular-nums text-[var(--text-primary)]"
              title="Masterdata order id. This page is keyed on it, not on the TrackingTime bigint."
            >
              {order.id}
            </span>
            {order.status ? (
              <span
                className="rounded-full border px-2 py-1 font-mono text-[10px] tracking-[0.08em]"
                style={{ color: statusTone, borderColor: statusTone }}
              >
                {order.status}
              </span>
            ) : (
              <span className={`rounded-full border border-[var(--border)] px-2 py-1 ${LABEL}`}>
                STATUS n/a
              </span>
            )}
            {serviceName ? (
              <span
                title={
                  serviceIsFallback
                    ? "From projects.contract_type: this order has no TrackingTime link to name a service."
                    : "From time.service via the TrackingTime link."
                }
              >
                <Pill>
                  {serviceName.toUpperCase()}
                  {serviceIsFallback ? " · AUS VERTRAGSART" : ""}
                </Pill>
              </span>
            ) : (
              <Pill>SERVICE n/a</Pill>
            )}
            {order.department ? <Pill>{order.department.toUpperCase()}</Pill> : null}
            {order.timeProjectId === null ? (
              <span
                className="rounded-full px-2 py-1 font-mono text-[10px] tracking-[0.08em]"
                style={{ color: "var(--warning, #d99b3d)", border: "1px solid var(--warning, #d99b3d)" }}
                title="No time.project row points at this order, so no hours can be summed for it."
              >
                KEINE TRACKINGTIME-VERKNUEPFUNG
              </span>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-[var(--card-gap)] sm:grid-cols-3 lg:grid-cols-5">
            <StatTile
              label="VERTRAG"
              value={contractHours === null ? null : h(contractHours)}
              unit="h"
              hint={contractHours === null ? "nicht hinterlegt" : "vereinbart"}
            />
            <StatTile
              label="GEBUCHT (LIVE)"
              value={loggedHoursLive === null ? null : h(loggedHoursLive)}
              unit="h"
              hint={loggedHoursLive === null ? "keine TrackingTime-Verknuepfung" : "aus time.entry, bis heute"}
            />
            <StatTile
              label="GEBUCHT (GESPEICHERT)"
              value={loggedHoursStored === null ? null : h(loggedHoursStored)}
              unit="h"
              hint={
                loggedHoursStored === null
                  ? "kein Snapshot"
                  : hoursDisagree
                    ? "Snapshot, weicht ab"
                    : "Snapshot, deckungsgleich"
              }
              tone={hoursDisagree ? "warning" : "neutral"}
            />
            <StatTile
              label="VERBRAUCH"
              value={burnPercent === null ? null : String(burnPercent)}
              unit="%"
              hint={
                burnPercent === null
                  ? loggedHoursLive === null
                    ? "ohne Live-Stunden nicht berechenbar"
                    : "kein Vertragswert"
                  : "des Vertrags, live"
              }
              tone={burnTone}
              progressPercent={burnPercent}
            />
            <StatTile
              label="ZEITBUCHUNGEN"
              value={order.timeProjectId === null ? null : order.entryCount.toLocaleString("en-GB")}
              hint={
                order.timeProjectId === null
                  ? "keine Verknuepfung"
                  : order.firstEntry
                    ? `${day(order.firstEntry)} bis ${day(order.lastEntry)}`
                    : "keine Eintraege"
              }
            />
          </div>

          {/*
            THE DISAGREEMENT, stated in words rather than left for the reader to
            spot across two tiles. Only rendered when it is real: a permanent
            caveat is wallpaper, and 118 of 177 linked orders agree.
          */}
          {hoursDisagree ? (
            <div
              className="card-elev rounded-[var(--radius-card)] border bg-[var(--surface)] px-4 py-3"
              style={{ borderColor: "var(--warning, #d99b3d)" }}
              data-hours-disagree="true"
            >
              <p className={LABEL} style={{ color: "var(--warning, #d99b3d)" }}>
                DIE ZWEI STUNDENWERTE WEICHEN AB
              </p>
              <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--text-secondary)]">
                <strong className="font-mono tabular-nums text-[var(--text-primary)]">
                  {h(loggedHoursStored!)} h
                </strong>{" "}
                stehen in der gespeicherten Spalte <code className="font-mono text-[11px]">projects.logged_hours</code>{" "}
                — ein Snapshot ueber die gesamte Laufzeit, der auch{" "}
                <strong>zukuenftig datierte Planeintraege</strong> enthalten kann und kein
                Aktualisierungsdatum mitfuehrt.{" "}
                <strong className="font-mono tabular-nums text-[var(--text-primary)]">
                  {h(loggedHoursLive!)} h
                </strong>{" "}
                sind live aus <code className="font-mono text-[11px]">time.entry</code> summiert und{" "}
                <strong>auf heute begrenzt</strong>, also die tatsaechlich verbrauchte Zeit.
                Differenz{" "}
                <span className="font-mono tabular-nums">
                  {h(Math.abs(loggedHoursStored! - loggedHoursLive!))} h
                </span>
                . Fuer Verbrauch und Restbudget gilt der Live-Wert; der Snapshot bleibt sichtbar,
                weil er in Berichten auftaucht.
              </p>
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {/* Responsibility. Provenance is on the panel because the reader's
                question is "why is this person here", not "who is here". */}
            <Card>
              <CardHeader title="Verantwortung" qualifier="PROJECT_RESPONSIBILITY · MIT HERKUNFT" />
              <CardDivider />
              <div className="grid grid-cols-1 sm:grid-cols-2">
                <RolePanel label="VERANTWORTLICH" role={order.responsible} />
                <RolePanel label="VERTRETUNG" role={order.replacement} />
              </div>
              <CardDivider />
              <div className="flex flex-col gap-2 px-4 py-3">
                <span className={LABEL}>ZUGEORDNETE PERSONEN · {assignees.length}</span>
                {assignees.length === 0 ? (
                  <span className="text-[12px] text-[var(--text-faint)]">n/a</span>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {/*
                      sharePercent > 0 carries the load; exactly 0 is the NAMED
                      COVER, which is the import's convention. A bare "0%" beside
                      a person's name reads as "does nothing on this order",
                      which is the opposite of what a standby means, so the zero
                      is never printed — the role is labelled instead.
                    */}
                    {carriers.map((a) => (
                      <li key={a.personId} className="flex items-baseline justify-between gap-3">
                        <span className="truncate text-[12px] text-[var(--text-primary)]">
                          {a.personName}
                        </span>
                        <span className="flex flex-none items-baseline gap-2">
                          <span className={LABEL}>TRAEGT</span>
                          <span className="font-mono text-[12px] tabular-nums text-[var(--text-secondary)]">
                            {pct(a.sharePercent)}
                          </span>
                        </span>
                      </li>
                    ))}
                    {covers.map((a) => (
                      <li key={a.personId} className="flex items-baseline justify-between gap-3">
                        <span className="truncate text-[12px] text-[var(--text-secondary)]">
                          {a.personName}
                        </span>
                        <span
                          className={LABEL}
                          title="Share 0% in the masterdata: named cover, not a load-bearing assignment."
                        >
                          BENANNTE VERTRETUNG
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Card>

            {/* Secondary on a phone: what the CUSTOMER buys is context for this
                order, not the order itself. Collapsed below sm, always open from
                sm up, and its total is stated while shut. */}
            <MobileDisclosure
              title="Services dieses Kunden"
              summary={`${customerServices.length} Service(s) · ${
                customerServices.some((s) => s.contractHours !== null)
                  ? `${h(customerServices.reduce((sum, s) => sum + (s.contractHours ?? 0), 0))} h vertraglich`
                  : "Vertragsstunden n/a"
              }`}
            >
              <Card>
                <CardHeader
                  title="Services dieses Kunden"
                  qualifier={`UEBER ALLE AUFTRAEGE VON ${(order.customer || "n/a").toUpperCase()}`}
                />
                <CardDivider />
                {customerServices.length === 0 ? (
                  <p className="px-4 py-3 text-[12px] text-[var(--text-faint)]">n/a</p>
                ) : (
                  <div className="max-h-[18rem] overflow-auto">
                    <table className="w-full border-collapse text-left text-[11.5px]">
                      <thead className="sticky top-0 bg-[var(--surface)]">
                        <tr>
                          <th className={`px-4 py-2 font-medium ${LABEL}`}>SERVICE</th>
                          <th className={`px-3 py-2 text-right font-medium ${LABEL}`}>AUFTRAEGE</th>
                          <th className={`px-4 py-2 text-right font-medium ${LABEL}`}>VERTRAGSH</th>
                        </tr>
                      </thead>
                      <tbody>
                        {customerServices.map((s) => (
                          <tr key={s.service ?? "n/a"} className="border-t border-[var(--divider)]">
                            <th className="px-4 py-2 font-medium text-[var(--text-primary)]">
                              {s.service ?? "Nicht zugeordnet"}
                            </th>
                            <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--text-secondary)]">
                              {s.orders}
                            </td>
                            {/* Honest null: no order in this bucket carried a
                                contract figure, which is not 0 h agreed. */}
                            <td className="px-4 py-2 text-right font-mono tabular-nums text-[var(--text-secondary)]">
                              {s.contractHours === null ? (
                                <span className="text-[var(--text-faint)]">n/a</span>
                              ) : (
                                `${h(s.contractHours)} h`
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </MobileDisclosure>
          </div>

          <p className="text-[11px] leading-relaxed text-[var(--text-faint)]">
            Auftrag aus <code className="font-mono">public.projects</code>; Stunden, Service und
            Zeitbuchungen aus TrackingTime, sofern verknuepft.{" "}
            {order.timeProjectId === null ? (
              <>
                Dieser Auftrag hat keine TrackingTime-Verknuepfung, daher gibt es keine
                Live-Stunden — deshalb steht dort n/a und keine 0.
              </>
            ) : (
              <Link
                href={`/projects/${order.timeProjectId}`}
                className="text-[var(--accent)] underline-offset-2 hover:underline"
              >
                Projektsicht mit Burn-Down oeffnen
              </Link>
            )}
          </p>
        </div>
      </div>
    </PageTransition>
  );
}
