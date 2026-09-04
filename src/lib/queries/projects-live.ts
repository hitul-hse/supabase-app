/**
 * Query layer for the Projects module — the real 334 projects imported from
 * TrackingTime, as opposed to the five hardcoded sample rows in `public.projects`
 * that `hse.ts` still serves to the legacy `/projects` page.
 *
 * WHY A NEW FILE RATHER THAN EXTENDING hse.ts
 * -------------------------------------------
 * `hse.ts` reads `public.projects` — a five-row demo table keyed by text ids
 * (`prj-1`). The live data lives in `time.project`, keyed by bigint, with 334
 * rows and a foreign key to `time.customer`. They are different tables with
 * different shapes and different row counts; overloading one accessor to serve
 * both would make every call site ask "which projects?" Keeping them apart
 * means the legacy page keeps working untouched while the new one is built.
 *
 * THE SAME TWO CONSTRAINTS AS trackingtime-report.ts
 * --------------------------------------------------
 * 1. **No aggregates over PostgREST.** `db-aggregates-enabled` is off on this
 *    project, so `duration_seconds.sum()` is rejected outright. Every hour total
 *    below is summed in TypeScript over fetched rows.
 * 2. **1000 rows per request, silently.** A short array is the only signal. At
 *    334 projects one page suffices today, but `fetchAllProjects` pages anyway —
 *    the failure mode of not doing so is a project list that quietly stops at
 *    1000 with no error, and nobody notices until a project is missing.
 *
 * Entry aggregation deliberately reuses `fetchAllEntries` from the report layer
 * rather than issuing its own query. That function already encodes two
 * corrections that are easy to get wrong and expensive to get wrong silently:
 * the exclusive upper date bound (a `lte` on a timestamptz drops the final day),
 * and the exclusion of running timers whose null duration would coerce to zero.
 *
 * MONEY IS ABSENT, DELIBERATELY
 * -----------------------------
 * No rates, no revenue. Those live behind `time.project_economics()`, a
 * security-definer function gated on `overview:export`, because a partial rate
 * join yields a plausible wrong total rather than an error — the same reason the
 * report layer keeps them out. A project page that quietly under-reports revenue
 * is worse than one that does not mention it.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { secondsToHours } from "@/lib/time-transform";
import { fetchAllEntries, type ReportEntry, type TimeFilters } from "./trackingtime-report";
import { canReadBudgets, budgetAwareColumns } from "@/lib/budget-visibility";

type SupabaseTyped = SupabaseClient<Database>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const timeSchema = (s: SupabaseTyped) => (s as any).schema("time");

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** PostgREST's page size on this project, measured rather than assumed. */
const PAGE = 1000;
const MAX_PAGES = 10;

/* ------------------------------------------------------------- raw reads */

export type ProjectRecord = {
  id: number;
  name: string;
  code: string | null;
  customerId: number | null;
  customerName: string | null;
  serviceName: string | null;
  estimatedHours: number | null;
  isBillable: boolean;
  isArchived: boolean;
};

/**
 * The columns, with the budget omitted for a caller who may not see it.
 *
 * /projects and /projects/[id] are gated on projects:read_all, which only exec
 * holds, and exec holds projects:contracts:read -- so today this never
 * subtracts anything. It is here because the page gate and the budget
 * permission are two independent decisions, and the ledger must not start
 * leaking budgets the day somebody widens the first one. The read layer states
 * its own requirement rather than relying on a caller three files away.
 */
const projectSelect = (canSeeBudgets: boolean) => `
  ${budgetAwareColumns("id, name, code, customer_id, is_billable, is_archived", canSeeBudgets)},
  customer:customer_id ( name ),
  service:service_id ( name )
`;

/**
 * Budgets by project id, or an empty map when the caller may not see them.
 *
 * NOT read from `time.project` any more. Migration
 * 20260903230000_budgets_are_not_readable_by_default revoked the column grant
 * on `estimated_hours` from `authenticated` -- and because every signed-in
 * Supabase user IS `authenticated`, that applies to exec too. Selecting the
 * column off the base table now fails with `permission denied for table
 * project` for EVERY caller, which silently emptied this whole ledger: the
 * paged loop below treats an error as "no more rows" and breaks.
 *
 * `time.project_summary` serves the same figure through
 * `time.project_estimated_hours()`, a SECURITY DEFINER function that checks
 * `projects:contracts:read` itself -- so this returns real numbers for exec and
 * NULLs for everyone else, without the base-table grant.
 */
async function fetchBudgets(
  supabase: SupabaseTyped,
  canSeeBudgets: boolean,
): Promise<Map<number, number | null>> {
  const byId = new Map<number, number | null>();
  if (!canSeeBudgets) return byId;
  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const { data, error } = await timeSchema(supabase)
        .from("project_summary")
        .select("project_id, estimated_hours")
        .order("project_id")
        .range(page * PAGE, page * PAGE + PAGE - 1);
      if (error || !data) break;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const r of data as any[]) byId.set(num(r.project_id), numOrNull(r.estimated_hours));
      if (data.length < PAGE) break;
    }
  } catch {
    return byId;
  }
  return byId;
}

/**
 * Every project the caller may see, paged past the 1000-row cap.
 *
 * Archived projects are INCLUDED. A project archived last month still owns the
 * hours logged against it, and excluding it would make those hours orphaned in
 * every total that reconciles against the entry table. The list UI filters them
 * out by default instead, which is reversible; dropping them here would not be.
 */
export async function fetchAllProjects(supabase: SupabaseTyped): Promise<ProjectRecord[]> {
  const out: ProjectRecord[] = [];
  try {
    const canSeeBudgets = await canReadBudgets(supabase);
    const budgets = await fetchBudgets(supabase, canSeeBudgets);
    for (let page = 0; page < MAX_PAGES; page++) {
      const { data, error } = await timeSchema(supabase)
        .from("project")
        .select(projectSelect(canSeeBudgets))
        .order("name")
        .range(page * PAGE, page * PAGE + PAGE - 1);

      if (error || !data) break;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const r of data as any[]) {
        out.push({
          id: num(r.id),
          name: r.name ?? "Untitled",
          code: r.code ?? null,
          customerId: numOrNull(r.customer_id),
          customerName: r.customer?.name ?? null,
          serviceName: r.service?.name ?? null,
          estimatedHours: budgets.get(num(r.id)) ?? null,
          isBillable: Boolean(r.is_billable),
          isArchived: Boolean(r.is_archived),
        });
      }

      if (data.length < PAGE) break;
    }
  } catch {
    return out;
  }
  return out;
}

/** One project by id, or null when it does not exist or RLS hides it. */
export async function fetchProject(
  supabase: SupabaseTyped,
  id: number,
): Promise<ProjectRecord | null> {
  try {
    const canSeeBudgets = await canReadBudgets(supabase);
    const budgets = await fetchBudgets(supabase, canSeeBudgets);
    const { data } = await timeSchema(supabase)
      .from("project")
      .select(projectSelect(canSeeBudgets))
      .eq("id", id)
      .maybeSingle();

    if (!data) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = data as any;
    return {
      id: num(r.id),
      name: r.name ?? "Untitled",
      code: r.code ?? null,
      customerId: numOrNull(r.customer_id),
      customerName: r.customer?.name ?? null,
      serviceName: r.service?.name ?? null,
      estimatedHours: budgets.get(num(r.id)) ?? null,
      isBillable: Boolean(r.is_billable),
      isArchived: Boolean(r.is_archived),
    };
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------- aggregation */

export type ProjectListRow = ProjectRecord & {
  actualHours: number;
  billableHours: number;
  entryCount: number;
  memberCount: number;
  /** ISO date of the most recent entry, or null when nothing was ever logged. */
  lastActivity: string | null;
  /** null when no estimate was set — never 0, which would read as "on budget". */
  burnPercent: number | null;
  remainingHours: number | null;
  isOver: boolean;
};

/**
 * Fold entries into per-project totals.
 *
 * A project with no entries is KEPT, at zero. It is a real project someone
 * created and it belongs in the list; silently dropping it would make the count
 * disagree with TrackingTime's own project count for no visible reason.
 *
 * `burnPercent` is null rather than 0 when no estimate exists. 83 of 334 live
 * projects carry `estimated_hours = 0`, meaning "nobody set a budget" — showing
 * those as 0% would sort them alongside genuinely untouched projects and bury
 * the overruns. The distinction between "0% burned" and "no budget to burn" is
 * the whole point of the column.
 */
export function summariseProjects(
  projects: ProjectRecord[],
  entries: ReportEntry[],
): ProjectListRow[] {
  const seconds = new Map<number, number>();
  const billable = new Map<number, number>();
  const counts = new Map<number, number>();
  const members = new Map<number, Set<number>>();
  const last = new Map<number, string>();

  // Same rule as the Overview (overview-live.ts) and the week popup: nothing
  // dated after now() is logged time. fetchAllEntries bounds at the END of
  // today, so an entry pre-logged for later today would otherwise count
  // here and not on the Overview -- two pages, two answers.
  const nowIso = new Date().toISOString();
  for (const e of entries) {
    if (e.projectId === null) continue;
    if (e.startedAt > nowIso) continue;
    const id = e.projectId;
    seconds.set(id, (seconds.get(id) ?? 0) + e.durationSeconds);
    if (e.isBillable) billable.set(id, (billable.get(id) ?? 0) + e.durationSeconds);
    counts.set(id, (counts.get(id) ?? 0) + 1);
    if (!members.has(id)) members.set(id, new Set());
    members.get(id)!.add(e.memberId);
    const prev = last.get(id);
    if (!prev || e.startedAt > prev) last.set(id, e.startedAt);
  }

  return projects.map((p) => {
    const actualHours = secondsToHours(seconds.get(p.id) ?? 0);
    const est = p.estimatedHours;
    const hasBudget = est !== null && est > 0;
    return {
      ...p,
      actualHours,
      billableHours: secondsToHours(billable.get(p.id) ?? 0),
      entryCount: counts.get(p.id) ?? 0,
      memberCount: members.get(p.id)?.size ?? 0,
      lastActivity: last.get(p.id)?.slice(0, 10) ?? null,
      burnPercent: hasBudget ? Math.round((actualHours / est) * 1000) / 10 : null,
      // Negative on purpose: "-12h" IS the overrun, and clamping it to zero
      // hides the one number a project lead needs.
      remainingHours: hasBudget ? Math.round((est - actualHours) * 10) / 10 : null,
      isOver: hasBudget ? actualHours > est : false,
    };
  });
}

export type ProjectSort = "burn" | "hours" | "name" | "recent";

/**
 * Sort a project list.
 *
 * "burn" puts projects WITHOUT a budget last rather than first. They sort as
 * null, and a naive numeric compare would treat null as 0 and float 83 unbudgeted
 * projects above a project at 140% — inverting the exact signal the sort exists
 * to surface.
 */
export function sortProjects(rows: ProjectListRow[], sort: ProjectSort): ProjectListRow[] {
  const out = [...rows];
  switch (sort) {
    case "burn":
      return out.sort((a, b) => {
        if (a.burnPercent === null && b.burnPercent === null) return a.name.localeCompare(b.name);
        if (a.burnPercent === null) return 1;
        if (b.burnPercent === null) return -1;
        return b.burnPercent - a.burnPercent;
      });
    case "hours":
      return out.sort((a, b) => b.actualHours - a.actualHours);
    case "recent":
      return out.sort((a, b) => {
        if (!a.lastActivity && !b.lastActivity) return a.name.localeCompare(b.name);
        if (!a.lastActivity) return 1;
        if (!b.lastActivity) return -1;
        return b.lastActivity.localeCompare(a.lastActivity);
      });
    case "name":
    default:
      return out.sort((a, b) => a.name.localeCompare(b.name));
  }
}

/* -------------------------------------------------------------- burndown */

export type BurnPoint = {
  /** ISO date (YYYY-MM-DD) of the bucket start. */
  date: string;
  label: string;
  /** Hours logged in this bucket alone. */
  hours: number;
  /** Running total from the first entry to the end of this bucket. */
  cumulativeHours: number;
};

/**
 * Cumulative hours per month for one project.
 *
 * WHY MONTHS, AND WHY DERIVED FROM THE ENTRIES
 * --------------------------------------------
 * `time.project` has NO start_date or due_date — verified against the DDL, the
 * vendor simply does not send them. So there is no contractual window to plot
 * against, and a burn-down chart with an invented timeline would be fiction
 * (which is exactly what the legacy /projects page draws: a hardcoded SVG
 * polyline with "SIGNED 12 JAN · PLANNED END 30 SEP" baked into the markup).
 *
 * What IS real is when work actually happened. This returns the observed
 * cumulative curve from first entry to last, monthly. The estimate is rendered
 * as a horizontal reference line by the UI, not as a planned trajectory, because
 * a trajectory would require a start and end date we do not have.
 *
 * Buckets are UTC. `new Date(y, m, d)` builds a LOCAL date, so a Berlin server
 * would file an entry logged at 23:30 on the 31st into the following month.
 */
export function burndown(entries: ReportEntry[]): BurnPoint[] {
  if (!entries.length) return [];

  const byMonth = new Map<string, number>();
  for (const e of entries) {
    const key = e.startedAt.slice(0, 7); // YYYY-MM
    byMonth.set(key, (byMonth.get(key) ?? 0) + e.durationSeconds);
  }

  const keys = [...byMonth.keys()].sort();
  const first = keys[0];
  const lastKey = keys[keys.length - 1];

  // Fill the gaps. A month with no logged time is a real fact about a project
  // (it stalled), and omitting it would compress the x-axis and make a
  // six-month gap look like one continuous month of work.
  const out: BurnPoint[] = [];
  let running = 0;
  const cursor = new Date(`${first}-01T00:00:00.000Z`);
  const end = new Date(`${lastKey}-01T00:00:00.000Z`);

  while (cursor <= end) {
    const key = cursor.toISOString().slice(0, 7);
    const hours = secondsToHours(byMonth.get(key) ?? 0);
    running = Math.round((running + hours) * 10) / 10;
    out.push({
      date: `${key}-01`,
      label: cursor.toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" }),
      hours,
      cumulativeHours: running,
    });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  return out;
}

/* ---------------------------------------------------------------- detail */

export type ProjectContributor = {
  memberId: number;
  memberName: string;
  hours: number;
  billableHours: number;
  entryCount: number;
};

export type ProjectTaskRow = {
  taskName: string;
  hours: number;
  entryCount: number;
};

/** Who worked on it, most hours first. */
export function contributors(entries: ReportEntry[]): ProjectContributor[] {
  const map = new Map<number, ProjectContributor>();
  for (const e of entries) {
    let row = map.get(e.memberId);
    if (!row) {
      row = { memberId: e.memberId, memberName: e.memberName, hours: 0, billableHours: 0, entryCount: 0 };
      map.set(e.memberId, row);
    }
    row.hours += e.durationSeconds;
    if (e.isBillable) row.billableHours += e.durationSeconds;
    row.entryCount++;
  }
  return [...map.values()]
    .map((r) => ({
      ...r,
      hours: secondsToHours(r.hours),
      billableHours: secondsToHours(r.billableHours),
    }))
    .sort((a, b) => b.hours - a.hours);
}

/**
 * Hours per task within a project.
 *
 * Entries with no task are folded into a single "(no task)" row rather than
 * dropped. On live data a large share of time carries no task, and silently
 * omitting it would make the task breakdown disagree with the project total —
 * the classic "the numbers don't add up" bug that destroys trust in a report.
 */
export function taskBreakdown(entries: ReportEntry[]): ProjectTaskRow[] {
  const map = new Map<string, { hours: number; entryCount: number }>();
  for (const e of entries) {
    const key = e.taskName?.trim() || "(no task)";
    const row = map.get(key) ?? { hours: 0, entryCount: 0 };
    row.hours += e.durationSeconds;
    row.entryCount++;
    map.set(key, row);
  }
  return [...map.entries()]
    .map(([taskName, r]) => ({ taskName, hours: secondsToHours(r.hours), entryCount: r.entryCount }))
    .sort((a, b) => b.hours - a.hours);
}

/**
 * The widest sensible date window: from before any TrackingTime data exists to
 * today. Used when a page wants "all time" without the caller inventing dates.
 *
 * The lower bound is 2000-01-01 rather than a computed minimum because finding
 * the true minimum needs an extra round trip to answer a question no user asked.
 */
export function allTimeFilters(overrides: Partial<TimeFilters> = {}): TimeFilters {
  return {
    from: "2000-01-01",
    to: new Date().toISOString().slice(0, 10),
    memberIds: [],
    projectIds: [],
    customerIds: [],
    serviceIds: [],
    billable: null,
    // Calendar entries ARE included here. On a project page the question is
    // "how much time did this project consume", and a meeting about the project
    // consumed it. The dashboard excludes them because it reports billable
    // ratios, where a 40%-of-hours block that is 63% non-billable skews the
    // headline. (Measured; the 34%/98% previously quoted here was both stale
    // and, in the 98%, wrong by enough to change the argument.)
    includeCalendar: true,
    ...overrides,
  };
}

/** Everything the project detail page needs, in one call. */
export async function getProjectOverview(supabase: SupabaseTyped, id: number) {
  const project = await fetchProject(supabase, id);
  if (!project) return null;

  const { entries, truncated } = await fetchAllEntries(
    supabase,
    allTimeFilters({ projectIds: [id] }),
  );

  const totalSeconds = entries.reduce((s, e) => s + e.durationSeconds, 0);
  const billableSeconds = entries.reduce((s, e) => s + (e.isBillable ? e.durationSeconds : 0), 0);
  const actualHours = secondsToHours(totalSeconds);
  const est = project.estimatedHours;
  const hasBudget = est !== null && est > 0;

  return {
    project,
    truncated,
    totals: {
      actualHours,
      billableHours: secondsToHours(billableSeconds),
      entryCount: entries.length,
      burnPercent: hasBudget ? Math.round((actualHours / est) * 1000) / 10 : null,
      remainingHours: hasBudget ? Math.round((est - actualHours) * 10) / 10 : null,
      isOver: hasBudget ? actualHours > est : false,
      firstEntry: entries.length ? entries[entries.length - 1].startedAt.slice(0, 10) : null,
      lastEntry: entries.length ? entries[0].startedAt.slice(0, 10) : null,
    },
    burn: burndown(entries),
    contributors: contributors(entries),
    tasks: taskBreakdown(entries),
  };
}

/* -------------------------------------------------- customer rank by month */

export type CustomerRankSeries = {
  name: string;
  /** 1 = top customer that month; null = outside the top N that month. */
  ranks: (number | null)[];
  /** Hours this customer logged in each month, top-N or not. */
  hoursByMonth: number[];
};

export type CustomerRankByMonth = {
  /** Month labels, e.g. ["JAN", ..., "AUG"]. Year-suffixed only if spanning years. */
  labels: string[];
  series: CustomerRankSeries[];
};

/**
 * Rank customers per calendar month by hours, top `topN` lanes.
 *
 * WHY IT REUSES THE PAGE'S ENTRIES
 * --------------------------------
 * getProjectList already fetches every entry once (allTimeFilters, calendar
 * INCLUDED — this page's convention, see the comment on allTimeFilters). A
 * separate query would re-page ~5,000 rows to answer a question this array
 * already answers, so this is a pure fold over what is in hand.
 *
 * Months run from the first entry to the CURRENT month only: allTimeFilters
 * caps `to` at today, so later months would be all-null lanes — an empty
 * right half that reads as "everyone stopped" rather than "no data yet".
 * Gap months in between are kept (a customer's rank surviving a quiet month
 * is real signal). Rank is null outside the top N rather than clamped to N,
 * because a lane pinned to the bottom would claim the customer was ranked.
 */
export function customerRankByMonth(entries: ReportEntry[], topN = 6): CustomerRankByMonth {
  // month key (YYYY-MM) -> customer name -> seconds
  const byMonth = new Map<string, Map<string, number>>();
  for (const e of entries) {
    if (!e.customerName) continue;
    const key = e.startedAt.slice(0, 7);
    let m = byMonth.get(key);
    if (!m) {
      m = new Map();
      byMonth.set(key, m);
    }
    m.set(e.customerName, (m.get(e.customerName) ?? 0) + e.durationSeconds);
  }

  if (byMonth.size === 0) return { labels: [], series: [] };

  // First data month .. current month, gaps included. UTC throughout, matching
  // burndown() above (a Berlin-local Date would misfile month boundaries).
  const first = [...byMonth.keys()].sort()[0];
  const nowKey = new Date().toISOString().slice(0, 7);
  const months: string[] = [];
  const cursor = new Date(`${first}-01T00:00:00.000Z`);
  while (cursor.toISOString().slice(0, 7) <= nowKey && months.length < 60) {
    months.push(cursor.toISOString().slice(0, 7));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  const multiYear = new Set(months.map((m) => m.slice(0, 4))).size > 1;
  const labels = months.map((m) => {
    const d = new Date(`${m}-01T00:00:00.000Z`);
    const mon = d.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" }).toUpperCase();
    return multiYear ? `${mon} ${m.slice(2, 4)}` : mon;
  });

  // Per month: sort customers by seconds desc (name asc as a deterministic
  // tiebreak), assign ranks 1..topN.
  const rankByMonth = months.map((m) => {
    const totals = byMonth.get(m);
    if (!totals) return new Map<string, number>();
    const ranked = [...totals.entries()]
      .filter(([, s]) => s > 0)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, topN);
    return new Map(ranked.map(([name], i) => [name, i + 1]));
  });

  // A customer earns a lane by making the top N in ANY month.
  const laneNames = new Set<string>();
  for (const m of rankByMonth) for (const name of m.keys()) laneNames.add(name);

  const series: CustomerRankSeries[] = [...laneNames].map((name) => ({
    name,
    ranks: rankByMonth.map((m) => m.get(name) ?? null),
    hoursByMonth: months.map((m) => secondsToHours(byMonth.get(m)?.get(name) ?? 0)),
  }));

  // Biggest customers first, so callers assigning colours by index give the
  // strongest hue to the lane the eye should find first.
  series.sort(
    (a, b) =>
      b.hoursByMonth.reduce((s, h) => s + h, 0) - a.hoursByMonth.reduce((s, h) => s + h, 0),
  );

  return { labels, series };
}

/* ---------------------------------------------------- customer portfolio */

export type CustomerPortfolioRow = {
  name: string;
  /** All logged hours for this customer across their projects. */
  hours: number;
  /** Billable share of those hours, 0-100, or null when nothing is billable-flagged. */
  billablePercent: number | null;
  /** Share of the whole portfolio's hours, 0-100 (one decimal). */
  sharePercent: number;
  /** Number of this customer's projects that have any logged time. */
  activeProjects: number;
  /**
   * Budgeted hours across this customer's projects that carry an estimate.
   * null when NONE of their projects were budgeted -- capacity is unknowable,
   * not zero.
   */
  committedHours: number | null;
  /**
   * Delivered against committed: committed - delivered on budgeted projects.
   * Positive = budget headroom (capacity still available), negative = overrun
   * (we are delivering beyond what was scoped). null when nothing is budgeted.
   */
  headroomHours: number | null;
  /** Hours logged in the last 60 days vs the 60 before -- recent momentum. */
  recentHours: number;
  priorHours: number;
};

export type CustomerPortfolio = {
  rows: CustomerPortfolioRow[];
  totalHours: number;
  /** Customers with any logged time. */
  customerCount: number;
  /** Cumulative share of the top 5, 0-100 -- the concentration headline. */
  top5SharePercent: number;
};

/**
 * Aggregate the project ledger by CUSTOMER.
 *
 * Answers the two questions the old rank chart could not: WHO are the biggest
 * customers (by delivered hours and share), and WHERE is capacity tight --
 * committed budget against delivered hours per customer, so an overrun (no
 * headroom) reads differently from a customer with budget still to burn.
 *
 * Budget is summed only over a customer's BUDGETED projects: folding a
 * zero-estimate project into "committed" would understate the burn on the ones
 * that were actually scoped. A customer with no budgeted project at all reports
 * committedHours = null (capacity unknowable) rather than 0.
 *
 * recentHours/priorHours need per-entry dates, so this takes the entries too --
 * the same array getProjectList already holds; no extra query.
 */
export function customerPortfolio(
  rows: ProjectListRow[],
  entries: ReportEntry[],
): CustomerPortfolio {
  type Acc = {
    hours: number;
    billableHours: number;
    projects: Set<number>;
    committed: number;
    committedDelivered: number;
    hasBudget: boolean;
  };
  const byCustomer = new Map<string, Acc>();
  const get = (name: string) => {
    let a = byCustomer.get(name);
    if (!a) {
      a = { hours: 0, billableHours: 0, projects: new Set(), committed: 0, committedDelivered: 0, hasBudget: false };
      byCustomer.set(name, a);
    }
    return a;
  };

  for (const p of rows) {
    if (p.actualHours <= 0 && (p.estimatedHours ?? 0) <= 0) continue;
    const name = p.customerName ?? "(no customer)";
    const a = get(name);
    a.hours += p.actualHours;
    a.billableHours += p.billableHours;
    if (p.actualHours > 0) a.projects.add(p.id);
    if (p.estimatedHours !== null && p.estimatedHours > 0) {
      a.committed += p.estimatedHours;
      a.committedDelivered += p.actualHours;
      a.hasBudget = true;
    }
  }

  // Recent vs prior 60-day windows, from entry timestamps.
  const now = Date.now();
  const DAY = 86_400_000;
  const recentCut = now - 60 * DAY;
  const priorCut = now - 120 * DAY;
  const recent = new Map<string, number>();
  const prior = new Map<string, number>();
  for (const e of entries) {
    const name = e.customerName ?? "(no customer)";
    const t = new Date(e.startedAt).getTime();
    if (Number.isNaN(t)) continue;
    if (t >= recentCut) recent.set(name, (recent.get(name) ?? 0) + e.durationSeconds);
    else if (t >= priorCut) prior.set(name, (prior.get(name) ?? 0) + e.durationSeconds);
  }

  const totalHours = [...byCustomer.values()].reduce((s, a) => s + a.hours, 0);

  const out: CustomerPortfolioRow[] = [...byCustomer.entries()]
    .filter(([, a]) => a.hours > 0)
    .map(([name, a]) => ({
      name,
      hours: Math.round(a.hours * 10) / 10,
      billablePercent: a.hours > 0 ? Math.round((a.billableHours / a.hours) * 100) : null,
      sharePercent: totalHours > 0 ? Math.round((a.hours / totalHours) * 1000) / 10 : 0,
      activeProjects: a.projects.size,
      committedHours: a.hasBudget ? Math.round(a.committed * 10) / 10 : null,
      headroomHours: a.hasBudget ? Math.round((a.committed - a.committedDelivered) * 10) / 10 : null,
      recentHours: Math.round(secondsToHours(recent.get(name) ?? 0) * 10) / 10,
      priorHours: Math.round(secondsToHours(prior.get(name) ?? 0) * 10) / 10,
    }))
    .sort((x, y) => y.hours - x.hours);

  const top5SharePercent =
    totalHours > 0
      ? Math.round((out.slice(0, 5).reduce((s, r) => s + r.hours, 0) / totalHours) * 100)
      : 0;

  return {
    rows: out,
    totalHours: Math.round(totalHours * 10) / 10,
    customerCount: out.length,
    top5SharePercent,
  };
}

/** Everything the project list page needs, in one call. */
export async function getProjectList(supabase: SupabaseTyped, sort: ProjectSort = "burn") {
  const [projects, { entries, truncated }] = await Promise.all([
    fetchAllProjects(supabase),
    fetchAllEntries(supabase, allTimeFilters()),
  ]);

  const rows = summariseProjects(projects, entries);
  // Both derived from the SAME entries fetched above — zero extra queries.
  return {
    rows: sortProjects(rows, sort),
    truncated,
    customerPortfolio: customerPortfolio(rows, entries),
  };
}
