"use client";
/**
 * MyWorkDetail — the masterdata sheet's purple fields for ONE selected order.
 *
 * WHAT THIS IS
 * ------------
 * On 2026-09-10 hitul confirmed the 27 magenta columns of the masterdata sheet
 * as what an operations person (Mathias) sees for their services: the customer
 * as the sheet names it, language, address, contract start and end, contract
 * hours, the responsible person and their replacement, the delivery terms
 * (minimum on-site time, travel flat rate, travel time as project time), the
 * customer's two contacts, and the working links (HSEHU-64). Those facts now
 * live in `public.project_masterdata` and `public.project_contact`, promoted
 * from the hourly staging of the sheet, and this panel is where they render.
 *
 * WHY A PANEL AND NOT COLUMNS
 * ---------------------------
 * The projects table clears 1280px by a few pixels and check-table-scroll-
 * budget pins /my-work. Twenty-seven more columns is not a table, it is a
 * spreadsheet, and the question these fields answer -- "what did we agree
 * with THIS customer" -- is asked about one row at a time. So the row's name
 * SELECTS it (the existing `?project=` URL state, APPLE_REF §8 #18) and the
 * facts appear beside the list: the master/detail shape UI-CONVENTIONS rule 4
 * describes, with the detail `lg:sticky lg:top-4` so row N's facts stay next
 * to row N.
 *
 * WHY A SIBLING CARD
 * ------------------
 * Never a Card inside the DataTable's Card -- the design gate bans nesting and
 * Card.tsx explains why. This is a sibling in a two-column grid that MyWorkTables
 * only builds when a row is selected, so a first load is byte-identical to
 * before: no width change, no new column, nothing for the scroll-budget gate
 * to measure differently. The trade on selection is real and stated: beside a
 * 20rem panel the table has less width and scrolls inside its card on a
 * narrower desktop. The link columns it hides are repeated here in full.
 *
 * WHAT IS NEVER HERE
 * ------------------
 * Contract hours are the ONE commercial figure on the panel and they come
 * from `projects.contract_hours` through the existing budget redaction: the
 * caller passes the already-formatted string and the withheld flag, so this
 * file cannot reconstruct a budget the reader may not see. The sheet's
 * planned / on-site / remote hours were never promoted at all.
 *
 * The two customer contacts are personal data of third parties. They render
 * here, for the one selected order, and nowhere else: no list column carries
 * them and no `Column.csv` exports them. check-my-work-detail.mjs pins both.
 *
 * HONEST NULLS
 * ------------
 * The sheet writes "-" for "not applicable". Every such cell arrives as null
 * and renders as the house absence glyph, never as 0, never as "Nein", never
 * as an empty string that looks like a rendering bug. A Ja/Nein column whose
 * cell held free text ("nach Absprache") shows that text, because the boolean
 * was never a boolean there. The contact cells are the one place the importer
 * leaves "-" as written (they are text to it); the query folds them before
 * they reach this file, so a "-" never becomes a contact called "-" with a
 * dead tel: link.
 *
 * ENDED, HISTORICAL, OR BOTH
 * --------------------------
 * Liveness is `contract_end`: never the sheet's status column (stale in 66 of
 * 247 rows when measured) and never `lifecycle_status` -- "open" is derived
 * by the readers, not stored, as the warehouse migration says. So a contract
 * whose end date has passed says so on EVERY row, whether or not the sheet
 * still carries it. A row the sheet stopped carrying is marked
 * `lifecycle_status = 'historical'` with the batch that last saw it, never
 * deleted (decision 2026-09-10), and that is a second, different fact: a
 * finished contract is finished business; a row that vanished while its
 * contract runs is a data question for whoever maintains the sheet. The
 * banner states whichever holds, or both, and "today" for the comparison is
 * the Berlin date, like every other stamp on the panel.
 */
import { useEffect } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Card, CardDivider, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { IconCross } from "@/components/nav-icons";
import {
  LINK_DESTINATION,
  type MyProject,
  type PersonKind,
} from "@/lib/queries/my-work";
import { LINK_ICON } from "./link-icons";

/** The house glyph for a missing value (DESIGN.md §Data tables 6) -- never 0, never blank. */
const ABSENT = "—";

/** The DOM id the mobile scroll-into-view targets; Card does not forward refs. */
const PANEL_ID = "my-work-detail";

/**
 * A date-only ISO string, rendered in the reader's locale. Parsed as UTC
 * midnight and formatted in UTC, so "2026-12-31" is the 31st on every machine
 * rather than the 30th for anyone west of Greenwich.
 */
function formatDate(iso: string, locale: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(locale === "de" ? "de-DE" : "en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * A timestamp, rendered in the company's zone. Pinned to Europe/Berlin rather
 * than the viewer's zone so the server render and the client render agree
 * (a hydration mismatch here would flash the whole footnote), and because the
 * sheet's modified time is a Berlin office time in the first place.
 */
function formatStamp(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(locale === "de" ? "de-DE" : "en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Berlin",
  });
}

/**
 * Today as YYYY-MM-DD in Europe/Berlin, the zone every other stamp on this
 * panel is pinned to. `toISOString().slice(0, 10)` is the UTC date, which is
 * still yesterday in Berlin between local midnight and 01:00 (02:00 in
 * summer): long enough for a server render and a client render to disagree
 * about whether a contract has ended, and for the footnote's Berlin stamp and
 * the banner to name different days. en-CA is the locale whose default date
 * format IS the ISO one.
 */
function todayInBerlin(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date());
}

/** tel: wants digits and a leading plus; the sheet writes spaces, slashes and dashes. */
function telHref(phone: string): string {
  return `tel:${phone.replace(/[^+\d]/g, "")}`;
}

/** One label / value pair of a definition list. */
function Row({
  label,
  children,
  mono = false,
}: {
  label: string;
  children: React.ReactNode;
  /** Figures and codes set in the mono role; prose in the callout role. */
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <dt className="flex-none t-label text-[var(--text-faint)]">{label}</dt>
      <dd
        className={`min-w-0 text-right [overflow-wrap:anywhere] ${
          mono ? "fig" : "t-callout"
        } text-[var(--text-primary)]`}
      >
        {children}
      </dd>
    </div>
  );
}

/** A value or the absence glyph, faint so the eye skips it. */
function Value({ value }: { value: string | null }) {
  if (value === null) return <span className="text-[var(--text-faint)]">{ABSENT}</span>;
  return <>{value}</>;
}

/**
 * A titled block of the panel. Its rows are a definition list -- unless
 * `list` is false, in which case the children render as they are. An empty
 * state is a sentence, and a <p> inside a <dl> is invalid markup that costs
 * assistive tech the list semantics it would otherwise announce (Card.tsx
 * makes the same point about a div between <ul> and its items). A section
 * that can be empty passes `list={items.length !== 0}` -- written without a
 * bare `>` so check-my-work-detail can find where the opening tag ends.
 */
function Section({
  title,
  children,
  list = true,
}: {
  title: string;
  children: React.ReactNode;
  list?: boolean;
}) {
  return (
    <section className="px-4 py-3">
      <h3 className="mb-1 t-label text-[var(--text-faint)]">{title}</h3>
      {list ? <dl className="flex flex-col">{children}</dl> : children}
    </section>
  );
}

export function MyWorkDetail({
  project,
  contractHours,
  budgetsWithheld,
  onClose,
  variant = "panel",
}: {
  /** The selected row, with its `detail` (or null) and `contacts`. */
  project: MyProject;
  /**
   * Contract hours ALREADY formatted by the tables' `hours()`, so the two
   * surfaces cannot format the same figure two ways -- and so this file never
   * touches the raw number, which is the redacted one.
   */
  contractHours: string;
  /** True when the caller may not see budgets; the cell then says so. */
  budgetsWithheld: boolean;
  /** Clears the selection (the same toggle the row name uses). */
  onClose: () => void;
  /*
    "panel" is the sticky column beside the table; "dialog" is the same content
    inside ModalShell, which owns the surface's position. The only difference is
    where it sits: a dialog must not stick to a viewport it already covers, and
    it caps its own height so a long order scrolls inside the dialog rather than
    growing it past the screen. Everything shown is identical, so a reader who
    has seen one has seen the other.
  */
  variant?: "panel" | "dialog";
}) {
  const t = useTranslations("myWork");
  const locale = useLocale();
  const { detail, contacts, links } = project;

  /*
   * Below `lg` the grid is one column and the panel sits UNDER a bounded
   * table, so a tap on a row name changed nothing on screen but the row tint.
   * Bring the panel into view when the selection changes, minimally
   * (`nearest`), and only there: at `lg` and up it is beside the table and
   * sticky, and scrolling would fight that.
   */
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(min-width: 64rem)").matches) return;
    document.getElementById(PANEL_ID)?.scrollIntoView({ block: "nearest" });
  }, [project.id]);

  const kindLabel = (kind: PersonKind | null, name: string | null): string | null => {
    if (kind === "person") return name ?? t("detail.people.unknown");
    if (kind === "doctor") return t("detail.people.doctor");
    if (kind === "other") return t("detail.people.other");
    return null;
  };

  /** Ja/Nein as words; free text as written; neither as the absence glyph. */
  const yesNo = (value: boolean | null, text: string | null): string | null => {
    if (value === true) return t("detail.delivery.yes");
    if (value === false) return t("detail.delivery.no");
    return text;
  };

  const address =
    detail && (detail.street || detail.postalCode || detail.city)
      ? [detail.street, [detail.postalCode, detail.city].filter(Boolean).join(" ")]
          .filter(Boolean)
          .join(", ")
      : null;

  // Two independent facts, each shown whenever it holds. ENDED: the end date
  // is before today, on ANY lifecycle, because liveness is contract_end. GONE:
  // the sheet stopped carrying the row. Compared as ISO strings, which sort
  // as dates; a contract ending today is still running today.
  const endedOn = detail?.contractEnd ?? null;
  const contractEnded = endedOn !== null && endedOn < todayInBerlin();
  const gone = detail?.lifecycleStatus === "historical";
  const bannerText =
    endedOn !== null && contractEnded
      ? gone
        ? t("detail.historical.both", { date: formatDate(endedOn, locale) })
        : t("detail.historical.ended", { date: formatDate(endedOn, locale) })
      : gone
        ? t("detail.historical.gone")
        : null;

  const hasLinks = links.length > 0 || Boolean(detail?.fileStorage);

  return (
    <Card
      as="section"
      id={PANEL_ID}
      aria-label={project.name}
      className={
        variant === "dialog"
          ? "max-h-[85vh] overflow-y-auto overscroll-contain"
          : "lg:sticky lg:top-4"
      }
    >
      <CardHeader
        title={project.name}
        qualifier={project.code}
        actions={
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            title={t("detail.close")}
            aria-label={t("detail.close")}
          >
            <IconCross className="h-3.5 w-3.5" />
          </Button>
        }
      />
      <CardDivider />

      {detail === null ? (
        /*
          The honest empty state: the sheet has no row for this order (or the
          promote has not run yet). One line, no skeleton, no zeroes. Links
          from project_link still render below because they are facts we do
          hold, and hiding them here while the row shows them would be odd.
        */
        <p className="px-4 py-3 t-callout text-[var(--text-muted)]">{t("detail.empty")}</p>
      ) : (
        <>
          {bannerText !== null ? (
            <p
              role="status"
              className="mx-4 mt-3 rounded-[var(--radius)] border border-[var(--border-strong)] px-3 py-2 t-callout text-[var(--text-secondary)]"
            >
              {/* The label names the state -- a row the sheet dropped is
                  HISTORICAL, a finished contract the sheet still carries is
                  CONTRACT ENDED -- and the sentence names the fact(s). Text,
                  not colour: neither is a risk, so no amber. */}
              <span className="t-label text-[var(--text-faint)]">
                {gone ? t("detail.historical.label") : t("detail.historical.endedLabel")}
              </span>{" "}
              {bannerText}
            </p>
          ) : null}

          <Section title={t("detail.service.title")}>
            <Row label={t("detail.service.customer")}>
              <Value value={detail.customerDisplayName} />
            </Row>
            {/* Only when the legal name differs: the same string twice is furniture. */}
            {detail.customerName && detail.customerName !== detail.customerDisplayName ? (
              <Row label={t("detail.service.customerName")}>
                <Value value={detail.customerName} />
              </Row>
            ) : null}
            <Row label={t("detail.service.language")}>
              <Value
                value={
                  detail.language === "de"
                    ? t("detail.language.de")
                    : detail.language === "en"
                      ? t("detail.language.en")
                      : null
                }
              />
            </Row>
            <Row label={t("detail.service.address")}>
              <Value value={address} />
            </Row>
            <Row label={t("detail.service.contractStart")} mono>
              <Value value={detail.contractStart ? formatDate(detail.contractStart, locale) : null} />
            </Row>
            <Row label={t("detail.service.contractEnd")} mono>
              <Value value={detail.contractEnd ? formatDate(detail.contractEnd, locale) : null} />
            </Row>
            <Row label={t("detail.service.contractHours")} mono>
              {/* "withheld" is a fact about the reader, "—" a fact about the
                  project (nobody set a budget). They must not look alike. */}
              {budgetsWithheld ? (
                <span className="text-[var(--text-muted)]">{t("detail.withheld")}</span>
              ) : (
                <Value value={contractHours === ABSENT ? null : contractHours} />
              )}
            </Row>
          </Section>
          <CardDivider />

          <Section title={t("detail.people.title")}>
            {/* The dt already names the rung (VERANTWORTLICH / VERTRETUNG). A
                RESPONSIBLE chip beside it was the same word twice, and in
                English inside a German panel; the tooltip keeps what the chip
                explained, on the name itself. */}
            <Row label={t("detail.people.responsible")}>
              <span title={detail.responsibleKind !== null ? t("detail.people.responsibleTitle") : undefined}>
                <Value value={kindLabel(detail.responsibleKind, detail.responsibleName)} />
              </span>
            </Row>
            <Row label={t("detail.people.role")}>
              <Value value={detail.serviceRole} />
            </Row>
            <Row label={t("detail.people.replacement")}>
              <span title={detail.replacementKind !== null ? t("detail.people.replacementTitle") : undefined}>
                <Value value={kindLabel(detail.replacementKind, detail.replacementName)} />
              </span>
            </Row>
          </Section>
          <CardDivider />

          <Section title={t("detail.delivery.title")}>
            <Row label={t("detail.delivery.minOnsite")}>
              <Value value={detail.minOnsiteTime} />
            </Row>
            <Row label={t("detail.delivery.travelFlatRate")}>
              <Value value={yesNo(detail.travelFlatRate, detail.travelFlatRateText)} />
            </Row>
            <Row label={t("detail.delivery.travelAsProjectTime")}>
              <Value value={yesNo(detail.travelAsProjectTime, detail.travelAsProjectTimeText)} />
            </Row>
          </Section>
          <CardDivider />

          <Section title={t("detail.contacts.title")} list={contacts.length !== 0}>
            {contacts.length === 0 ? (
              <p className="t-callout text-[var(--text-faint)]">{t("detail.contacts.none")}</p>
            ) : (
              contacts.map((c) => (
                <div key={c.slot} className="flex flex-col py-1">
                  <dt className="t-label text-[var(--text-faint)]">
                    {t("detail.contacts.slot", { slot: c.slot })}
                  </dt>
                  <dd className="flex flex-col gap-0.5 t-callout text-[var(--text-primary)]">
                    <Value value={c.name} />
                    {c.phone ? (
                      <a
                        href={telHref(c.phone)}
                        className="fig text-[var(--accent)] underline-offset-2 hover:underline"
                      >
                        {c.phone}
                      </a>
                    ) : null}
                    {c.email ? (
                      <a
                        href={`mailto:${c.email}`}
                        className="[overflow-wrap:anywhere] text-[var(--accent)] underline-offset-2 hover:underline"
                      >
                        {c.email}
                      </a>
                    ) : null}
                  </dd>
                </div>
              ))
            )}
          </Section>
          <CardDivider />
        </>
      )}

      {/*
        Links are dt/dd groups like every other row -- dt where it goes, dd the
        link -- so the <dl> holds definitions and not stray <div>s. The link's
        own text is the sheet's label when there is one and the destination
        otherwise: a screen reader lists links out of context, so a link's
        name must stand on its own even where it repeats the dt beside it.
      */}
      <Section title={t("detail.links.title")} list={hasLinks}>
        {!hasLinks ? (
          <p className="t-callout text-[var(--text-faint)]">{t("detail.links.none")}</p>
        ) : (
          <>
            {links.map((l) => {
              const Icon = LINK_ICON[l.kind];
              const destination = LINK_DESTINATION[l.kind];
              return (
                <Row key={`${l.kind}:${l.url}`} label={destination}>
                  <a
                    href={l.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 text-[var(--accent)] underline-offset-2 hover:underline"
                  >
                    <Icon className="h-4 w-4 flex-none" />
                    <span className="[overflow-wrap:anywhere]">{l.label ?? destination}</span>
                  </a>
                </Row>
              );
            })}
            {detail?.fileStorage ? (
              <Row label={t("detail.links.fileStorage")}>
                <Value value={detail.fileStorage} />
              </Row>
            ) : null}
          </>
        )}
      </Section>

      <CardDivider />
      <p className="px-4 py-2.5 t-label text-[var(--text-faint)]">
        {detail?.lastSeenAt
          ? t("detail.source", { when: formatStamp(detail.lastSeenAt, locale) })
          : t("detail.sourceUndated")}
      </p>
    </Card>
  );
}
