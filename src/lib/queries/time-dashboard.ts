/**
 * Reads for the organisation-wide Time Tracking dashboard (`/time/dashboard`).
 *
 * Separate from queries/time.ts on purpose: that file serves one person's week,
 * this one serves whole-organisation rollups from the `time` schema's 8b
 * analytics views. They have different access profiles and different failure
 * modes, and mixing them makes it easy to reach for a rate-bearing read on a
 * page that should never show money.
 *
 * Three rules hold everywhere in this file:
 *
 * 1. **Seconds in, hours out at the very edge.** Every view column ending
 *    `_seconds` is SECONDS. Conversion happens once, here, via
 *    `secondsToHours`/`formatSeconds`. No component divides by 3600.
 *
 * 2. **Money is not a view.** `getProjectEconomics()` calls a security definer
 *    RPC gated on a permission. It returns `null` — not zeros, not an empty
 *    array — when the caller may not see money, so the page can hide the
 *    section rather than render a convincing €0.00.
 *
 * 3. **Empty is an answer.** RLS legitimately returns no rows, and the `time`
 *    schema may not be applied to a given environment yet. Every read degrades
 *    to empty rather than throwing, because a dashboard that 500s on a fresh
 *    database is worse than one that says "no data yet".
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { secondsToHours } from "@/lib/time-transform";

type SupabaseTyped = SupabaseClient<Database>;
/** See queries/time.ts — `time` is absent from the generated `public` types. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const timeSchema = (s: SupabaseTyped) => (s as any).schema("time");

/** Coerce a PostgREST numeric (which arrives as a string) to a number. */
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Same, but preserving "not set" as null rather than flattening it to 0. */
const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export type OrgWeekRow = {
  weekStart: string;
  totalSeconds: number;
  billableSeconds: number;
  calendarSeconds: number;
  /** Total minus calendar — the deliberate work. */
  trackedSeconds: number;
  entryCount: number;
  activeMembers: number;
  activeProjects: number;
  totalHours: number;
  billableHours: number;
};

export type ProjectSummaryRow = {
  projectId: number;
  projectName: string;
  customerName: string | null;
  isBillable: boolean;
  isArchived: boolean;
  totalSeconds: number;
  billableSeconds: number;
  calendarSeconds: number;
  entryCount: number;
  memberCount: number;
  lastActivityAt: string | null;
  /** Budget in hours, or null when nobody set one. */
  estimatedHours: number | null;
  /** Logged ÷ budget × 100, or null when there is no budget to burn. */
  burnPercent: number | null;
  totalHours: number;
  billableHours: number;
};

export type CustomerSummaryRow = {
  customerId: number;
  customerName: string;
  totalSeconds: number;
  billableSeconds: number;
  projectCount: number;
  entryCount: number;
  lastActivityAt: string | null;
  totalHours: number;
};

export type ServiceSummaryRow = {
  serviceId: number;
  serviceName: string;
  isTravel: boolean;
  isPaidTravel: boolean;
  isInternal: boolean;
  totalSeconds: number;
  billableSeconds: number;
  entryCount: number;
  totalHours: number;
  /** Share of the organisation's total, 0-100. */
  sharePercent: number;
};

export type MemberUtilisationRow = {
  memberId: number;
  displayName: string;
  isArchived: boolean;
  weeklyHours: number;
  totalSeconds: number;
  billableSeconds: number;
  calendarSeconds: number;
  trackedSeconds: number;
  entryCount: number;
  weeksActive: number;
  lastActivityAt: string | null;
  totalHours: number;
  /**
   * Tracked hours against contracted hours over the weeks the person was
   * actually active, 0-∞. Null when there is no contract or no activity —
   * "unknown" and "0%" are different claims.
   */
  utilisationPercent: number | null;
};

export type ProjectEconomicsRow = {
  projectId: number;
  projectName: string;
  customerName: string | null;
  totalSeconds: number;
  billableSeconds: number;
  revenue: number;
  cost: number;
  margin: number;
  /** Margin as a share of revenue, or null when there is no revenue. */
  marginPercent: number | null;
};

/** The headline figures across the whole window. */
export type OrgTotals = {
  totalSeconds: number;
  billableSeconds: number;
  calendarSeconds: number;
  trackedSeconds: number;
  entryCount: number;
  totalHours: number;
  billableHours: number;
  /** Billable as a share of DELIBERATE work, not of everything. See below. */
  billablePercent: number | null;
  activeMembers: number;
  activeProjects: number;
  weeksCovered: number;
};

/**
 * Organisation weekly trend, oldest first.
 *
 * `limit` is applied to the most recent weeks and the result is then reversed,
 * because a chart reads left-to-right in time. Ordering ascending and taking
 * the first N would return the OLDEST weeks — the exact bug already fixed once
 * in getExecutiveOverview (see scripts/check-trend-window.mjs).
 */
export async function getOrgWeeks(
  supabase: SupabaseTyped,
  limit = 12,
): Promise<OrgWeekRow[]> {
  try {
    const { data, error } = await timeSchema(supabase)
      .from("org_week")
      .select("*")
      .order("week_start", { ascending: false })
      .limit(limit);

    if (error || !data) return [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (data as any[]).map((r) => {
      const totalSeconds = num(r.total_seconds);
      const billableSeconds = num(r.billable_seconds);
      return {
        weekStart: String(r.week_start).slice(0, 10),
        totalSeconds,
        billableSeconds,
        calendarSeconds: num(r.calendar_seconds),
        trackedSeconds: num(r.tracked_seconds),
        entryCount: num(r.entry_count),
        activeMembers: num(r.active_members),
        activeProjects: num(r.active_projects),
        totalHours: secondsToHours(totalSeconds),
        billableHours: secondsToHours(billableSeconds),
      };
    });

    return rows.reverse();
  } catch {
    return [];
  }
}

/**
 * Roll a set of weeks into the headline strip.
 *
 * `billablePercent` divides by TRACKED time, not total. A third of live events
 * are calendar placeholders that are 98% non-billable, so dividing by the total
 * would depress the billable ratio by a constant that has nothing to do with
 * how the business is performing.
 *
 * `activeMembers`/`activeProjects` take the MAX across weeks rather than the
 * sum — summing distinct counts double-counts anyone who worked in two weeks.
 * Max is the honest "how big did this get" without a second query.
 */
export function summariseOrgWeeks(weeks: OrgWeekRow[]): OrgTotals {
  let totalSeconds = 0;
  let billableSeconds = 0;
  let calendarSeconds = 0;
  let trackedSeconds = 0;
  let entryCount = 0;
  let activeMembers = 0;
  let activeProjects = 0;

  for (const w of weeks) {
    totalSeconds += w.totalSeconds;
    billableSeconds += w.billableSeconds;
    calendarSeconds += w.calendarSeconds;
    trackedSeconds += w.trackedSeconds;
    entryCount += w.entryCount;
    activeMembers = Math.max(activeMembers, w.activeMembers);
    activeProjects = Math.max(activeProjects, w.activeProjects);
  }

  return {
    totalSeconds,
    billableSeconds,
    calendarSeconds,
    trackedSeconds,
    entryCount,
    totalHours: secondsToHours(totalSeconds),
    billableHours: secondsToHours(billableSeconds),
    // Denominator is totalSeconds, NOT trackedSeconds. 427 live entries are BOTH
    // is_calendar and is_billable, so they are excluded from tracked while still
    // counted in billable — dividing by tracked yields 102-109%, which is
    // nonsense on a percentage a CEO reads. total is the only denominator that
    // contains every second in the numerator.
    billablePercent:
      totalSeconds > 0 ? Math.round((billableSeconds / totalSeconds) * 100) : null,
    activeMembers,
    activeProjects,
    weeksCovered: weeks.length,
  };
}

/** Projects ranked by hours logged. Archived projects are excluded by default. */
export async function getProjectSummary(
  supabase: SupabaseTyped,
  opts: { limit?: number; includeArchived?: boolean } = {},
): Promise<ProjectSummaryRow[]> {
  const { limit = 25, includeArchived = false } = opts;

  try {
    let query = timeSchema(supabase)
      .from("project_summary")
      .select("*")
      .order("total_seconds", { ascending: false })
      .limit(limit);

    if (!includeArchived) query = query.eq("is_archived", false);

    const { data, error } = await query;
    if (error || !data) return [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data as any[]).map((r) => {
      const totalSeconds = num(r.total_seconds);
      const billableSeconds = num(r.billable_seconds);
      return {
        projectId: num(r.project_id),
        projectName: r.project_name ?? "Untitled",
        customerName: r.customer_name ?? null,
        isBillable: Boolean(r.is_billable),
        isArchived: Boolean(r.is_archived),
        totalSeconds,
        billableSeconds,
        calendarSeconds: num(r.calendar_seconds),
        entryCount: num(r.entry_count),
        memberCount: num(r.member_count),
        lastActivityAt: r.last_activity_at ?? null,
        estimatedHours: numOrNull(r.estimated_hours),
        burnPercent: numOrNull(r.burn_percent),
        totalHours: secondsToHours(totalSeconds),
        billableHours: secondsToHours(billableSeconds),
      };
    });
  } catch {
    return [];
  }
}

/** Customers ranked by hours logged. */
export async function getCustomerSummary(
  supabase: SupabaseTyped,
  limit = 15,
): Promise<CustomerSummaryRow[]> {
  try {
    const { data, error } = await timeSchema(supabase)
      .from("customer_summary")
      .select("*")
      .eq("is_archived", false)
      .order("total_seconds", { ascending: false })
      .limit(limit);

    if (error || !data) return [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data as any[]).map((r) => {
      const totalSeconds = num(r.total_seconds);
      return {
        customerId: num(r.customer_id),
        customerName: r.customer_name ?? "Unknown",
        totalSeconds,
        billableSeconds: num(r.billable_seconds),
        projectCount: num(r.project_count),
        entryCount: num(r.entry_count),
        lastActivityAt: r.last_activity_at ?? null,
        totalHours: secondsToHours(totalSeconds),
      };
    });
  } catch {
    return [];
  }
}

/**
 * Services ranked by hours, with each one's share of the total.
 *
 * The share is computed here rather than in SQL because a window function over
 * the whole view would ignore the `limit`, producing percentages that don't add
 * up to what's on screen. Services with no time are dropped: an empty catalogue
 * row is noise on a dashboard.
 */
export async function getServiceSummary(
  supabase: SupabaseTyped,
): Promise<ServiceSummaryRow[]> {
  try {
    const { data, error } = await timeSchema(supabase)
      .from("service_summary")
      .select("*")
      .order("total_seconds", { ascending: false });

    if (error || !data) return [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (data as any[])
      .map((r) => ({
        serviceId: num(r.service_id),
        serviceName: r.service_name ?? "Unknown",
        isTravel: Boolean(r.is_travel),
        isPaidTravel: Boolean(r.is_paid_travel),
        isInternal: Boolean(r.is_internal),
        totalSeconds: num(r.total_seconds),
        billableSeconds: num(r.billable_seconds),
        entryCount: num(r.entry_count),
      }))
      .filter((r) => r.totalSeconds > 0);

    const grand = rows.reduce((a, r) => a + r.totalSeconds, 0);

    return rows.map((r) => ({
      ...r,
      totalHours: secondsToHours(r.totalSeconds),
      sharePercent: grand > 0 ? Math.round((r.totalSeconds / grand) * 1000) / 10 : 0,
    }));
  } catch {
    return [];
  }
}

/**
 * Per-member utilisation.
 *
 * The denominator is `weeklyHours × weeksActive`, not `weeklyHours × window`.
 * Dividing by the full window would show somebody who joined last month at 8%
 * utilised, which says nothing true about them. Weeks they were actually active
 * is the honest basis, and `weeksActive` is surfaced so the reader can judge it.
 */
export async function getMemberUtilisation(
  supabase: SupabaseTyped,
  opts: { includeArchived?: boolean } = {},
): Promise<MemberUtilisationRow[]> {
  const { includeArchived = false } = opts;

  try {
    let query = timeSchema(supabase)
      .from("member_utilisation")
      .select("*")
      .order("total_seconds", { ascending: false });

    if (!includeArchived) query = query.eq("is_archived", false);

    const { data, error } = await query;
    if (error || !data) return [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data as any[]).map((r) => {
      const totalSeconds = num(r.total_seconds);
      const trackedSeconds = num(r.tracked_seconds);
      const weeklyHours = num(r.weekly_hours);
      const weeksActive = num(r.weeks_active);
      const contractedSeconds = weeklyHours * 3600 * weeksActive;

      return {
        memberId: num(r.member_id),
        displayName: r.display_name ?? "Unknown",
        isArchived: Boolean(r.is_archived),
        weeklyHours,
        totalSeconds,
        billableSeconds: num(r.billable_seconds),
        calendarSeconds: num(r.calendar_seconds),
        trackedSeconds,
        entryCount: num(r.entry_count),
        weeksActive,
        lastActivityAt: r.last_activity_at ?? null,
        totalHours: secondsToHours(totalSeconds),
        utilisationPercent:
          contractedSeconds > 0
            ? Math.round((trackedSeconds / contractedSeconds) * 100)
            : null,
      };
    });
  } catch {
    return [];
  }
}

/**
 * Project economics — revenue, cost and margin.
 *
 * Returns **null**, not `[]`, when the caller may not see money. The distinction
 * carries the whole security story: `[]` means "you may look and there is
 * nothing", `null` means "this is not yours to see", and the page must render
 * those differently. A €0.00 card shown to someone without the permission would
 * be a confident lie.
 *
 * Because the RPC is security definer and gated internally, an unauthorised
 * caller gets an empty result rather than an error, so "empty" is disambiguated
 * here by checking the permission separately.
 */
export async function getProjectEconomics(
  supabase: SupabaseTyped,
  opts: { canSeeMoney: boolean; from?: string; to?: string; limit?: number } = {
    canSeeMoney: false,
  },
): Promise<ProjectEconomicsRow[] | null> {
  if (!opts.canSeeMoney) return null;

  try {
    const { data, error } = await timeSchema(supabase).rpc("project_economics", {
      p_from: opts.from ?? null,
      p_to: opts.to ?? null,
    });

    if (error || !data) return [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (data as any[]).map((r) => ({
      projectId: num(r.project_id),
      projectName: r.project_name ?? "Untitled",
      customerName: r.customer_name ?? null,
      totalSeconds: num(r.total_seconds),
      billableSeconds: num(r.billable_seconds),
      revenue: num(r.revenue),
      cost: num(r.cost),
      margin: num(r.margin),
      marginPercent: numOrNull(r.margin_percent),
    }));

    rows.sort((a, b) => b.revenue - a.revenue);
    return typeof opts.limit === "number" ? rows.slice(0, opts.limit) : rows;
  } catch {
    // The RPC is absent (schema not applied) rather than forbidden. Empty is the
    // honest answer; null would wrongly claim the caller lacks permission.
    return [];
  }
}

// ---------------------------------------------------------------------------
// Freshness
// ---------------------------------------------------------------------------

export type SyncFreshness = {
  /** When the last SUCCESSFUL run finished. Null if there has never been one. */
  lastSuccessAt: string | null;
  /** Whole hours since that run, or null when there is nothing to measure from. */
  hoursSince: number | null;
  /** Rows written by that run — the sanity check on "it said ok". */
  recordCount: number | null;
  /**
   * A run that started and never finished, or finished as 'failed', SINCE the
   * last success. This is the case that must not read as healthy: the data is
   * intact and correct, but it is no longer being refreshed.
   */
  failedSince: number;
  /** True when the newest run is still 'running' — a sync in flight right now. */
  inProgress: boolean;
  /**
   * ok      — refreshed within a day
   * stale   — a day to a week old, or something has failed since the last success
   * missing — over a week old, or no successful run has ever been recorded
   *
   * Thresholds are deliberately generous: the schedule is daily, so a single
   * missed run should not shout, but a week of silence is a real outage.
   */
  status: "ok" | "stale" | "missing";
};

/** Hours after which the data stops being "today's" and starts being old. */
const STALE_AFTER_HOURS = 24;
/** Hours after which nobody should trust the numbers without asking why. */
const MISSING_AFTER_HOURS = 24 * 7;

/**
 * How fresh the TrackingTime import is — the read behind the dashboard's
 * freshness banner.
 *
 * WHY THIS EXISTS: every figure on the dashboard is a snapshot of whenever the
 * importer last ran. Without this, a page whose data stopped updating three
 * weeks ago renders exactly like one refreshed an hour ago — confident, precise
 * and wrong. That is the same failure class as the billable-percent and €0
 * revenue bugs: a plausible number, not an error anyone would notice.
 *
 * Reads the last SUCCESSFUL run, not the last run, and counts failures since it
 * separately. A cron job that fails every night while the dashboard shows a
 * green tick is the exact outcome this is written to prevent.
 *
 * Degrades to a null/`missing` shape rather than throwing: `raw` may not be
 * exposed in a given environment, and a dashboard that 500s over its own
 * freshness widget is worse than one that admits it does not know.
 */
export async function getSyncFreshness(
  supabase: SupabaseTyped,
  source = "trackingtime",
): Promise<SyncFreshness> {
  const empty: SyncFreshness = {
    lastSuccessAt: null,
    hoursSince: null,
    recordCount: null,
    failedSince: 0,
    inProgress: false,
    status: "missing",
  };

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawSchema = (supabase as any).schema("raw");

    const { data: okRows, error } = await rawSchema
      .from("sync_run")
      .select("finished_at, record_count")
      .eq("source", source)
      .eq("status", "ok")
      .not("finished_at", "is", null)
      .order("finished_at", { ascending: false })
      .limit(1);

    if (error) return empty;

    const last = okRows?.[0] ?? null;
    const lastSuccessAt: string | null = last?.finished_at ?? null;

    // Anything that has run since the last success, so a silent string of
    // failures cannot hide behind an old green row.
    const { data: sinceRows } = await rawSchema
      .from("sync_run")
      .select("status, started_at")
      .eq("source", source)
      .order("started_at", { ascending: false })
      .limit(50);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recent = (sinceRows ?? []) as any[];
    const cutoff = lastSuccessAt ? new Date(lastSuccessAt).getTime() : 0;

    const failedSince = recent.filter(
      (r) => r.status === "failed" && new Date(r.started_at).getTime() > cutoff,
    ).length;
    const inProgress = recent.some((r) => r.status === "running");

    if (!lastSuccessAt) return { ...empty, failedSince, inProgress };

    const hoursSince = Math.floor((Date.now() - new Date(lastSuccessAt).getTime()) / 3_600_000);

    // A failure since the last success is at least "stale" no matter how recent
    // that success was: the pipeline is broken now, which is what matters.
    const status: SyncFreshness["status"] =
      hoursSince >= MISSING_AFTER_HOURS
        ? "missing"
        : hoursSince >= STALE_AFTER_HOURS || failedSince > 0
          ? "stale"
          : "ok";

    return {
      lastSuccessAt,
      hoursSince,
      recordCount: numOrNull(last?.record_count),
      failedSince,
      inProgress,
      status,
    };
  } catch {
    return empty;
  }
}
