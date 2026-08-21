/**
 * Filtered reporting over the `time` schema — the query engine behind the
 * TrackingTime Dashboard.
 *
 * WHY THIS EXISTS ALONGSIDE time-dashboard.ts
 * -------------------------------------------
 * `time-dashboard.ts` reads the pre-aggregated SQL views (`org_week`,
 * `project_summary`, …). Those are fast and correct, but they aggregate over
 * ALL TIME and expose no filter surface — a view cannot answer "Björn's
 * billable hours on project X in June". This module answers arbitrary filtered
 * questions; the views remain the right tool for the unfiltered overview.
 *
 * TWO MEASURED CONSTRAINTS SHAPE EVERY DECISION BELOW
 * ---------------------------------------------------
 * 1. **PostgREST refuses aggregate functions on this project.** Measured against
 *    the live database: `select=duration_seconds.sum()` returns
 *    `"Use of aggregate functions is not allowed"`. `db-aggregates-enabled` is
 *    off (Supabase's default since the 2024 advisory — aggregates over an
 *    unbounded table are a trivial DoS). So every total here is summed in
 *    TypeScript over fetched rows. This is not a preference; the database will
 *    not do it for us over the REST API.
 *
 * 2. **A single request returns at most 1000 rows.** Also measured:
 *    `.range(0, 4999)` still yielded exactly 1000. That is PostgREST's
 *    `db-max-rows`, and it is a SILENT truncation — no error, just a short
 *    array. Summing one unpaginated page of a 4,191-row table would under-report
 *    total hours by 76% while looking perfectly healthy. `fetchAllEntries`
 *    therefore pages explicitly and reports when it hits its own ceiling.
 *
 * SECURITY
 * --------
 * Every query runs through the caller's RLS-scoped client. `time.entry`'s
 * policies already restrict rows to what the caller may see, so an employee
 * running an unfiltered report gets their own hours, not the company's. This
 * module adds NO privilege — it only narrows. Money is deliberately absent:
 * rates live behind `time.project_economics()`, a security-definer function
 * gated on a permission, because a partial rate join produces a plausible wrong
 * total rather than an error (see the note in schema.sql §8b).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { secondsToHours } from "@/lib/time-transform";
import { fetchAllPaged } from "@/lib/queries/paged";

type SupabaseTyped = SupabaseClient<Database>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const timeSchema = (s: SupabaseTyped) => (s as any).schema("time");

/** Coerce a PostgREST numeric (which may arrive as a string) to a number. */
function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/* --------------------------------------------------------------- filters */

/**
 * The filter surface, mirroring what TrackingTime's own Timesheets report
 * offers: date range, member, project, customer, service, and the
 * billable/calendar flags.
 *
 * Id arrays are multi-select and treated as OR within a dimension, AND across
 * dimensions — the behaviour every reporting tool has, and the one users
 * assume. An EMPTY array means "no constraint", never "match nothing":
 * rendering an empty dashboard because a picker was cleared is a bug users
 * report as data loss.
 */
export type TimeFilters = {
  /** Inclusive ISO date (YYYY-MM-DD). */
  from: string;
  /** Inclusive ISO date (YYYY-MM-DD). */
  to: string;
  memberIds: number[];
  projectIds: number[];
  customerIds: number[];
  serviceIds: number[];
  /** null = both billable and non-billable. */
  billable: boolean | null;
  /**
   * Calendar (GHOST) entries are EXCLUDED by default and included on request.
   *
   * MEASURED over all 5,218 stored entries, because the figures this decision
   * rests on had drifted badly from the ones written here:
   *
   *   calendar share   46.4% of events, 39.6% of hours   (was documented as 34%)
   *   non-billable     78.8% of events, 62.5% of hours   (was documented as 98%)
   *
   * The second correction matters more than the first. At 98% non-billable the
   * exclusion is nearly free; at 62.5% it withholds roughly 1,225 BILLABLE hours,
   * which is a real number about the business and not calendar noise. The default
   * is kept — folding largely-undeliberate time into a billable ratio still
   * distorts it — but it can no longer be justified as costless, which is why
   * TotalsStrip now states the excluded total on screen instead of leaving it to
   * a tooltip nobody hovers.
   */
  includeCalendar: boolean;
};

export const DEFAULT_FILTERS: Omit<TimeFilters, "from" | "to"> = {
  memberIds: [],
  projectIds: [],
  customerIds: [],
  serviceIds: [],
  billable: null,
  includeCalendar: false,
};

/**
 * Named date presets, matching those TrackingTime exposes (verified in their
 * help docs): Today, This Week, Last Week, This Month, Last Month, This Year,
 * All Time, Custom.
 *
 * Computed in UTC via `Date.UTC`, deliberately. `new Date(y, m, d)` builds a
 * LOCAL date, so a server in Berlin (UTC+2) resolves "today" to a window
 * starting 22:00 the previous day — entries logged late in the evening land in
 * the wrong bucket, and only for some deployments. Entry timestamps are stored
 * UTC; the boundaries must match them.
 */
export type PresetKey =
  | "today"
  | "this_week"
  | "last_week"
  | "this_month"
  | "last_month"
  | "this_year"
  | "all"
  | "custom";

export const PRESETS: { key: PresetKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "this_week", label: "This week" },
  { key: "last_week", label: "Last week" },
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "this_year", label: "This year" },
  { key: "all", label: "All time" },
];

const iso = (d: Date): string => d.toISOString().slice(0, 10);

/** Monday-start ISO week, matching `date_trunc('week', …)` in Postgres. */
function isoWeekStartUTC(d: Date): Date {
  const day = d.getUTCDay(); // 0=Sun
  const delta = day === 0 ? -6 : 1 - day;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + delta));
}

export function resolvePreset(key: PresetKey, now = new Date()): { from: string; to: string } {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth();

  switch (key) {
    case "today":
      return { from: iso(today), to: iso(today) };
    case "this_week": {
      const s = isoWeekStartUTC(today);
      return { from: iso(s), to: iso(new Date(s.getTime() + 6 * 86_400_000)) };
    }
    case "last_week": {
      const s = new Date(isoWeekStartUTC(today).getTime() - 7 * 86_400_000);
      return { from: iso(s), to: iso(new Date(s.getTime() + 6 * 86_400_000)) };
    }
    case "this_month":
      // Day 0 of the NEXT month is the last day of this one — avoids a 28/30/31
      // table and gets February right in a leap year for free.
      return { from: iso(new Date(Date.UTC(y, m, 1))), to: iso(new Date(Date.UTC(y, m + 1, 0))) };
    case "last_month":
      return { from: iso(new Date(Date.UTC(y, m - 1, 1))), to: iso(new Date(Date.UTC(y, m, 0))) };
    case "this_year":
      /**
       * YEAR TO DATE, not the whole calendar year.
       *
       * This ran to 31 December, and that made the figure disagree with
       * TrackingTime's own "This Year" report by 765 hours -- measured: ours
       * 8,263.4h against the vendor's 7,498h for 2026. The cause is that this
       * account books work in ADVANCE (planned assignments dated Sep-Dec), so a
       * range ending in December counts hours nobody has worked yet.
       *
       * That is indefensible on a report someone reconciles against the vendor:
       * "this year" in every other tool means the year so far, and a total that
       * silently includes the future reads as an error in our data rather than as
       * a definition. `scripts/explain-hours-definitions.mjs` matched the vendor's
       * figure to "everything up to today" at 7,498.5h against their 7,498h.
       *
       * Future-dated work is still reachable -- "All time" extends into next year,
       * and a custom range can end wherever you like. It is simply not folded into
       * a year-to-date number by default.
       */
      return { from: iso(new Date(Date.UTC(y, 0, 1))), to: iso(today) };
    case "all":
    default:
      // Wide enough to contain any plausible record without being unbounded.
      return { from: "2000-01-01", to: iso(new Date(Date.UTC(y + 1, 11, 31))) };
  }
}

/* ------------------------------------------------------------- fetching */

/** One entry, flattened with its related names resolved. */
export type ReportEntry = {
  id: number;
  memberId: number;
  memberName: string;
  projectId: number | null;
  projectName: string | null;
  customerId: number | null;
  customerName: string | null;
  serviceId: number | null;
  serviceName: string | null;
  taskName: string | null;
  startedAt: string;
  durationSeconds: number;
  isBillable: boolean;
  isBilled: boolean;
  isCalendar: boolean;
  notes: string | null;
};

const SELECT = `
  id, member_id, project_id, customer_id, service_id,
  started_at, duration_seconds, is_billable, is_billed, is_calendar, notes,
  member:member_id ( display_name ),
  project:project_id ( name ),
  customer:customer_id ( name ),
  service:service_id ( name ),
  task:task_id ( name )
`;

/** PostgREST's hard page size on this project, measured rather than assumed. */
const PAGE = 1000;

/**
 * Safety ceiling: 25 pages ≈ 25,000 entries. The live table holds 4,191, so
 * this is ~6× headroom while still bounding a runaway loop. If a future dataset
 * exceeds it the result is flagged `truncated` and the UI says so — a visibly
 * partial report beats both a silent undercount and a hung page.
 */
const MAX_PAGES = 25;

export type FetchResult = {
  entries: ReportEntry[];
  /** True when MAX_PAGES was hit and rows remain unread. */
  truncated: boolean;
};

/**
 * How many seconds the calendar exclusion is currently hiding.
 *
 * WHY THIS EXISTS: `includeCalendar` defaults to false, and for a live July that
 * removes 420 of 1069 hours — 39%. The dashboard rendered the remaining 649h as
 * "TOTAL HOURS" with nothing beside it saying so, so the only way to discover
 * the gap was to already know the toggle existed. Measured against the vendor
 * API, TrackingTime's own report for the same month says 1069.3h: the two
 * numbers disagreeing with no explanation reads as a data fault, and was
 * reported as one.
 *
 * Returns 0 when calendar time is already included, so the caller can render
 * unconditionally without asking twice.
 *
 * Only `duration_seconds` is selected: this is a sum, and pulling the full row
 * shape for entries that are never displayed would double the page's data cost.
 */
export async function fetchExcludedCalendarSeconds(
  supabase: SupabaseTyped,
  filters: TimeFilters,
): Promise<number> {
  if (filters.includeCalendar) return 0;

  const toExclusive = new Date(`${filters.to}T00:00:00.000Z`);
  toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);

  let total = 0;

  try {
    // Parallel-paged (paged.ts): this runs alongside fetchAllEntries on every
    // dashboard load, so its serial loop added a whole extra page-by-page scan.
    const { rows } = await fetchAllPaged<{ duration_seconds: number | null }>((from, to) => {
      let q = timeSchema(supabase)
        .from("entry")
        .select("duration_seconds")
        .gte("started_at", `${filters.from}T00:00:00.000Z`)
        .lt("started_at", toExclusive.toISOString())
        .not("duration_seconds", "is", null)
        // The one difference from fetchAllEntries: this asks for exactly the
        // rows that call excludes.
        .eq("is_calendar", true)
        .range(from, to);

      if (filters.memberIds.length) q = q.in("member_id", filters.memberIds);
      if (filters.projectIds.length) q = q.in("project_id", filters.projectIds);
      if (filters.customerIds.length) q = q.in("customer_id", filters.customerIds);
      if (filters.serviceIds.length) q = q.in("service_id", filters.serviceIds);
      if (filters.billable !== null) q = q.eq("is_billable", filters.billable);

      return q;
    }, { maxPages: MAX_PAGES });

    for (const r of rows) {
      total += num(r.duration_seconds);
    }
  } catch {
    // A failure here must not take the page down: the caveat is additive, and
    // 0 renders as "no note", which is the same as the old behaviour.
    return 0;
  }

  return total;
}

/**
 * Fetch every entry matching the filters, paging past the 1000-row cap.
 *
 * The date bound on `to` is `< to + 1 day` rather than `<= to`. `started_at` is
 * a timestamptz; `lte('started_at', '2026-06-30')` compares against
 * midnight, so it silently drops everything logged during the final day of the
 * range — the most recent day, the one users check first.
 *
 * PAGES IN PARALLEL, and that is a measured decision rather than a stylistic one.
 *
 * Measured AS A SIGNED-IN EXEC over the live 4,194-entry table
 * (scripts/recheck2-paging-and-tables.mjs, median of 5 runs):
 *
 *     all-time paged sequentially   ~3320ms   <- what this used to do
 *     all-time paged in parallel    ~2935ms
 *
 * This comment previously quoted 893ms -> 252ms. Those came from the SERVICE ROLE
 * key, and they were misleading in both directions: they understate the absolute
 * time a real user waits by roughly 6x, because service_role bypasses row-level
 * security, and they understate the SAVING too (226ms against 386ms) because every
 * serial round trip carries its own policy evaluation, so removing the
 * serialisation removes more work, not less. Quoting them was the same shortcut
 * that made my original latency diagnosis wrong, so the RLS numbers are what is
 * recorded here.
 *
 * The saving is paid back on every wide load AND on every filter change over a
 * wide range, because the whole report re-runs server-side each time. The
 * sequential loop existed because it discovered the end of the data by hitting a
 * short page -- it could not know the page count in advance. An exact `count` in
 * the first request removes that dependency, so the remaining pages can go at
 * once.
 *
 * The absolute figures stay around 3s until
 * supabase/migrations/hoist_entry_read_policy.sql is applied: per-row RLS
 * evaluation dominates, and parallelising requests cannot remove work the database
 * performs on every row.
 *
 * The first request therefore does double duty: it returns page 0 AND the total,
 * which costs nothing extra over the request that had to happen anyway. When the
 * count is unavailable (a PostgREST version or a policy that declines to report
 * it) this falls back to the original sequential probe rather than guessing, so
 * correctness never depends on the optimisation.
 */
export async function fetchAllEntries(
  supabase: SupabaseTyped,
  filters: TimeFilters,
): Promise<FetchResult> {
  const toExclusive = new Date(`${filters.to}T00:00:00.000Z`);
  toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);

  /** The filtered query for one page. Shared so every page is identical bar its range. */
  const pageQuery = (page: number, opts: { count?: "exact" } = {}) => {
    let q = timeSchema(supabase)
      .from("entry")
      .select(SELECT, opts.count ? { count: opts.count } : undefined)
      .gte("started_at", `${filters.from}T00:00:00.000Z`)
      .lt("started_at", toExclusive.toISOString())
      // A running timer has no duration yet. Including it would add a null
      // that coerces to 0 and inflate the entry count with a non-fact.
      .not("duration_seconds", "is", null)
      .order("started_at", { ascending: false })
      .range(page * PAGE, page * PAGE + PAGE - 1);

    if (filters.memberIds.length) q = q.in("member_id", filters.memberIds);
    if (filters.projectIds.length) q = q.in("project_id", filters.projectIds);
    if (filters.customerIds.length) q = q.in("customer_id", filters.customerIds);
    if (filters.serviceIds.length) q = q.in("service_id", filters.serviceIds);
    if (filters.billable !== null) q = q.eq("is_billable", filters.billable);
    if (!filters.includeCalendar) q = q.eq("is_calendar", false);

    return q;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const flatten = (rows: any[]): ReportEntry[] =>
    rows.map((r) => ({
      id: num(r.id),
      memberId: num(r.member_id),
      memberName: r.member?.display_name ?? "Unknown",
      projectId: numOrNull(r.project_id),
      projectName: r.project?.name ?? null,
      customerId: numOrNull(r.customer_id),
      customerName: r.customer?.name ?? null,
      serviceId: numOrNull(r.service_id),
      serviceName: r.service?.name ?? null,
      taskName: r.task?.name ?? null,
      startedAt: String(r.started_at),
      durationSeconds: num(r.duration_seconds),
      isBillable: Boolean(r.is_billable),
      isBilled: Boolean(r.is_billed),
      isCalendar: Boolean(r.is_calendar),
      notes: r.notes ?? null,
    }));

  try {
    // Page 0 plus the total, in one request.
    const first = await pageQuery(0, { count: "exact" });
    if (first.error || !first.data) return { entries: [], truncated: false };

    const out = flatten(first.data as unknown[]);

    // A short first page is the whole result. This is the common case by far --
    // a week or a month is well under 1000 entries -- and it costs exactly one
    // request, as it always did.
    if ((first.data as unknown[]).length < PAGE) {
      return { entries: out, truncated: false };
    }

    const total = typeof first.count === "number" ? first.count : null;

    if (total === null) {
      // No count: fall back to the original sequential probe. Slower, but it
      // cannot over- or under-fetch, and correctness must not depend on an
      // optimisation being available.
      for (let page = 1; page < MAX_PAGES; page++) {
        const { data, error } = await pageQuery(page);
        if (error || !data) break;
        out.push(...flatten(data as unknown[]));
        if ((data as unknown[]).length < PAGE) return { entries: out, truncated: false };
        if (page === MAX_PAGES - 1) return { entries: out, truncated: true };
      }
      return { entries: out, truncated: false };
    }

    const neededPages = Math.ceil(total / PAGE);
    // The ceiling still applies: it bounds how much this will pull into memory,
    // and exceeding it is reported to the user rather than silently truncating.
    const lastPage = Math.min(neededPages, MAX_PAGES);

    // Pages 1..last, all at once. Measured at 252ms against 893ms sequential.
    const rest = await Promise.all(
      Array.from({ length: lastPage - 1 }, (_, i) => pageQuery(i + 1)),
    );

    // Appended IN PAGE ORDER, not in completion order: `entries` is consumed as
    // "most recent first" (the entry table's default sort and the trend's input),
    // and Promise.all preserves input order, so this holds by construction.
    for (const r of rest) {
      if (r.error || !r.data) break;
      out.push(...flatten(r.data as unknown[]));
    }

    return { entries: out, truncated: neededPages > MAX_PAGES };
  } catch {
    // A failed report renders as empty rather than a 500. RLS denial and a
    // network fault are indistinguishable here and both mean "show nothing".
    return { entries: [], truncated: false };
  }
}

/* ---------------------------------------------------------- aggregation */

export type Totals = {
  totalSeconds: number;
  billableSeconds: number;
  nonBillableSeconds: number;
  calendarSeconds: number;
  entryCount: number;
  totalHours: number;
  billableHours: number;
  /** Null rather than 0 when there is nothing to divide — see below. */
  billablePercent: number | null;
  memberCount: number;
  projectCount: number;
  customerCount: number;
  /** Distinct calendar days with at least one entry. */
  activeDays: number;
};

/**
 * Roll entries into the headline strip.
 *
 * `billablePercent` divides by TOTAL, not by non-calendar time. 427 live
 * entries are both `is_calendar` and `is_billable`; excluding calendar from the
 * denominator while those remain in the numerator yields 102–109%, which is
 * nonsense on a figure an executive reads. Total is the only denominator that
 * contains every second in the numerator.
 *
 * It returns `null` — not 0 — for an empty set. "0% billable" is a claim that
 * the team did unbillable work; "—" correctly says nothing was logged.
 */
export function summarise(entries: ReportEntry[]): Totals {
  let totalSeconds = 0;
  let billableSeconds = 0;
  let calendarSeconds = 0;

  const members = new Set<number>();
  const projects = new Set<number>();
  const customers = new Set<number>();
  const days = new Set<string>();

  for (const e of entries) {
    totalSeconds += e.durationSeconds;
    if (e.isBillable) billableSeconds += e.durationSeconds;
    if (e.isCalendar) calendarSeconds += e.durationSeconds;
    members.add(e.memberId);
    if (e.projectId !== null) projects.add(e.projectId);
    if (e.customerId !== null) customers.add(e.customerId);
    days.add(e.startedAt.slice(0, 10));
  }

  return {
    totalSeconds,
    billableSeconds,
    nonBillableSeconds: totalSeconds - billableSeconds,
    calendarSeconds,
    entryCount: entries.length,
    totalHours: secondsToHours(totalSeconds),
    billableHours: secondsToHours(billableSeconds),
    billablePercent:
      totalSeconds > 0 ? Math.round((billableSeconds / totalSeconds) * 100) : null,
    memberCount: members.size,
    projectCount: projects.size,
    customerCount: customers.size,
    activeDays: days.size,
  };
}

/** A generic grouped row — the shape every breakdown table renders. */
export type GroupRow = {
  key: string;
  id: number | null;
  label: string;
  secondary: string | null;
  totalSeconds: number;
  billableSeconds: number;
  entryCount: number;
  totalHours: number;
  billableHours: number;
  /** Share of the grand total, for the magnitude bar. */
  sharePercent: number;
  billablePercent: number | null;
  lastActivityAt: string | null;
};

export type GroupBy = "member" | "project" | "customer" | "service" | "task";

/**
 * Group entries by one dimension, ranked by hours descending.
 *
 * Unattributed time is kept as an explicit "(none)" row rather than dropped.
 * 1,691 live entries have no project — discarding them would make the
 * breakdown's total silently disagree with the headline figure above it, and
 * the reader has no way to see which number is wrong.
 */
export function groupBy(entries: ReportEntry[], dim: GroupBy): GroupRow[] {
  const pick = (
    e: ReportEntry,
  ): { id: number | null; label: string; secondary: string | null } => {
    switch (dim) {
      case "member":
        return { id: e.memberId, label: e.memberName, secondary: null };
      case "project":
        return {
          id: e.projectId,
          label: e.projectName ?? "(no project)",
          secondary: e.customerName,
        };
      case "customer":
        return { id: e.customerId, label: e.customerName ?? "(no customer)", secondary: null };
      case "service":
        return { id: e.serviceId, label: e.serviceName ?? "(no service)", secondary: null };
      case "task":
        return { id: null, label: e.taskName ?? "(no task)", secondary: e.projectName };
    }
  };

  const acc = new Map<string, GroupRow>();
  let grand = 0;

  for (const e of entries) {
    const { id, label, secondary } = pick(e);
    // Key on the id when present, on the label otherwise. Keying on the label
    // alone would merge two distinct projects that share a name — which happens
    // in the live data, where the same engagement recurs per year.
    const key = id !== null ? `id:${id}` : `label:${label}`;
    grand += e.durationSeconds;

    let row = acc.get(key);
    if (!row) {
      row = {
        key,
        id,
        label,
        secondary,
        totalSeconds: 0,
        billableSeconds: 0,
        entryCount: 0,
        totalHours: 0,
        billableHours: 0,
        sharePercent: 0,
        billablePercent: null,
        lastActivityAt: null,
      };
      acc.set(key, row);
    }

    row.totalSeconds += e.durationSeconds;
    if (e.isBillable) row.billableSeconds += e.durationSeconds;
    row.entryCount += 1;
    if (row.lastActivityAt === null || e.startedAt > row.lastActivityAt) {
      row.lastActivityAt = e.startedAt;
    }
  }

  const rows = [...acc.values()];
  for (const r of rows) {
    r.totalHours = secondsToHours(r.totalSeconds);
    r.billableHours = secondsToHours(r.billableSeconds);
    r.sharePercent = grand > 0 ? (r.totalSeconds / grand) * 100 : 0;
    r.billablePercent =
      r.totalSeconds > 0 ? Math.round((r.billableSeconds / r.totalSeconds) * 100) : null;
  }

  return rows.sort((a, b) => b.totalSeconds - a.totalSeconds);
}

export type TrendBucket = "day" | "week" | "month";

export type TrendPoint = {
  bucket: string;
  totalSeconds: number;
  billableSeconds: number;
  totalHours: number;
  billableHours: number;
  entryCount: number;
};

/**
 * Bucket entries into a time series, oldest first (a chart reads left to right).
 *
 * Buckets present in the data are the only ones emitted; a week with no work
 * simply does not appear. That is honest for a bar chart and avoids inventing
 * zero rows across a multi-year "all time" range.
 */
export function trend(entries: ReportEntry[], bucket: TrendBucket): TrendPoint[] {
  const keyOf = (isoTs: string): string => {
    const d = new Date(isoTs);
    if (Number.isNaN(d.getTime())) return isoTs.slice(0, 10);
    if (bucket === "day") return d.toISOString().slice(0, 10);
    if (bucket === "month") return `${d.toISOString().slice(0, 7)}-01`;
    return isoWeekStartUTC(d).toISOString().slice(0, 10);
  };

  const acc = new Map<string, TrendPoint>();

  for (const e of entries) {
    const k = keyOf(e.startedAt);
    let p = acc.get(k);
    if (!p) {
      p = {
        bucket: k,
        totalSeconds: 0,
        billableSeconds: 0,
        totalHours: 0,
        billableHours: 0,
        entryCount: 0,
      };
      acc.set(k, p);
    }
    p.totalSeconds += e.durationSeconds;
    if (e.isBillable) p.billableSeconds += e.durationSeconds;
    p.entryCount += 1;
  }

  const pts = [...acc.values()].sort((a, b) => a.bucket.localeCompare(b.bucket));
  for (const p of pts) {
    p.totalHours = secondsToHours(p.totalSeconds);
    p.billableHours = secondsToHours(p.billableSeconds);
  }
  return pts;
}

/* ------------------------------------------------------------- budgets */

export type BudgetRow = {
  projectId: number;
  projectName: string;
  customerName: string | null;
  estimatedHours: number;
  actualHours: number;
  remainingHours: number;
  burnPercent: number;
  isOver: boolean;
};

/**
 * Budget burn: estimated versus actual, for projects that have an estimate.
 *
 * Projects WITHOUT a usable estimate are excluded entirely rather than shown at
 * 0%. 83 of 334 live projects carry `estimated_hours = 0`, which means "nobody
 * set a budget", not "the budget is zero" — rendering those as 0% consumed
 * would put 83 phantom rows at the top of a list sorted by health, burying the
 * projects that are genuinely overrunning.
 *
 * `estimated_hours` is HOURS while entries are SECONDS; the conversion uses a
 * float divisor, since integer division would floor 3,599 seconds to 0 hours.
 */
export function budgets(
  entries: ReportEntry[],
  projects: { id: number; name: string; customerName: string | null; estimatedHours: number | null }[],
): BudgetRow[] {
  const actual = new Map<number, number>();
  for (const e of entries) {
    if (e.projectId === null) continue;
    actual.set(e.projectId, (actual.get(e.projectId) ?? 0) + e.durationSeconds);
  }

  const rows: BudgetRow[] = [];
  for (const p of projects) {
    if (p.estimatedHours === null || p.estimatedHours <= 0) continue;
    const actualHours = secondsToHours(actual.get(p.id) ?? 0);
    const burnPercent = Math.round((actualHours / p.estimatedHours) * 1000) / 10;
    rows.push({
      projectId: p.id,
      projectName: p.name,
      customerName: p.customerName,
      estimatedHours: p.estimatedHours,
      actualHours,
      // Can go negative, and should: "-12h" is the overrun, and clamping it to
      // zero would hide exactly the number a project manager needs.
      remainingHours: Math.round((p.estimatedHours - actualHours) * 10) / 10,
      burnPercent,
      isOver: actualHours > p.estimatedHours,
    });
  }

  // Most-burned first — the ones needing attention lead.
  return rows.sort((a, b) => b.burnPercent - a.burnPercent);
}

/* ------------------------------------------------------------- lookups */

export type FilterOptions = {
  members: { id: number; name: string }[];
  projects: { id: number; name: string; customerName: string | null; estimatedHours: number | null }[];
  customers: { id: number; name: string }[];
  services: { id: number; name: string }[];
};

/**
 * Options for the filter pickers.
 *
 * Archived records are included: a report over a past quarter must be able to
 * name a project that has since been archived, or that quarter becomes
 * unreportable. Only the members list hides archived entries, because a picker
 * of 49 people where 30 have left is unusable — and their historical hours
 * still appear in the breakdowns regardless of the picker.
 */
export async function getFilterOptions(supabase: SupabaseTyped): Promise<FilterOptions> {
  const empty: FilterOptions = { members: [], projects: [], customers: [], services: [] };

  try {
    const t = timeSchema(supabase);
    const [m, p, c, s] = await Promise.all([
      t.from("member").select("id,display_name").eq("is_archived", false).order("display_name"),
      t.from("project").select("id,name,estimated_hours,customer:customer_id(name)").order("name").limit(PAGE),
      t.from("customer").select("id,name").order("name").limit(PAGE),
      t.from("service").select("id,name").order("sort_order"),
    ]);

    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      members: ((m.data ?? []) as any[]).map((r) => ({
        id: num(r.id),
        name: r.display_name ?? "Unknown",
      })),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      projects: ((p.data ?? []) as any[]).map((r) => ({
        id: num(r.id),
        name: r.name ?? "Untitled",
        customerName: r.customer?.name ?? null,
        estimatedHours: numOrNull(r.estimated_hours),
      })),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      customers: ((c.data ?? []) as any[]).map((r) => ({
        id: num(r.id),
        name: r.name ?? "Untitled",
      })),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      services: ((s.data ?? []) as any[]).map((r) => ({
        id: num(r.id),
        name: r.name ?? "Untitled",
      })),
    };
  } catch {
    return empty;
  }
}

/* ----------------------------------------------------------- URL params */

/**
 * Read filters from the URL. The URL is the single source of truth so a report
 * is shareable, bookmarkable, and survives the back button — the same reason
 * the existing view tabs are links rather than state.
 *
 * Every id is validated as a finite integer before it reaches a query. These
 * flow into PostgREST `in.(…)` lists, so unvalidated input is an injection
 * surface as well as a crash risk.
 */
export function parseFilters(
  params: Record<string, string | string[] | undefined>,
  now = new Date(),
): TimeFilters & { preset: PresetKey } {
  const one = (k: string): string | undefined => {
    const v = params[k];
    return Array.isArray(v) ? v[0] : v;
  };

  const ids = (k: string): number[] => {
    const raw = one(k);
    if (!raw) return [];
    return raw
      .split(",")
      .map((x) => Number(x.trim()))
      .filter((n) => Number.isInteger(n) && n > 0)
      .slice(0, 200); // Bound the IN list; a URL is user-controlled.
  };

  const rawPreset = one("preset");
  const isDate = (v: string | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

  const from = one("from");
  const to = one("to");

  let preset: PresetKey;
  let range: { from: string; to: string };

  if (rawPreset === "custom" && isDate(from) && isDate(to)) {
    preset = "custom";
    // Swap rather than reject: a reversed range is a slip, and an empty report
    // teaches the user nothing about why.
    range = from <= to ? { from, to } : { from: to, to: from };
  } else {
    const known = PRESETS.find((p) => p.key === rawPreset);
    preset = known ? known.key : "this_month";
    range = resolvePreset(preset, now);
  }

  const billableRaw = one("billable");

  return {
    preset,
    from: range.from,
    to: range.to,
    memberIds: ids("members"),
    projectIds: ids("projects"),
    customerIds: ids("customers"),
    serviceIds: ids("services"),
    billable: billableRaw === "yes" ? true : billableRaw === "no" ? false : null,
    includeCalendar: one("calendar") === "1",
  };
}

/** Serialise filters back to a query string, omitting defaults for a clean URL. */
export function buildQuery(
  f: TimeFilters & { preset: PresetKey },
  overrides: Partial<Record<string, string | null>> = {},
): string {
  const p = new URLSearchParams();
  p.set("preset", f.preset);
  if (f.preset === "custom") {
    p.set("from", f.from);
    p.set("to", f.to);
  }
  if (f.memberIds.length) p.set("members", f.memberIds.join(","));
  if (f.projectIds.length) p.set("projects", f.projectIds.join(","));
  if (f.customerIds.length) p.set("customers", f.customerIds.join(","));
  if (f.serviceIds.length) p.set("services", f.serviceIds.join(","));
  if (f.billable !== null) p.set("billable", f.billable ? "yes" : "no");
  if (f.includeCalendar) p.set("calendar", "1");

  for (const [k, v] of Object.entries(overrides)) {
    if (v === null) p.delete(k);
    else if (v !== undefined) p.set(k, v);
  }

  return p.toString();
}
