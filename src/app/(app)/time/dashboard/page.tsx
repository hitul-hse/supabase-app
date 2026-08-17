import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import PageTransition from "@/components/animations/PageTransition";
import { createClient } from "@/utils/supabase/server";
import { requirePermission } from "@/utils/supabase/require-profile";
import { PERMISSIONS } from "@/lib/permissions";
import {
  budgets,
  fetchAllEntries,
  getFilterOptions,
  groupBy as groupEntries,
  parseFilters,
  summarise,
  trend,
  type GroupBy,
  type TrendBucket,
} from "@/lib/queries/trackingtime-report";
import { getProjectEconomics } from "@/lib/queries/time-dashboard";
import { EconomicsTable } from "./DashboardPanels";
import { ReportFilters } from "./ReportFilters";
import {
  BreakdownTable,
  BudgetTable,
  RecentEntries,
  TotalsStrip,
  TrendChart,
} from "./ReportPanels";

/**
 * TrackingTime Dashboard — filtered reporting over imported TrackingTime data.
 *
 * Mirrors what TrackingTime's own Timesheets/Project/User reports offer (date
 * presets, multi-select dimensions, group-by, budget burn) over our `time`
 * schema, so the whole organisation's hours are answerable inside the Hub
 * without a second login.
 *
 * THREE ACCESS DECISIONS, stated plainly:
 *
 * 1. Entry needs `timesheets:read_all`, not `read_own`. Someone who may see
 *    only their own hours has no business on an organisation rollup, and
 *    gating on `read_own` would admit them to a page whose every panel is then
 *    silently empty — which reads as "the company logged nothing" rather than
 *    "you may not see this".
 *
 * 2. Money is a SEPARATE permission (`overview:export`), checked here and again
 *    inside `time.project_economics()`. Without it the economics panel is
 *    absent entirely rather than zeroed, because a €0 card is a claim about the
 *    business, not about permissions.
 *
 * 3. Gated in the page, not only in middleware. Per CVE-2025-29927, middleware
 *    is defence in depth and never the auth boundary.
 *
 * Rendering is dynamic: every panel depends on searchParams and on the caller's
 * RLS scope, so a cached copy would be both stale and cross-tenant wrong.
 */

const GROUPS: GroupBy[] = ["member", "project", "customer", "service", "task"];
const BUCKETS: TrendBucket[] = ["day", "week", "month"];

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function TrackingTimeDashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePermission("/time/dashboard", PERMISSIONS.TIMESHEETS_READ_ALL);

  const supabase = await createClient();
  const params = await searchParams;

  const filters = parseFilters(params);

  // Both come from the URL, so both are validated against a fixed list rather
  // than cast. An unrecognised value falls back instead of reaching a switch
  // that has no branch for it.
  const rawGroup = one(params.group);
  const group: GroupBy = GROUPS.includes(rawGroup as GroupBy) ? (rawGroup as GroupBy) : "member";

  const rawBucket = one(params.bucket);
  const bucket: TrendBucket = BUCKETS.includes(rawBucket as TrendBucket)
    ? (rawBucket as TrendBucket)
    : "week";

  const { data: canSeeMoney } = await supabase.rpc("app_user_has_permission", {
    p_key: PERMISSIONS.OVERVIEW_EXPORT,
  });

  const [{ entries, truncated }, options, economics] = await Promise.all([
    fetchAllEntries(supabase, filters),
    getFilterOptions(supabase),
    getProjectEconomics(supabase, { canSeeMoney: canSeeMoney === true, limit: 15 }),
  ]);

  const totals = summarise(entries);
  const breakdown = groupEntries(entries, group);
  const points = trend(entries, bucket);

  // Budget burn is scoped to the projects actually present in this selection.
  // Listing all 251 estimated projects while the filter shows one week would
  // put a wall of 0%-burn rows under a filtered report and imply they were
  // idle, when they are simply out of range.
  const selectedProjectIds = new Set(
    entries.map((e) => e.projectId).filter((id): id is number => id !== null),
  );
  const budgetRows = budgets(
    entries,
    options.projects.filter((p) => selectedProjectIds.has(p.id)),
  );

  const period = `${filters.from} → ${filters.to}`;

  return (
    <PageTransition>
      <div className="flex flex-col">
        <PageHeader
          category="TRACKINGTIME / DASHBOARD"
          title="TrackingTime Dashboard"
          meta={`${period} · ${totals.entryCount.toLocaleString("en-GB")} ENTRIES · ${totals.totalHours.toLocaleString("en-GB", { maximumFractionDigits: 1 })}H`}
        />

        <div className="flex flex-col gap-5 p-4 sm:p-6">
          <ReportFilters
            members={options.members.map((m) => ({ id: m.id, name: m.name }))}
            projects={options.projects.map((p) => ({
              id: p.id,
              name: p.name,
              hint: p.customerName,
            }))}
            customers={options.customers}
            services={options.services}
            preset={filters.preset}
            from={filters.from}
            to={filters.to}
            memberIds={filters.memberIds}
            projectIds={filters.projectIds}
            customerIds={filters.customerIds}
            serviceIds={filters.serviceIds}
            billable={filters.billable}
            includeCalendar={filters.includeCalendar}
            groupBy={group}
            bucket={bucket}
          />

          {truncated && (
            <p className="border border-[var(--critical)] bg-[var(--surface)] px-4 py-2.5 text-[12px] text-[var(--critical)]">
              This selection exceeds the reporting ceiling, so the figures below cover only the
              most recent entries in range. Narrow the period or add a filter for an exact total.
            </p>
          )}

          {entries.length === 0 ? (
            <EmptyState
              title="No time logged in this selection"
              description="No entries match the current filters. Widen the date range or clear a filter. An empty result can also mean your role isn't permitted to see other people's time, which is the access model working rather than a fault — and note that calendar placeholders are excluded unless you switch them on."
            />
          ) : (
            <>
              <TotalsStrip totals={totals} />

              <TrendChart points={points} bucket={bucket} />

              {/* Economics sits high when present: for the audience allowed to
                  see it, margin is the first question rather than the last.
                  It reads all-time project totals from the security-definer
                  RPC and is deliberately NOT filtered — see the hint below. */}
              {economics !== null && economics.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <EconomicsTable rows={economics} />
                  <p className="text-[10.5px] text-[var(--text-faint)]">
                    Economics covers all time on each project, not the filtered period. Rates are
                    resolved inside a security-definer function so the total is never partial.
                  </p>
                </div>
              )}

              <BudgetTable rows={budgetRows} />

              <BreakdownTable rows={breakdown} dimension={group} />

              <RecentEntries rows={entries.slice(0, 25)} />
            </>
          )}
        </div>
      </div>
    </PageTransition>
  );
}
