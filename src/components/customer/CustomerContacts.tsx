import { useTranslations } from "next-intl";
import { Card, CardDivider, CardHeader } from "@/components/ui/Card";
import { NoneLine, Value } from "./parts";
import type { CustomerContact } from "@/lib/queries/customer-profile";

/**
 * Who to call at the customer. PERSONAL DATA OF THIRD PARTIES.
 *
 * THE RULE, WHICH IS OLDER THAN THIS PAGE
 * ---------------------------------------
 * `public.project_contact` is read under `can_view_project()`, so a reader only
 * ever sees contacts on orders that are already theirs. What keeps it out of
 * everything else is a UI contract, not a policy: never a table column, never a
 * `csv:` callback, never a `title=` tooltip, never the page's export.
 * check-my-work-detail.mjs pinned that for /my-work and
 * check-customer-profile.mjs pins it here. The privacy line on screen states the
 * rule the gate enforces, so a reader can see the promise as well as rely on it.
 *
 * ONCE PER PERSON, NOT ONCE PER ROW
 * ---------------------------------
 * 263 contact rows across the sheet collapse to 121 distinct people, and within
 * one customer up to 3 people are spread over up to 9 orders. The query folds
 * them on name + e-mail + digits-of-phone; this card shows each person once and
 * names the orders they appear on, but only when there is more than one — "named
 * on the only order" is not information.
 *
 * A contact with no name at all is 4 of 263 rows, and it says so rather than
 * rendering an empty line that looks broken.
 *
 * AN EMPTY LIST IS TWO DIFFERENT FACTS
 * ------------------------------------
 * The `project_contact` read degrades to no rows on error, so "this customer has
 * no contacts" and "the read failed" arrive here as the same empty array. "Kein
 * Ansprechpartner hinterlegt" is a claim about the CUSTOMER and is false in the
 * second case — and that is the case where a colleague most needs to know to
 * look elsewhere rather than conclude there is nobody to call. `unavailable`
 * carries the difference, and it gets its own sentence.
 */
export function CustomerContacts({
  contacts,
  unavailable,
}: {
  contacts: CustomerContact[];
  /** True when the read FAILED. An absence and a failure are not one sentence. */
  unavailable: boolean;
}) {
  const t = useTranslations("customer");

  /** tel: wants digits and a leading plus; the sheet writes spaces and slashes. */
  const telHref = (phone: string) => `tel:${phone.replace(/[^+\d]/g, "")}`;

  return (
    <Card as="section" aria-label={t("contacts.title")}>
      <CardHeader title={t("contacts.title")} qualifier={t("contacts.qualifier")} />
      <CardDivider />
      <p className="px-4 pt-3 t-label text-[var(--text-faint)]">{t("contacts.privacy")}</p>
      {contacts.length === 0 ? (
        <div className="px-4 py-3">
          <NoneLine>{unavailable ? t("contacts.unavailable") : t("contacts.none")}</NoneLine>
        </div>
      ) : (
        <div className="divide-y divide-[var(--divider)]">
          {contacts.map((c) => (
            <div
              key={`${c.name ?? ""}|${c.email ?? ""}|${c.phone ?? ""}`}
              className="flex flex-col gap-0.5 px-4 py-3"
            >
              <span className="t-callout text-[var(--text-primary)] [overflow-wrap:anywhere]">
                {c.name === null ? (
                  <span className="text-[var(--text-faint)]">{t("contacts.noName")}</span>
                ) : (
                  <Value value={c.name} />
                )}
              </span>
              {/* --accent is correct on these two: they are interactive. */}
              {c.phone ? (
                <a href={telHref(c.phone)} className="fig text-[var(--accent)] underline-offset-2 hover:underline">
                  {c.phone}
                </a>
              ) : null}
              {c.email ? (
                <a
                  href={`mailto:${c.email}`}
                  className="t-callout text-[var(--accent)] underline-offset-2 hover:underline [overflow-wrap:anywhere]"
                >
                  {c.email}
                </a>
              ) : null}
              {c.orderCodes.length > 1 ? (
                <span className="t-label text-[var(--text-faint)] [overflow-wrap:anywhere]">
                  {t("contacts.onOrders", { codes: c.orderCodes.join(" · ") })}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
