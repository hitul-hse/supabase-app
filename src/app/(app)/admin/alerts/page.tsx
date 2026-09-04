import { PageHeader } from "@/components/PageHeader";
import PageTransition from "@/components/animations/PageTransition";
import { createClient } from "@/utils/supabase/server";
import {
  enforceRoleRouteAccess,
  requireProfile,
  userHasPermission,
} from "@/utils/supabase/require-profile";
import { PERMISSIONS } from "@/lib/permissions";
import { getBudgetAlerts, permissionKeyExists } from "@/lib/queries/budget-alerts";
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
  // This page answers a refusal with a rendered "ACCESS RESTRICTED" panel rather
  // than a redirect, which is the right answer for a role that could plausibly
  // be granted projects:alerts:read and needs to know why it is not seeing the
  // list. A route-restricted role is not in that conversation.
  await enforceRoleRouteAccess("/admin/alerts");
  const params = await searchParams;

  // Open by default: the list is for acting on, and a log of everything ever
  // recorded is a different question (answered by ?show=all).
  const openOnly = params.show !== "all";

  const supabase = await createClient();

  if (!(await userHasPermission(PERMISSIONS.PROJECTS_ALERTS_READ))) {
    /*
     * Two very different reasons land here, and conflating them wasted a user's
     * time: an executive holding 32 permissions was told their ROLE was not
     * eligible, when in fact the capability did not exist in the database yet.
     * Ask which it is before explaining it.
     */
    const registered = await permissionKeyExists(supabase, PERMISSIONS.PROJECTS_ALERTS_READ);

    return (
      <PageTransition>
        <div className="flex flex-col">
          <PageHeader
            category="ADMIN / ALERTS"
            title="Budget alerts"
            meta={registered ? "ACCESS RESTRICTED" : "SETUP INCOMPLETE"}
          />
          <div className="page-shell">
            {registered ? (
              <p className="border border-[var(--border-strong)] px-4 py-3 text-[12px] leading-relaxed text-[var(--text-muted)]">
                Your role does not include reading budget alerts. They expose commercial
                pressure across the portfolio, so they are limited to executives,
                department heads, project managers and HR.
              </p>
            ) : (
              <div className="flex flex-col gap-2 border border-[var(--border-strong)] px-4 py-3">
                <p className="text-[12px] leading-relaxed text-[var(--text-primary)]">
                  This feature is not switched on in the database yet, so nobody can
                  reach it -- including executives. It is not a problem with your role.
                </p>
                <p className="text-[11.5px] leading-relaxed text-[var(--text-secondary)]">
                  The permission{" "}
                  <code className="font-mono text-[11px] text-[var(--accent)]">
                    {PERMISSIONS.PROJECTS_ALERTS_READ}
                  </code>{" "}
                  does not exist. Apply{" "}
                  <code className="font-mono text-[11px] text-[var(--text-primary)]">
                    supabase/migrations/add_contract_periods.sql
                  </code>{" "}
                  and{" "}
                  <code className="font-mono text-[11px] text-[var(--text-primary)]">
                    supabase/migrations/add_budget_alert_visibility.sql
                  </code>
                  , in that order, then reload this page.
                </p>
                <p className="text-[11px] leading-relaxed text-[var(--text-faint)]">
                  Until then the budget guard still works and still records alerts --
                  they simply have nowhere to be displayed.
                </p>
              </div>
            )}
          </div>
        </div>
      </PageTransition>
    );
  }
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

        <div className="flex flex-col gap-5 page-shell">
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
