import { useTranslations } from "next-intl";
import { Card, CardDivider, CardHeader } from "@/components/ui/Card";
import { NoneLine } from "./parts";
import type { CustomerLocation } from "@/lib/queries/customer-profile";

/**
 * Where the work happens — one block per distinct address.
 *
 * WHY THIS IS A CARD AND NOT A COLUMN OR A HEADER LINE
 * ----------------------------------------------------
 * An address belongs to an ORDER, not to a customer. Measured on the live sheet:
 * 18 of 101 customers have more than one distinct address across their orders,
 * up to SEVEN. So there is no single "the address" to put in the header, and a
 * column in the orders table would repeat one string down the page for the 83
 * customers who have exactly one — on the widest element of the profile.
 *
 * The order codes appear only when there are several addresses. Listing nine
 * codes under the one address every order uses is noise; listing them under each
 * of four addresses is the join a reader actually needs ("which service happens
 * where").
 *
 * An address whose three parts are all null renders a SENTENCE, never a bare
 * dash row — a dash where a street should be looks like a rendering fault, and
 * the fact is that nobody recorded an address for that order.
 */
export function CustomerLocations({ locations }: { locations: CustomerLocation[] }) {
  const t = useTranslations("customer");
  const several = locations.length > 1;

  return (
    <Card as="section" aria-label={t("locations.title")}>
      <CardHeader
        title={t("locations.title")}
        qualifier={several ? t("locations.count", { count: locations.length }) : undefined}
      />
      <CardDivider />
      {locations.length === 0 ? (
        <div className="px-4 py-3">
          <NoneLine>{t("locations.none")}</NoneLine>
        </div>
      ) : (
        <div className="divide-y divide-[var(--divider)]">
          {locations.map((l) => {
            const line2 = [l.postalCode, l.city].filter(Boolean).join(" ");
            const empty = !l.street && line2.length === 0;
            return (
              <div
                key={`${l.street ?? ""}|${l.postalCode ?? ""}|${l.city ?? ""}`}
                className="flex flex-col gap-0.5 px-4 py-3"
              >
                {empty ? (
                  <NoneLine>{t("locations.none")}</NoneLine>
                ) : (
                  <>
                    {l.street ? (
                      <span className="t-callout text-[var(--text-primary)] [overflow-wrap:anywhere]">{l.street}</span>
                    ) : null}
                    {line2.length > 0 ? (
                      <span className="t-callout text-[var(--text-primary)]">{line2}</span>
                    ) : null}
                  </>
                )}
                {several && l.orderCodes.length > 0 ? (
                  <span className="t-label text-[var(--text-faint)] [overflow-wrap:anywhere]">
                    {t("locations.orders", { codes: l.orderCodes.join(" · ") })}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
