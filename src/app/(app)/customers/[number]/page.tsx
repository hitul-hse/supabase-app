/**
 * /customers/[number] — who this customer is, for the person asking.
 *
 * WHAT IT REPLACES
 * ----------------
 * Nothing, which is the point. Clicking a customer in My Work or on the
 * management tab has only ever FILTERED a project list, and /customer-master/
 * import-review shows STAGING rather than a customer. There has been no route
 * in the Hub that answers "who is this customer"; this is it.
 *
 * THE KEY IS THE FIVE-DIGIT LEXWARE NUMBER (ADR-001)
 * --------------------------------------------------
 * `CUSTOMER_NUMBER_PATTERN` is `public.project_masterdata`'s OWN check
 * constraint, which is what makes the guard below provable rather than a guess:
 * a segment that fails it is not a customer number, so the page 404s without a
 * round trip. That is the ONLY notFound() this route produces — see the empty
 * states for why "no rows" is never a 404.
 *
 * ACCESS: A SESSION, AND NOTHING BEYOND IT
 * ----------------------------------------
 * `requireProfile()` plus `enforceRoleRouteAccess("/customers")`, the same
 * argument /my-work makes: every row this page can render is a row
 * `can_view_project()` has already decided the reader may see, so there is no
 * wider scope left to gate. Requiring `projects:read_all` — what /orders/[id]
 * does — would lock out `operations`, `employee` and `project_manager`, 15 of 23
 * provisioned accounts, from the page built for them.
 *
 * `"/customers"` therefore had to be added to `ROLE_ROUTE_ALLOWLIST.operations`
 * in nav-access.ts. Without that one array element `enforceRoleRouteAccess`
 * redirects all six operations accounts to /my-work and the page is invisible to
 * exactly the people it is for.
 *
 * ALMOST NOBODY SEES THE WHOLE ACCOUNT
 * ------------------------------------
 * Measured over every (person, account) pair with any visibility: 80.8% of the
 * time an operations colleague opening a customer is looking at PART of the
 * account, median half of it. So the header states the SCOPE — ALLE AUFTRÄGE for
 * an exec, NUR SICHTBARE AUFTRÄGE for everybody else — and the table repeats it
 * in a footnote, because the header is the one line a reader does not go back to.
 *
 * THE HEADER CARRIES NO FIGURE, DELIBERATELY
 * ------------------------------------------
 * Not an order count, not hours. A count in the header reads as the CUSTOMER's
 * count; for four readers in five it is only the reader's slice. Counts live in
 * the tiles and in the table's own header, where the coverage sentence sits
 * beside them.
 *
 * ORDER OF THE PAGE = ORDER OF THE QUESTIONS
 * ------------------------------------------
 * DOM order is the mobile order, so the sections are ordered by what an
 * operations colleague asks when they open a customer: who is this and how
 * complete is it (header, banner, hero) -> where do I drive and who do I call
 * (Standorte, Ansprechpartner) -> what are the orders (the ledger) -> who covers
 * it and where are the working links -> the canonical record. The last three are
 * wrapped in `MobileDisclosure` so the page stays inside the house four-screen
 * mobile ceiling; each states its count while shut, because a collapsed panel
 * with no count is indistinguishable from an empty one.
 */
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { ButtonLink } from "@/components/ui/Button";
import { IconArrowRight } from "@/components/nav-icons";
import PageTransition from "@/components/animations/PageTransition";
import { MobileDisclosure } from "@/components/MobileDisclosure";
import { createClient } from "@/utils/supabase/server";
import { enforceRoleRouteAccess, requireProfile } from "@/utils/supabase/require-profile";
import { formatDate, formatStamp } from "@/lib/date-display";
import { CUSTOMER_NUMBER_PATTERN, getCustomerProfile } from "@/lib/queries/customer-profile";
import { CustomerIdentityCard } from "@/components/customer/CustomerIdentityCard";
import { CustomerLocations } from "@/components/customer/CustomerLocations";
import { CustomerContacts } from "@/components/customer/CustomerContacts";
import { CustomerOrdersTable } from "@/components/customer/CustomerOrdersTable";
import { CustomerCare } from "@/components/customer/CustomerCare";
import { CustomerLinks } from "@/components/customer/CustomerLinks";
import { CustomerMasterRecord } from "@/components/customer/CustomerMasterRecord";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function CustomerProfilePage({
  params,
}: {
  params: Promise<{ number: string }>;
}) {
  const { number } = await params;

  /*
   * THE GUARD RUNS BEFORE ANY READ. `project_masterdata.customer_number` carries
   * `check (customer_number ~ '^[0-9]{5}$')`, so a segment that fails this
   * cannot name a row and there is nothing to ask the database. Anything that
   * passes goes to PostgREST as `customer_number=eq.<number>` — an exact match
   * on the key, never a name and never a LIKE.
   */
  if (!CUSTOMER_NUMBER_PATTERN.test(number)) notFound();

  const profile = await requireProfile(`/customers/${number}`);
  await enforceRoleRouteAccess("/customers");

  const supabase = await createClient();
  const t = await getTranslations("customer");
  const locale = await getLocale();
  const isExec = profile.roleKey === "exec";
  const data = await getCustomerProfile(supabase, number, { isExec });

  const title = data.displayName ?? t("header.fallbackTitle", { number });
  const header = (
    <PageHeader
      title={title}
      meta={isExec ? t("header.metaAll", { number }) : t("header.metaVisible", { number })}
    />
  );

  /*
   * A FAILED READ IS NOT AN EMPTY CUSTOMER, and it is not a missing one either.
   * Rendering an empty list here would tell a reader with nine orders that they
   * may see none of them — the same class of lie /my-work shipped once. Checked
   * FIRST so it can never be mistaken for one of the empty states below.
   */
  if (data.loadFailed) {
    return (
      <PageTransition>
        <div className="flex flex-col">
          {header}
          <div className="flex flex-col gap-4 page-shell">
            <EmptyState
              title={t("empty.failed.title")}
              description={t("empty.failed.description")}
              action={
                <ButtonLink href={`/customers/${number}`} variant="secondary" size="sm">
                  {t("empty.failed.action")}
                  <IconArrowRight className="h-3.5 w-3.5" />
                </ButtonLink>
              }
            />
          </div>
        </div>
      </PageTransition>
    );
  }

  if (data.orders.length === 0) {
    /*
     * FOUR DIFFERENT SENTENCES, AND ONLY AN EXEC MAY HEAR THREE OF THEM.
     *
     * A non-exec with no rows cannot be told whether the number exists: under
     * `can_view_project()` a customer they may not see and a customer that is
     * not there are the same absence. Saying "no such customer" would be a claim
     * the page cannot support, and saying nothing would let them infer it.
     *
     * An exec can read the evidence for the other three, and the third of them
     * is honest about what it could NOT read: with `crm` unreadable, "the number
     * is unknown" is not a conclusion available to anybody.
     */
    const empty = !isExec
      ? {
          title: t("empty.invisible.title"),
          description: t("empty.invisible.description"),
          actionLabel: t("empty.invisible.action"),
          href: "/my-work",
        }
      : data.masterState === "present"
        ? {
            title: t("empty.noOrders.title"),
            description: t("empty.noOrders.description"),
            actionLabel: t("empty.unknown.action"),
            href: "/customer-master/import-review",
          }
        : data.masterState === "unavailable"
          ? {
              title: t("empty.unchecked.title", { number }),
              description: t("empty.unchecked.description"),
              actionLabel: t("empty.unknown.action"),
              href: "/customer-master/import-review",
            }
          : {
              title: t("empty.unknown.title", { number }),
              description: t("empty.unknown.description"),
              actionLabel: t("empty.unknown.action"),
              href: "/customer-master/import-review",
            };

    return (
      <PageTransition>
        <div className="flex flex-col">
          {header}
          <div className="flex flex-col gap-4 page-shell">
            <EmptyState
              title={empty.title}
              description={empty.description}
              action={
                <ButtonLink href={empty.href} variant="secondary" size="sm">
                  {empty.actionLabel}
                  <IconArrowRight className="h-3.5 w-3.5" />
                </ButtonLink>
              }
            />
            {/* The master-record card still renders, with whichever of its four
                sentences holds. A withheld record must never be a blank space. */}
            <CustomerMasterRecord state={data.masterState} record={data.master} />
          </div>
        </div>
      </PageTransition>
    );
  }

  /*
   * TWO INDEPENDENT FACTS, EITHER OR BOTH. A customer whose contracts have all
   * ended must say so BEFORE the reader reads a live-looking table; a row the
   * sheet stopped carrying is a different fact and gets its own clause. A
   * customer with a mix (27 of 101) gets NO banner — the per-row STATUS badges
   * carry it, and a banner over a live contract would be false.
   *
   * Text, not colour: neither state is a risk, so no amber.
   */
  const allEnded = data.figures.endedContracts === data.figures.orders;
  const lastEnd = data.figures.lastContractEnd;
  const historical = data.figures.historicalOrders;
  const banner =
    allEnded && lastEnd !== null && historical > 0
      ? { label: t("banner.endedLabel"), text: t("banner.both", { date: formatDate(lastEnd, locale), count: historical }) }
      : allEnded && lastEnd !== null
        ? { label: t("banner.endedLabel"), text: t("banner.ended", { date: formatDate(lastEnd, locale) }) }
        : historical > 0
          ? { label: t("banner.historicalLabel"), text: t("banner.historical", { count: historical }) }
          : null;

  const asOf = data.figures.loggedHoursAsOf ? formatStamp(data.figures.loggedHoursAsOf, locale) : null;

  return (
    <PageTransition>
      <div className="flex flex-col">
        {header}

        <div className="flex flex-col gap-4 page-shell">
          {banner !== null ? (
            <p
              role="status"
              className="rounded-[var(--radius)] border border-[var(--border-strong)] px-3 py-2 t-callout text-[var(--text-secondary)]"
            >
              <span className="t-label text-[var(--text-faint)]">{banner.label}</span> {banner.text}
            </p>
          ) : null}

          <CustomerIdentityCard profile={data} />

          {/* "Where do I drive" and "who do I call" are questions two and three
              and must clear the fold on a phone, so they sit above the ledger. */}
          <div className="grid gap-4 lg:grid-cols-2">
            <CustomerLocations locations={data.locations} />
            <CustomerContacts contacts={data.contacts} unavailable={data.contactsUnavailable} />
          </div>

          {/* DataTable renders its own section shell, so it is a SIBLING of the
              cards, never a child of one: Card-in-Card is banned. */}
          <CustomerOrdersTable
            customerNumber={data.customerNumber}
            orders={data.orders}
            budgetsWithheld={data.budgetsWithheld}
            canOpenOrder={data.canOpenOrder}
            loggedHoursAsOf={asOf}
            footnotes={{
              isExec,
              budgetsWithheld: data.budgetsWithheld,
              measuredOrders: data.figures.loggedMeasuredOrders,
              totalOrders: data.figures.orders,
              siblingUnnumberedOrders: data.siblingUnnumberedOrders,
              siblingCustomerNumbers: data.siblingCustomerNumbers,
              truncated: data.truncated,
            }}
          />

          <div className="grid gap-4 lg:grid-cols-2">
            <MobileDisclosure title={t("care.title")} summary={t("care.summary", { count: data.care.length })}>
              <CustomerCare
                care={data.care}
                ordersWithoutResponsible={data.figures.ordersWithoutResponsible}
                totalOrders={data.figures.orders}
              />
            </MobileDisclosure>
            <MobileDisclosure
              title={t("links.title")}
              /* A collapsed panel is read INSTEAD of the card behind it, so a
                 count of the rows a failed read returned would be the same lie
                 one level up. "Nicht lesbar" is the crm card's own word for it. */
              summary={
                data.linksUnavailable
                  ? t("links.summaryUnavailable")
                  : t("links.summary", { count: data.links.length + data.fileStorages.length })
              }
            >
              <CustomerLinks
                links={data.links}
                fileStorages={data.fileStorages}
                totalOrders={data.figures.orders}
                unavailable={data.linksUnavailable}
              />
            </MobileDisclosure>
          </div>

          <MobileDisclosure title={t("crm.title")} summary={t(`crm.summary.${data.masterState}`)}>
            <CustomerMasterRecord state={data.masterState} record={data.master} />
          </MobileDisclosure>

          {/* Where these facts came from. The stamp is the sheet batch that last
              carried these rows, in Berlin, like every other stamp in the Hub. */}
          <p className="t-label text-[var(--text-muted)]">
            {data.lastSeenAt ? t("source", { when: formatStamp(data.lastSeenAt, locale) }) : t("sourceUndated")}
          </p>
        </div>
      </div>
    </PageTransition>
  );
}
