import { useTranslations } from "next-intl";
import { Card, CardDivider, CardHeader } from "@/components/ui/Card";
import { StatusBadge } from "@/components/StatusBadge";
import { NoneLine } from "./parts";
import type { CustomerCarer } from "@/lib/queries/customer-profile";

/**
 * Who looks after this customer, and who covers them.
 *
 * NAMES COME FROM public.org_chart_nodes, NEVER public.people
 * -----------------------------------------------------------
 * `can_view_person()` hides `people` from a non-exec caller, so a colleague's
 * row would come back empty and this card would print a person id. The identity
 * view projects id / name / role / department / manager_id and nothing
 * commercial or HR-sensitive, which is why it is deliberately not
 * security_invoker. A name that does not resolve renders "Name nicht verfügbar"
 * — true, and different from "nobody is responsible".
 *
 * A COMPANY DOCTOR IS NOT A MISSING PERSON
 * ----------------------------------------
 * 64 masterdata rows record `responsible_kind = 'doctor'` and 7 `'other'` with a
 * null person id: an external occupational physician the sheet names by role
 * rather than by name. Rendering those as a gap would report 92 unassigned
 * orders where there are 23. They render as "Betriebsarzt" / "Sonstige", with no
 * name, because that is what the sheet says.
 *
 * THE GAP COUNT IS DEFINED ON public.project_responsibility
 * --------------------------------------------------------
 * Not on `project_masterdata.responsible_person_id`, for the reason above. The
 * role table agrees with the masterdata person on all 130 orders where both are
 * set and with `projects.owner_person_id` on 241 of 242, and it still names an
 * internal holder for 62 of the 64 doctor-kind orders. When NOBODY is named on
 * any order the line says that in words rather than as "3 of 3", which is a
 * different sentence.
 *
 * AND THE COUNT IS THREE-STATE, BECAUSE THE READ CAN FAIL
 * -------------------------------------------------------
 * `null` means the role table could not be READ, and it gets its own sentence.
 * Recomputed over the empty rows of a failed read the count equals the order
 * total, so this card would print "auf keinem dieser Aufträge ist jemand als
 * verantwortlich benannt" directly below the carers it had just listed by name
 * — a categorical claim manufactured out of a failed read, and a card
 * contradicting its own footnote. 0 stays silent, as before.
 *
 * No link to /people: that route is off the operations allow-list, and a link
 * that ends in a redirect is worse than a name.
 */
export function CustomerCare({
  care,
  ordersWithoutResponsible,
  totalOrders,
}: {
  care: CustomerCarer[];
  /** null when `public.project_responsibility` could not be read at all. */
  ordersWithoutResponsible: number | null;
  totalOrders: number;
}) {
  const t = useTranslations("customer");
  const several = totalOrders > 1;

  const nameOf = (c: CustomerCarer): string => {
    if (c.kind === "doctor") return t("people.doctor");
    if (c.kind === "other") return t("people.other");
    return c.name ?? t("people.unknown");
  };

  return (
    <Card as="section" aria-label={t("care.title")}>
      <CardHeader title={t("care.title")} qualifier={t("care.qualifier")} />
      <CardDivider />
      {care.length === 0 ? (
        <div className="px-4 py-3">
          <NoneLine>{t("care.none")}</NoneLine>
        </div>
      ) : (
        <div className="divide-y divide-[var(--divider)]">
          {care.map((c) => (
            <div key={`${c.role}|${c.kind}|${c.personId ?? ""}`} className="flex flex-col gap-1 px-4 py-3">
              <span className="flex flex-wrap items-center gap-2">
                <span className="t-callout text-[var(--text-primary)] [overflow-wrap:anywhere]">{nameOf(c)}</span>
                {/* Neutral: the rung is the badge's TEXT, not its colour. */}
                <StatusBadge
                  status={c.role === "responsible" ? t("care.responsible") : t("care.replacement")}
                  tone="neutral"
                />
              </span>
              {c.serviceRole ? (
                <span className="t-subhead text-[var(--text-muted)] [overflow-wrap:anywhere]">{c.serviceRole}</span>
              ) : null}
              {several && c.orderCodes.length > 0 ? (
                <span className="t-label text-[var(--text-faint)] [overflow-wrap:anywhere]">
                  {t("care.onOrders", { codes: c.orderCodes.join(" · ") })}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      )}
      {/* Three sentences and a silence. null is "could not be checked", which is
          a fact about the READ; "nobody at all" is about the customer and is a
          different sentence from a count; 0 says nothing at all. */}
      {ordersWithoutResponsible === null || ordersWithoutResponsible > 0 ? (
        <>
          <CardDivider />
          <p className="px-4 py-2.5 t-label text-[var(--text-muted)]">
            {ordersWithoutResponsible === null
              ? t("care.gapUnknown")
              : ordersWithoutResponsible === totalOrders
                ? t("care.noneNamed")
                : t("care.gap", { count: ordersWithoutResponsible, total: totalOrders })}
          </p>
        </>
      ) : null}
    </Card>
  );
}
