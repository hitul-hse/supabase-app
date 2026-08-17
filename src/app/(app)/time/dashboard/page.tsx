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
  type TrendBucket,
} from "@/lib/queries/trackingtime-report";
import { getProjectEconomics, getSyncFreshness } from "@/lib/queries/time-dashboard";
import { ReportFilters } from "./ReportFilters";
import { FreshnessBanner, TotalsStrip } from "./ReportPanels";
import { TrendChart } from "./TrendChart";
import {
  BreakdownTable,
  BudgetTable,
  EconomicsTable,
  EntriesTable,
} from "./ReportTables";

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
 *
 * WHY THE TABLES GET EVERY ROW
 * ----------------------------
 * Each table used to receive `rows.slice(0, 40)`. With 334 live projects that
 * meant 294 of them could not be reached from anywhere on the page — the hint
 * said "top 40 of 334", which was honest and useless. The rows handed down are
 * AGGREGATES (one per project/person/customer, not one per entry), so the full
 * set is small, and the client tables can then sort, search and page it without
 * a round trip. The raw entry list is the one genuinely large payload and is
 * bounded below.
 */

const GROUPS: GroupBy[] = ["member", "project", "customer", "service", "task"];
const BUCKETS: TrendBucket[] = ["day", "week", "month"];

/**
 * Entry rows shipped to the browser for the entry-level table.
 *
 * The aggregates above are naturally small; the raw entries are not — an
 * all-time selection is 4,000+ rows today and grows with every sync. Rendering
 * all of them would put megabytes into the HTML payload for a table nobody
 * scrolls past the first page of, so this is capped and the table says so. The
 * cap is generous enough that any single week or month is complete, which is
 * what the filters are for.
 */
const ENTRY_ROW_LIMIT = 2000;

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** The bucket a trend bar covers, as an inclusive date range. */
function bucketRange(bucketStart: string, bucket: TrendBucket): { from: string; to: string } {
  const start = new Date(`${bucketStart}T00:00:00.000Z`);
  const end = new Date(start);
  if (bucket === "day") {
    // Same day, inclusive on both ends.
  } else if (bucket === "week") {
    end.setUTCDate(end.getUTCDate() + 6);
  } else {
    // Day 0 of the next month is the last day of this one — no 28/30/31 table
    // and February in a leap year comes out right for free.
    end.setUTCMonth(end.getUTCMonth() + 1);
    end.setUTCDate(0);
  }
  return { from: bucketStart, to: end.toISOString().slice(0, 10) };
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
    // Scoped to the SELECTED PERIOD. It previously ran unbounded and the panel
    // carried a caveat saying so — which made it the one panel on the page that
    // silently ignored the filter bar, so a June report showed June's hours
    // beside all-time revenue and the margin belonged to neither. The RPC has
    // taken p_from/p_to all along; the page simply never passed them.
    getProjectEconomics(supabase, {
      canSeeMoney: canSeeMoney === true,
      from: filters.from,
      to: filters.to,
    }),
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
  // Used in export filenames, so it must be filesystem-safe.
  const periodSlug = `${filters.from}_${filters.to}`;

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
   *
   * Precomputed into a plain object rather than passed as a function, because
   * the table is now a Client Component and a closure cannot cross that
   * boundary. Keyed by GroupRow.key, which is already unique per row.
   */
  const DRILL: Partial<Record<GroupBy, { param: string; next: GroupBy }>> = {
    customer: { param: "customers", next: "project" },
    project: { param: "projects", next: "member" },
    member: { param: "members", next: "project" },
    service: { param: "services", next: "project" },
    // `task` is absent deliberately: groupBy() keys task rows by NAME, not id
    // (e.id is null for every one), so there is nothing to filter on.
  };

  const drillHrefs: Record<string, string> = {};
  {
    const rule = DRILL[group];
    if (rule) {
      const current =
        filters[
          rule.param === "customers"
            ? "customerIds"
            : rule.param === "projects"
              ? "projectIds"
              : rule.param === "members"
                ? "memberIds"
                : "serviceIds"
        ];
      for (const row of breakdown) {
        if (row.id === null) continue;
        // Already the only selection on this dimension — the link would be a
        // no-op that appears to do something. Left out, so the cell renders as
        // plain text.
        if (current.length === 1 && current[0] === row.id) continue;
        const merged = current.includes(row.id) ? current : [...current, row.id];
        drillHrefs[row.key] = `/time/dashboard?${buildQuery(filters, {
          [rule.param]: merged.join(","),
          group: rule.next,
          bucket,
        })}`;
      }
    }
  }

  /** Clicking a trend bar narrows the period to that bucket. */
  const trendHrefs: Record<string, string> = {};
  for (const p of points) {
    const { from, to } = bucketRange(p.bucket, bucket);
    // Only if it would actually change the range; a single-day report whose one
    // bar spans the whole selection should not offer a link that does nothing.
    if (from === filters.from && to === filters.to) continue;
    trendHrefs[p.bucket] = `/time/dashboard?${buildQuery(filters, {
      preset: "custom",
      from,
      to,
      group,
      bucket,
    })}`;
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

  const entryRows = entries.slice(0, ENTRY_ROW_LIMIT).map((e) => ({
    id: e.id,
    startedAt: e.startedAt,
    memberName: e.memberName,
    projectName: e.projectName,
    customerName: e.customerName,
    taskName: e.taskName,
    serviceName: e.serviceName,
    durationSeconds: e.durationSeconds,
    isBillable: e.isBillable,
    isCalendar: e.isCalendar,
    notes: e.notes,
  }));

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
                  scroll={false}
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
                scroll={false}
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
              <TotalsStrip
                totals={totals}
                billableHref={`/time/dashboard?${buildQuery(filters, { billable: "yes", group, bucket })}`}
                nonBillableHref={`/time/dashboard?${buildQuery(filters, { billable: "no", group, bucket })}`}
                groupLabel={`Every figure covers ${period}`}
              />

              <TrendChart points={points} bucket={bucket} hrefFor={trendHrefs} />

              {/* Economics sits high when present: for the audience allowed to
                  see it, margin is the first question rather than the last. */}
              {economics !== null && economics.length > 0 && (
                <EconomicsTable rows={economics} period={periodSlug} />
              )}

              <BreakdownTable
                rows={breakdown}
                dimension={group}
                hrefFor={drillHrefs}
                period={periodSlug}
              />

              <BudgetTable rows={budgetRows} period={periodSlug} />

              <EntriesTable rows={entryRows} period={periodSlug} />

              {entries.length > ENTRY_ROW_LIMIT && (
                <p className="text-[10.5px] text-[var(--text-faint)]">
                  The entry table lists the {ENTRY_ROW_LIMIT.toLocaleString("en-GB")} most recent of{" "}
                  {entries.length.toLocaleString("en-GB")} entries in range. Every total above
                  covers all {entries.length.toLocaleString("en-GB")}; narrow the period to list
                  the rest.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </PageTransition>
  );
}
