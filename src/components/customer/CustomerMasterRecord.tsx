import Link from "next/link";
import { useTranslations } from "next-intl";
import { Card, CardDivider, CardHeader } from "@/components/ui/Card";
import { StatusBadge } from "@/components/StatusBadge";
import { Row, Value } from "./parts";
import type {
  CustomerMasterRecord as MasterRecord,
  MasterRecordState,
} from "@/lib/queries/customer-profile";

/**
 * The canonical Lexware customer record — exec only, and ALWAYS on the page.
 *
 * NEVER A BLANK SPACE, NEVER A SILENT OMISSION
 * --------------------------------------------
 * Every `crm.*` table carries the exec-only policy "customer master exec
 * access", so 17 of the 23 provisioned accounts may not read a single row. The
 * shape budget-visibility.ts established applies: the card is rendered for
 * everybody, and for a reader without the role it carries one state word and one
 * paragraph saying the withholding is a fact about THEM.
 *
 * The load-bearing sentence in that paragraph is the second one — that the page
 * cannot tell them whether such a record EXISTS. Under RLS, a record they may
 * not read and a record that is not there are indistinguishable, and a card that
 * merely said "restricted" would let a reader conclude the first from the
 * second's silence.
 *
 * FOUR STATES, FOUR SENTENCES
 * ---------------------------
 *   withheld     not exec. About the reader.
 *   none         exec, and crm holds no row for this number.
 *   unavailable  exec, and the READ FAILED. A failure, not a restriction.
 *   present      exec, and the record is below.
 *
 * `unavailable` is not hypothetical today. Measured 2026-09-10: the `crm` schema
 * is NOT in this project's PostgREST exposed-schema list — a probe returns
 * `PGRST106 "Only the following schemas are exposed: public, graphql_public,
 * raw, time"` — so an exec currently lands here. Exposing `crm` is a Supabase
 * project setting rather than a migration, and is outside this ticket.
 *
 * THE EM DASHES ARE THE POINT
 * ---------------------------
 * Billing name / street / postcode / city are populated on 6 of 119 Lexware
 * rows, and `vat_id` on 0 of 119. Most of this card is therefore an absence for
 * most customers, and hiding the empty rows would hide the actionable fact: the
 * master record is not maintained. So every row renders, absent or not.
 */
export function CustomerMasterRecord({
  state,
  record,
}: {
  state: MasterRecordState;
  record: MasterRecord | null;
}) {
  const t = useTranslations("customer");

  const message =
    state === "withheld"
      ? { label: t("crm.withheldLabel"), body: t("crm.withheldBody") }
      : state === "none"
        ? { label: null, body: t("crm.none") }
        : state === "unavailable"
          ? { label: null, body: t("crm.unavailable") }
          : null;

  return (
    <Card as="section" aria-label={t("crm.title")}>
      <CardHeader title={t("crm.title")} qualifier={t("crm.qualifier")} />
      <CardDivider />
      {message !== null || record === null ? (
        <div className="flex flex-col gap-1 px-4 py-3">
          {message?.label ? <span className="t-label text-[var(--text-faint)]">{message.label}</span> : null}
          <p className="t-callout t-loose text-[var(--text-secondary)]">{message?.body ?? t("crm.unavailable")}</p>
        </div>
      ) : (
        <dl className="flex flex-col px-4 py-3">
          <Row label={t("crm.field.displayName")}>
            <Value value={record.displayNameSource} />
          </Row>
          <Row label={t("crm.field.billingName")}>
            <Value value={record.billingName} />
          </Row>
          <Row label={t("crm.field.billingAddress")}>
            <Value value={record.billingAddress} />
          </Row>
          <Row label={t("crm.field.vatId")} mono>
            <Value value={record.vatId} />
          </Row>
          <Row label={t("crm.field.legalEntity")}>
            <Value value={record.legalName} />
          </Row>
          <Row label={t("crm.field.legalForm")}>
            <Value value={record.legalForm} />
          </Row>
          <Row label={t("crm.field.country")} mono>
            <Value value={record.countryCode} />
          </Row>
          <Row label={t("crm.field.lifecycle")}>
            <Value value={record.lifecycleStatus} />
          </Row>
          <Row label={t("crm.field.review")}>
            {record.reviewStatus === "review_required" ? (
              /* The one page that can resolve it. Exec-only, like this card. */
              <Link href="/customer-master/import-review" className="underline-offset-2 hover:underline">
                <StatusBadge status={t("crm.reviewRequired")} tone="warning" />
              </Link>
            ) : (
              <Value value={record.reviewStatus} />
            )}
          </Row>
          <Row label={t("crm.field.locations")}>
            <Value value={record.locations.length > 0 ? record.locations.join(" · ") : null} />
          </Row>
          <Row label={t("crm.field.aliases")}>
            <Value value={record.aliases.length > 0 ? record.aliases.join(" · ") : null} />
          </Row>
        </dl>
      )}
    </Card>
  );
}
