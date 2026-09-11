/**
 * /customers — which customers are there, for the person asking.
 *
 * WHY (2026-09-11). `/customers/[number]` shipped the day before and was
 * reachable only by clicking a name on /my-work or the management portfolio.
 * There was no index, so there was nothing for a navigation entry to point at,
 * and a consultant who wanted to look a customer up had nowhere to start. hitul
 * asked for a Customers tab under Projects; this is the page behind it.
 *
 * A SERVER COMPONENT WITH THE PAGE NUMBER IN THE URL. docs/UI-CONVENTIONS.md
 * asks for pagination in the URL and ten rows to a worked queue, and names the
 * import-review Pager as the reference. That is what this uses, rather than the
 * client-side `DataTable`, for two reasons: a page number in the URL survives a
 * reload and can be sent to a colleague, and nothing here needs state, so the
 * whole page stays off the client bundle.
 *
 * THE LIST IS PER-READER AND SAYS SO. `getCustomersIndex` reads
 * `project_masterdata` on the reader's own session, under `can_view_project()`.
 * An exec sees every customer; a department head sees their department's; a
 * consultant sees the customers they work for. The header says which of those
 * it is rather than presenting a partial list as the whole one.
 */
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { NumberedPager } from "@/components/NumberedPager";
import PageTransition from "@/components/animations/PageTransition";
import { Card, CardDivider, CardHeader } from "@/components/ui/Card";
import { createClient } from "@/utils/supabase/server";
import { enforceRoleRouteAccess, requireProfile } from "@/utils/supabase/require-profile";
import { getCustomersIndex } from "@/lib/queries/customers-index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SearchParams = Promise<{ page?: string | string[] }>;

/** A page number that is not a positive integer is page 1, never an error. */
function pageFrom(raw: string | string[] | undefined): number {
  const first = Array.isArray(raw) ? raw[0] : raw;
  const n = Number(first);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

export default async function CustomersIndexPage({ searchParams }: { searchParams: SearchParams }) {
  /*
   * Both guards run before any read, and the page calls them itself rather than
   * trusting the middleware: CVE-2025-29927 was a middleware auth bypass, and
   * every protected page in this app gates itself for that reason.
   */
  const profile = await requireProfile("/customers");
  await enforceRoleRouteAccess("/customers");

  const params = await searchParams;
  const requestedPage = pageFrom(params.page);

  const supabase = await createClient();
  const t = await getTranslations("customers");
  const isExec = profile.roleKey === "exec";

  const data = await getCustomersIndex(supabase, { page: requestedPage });

  const header = (
    <PageHeader
      title={t("title")}
      meta={
        isExec
          ? t("metaAll", { total: data.total, orders: data.visibleOrders })
          : t("metaVisible", { total: data.total, orders: data.visibleOrders })
      }
    />
  );

  if (data.total === 0) {
    return (
      <PageTransition>
        <div className="flex flex-col">
          {header}
          <div className="flex flex-col gap-4 page-shell">
            <EmptyState title={t("emptyTitle")} description={t("emptyDescription")} />
          </div>
        </div>
      </PageTransition>
    );
  }

  const from = (data.page - 1) * data.perPage + 1;
  const to = from + data.rows.length - 1;

  return (
    <PageTransition>
      <div className="flex flex-col">
        {header}
        <div className="flex flex-col gap-4 page-shell">
          <Card>
            <CardHeader
              title={t("title")}
              qualifier={
                isExec
                  ? t("metaAll", { total: data.total, orders: data.visibleOrders })
                  : t("metaVisible", { total: data.total, orders: data.visibleOrders })
              }
            />
            <CardDivider />

            {/*
              The ceiling was reached, so every count below is a floor. Said
              before the numbers rather than under them: a reader who has
              already read the table has already believed it.
            */}
            {data.truncated && (
              <p className="border-b border-[var(--divider)] px-4 py-2 font-mono text-[10px] text-[var(--text-muted)]">
                {t("truncated")}
              </p>
            )}

            <div className="overflow-x-auto">
              <table className="w-full min-w-[34rem] border-collapse text-sm">
                <thead>
                  <tr className="bg-[var(--surface-2)] font-mono text-[9px] tracking-[0.08em] text-[var(--text-faint)]">
                    <th scope="col" className="px-4 py-2 text-left font-normal">{t("colNumber")}</th>
                    <th scope="col" className="px-4 py-2 text-left font-normal">{t("colName")}</th>
                    <th scope="col" className="px-4 py-2 text-left font-normal">{t("colCity")}</th>
                    <th scope="col" className="px-2 py-2 text-right font-normal">{t("colLive")}</th>
                    <th scope="col" className="px-2 py-2 text-right font-normal">{t("colOrders")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--divider)]">
                  {data.rows.map((row) => (
                    <tr key={row.customerNumber} className="hover:bg-[var(--surface-hover)]">
                      <td className="px-4 py-2.5 font-mono text-xs text-[var(--text-secondary)]">
                        {/*
                          The whole row is a link target in effect, but only the
                          number and the name carry the anchor: a link wrapping a
                          table row is not valid HTML, and two anchors per row is
                          two tab stops, so the name is the one that gets it and
                          the number stays selectable text people paste into
                          Lexware.
                        */}
                        {row.customerNumber}
                      </td>
                      <td className="px-4 py-2.5">
                        <Link
                          href={`/customers/${row.customerNumber}`}
                          className="text-[var(--text-primary)] underline-offset-2 hover:underline"
                        >
                          {/* A blank name is said, never invented from the number. */}
                          {row.name ?? (
                            <span className="text-[var(--text-muted)]">{t("noName")}</span>
                          )}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">
                        {/* Two sites is not a place, so the query gives null and this says n/a. */}
                        {row.city ?? <span className="text-[var(--text-faint)]">n/a</span>}
                      </td>
                      <td className="px-2 py-2.5 text-right font-mono text-xs">
                        {/*
                          0 here is a measured zero, not a missing one: the rows
                          are in hand and none of them is running. It is dimmed
                          and titled rather than blanked, because a dormant
                          customer is a real answer.
                        */}
                        {row.liveOrders === 0 ? (
                          <span className="text-[var(--text-faint)]" title={t("dormant")}>0</span>
                        ) : (
                          <span className="text-[var(--text-primary)]">{row.liveOrders}</span>
                        )}
                      </td>
                      <td className="px-2 py-2.5 text-right font-mono text-xs text-[var(--text-secondary)]">
                        {row.visibleOrders}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {data.pageCount > 1 && (
              <NumberedPager
                page={data.page}
                pageCount={data.pageCount}
                countLine={t("pagerCount", {
                  page: data.page,
                  pageCount: data.pageCount,
                  total: data.total,
                })}
                navLabel={t("pagerNav")}
                labels={{
                  prev: t("pagerPrev"),
                  next: t("pagerNext"),
                  pageLabel: (n) => t("pagerPage", { n }),
                }}
                hrefFor={(n) => (n === 1 ? "/customers" : `/customers?page=${n}`)}
              />
            )}
          </Card>

          {/*
            The honest count, spelled out. `from`/`to` describe THIS page; the
            total describes what this reader can see, which is not the company
            total unless they are an exec. Both are stated so neither can be
            mistaken for the other.
          */}
          <p className="px-1 font-mono text-[10px] tracking-[0.08em] text-[var(--text-faint)]">
            {from}–{to} / {data.total}
          </p>
        </div>
      </div>
    </PageTransition>
  );
}
