import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import PageTransition from "@/components/animations/PageTransition";
import { createClient } from "@/utils/supabase/server";
import { requireProfile, userHasPermission } from "@/utils/supabase/require-profile";
import { PERMISSIONS } from "@/lib/permissions";
import {
  budgets,
  buildQuery,
  fetchAllEntries,
  getFilterOptions,
  groupBy as groupEntries,
  parseFilters,
  summarise,
  trend,
  type GroupBy,
  type GroupRow,
  type TrendBucket,
} from "@/lib/queries/trackingtime-report";
import { getProjectEconomics, getSyncFreshness } from "@/lib/queries/time-dashboard";
import { EconomicsTable } from "./DashboardPanels";
import { ReportFilters } from "./ReportFilters";
import {
  BreakdownTable,
  BudgetTable,
  FreshnessBanner,
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
 *
 * WHY THE GATE IS HAND-ROLLED RATHER THAN requirePermission(): this route is now
 * the portal tile's destination, and the tile is shown to anyone holding ANY
 * `time` permission -- which is every role, since all four hold
 * `timesheets:read_own`. Only `exec` holds `read_all`. requirePermission()
 * redirects a failure to "/", so the other three roles would have clicked their
 * own module's tile and been thrown out to the Hub with no explanation. They are
 * sent to /time instead: the page they actually have the rights to read.
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
  await requireProfile("/time/dashboard");

  if (!(await userHasPermission(PERMISSIONS.TIMESHEETS_READ_ALL))) {
    redirect("/time");
  }

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

  const [{ entries, truncated }, options, economics, freshness] = await Promise.all([
    fetchAllEntries(supabase, filters),
    getFilterOptions(supabase),
    getProjectEconomics(supabase, { canSeeMoney: canSeeMoney === true, limit: 15 }),
    getSyncFreshness(supabase),
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

  /**
   * Drill-down target for a breakdown row: the same report, narrowed to that
   * entity, and re-grouped by the dimension you would naturally want next
   * (customer → its projects, project → who worked on it, member → what they
   * worked on).
   *
   * ADDITIVE, not replacing: an existing customer filter survives clicking into
   * a project, so customer → project → member composes into a genuine path
   * rather than resetting each time. The date range and every other filter are
   * carried through by buildQuery.
   */
  const DRILL: Partial<Record<GroupBy, { param: string; next: GroupBy }>> = {
    customer: { param: "customers", next: "project" },
    project: { param: "projects", next: "member" },
    member: { param: "members", next: "project" },
    service: { param: "services", next: "project" },
    // `task` is absent deliberately: groupBy() keys task rows by NAME, not id
    // (e.id is null for every one), so there is nothing to filter on.
  };

  function drillHref(row: GroupRow): string | null {
    const rule = DRILL[group];
    if (!rule || row.id === null) return null;

    // Already the only selection on this dimension — the link would be a no-op
    // that appears to do something. Render it as plain text instead.
    const current = filters[
      rule.param === "customers"
        ? "customerIds"
        : rule.param === "projects"
          ? "projectIds"
          : rule.param === "members"
            ? "memberIds"
            : "serviceIds"
    ];
    if (current.length === 1 && current[0] === row.id) return null;

    const merged = current.includes(row.id) ? current : [...current, row.id];
    const qs = buildQuery(filters, {
      [rule.param]: merged.join(","),
      group: rule.next,
      bucket,
    });
    return `/time/dashboard?${qs}`;
  }

  // Which filters are actually narrowing the view, so they can be shown as
  // removable chips. Without this, a drill-down is a one-way door: the numbers
  // change, nothing says why, and the only way back is the browser button.
  const activeDrills = [
    { label: "Member", ids: filters.memberIds, param: "members", options: options.members },
    { label: "Project", ids: filters.projectIds, param: "projects", options: options.projects },
    { label: "Customer", ids: filters.customerIds, param: "customers", options: options.customers },
    { label: "Service", ids: filters.serviceIds, param: "services", options: options.services },
  ].flatMap(({ label, ids, param, options: opts }) =>
    ids.map((id) => ({
      key: `${param}:${id}`,
      label,
      // Fall back to the id when the entity is outside the current option set,
      // so a chip is never a blank rectangle.
      name: opts.find((o) => o.id === id)?.name ?? `#${id}`,
      href: `/time/dashboard?${buildQuery(filters, {
        [param]: ids.filter((x) => x !== id).join(",") || null,
        group,
        bucket,
      })}`,
    })),
  );

  return (
    <PageTransition>
      <div className="flex flex-col">
        <PageHeader
          category="TRACKINGTIME / DASHBOARD"
          title="TrackingTime API Dashboard"
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

          {/* Above the empty-state branch on purpose. "No entries match" and
              "the import stopped running three weeks ago" look identical to a
              reader, and the second explains the first. */}
          <FreshnessBanner freshness={freshness} />

          {/* The way back out of a drill-down. Rendered above the panels rather
              than inside the filter form because it must be visible without
              expanding anything: after two clicks the totals can be a small
              fraction of the company's hours, and nothing else on screen says
              so. Each chip removes exactly its own filter. */}
          {activeDrills.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--text-faint)]">
                Filtered to
              </span>
              {activeDrills.map((chip) => (
                <Link
                  key={chip.key}
                  href={chip.href}
                  className="group inline-flex items-center gap-1.5 border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1 text-[11px] text-[var(--text-primary)] transition-colors hover:border-[var(--text-secondary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
                >
                  <span className="text-[var(--text-faint)]">{chip.label}</span>
                  <span className="max-w-[16rem] truncate">{chip.name}</span>
                  <span aria-hidden className="text-[var(--text-faint)] group-hover:text-[var(--critical)]">
                    ×
                  </span>
                  <span className="sr-only">Remove this filter</span>
                </Link>
              ))}
              <Link
                href={`/time/dashboard?${buildQuery(filters, {
                  members: null,
                  projects: null,
                  customers: null,
                  services: null,
                  group,
                  bucket,
                })}`}
                className="text-[11px] text-[var(--text-secondary)] underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
              >
                Clear all
              </Link>
            </div>
          )}

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

              <BreakdownTable rows={breakdown} dimension={group} hrefFor={drillHref} />

              <RecentEntries rows={entries.slice(0, 25)} />
            </>
          )}
        </div>
      </div>
    </PageTransition>
  );
}
