import { useLocale, useTranslations } from "next-intl";
import { Card, CardDivider, CardHeader, StatTile } from "@/components/ui/Card";
import { formatStamp } from "@/lib/date-display";
import type { CustomerProfile } from "@/lib/queries/customer-profile";
import { ABSENT, Row, Value } from "./parts";

/**
 * Who this customer is, and the four figures that decide what happens next.
 *
 * THE HERO TONE IS SPENT HERE, ONCE
 * ---------------------------------
 * `Card tone="hero"` holding a left identity block and a strip of `StatTile`s is
 * the house pattern (`/customer-master/import-review`). Used twice on a page it
 * stops meaning "start here" and the page flattens back to wallpaper, so nothing
 * else on the profile is hero-toned.
 *
 * `lg:contents` promotes the four tiles to direct children of the card's grid at
 * `lg`, so they are a 2x2 block at 400px and a single row of four on a desktop.
 * Stacking them four-high on a phone would cost about half a screen against the
 * house four-screen mobile ceiling.
 *
 * WHY THERE IS NO BURN PERCENTAGE
 * -------------------------------
 * `consumed_percent` is a redacted budget field, and a customer-level burn
 * computed across orders whose hour coverage is 57% partial is exactly the
 * plausible-and-wrong number budget-visibility.ts was written to prevent. The
 * two hour figures sit side by side with their coverage stated and the reader
 * does the division only where it is defensible.
 *
 * THE WITHHELD TILE IS NOT A NULL TILE
 * ------------------------------------
 * `StatTile` renders `value={null}` as "—", which means ABSENT. A budget the
 * reader's role was denied is not absent, so slot three becomes `WithheldTile`
 * — StatTile's exact geometry, the words instead of a figure. `StatTile` itself
 * is deliberately not modified; if a `withheld` variant is ever added there,
 * this moves into it.
 */
export function CustomerIdentityCard({ profile }: { profile: CustomerProfile }) {
  const t = useTranslations("customer");
  const locale = useLocale();
  const { figures } = profile;

  const hours = (n: number) =>
    n.toLocaleString(locale === "de" ? "de-DE" : "en-GB", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });

  const asOf = figures.loggedHoursAsOf ? formatStamp(figures.loggedHoursAsOf, locale) : null;

  return (
    <Card tone="hero">
      <CardHeader title={t("identity.title")} qualifier={t("identity.qualifier")} />
      <CardDivider />
      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1.2fr)_repeat(4,minmax(120px,1fr))]">
        <dl className="flex min-w-0 flex-col">
          {/* Only when the legal name says something the display name does not:
              the same string twice is furniture. */}
          {profile.legalNames.length > 0 ? (
            <Row label={t("identity.legalName")}>{profile.legalNames.join(" · ")}</Row>
          ) : null}
          <Row label={t("identity.group")}>
            <Value value={profile.corporateGroups.length > 0 ? profile.corporateGroups.join(" · ") : null} />
          </Row>
          <Row label={t("identity.language")}>
            {/* The sheet stores 1 and 2. A reader must never see a digit here,
                and a customer whose orders disagree sees both, not one. */}
            <Value
              value={
                profile.languages.length > 0
                  ? profile.languages.map((l) => t(`language.${l}`)).join(" · ")
                  : null
              }
            />
          </Row>
          {/* The merge, stated rather than assumed: 10 customers carry more than
              one spelling, and folding them silently leaves a name nobody can
              reconcile with the sheet in front of them. */}
          {profile.spellings.length > 0 ? (
            <Row label={t("identity.spellings")}>{profile.spellings.join(" · ")}</Row>
          ) : null}
          {/* Always shown: this is the identity, and it is what a colleague
              pastes into Lexware. */}
          <Row label={t("identity.number")} mono>
            {profile.customerNumber}
          </Row>
        </dl>

        <div className="grid grid-cols-2 gap-3 lg:contents">
          <StatTile
            label={t("tiles.orders")}
            value={figures.orders}
            hint={profile.isExec ? t("tiles.ordersHintAll") : t("tiles.ordersHintVisible")}
          />
          <StatTile
            label={t("tiles.running")}
            value={figures.runningContracts}
            /*
             * Tone stays neutral whatever the count. A customer with no running
             * contract is not a fault, and --good / --warning on this figure
             * would be colour used as decoration (UI-CONVENTIONS: the accent and
             * the status colours are never decoration on a figure).
             */
            hint={
              figures.unknownEnd > 0
                ? t("tiles.runningHintUnknown", { total: figures.orders, unknown: figures.unknownEnd })
                : t("tiles.runningHint", { total: figures.orders })
            }
          />

          {profile.budgetsWithheld ? (
            <WithheldTile label={t("tiles.contract")} value={t("tiles.withheld")} hint={t("tiles.withheldHint")} />
          ) : (
            <StatTile
              label={t("tiles.contract")}
              /* null renders "—": nobody recorded contracted hours on any order
                 the reader can see. Never 0 h, which would be a claim. */
              value={figures.contractHours === null ? null : hours(figures.contractHours)}
              unit="h"
              hint={
                figures.contractHours === null
                  ? t("tiles.contractNone")
                  : t("tiles.contractHint", { measured: figures.contractHoursOrders, total: figures.orders })
              }
            />
          )}

          <StatTile
            label={t("tiles.logged")}
            /* null when NOT ONE order is measured — 13 of 101 accounts. "0 h"
               there reads as a customer we abandoned; the truth is that nobody
               linked the orders to TrackingTime. */
            value={figures.loggedHours === null ? null : hours(figures.loggedHours)}
            unit="h"
            /* The coverage clause is part of the figure, not a footnote: a bare
               total invites the reader to divide by the full contract and
               conclude a burn nobody measured. */
            hint={
              figures.loggedHours === null
                ? t("tiles.loggedNone")
                : t("tiles.loggedHint", {
                    measured: figures.loggedMeasuredOrders,
                    total: figures.orders,
                    when: asOf ?? ABSENT,
                  })
            }
          />
        </div>
      </div>
    </Card>
  );
}

/**
 * A figure the reader's role may not see.
 *
 * `StatTile`'s geometry exactly (`card-elev`, the 76px floor, the same label
 * role), so the strip does not go ragged where one tile is withheld — but the
 * value slot carries WORDS in `--text-muted` rather than a figure, because
 * "nicht freigegeben" is a sentence about the reader and a dash would be a
 * sentence about the customer.
 */
function WithheldTile({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="card-elev flex min-h-[76px] flex-col gap-1 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4">
      <span className="t-label text-[var(--text-faint)]">{label}</span>
      <span className="t-title-3 text-[var(--text-muted)]">{value}</span>
      <span className="t-subhead text-[var(--text-muted)]">{hint}</span>
    </div>
  );
}
