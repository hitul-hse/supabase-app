import { useTranslations } from "next-intl";
import { Card, CardDivider, CardHeader } from "@/components/ui/Card";
import { LINK_ICON } from "@/components/my-work/link-icons";
import { LINK_DESTINATION } from "@/lib/queries/my-work";
import { NoneLine } from "./parts";
import type { CustomerLink } from "@/lib/queries/customer-profile";

/**
 * The working links for this customer — each DESTINATION once.
 *
 * WHY NOT A COLUMN ON THE ORDERS TABLE
 * ------------------------------------
 * Measured: 341 link rows carry only 340 distinct (project, kind) pairs, and 29
 * URLs are SHARED between several orders of one customer. A per-row link column
 * would therefore render the same Google Chat room up to nine times down the
 * page. Keyed on the URL, it appears once with the orders it belongs to.
 *
 * The attribution line is shown only when the customer has more than one order:
 * otherwise it is trivially "all of them".
 *
 * THE LINK'S OWN TEXT MUST STAND ALONE
 * ------------------------------------
 * A screen reader lists links out of context, so the accessible name is the
 * sheet's label when there is one and the FULL destination otherwise ("Google
 * Chat room", never "CHAT"). `LINK_DESTINATION` is the shared map — reused here
 * rather than re-invented, so the two surfaces cannot call one kind two things.
 *
 * AN ABSENT LINK IS NOT AN "N/A"
 * ------------------------------
 * Nobody recorded one; there is no figure being withheld and no measurement
 * missing. Two customers are in that state and the card says so in a sentence.
 *
 * DATEIABLAGE is a PATH, not a URL — a text row, never an anchor.
 */
export function CustomerLinks({
  links,
  fileStorages,
  totalOrders,
}: {
  links: CustomerLink[];
  fileStorages: string[];
  totalOrders: number;
}) {
  const t = useTranslations("customer");
  const several = totalOrders > 1;
  const empty = links.length === 0 && fileStorages.length === 0;

  return (
    <Card as="section" aria-label={t("links.title")}>
      <CardHeader title={t("links.title")} qualifier={t("links.qualifier")} />
      <CardDivider />
      {empty ? (
        <div className="px-4 py-3">
          <NoneLine>{t("links.none")}</NoneLine>
        </div>
      ) : (
        <div className="divide-y divide-[var(--divider)]">
          {links.map((l) => {
            const Icon = LINK_ICON[l.kind];
            const destination = LINK_DESTINATION[l.kind];
            return (
              <div key={l.url} className="flex flex-col gap-0.5 px-4 py-3">
                <a
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 t-callout text-[var(--accent)] underline-offset-2 hover:underline"
                >
                  <Icon className="h-4 w-4 flex-none" />
                  <span className="[overflow-wrap:anywhere]">{l.label ?? destination}</span>
                </a>
                {several && l.orderCodes.length > 0 ? (
                  <span className="t-label text-[var(--text-faint)] [overflow-wrap:anywhere]">
                    {t("links.onOrders", { codes: l.orderCodes.join(" · ") })}
                  </span>
                ) : null}
              </div>
            );
          })}
          {fileStorages.map((path) => (
            <div key={path} className="flex flex-col gap-0.5 px-4 py-3">
              <span className="t-label text-[var(--text-faint)]">{t("links.fileStorage")}</span>
              <span className="t-callout text-[var(--text-primary)] [overflow-wrap:anywhere]">{path}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
