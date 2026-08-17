import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import PageTransition from "@/components/animations/PageTransition";
import { createClient } from "@/utils/supabase/server";
import { requirePermission } from "@/utils/supabase/require-profile";
import { PERMISSIONS } from "@/lib/permissions";
import {
  getCustomerSummary,
  getMemberUtilisation,
  getOrgWeeks,
  getProjectEconomics,
  getProjectSummary,
  getServiceSummary,
  summariseOrgWeeks,
} from "@/lib/queries/time-dashboard";
import {
  CustomerTable,
  EconomicsTable,
  MemberTable,
  OrgTotalsStrip,
  ProjectTable,
  ServiceBreakdown,
  WeeklyTrend,
} from "./DashboardPanels";
import { WindowTabs } from "./WindowTabs";

/**
 * Organisation-wide Time Tracking dashboard.
 *
 * The read equivalent of everything TrackingTime's reporting offers, over our
 * own `time` schema: where the hours went, which projects are burning budget,
 * which customers and services consume the week, and how utilised people are.
 *
 * Two access decisions worth stating plainly:
 *
 * 1. Entry to the page needs `timesheets:read_all`, not `read_own`. Somebody
 *    who may only see their own hours has no business on an organisation
 *    rollup, and gating on `read_own` would let them in to a page whose every
 *    panel would then be silently empty — which reads as "the company logged
 *    nothing" rather than "you may not see this".
 *
 * 2. Money is a *separate* permission (`overview:export`), checked here and
 *    again inside `time.project_economics()`. When the caller lacks it the
 *    economics section is absent entirely rather than zeroed, because a €0
 *    card is a claim about the business, not about permissions.
 *
 * Gated in the page rather than only in the proxy: per CVE-2025-29927,
 * middleware is defence in depth and never the auth boundary.
 */

/** How far back to look. Small, fixed set — never a raw number from the URL. */
const WINDOWS = { "4": 4, "12": 12, "26": 26, "52": 52 } as const;
type WindowKey = keyof typeof WINDOWS;

function parseWindow(raw: string | undefined): WindowKey {
  return raw && raw in WINDOWS ? (raw as WindowKey) : "12";
}

export default async function TimeDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string }>;
}) {
  // Throws a redirect for anyone without organisation-wide read.
  await requirePermission("/time/dashboard", PERMISSIONS.TIMESHEETS_READ_ALL);

  const supabase = await createClient();
  const params = await searchParams;
  const windowKey = parseWindow(params.window);
  const weeks = WINDOWS[windowKey];

  // Whether this caller may see rates at all. Checked before the RPC so the
  // page can distinguish "not permitted" (hide the section) from "permitted but
  // nothing to show" (render an empty panel).
  const { data: canSeeMoney } = await supabase.rpc("app_user_has_permission", {
    p_key: PERMISSIONS.OVERVIEW_EXPORT,
  });

  const [orgWeeks, projects, customers, services, members, economics] = await Promise.all([
    getOrgWeeks(supabase, weeks),
    getProjectSummary(supabase, { limit: 20 }),
    getCustomerSummary(supabase, 12),
    getServiceSummary(supabase),
    getMemberUtilisation(supabase),
    getProjectEconomics(supabase, { canSeeMoney: canSeeMoney === true, limit: 15 }),
  ]);

  const totals = summariseOrgWeeks(orgWeeks);

  // Nothing anywhere means the import has not run (or RLS permits nothing).
  // Either way it is an empty state, not an error.
  const hasAnything =
    orgWeeks.length > 0 || projects.length > 0 || customers.length > 0 || members.length > 0;

  return (
    <PageTransition>
      <div className="flex flex-col">
        <PageHeader
          category="TIME TRACKING / ANALYTICS"
          title="Organisation dashboard"
          meta={`LAST ${weeks} WEEKS · ${totals.entryCount.toLocaleString("en-GB")} ENTRIES · SECONDS`}
        />

        <div className="flex flex-col gap-5 p-4 sm:p-6">
          <WindowTabs current={windowKey} />

          {!hasAnything ? (
            <EmptyState
              title="No time data yet"
              description="This dashboard reads the time module's analytics views. It fills in once the TrackingTime import has run against this environment. An empty dashboard can also mean your role isn't permitted to see organisation-wide time, which is the access model working rather than a fault."
            />
          ) : (
            <>
              <OrgTotalsStrip totals={totals} />

              <WeeklyTrend weeks={orgWeeks} />

              {/* Economics sits high when present: for the audience who can see
                  it, margin is the first question, not the last. */}
              {economics !== null && economics.length > 0 && (
                <EconomicsTable rows={economics} />
              )}

              <ProjectTable rows={projects} />

              <div className="grid gap-5 lg:grid-cols-2">
                <CustomerTable rows={customers} />
                <ServiceBreakdown rows={services} />
              </div>

              <MemberTable rows={members} />
            </>
          )}
        </div>
      </div>
    </PageTransition>
  );
}
