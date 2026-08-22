import { PageHeader } from "@/components/PageHeader";
import PageTransition from "@/components/animations/PageTransition";
import { createClient } from "@/utils/supabase/server";
import { requireProfile, userHasPermission } from "@/utils/supabase/require-profile";
import { PERMISSIONS } from "@/lib/permissions";
import { getBudgetAlerts } from "@/lib/queries/budget-alerts";
import { getContractsNeedingAttention } from "@/lib/queries/contract-periods";
import { AlertList } from "./AlertList";
import { ContractWatchlist } from "./ContractWatchlist";

/**
 * Budget and contract alerts.
 *
 * WHY THIS PAGE EXISTS. The overbooking guard recorded a refusal correctly and
 * the user still heard nothing, because the alert's only output was email and
 * RESEND_API_KEY is unset. A feature whose entire signal depends on an optional
 * environment variable has no signal. This is that signal, in the app.
 *
 * TWO LISTS, DELIBERATELY. Alerts are things that already HAPPENED (a booking
 * was refused, a threshold was crossed). The watchlist is things that are ABOUT
 * to happen (a contract expiring, one already lapsed). Merging them would mean
 * either events without deadlines or deadlines without events; keeping them
 * apart lets each be read for what it is.
 */
export default async function AlertsPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string }>;
}) {
  // The path is what an unauthenticated visitor is redirected back to after
  // signing in, so it has to be this page rather than a default.
  await requireProfile("/admin/alerts");
  const params = await searchParams;

  // Open by default: the list is for acting on, and a log of everything ever
  // recorded is a different question (answered by ?show=all).
  const openOnly = params.show !== "all";

  if (!(await userHasPermission(PERMISSIONS.PROJECTS_ALERTS_READ))) {
    return (
      <PageTransition>
        <div className="flex flex-col">
          <PageHeader category="ADMIN / ALERTS" title="Budget alerts" />
          <div className="p-4 sm:p-6">
            <p className="border border-[var(--border-strong)] px-4 py-3 text-[12px] leading-relaxed text-[var(--text-muted)]">
              Your role does not include reading budget alerts. They expose commercial
              pressure across the portfolio, so they are limited to executives,
              department heads, project managers and HR.
            </p>
          </div>
        </div>
      </PageTransition>
    );
  }

  const supabase = await createClient();
  const [alerts, watchlist, canAck] = await Promise.all([
    getBudgetAlerts(supabase, { openOnly }),
    getContractsNeedingAttention(supabase),
    userHasPermission(PERMISSIONS.PROJECTS_ALERTS_ACKNOWLEDGE),
  ]);

  const blocking = alerts.filter((a) => a.blockedTheBooking).length;

  return (
    <PageTransition>
      <div className="flex flex-col">
        <PageHeader
          category="ADMIN / ALERTS"
          title="Budget alerts"
          meta={`${alerts.length} ${openOnly ? "OPEN" : "TOTAL"}${blocking ? ` · ${blocking} BLOCKED A BOOKING` : ""}${watchlist.length ? ` · ${watchlist.length} CONTRACTS NEED ATTENTION` : ""}`}
        />

        <div className="flex flex-col gap-5 p-4 sm:p-6">
          <p className="text-[12px] leading-relaxed text-[var(--text-secondary)]">
            Every budget event is recorded here whether or not an email goes out. Each
            row states its own delivery state, so a missing mail transport can never
            make an alert disappear silently.
          </p>

          <ContractWatchlist rows={watchlist} />

          <AlertList alerts={alerts} canAck={canAck} showingOpenOnly={openOnly} />

          <p className="text-[11px] text-[var(--text-faint)]">
            {openOnly ? (
              <>
                Showing open alerts.{" "}
                <a
                  href="/admin/alerts?show=all"
                  className="text-[var(--accent)] underline-offset-2 hover:underline"
                >
                  Show every alert ever recorded
                </a>
                , including acknowledged ones.
              </>
            ) : (
              <>
                Showing every recorded alert.{" "}
                <a
                  href="/admin/alerts"
                  className="text-[var(--accent)] underline-offset-2 hover:underline"
                >
                  Show only open ones
                </a>
                .
              </>
            )}
          </p>
        </div>
      </div>
    </PageTransition>
  );
}
