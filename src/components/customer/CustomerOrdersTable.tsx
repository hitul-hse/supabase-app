"use client";
/**
 * The customer's order ledger — the substance of /customers/[number].
 *
 * WHY THE COLUMNS ARE WHAT THEY ARE
 * ---------------------------------
 * Six, and no more. The masterdata sheet carries twenty-seven fields per order
 * and this table is already the widest thing on the page, so everything that is
 * not asked about while SCANNING a ledger lives elsewhere:
 *
 *   - the address is constant for 91 of 101 customers, so a column would repeat
 *     one string down the page; it is the Standorte card instead;
 *   - 29 link URLs are shared between a customer's orders, so a link column
 *     would render the same chat room up to nine times; they are the Links card;
 *   - the delivery terms (minimum on-site time, travel, travel as project time)
 *     are populated on well under half the rows; the footnote names them and
 *     says they live on the order;
 *   - `order_confirmation_number` is already inside the order code.
 *
 * WHAT IS NEVER HERE, AND IS PINNED BY A GATE
 * -------------------------------------------
 * No contact field. `public.project_contact` is personal data of third parties;
 * it renders once per person in its own card and never as a column, never in a
 * `csv:` callback, never in a `title=` tooltip. scripts/check-customer-profile.mjs
 * asserts that this file contains no contact field at all and that the DataTable
 * call site passes `columns={orderColumns}` BY NAME — no spread, no concat,
 * which is the mutation a sliced-block check alone cannot see.
 *
 * THE BUDGET COLUMN IS OMITTED, NOT BLANKED
 * -----------------------------------------
 * Without `projects:contracts:read` the VERTRAGSSTUNDEN column is not in the
 * array at all, and the footnote says so. Nine rows of the words "nicht
 * freigegeben" add nothing the withheld tile above has not already said, and a
 * column that is never built cannot leak into the CSV — the same discipline
 * `budgetAwareColumns()` applies to the wire.
 *
 * NOTHING HERE DECIDES A FIGURE
 * -----------------------------
 * Every value on a row is read off `CustomerOrder`, including `termState`, which
 * the SERVER decided against the Berlin date. Deriving liveness here would
 * compare against the viewer's clock, so the server render and the client render
 * could disagree on one machine and two colleagues in two zones could read the
 * same contract as running and ended.
 */
import Link from "next/link";
import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { DataTable, cmpNum, cmpText, type Column } from "@/components/data-table";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDate } from "@/lib/date-display";
import type { CustomerOrder, TermState } from "@/lib/queries/customer-profile";

/** The house glyph for a missing value — never 0, never blank. */
const ABSENT = "—";

/** Sort rank for STATUS: running first, then ended, then no end date at all. */
const TERM_RANK: Record<TermState, number> = { running: 0, ended: 1, unknownEnd: 2 };

export type OrdersFootnoteFacts = {
  isExec: boolean;
  budgetsWithheld: boolean;
  measuredOrders: number;
  totalOrders: number;
  siblingUnnumberedOrders: number;
  siblingCustomerNumbers: string[];
  truncated: boolean;
};

export function CustomerOrdersTable({
  customerNumber,
  orders,
  budgetsWithheld,
  canOpenOrder,
  loggedHoursAsOf,
  footnotes,
}: {
  /** The five-digit key, used only to name the CSV the reader downloads. */
  customerNumber: string;
  orders: CustomerOrder[];
  /** True when the reader may not see budgets; the column is then absent. */
  budgetsWithheld: boolean;
  /**
   * True when the reader holds `projects:read_all`.
   *
   * /orders/[id] refuses that permission and /orders is off the operations
   * allow-list besides, so for the page's primary audience a linked order code
   * would end in a redirect to /my-work. A link that lands on a refusal panel
   * is worse than no link, so the codes are plain text instead.
   */
  canOpenOrder: boolean;
  /** The `logged_hours` refresh instant, already formatted for this locale. */
  loggedHoursAsOf: string | null;
  footnotes: OrdersFootnoteFacts;
}) {
  const t = useTranslations("customer");
  const locale = useLocale();

  /** Hours to one decimal in the reader's locale; a German reader gets a comma. */
  const hours = (n: number) =>
    n.toLocaleString(locale === "de" ? "de-DE" : "en-GB", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });

  const day = (iso: string | null) => (iso === null ? ABSENT : formatDate(iso, locale));

  const orderColumns: Column<CustomerOrder>[] = useMemo(() => {
    const kindLabel = (kind: CustomerOrder["responsibleKind"], name: string | null): string | null => {
      if (kind === "person") return name ?? t("people.unknown");
      if (kind === "doctor") return t("people.doctor");
      if (kind === "other") return t("people.other");
      return null;
    };

    const cols: Column<CustomerOrder>[] = [
      {
        key: "service",
        header: t("orders.col.service"),
        className: "w-[14rem]",
        title: t("orders.col.serviceTitle"),
        /*
         * Number first, then the subproject, then the code. Sorting on the NAME
         * would put two spellings of the same service apart; sorting on the
         * number keeps 1000 and 1001 adjacent, which is where the reader can
         * see for themselves that they are the same service twice.
         */
        compare: (a, b) =>
          cmpNum(a.serviceNumber, b.serviceNumber) ||
          cmpNum(a.subprojectNumber, b.subprojectNumber) ||
          cmpText(a.code, b.code),
        descFirst: false,
        search: (r) => `${r.serviceName ?? ""} ${r.code} ${r.name}`,
        csv: (r) => r.code,
        cell: (r) => (
          <div className="flex min-w-0 flex-col t-tight">
            <span className="t-callout text-[var(--text-primary)] [overflow-wrap:anywhere]">
              {r.serviceName ?? ABSENT}
            </span>
            {/* The order code opens /orders/[id] only for a reader who may. */}
            {canOpenOrder ? (
              <Link
                href={`/orders/${encodeURIComponent(r.id)}`}
                className="fig text-[var(--accent)] underline-offset-2 hover:underline"
              >
                {r.code}
              </Link>
            ) : (
              <span className="fig text-[var(--text-faint)]">{r.code}</span>
            )}
          </div>
        ),
      },
      {
        key: "responsible",
        header: t("orders.col.responsible"),
        className: "w-[10rem]",
        compare: (a, b) =>
          cmpText(kindLabel(a.responsibleKind, a.responsibleName), kindLabel(b.responsibleKind, b.responsibleName)),
        descFirst: false,
        // The sheet names nobody at all on this order — not the same as an
        // external physician, which is a real answer and sorts with the rest.
        nullish: (r) => r.responsibleKind === null,
        search: (r) => kindLabel(r.responsibleKind, r.responsibleName) ?? "",
        csv: (r) => kindLabel(r.responsibleKind, r.responsibleName) ?? "",
        cell: (r) => {
          const label = kindLabel(r.responsibleKind, r.responsibleName);
          return label === null ? (
            <span className="text-[var(--text-faint)]">{ABSENT}</span>
          ) : (
            <span className="[overflow-wrap:anywhere]">{label}</span>
          );
        },
      },
      {
        key: "term",
        header: t("orders.col.term"),
        className: "w-[11rem]",
        compact: true,
        title: t("orders.col.termTitle"),
        compare: (a, b) => cmpText(a.contractEnd, b.contractEnd),
        descFirst: true,
        // Pinned last in BOTH directions: an order with no end date is not the
        // furthest-future contract, and a comparator alone cannot say so.
        nullish: (r) => r.contractEnd === null,
        search: (r) => `${r.contractStart ?? ""} ${r.contractEnd ?? ""}`,
        csv: (r) => `${r.contractStart ?? ""}|${r.contractEnd ?? ""}`,
        cell: (r) => (
          <span className="fig">{t("orders.termRange", { start: day(r.contractStart), end: day(r.contractEnd) })}</span>
        ),
      },
      {
        key: "status",
        header: t("orders.col.status"),
        compact: true,
        compare: (a, b) => TERM_RANK[a.termState] - TERM_RANK[b.termState],
        descFirst: false,
        search: (r) => t(`orders.status.${r.termState}`),
        csv: (r) =>
          r.lifecycleStatus === "historical"
            ? `${t(`orders.status.${r.termState}`)} / ${t("orders.status.historical")}`
            : t(`orders.status.${r.termState}`),
        cell: (r) => (
          <span className="flex flex-wrap items-center gap-1">
            {/* Neutral throughout: an ended contract is finished business, not a
                fault, and colour on it would be decoration. Status is the badge
                TEXT, never the colour (UI-CONVENTIONS, house tokens). */}
            <StatusBadge status={t(`orders.status.${r.termState}`)} tone="neutral" />
            {r.lifecycleStatus === "historical" ? (
              <StatusBadge status={t("orders.status.historical")} tone="neutral" />
            ) : null}
          </span>
        ),
      },
    ];

    if (!budgetsWithheld) {
      cols.push({
        key: "contract",
        header: t("orders.col.contract"),
        align: "right",
        className: "w-[8rem]",
        compact: true,
        compare: (a, b) => cmpNum(a.contractHours, b.contractHours),
        descFirst: true,
        nullish: (r) => r.contractHours === null,
        csv: (r) => (r.contractHours === null ? "" : r.contractHours),
        cell: (r) =>
          r.contractHours === null ? (
            <span className="text-[var(--text-faint)]">{ABSENT}</span>
          ) : (
            <span className="fig tabular-nums">{hours(r.contractHours)}</span>
          ),
      });
    }

    cols.push({
      key: "logged",
      header: t("orders.col.logged"),
      align: "right",
      className: "w-[8rem]",
      compact: true,
      title: t("orders.col.loggedTitle", { when: loggedHoursAsOf ?? ABSENT }),
      compare: (a, b) => cmpNum(a.loggedHours, b.loggedHours),
      descFirst: true,
      // null means "no TrackingTime link on this order", which is unknown, not
      // zero — and 65 of 242 live orders are in that state.
      nullish: (r) => r.loggedHours === null,
      csv: (r) => (r.loggedHours === null ? "" : r.loggedHours),
      cell: (r) =>
        r.loggedHours === null ? (
          <span className="text-[var(--text-faint)]">{ABSENT}</span>
        ) : (
          <span className="fig tabular-nums">{hours(r.loggedHours)}</span>
        ),
    });

    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, locale, budgetsWithheld, canOpenOrder, loggedHoursAsOf]);

  return (
    <DataTable<CustomerOrder>
      rows={orders}
      columns={orderColumns}
      rowKey={(r) => r.id}
      title={t("orders.title")}
      hint={loggedHoursAsOf ? t("orders.hint", { when: loggedHoursAsOf }) : undefined}
      initialSort="term"
      initialDesc
      density="standard"
      /*
       * 25 rows, mirrored into the URL so a shared link, a refresh and the back
       * button agree (UI-CONVENTIONS rule 2). At today's data the pager never
       * renders — the largest account holds nine orders — and that is the right
       * outcome: this is a ledger somebody SCANS, not a queue they work through,
       * so rule 1's fixed ten does not apply and `fixedPageSize` is not set.
       */
      defaultPageSize={25}
      pagerStyle="compact"
      urlKeys={{ page: "page", size: "size" }}
      exportName={`kunde-${customerNumber}-auftraege`}
      searchPlaceholder={t("orders.search")}
      emptyText={t("orders.empty")}
      footnote={<OrdersFootnotes facts={footnotes} />}
    />
  );
}

/**
 * What the table is NOT showing, one line each, in the order a reader needs
 * them. UI-CONVENTIONS rule 6: a silent omission reads as "everything is fine",
 * which is a lie by layout.
 */
function OrdersFootnotes({ facts }: { facts: OrdersFootnoteFacts }) {
  const t = useTranslations("customer");
  const lines: string[] = [];

  if (!facts.isExec) lines.push(t("orders.footnote.visibility"));
  if (facts.measuredOrders === 0 && facts.totalOrders > 0) {
    lines.push(t("orders.footnote.hoursNone"));
  } else if (facts.measuredOrders < facts.totalOrders) {
    lines.push(t("orders.footnote.hours", { measured: facts.measuredOrders, total: facts.totalOrders }));
  }
  if (facts.budgetsWithheld) lines.push(t("orders.footnote.budgets"));
  if (facts.siblingUnnumberedOrders > 0) {
    lines.push(t("orders.footnote.unnumbered", { count: facts.siblingUnnumberedOrders }));
  }
  lines.push(t("orders.footnote.terms"));
  if (facts.truncated) lines.push(t("orders.footnote.truncated"));

  return (
    <div className="flex flex-col gap-1">
      {lines.map((line) => (
        <p key={line} className="t-label text-[var(--text-muted)]">
          {line}
        </p>
      ))}
      {/* Other numbers under the same legal entity are OTHER customers, each
          with its own page and its own figures. ADR-001: the number is the
          identity, so two numbers are two customers even under one entity. */}
      {facts.siblingCustomerNumbers.length > 0 ? (
        <p className="t-label text-[var(--text-muted)]">
          {t("orders.footnote.siblingsLead")}{" "}
          {facts.siblingCustomerNumbers.map((n, i) => (
            <span key={n}>
              {i > 0 ? " · " : null}
              <Link href={`/customers/${n}`} className="fig text-[var(--accent)] underline-offset-2 hover:underline">
                {n}
              </Link>
            </span>
          ))}
        </p>
      ) : null}
    </div>
  );
}
