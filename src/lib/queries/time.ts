/**
 * Reads for the Time Tracking module (`time` schema).
 *
 * Everything here goes through `supabase.schema("time")`. That is not a style
 * choice: a client pinned to one module cannot reach another module's tables
 * even by a typo in a table name (PLATFORM-ARCHITECTURE.md §2), and it keeps the
 * `time` tables out of the default PostgREST surface.
 *
 * Two rules this file exists to enforce in one place:
 *
 * 1. **Durations are SECONDS.** `time.entry.duration_seconds` is seconds,
 *    `public.timesheet_entries.hours` is hours, and Factorial data is minutes.
 *    Conversion happens exactly once, at the edge of this module, via
 *    `secondsToHours`/`formatSeconds` from `@/lib/time-transform`.
 *
 * 2. **RLS is the access boundary, and "no rows" is a legitimate answer.**
 *    `time.can_view_member()` already restricts what a caller sees, so these
 *    functions never widen a query to compensate. An empty list means "correctly
 *    denied or genuinely empty", never "query is broken".
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { formatSeconds, isoWeekStart, secondsToHours } from "@/lib/time-transform";

/**
 * `time` is a separate Postgres schema and is deliberately absent from
 * database.types.ts, which is generated from `public` only. The generated
 * client therefore rejects `.schema("time")` outright, so the schema handle is
 * narrowed here once instead of scattering casts through every read. The row
 * shapes below carry the type safety that the generated types cannot.
 */
type SupabaseTyped = SupabaseClient<Database>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const timeSchema = (s: SupabaseTyped) => (s as any).schema("time");

/** One row of the day view, already resolved to display names. */
export type TimeEntryRow = {
  id: number;
  memberId: number;
  memberName: string;
  taskName: string | null;
  projectName: string | null;
  customerName: string | null;
  serviceName: string | null;
  startedAt: string;
  endedAt: string | null;
  /** Seconds. Null only while a timer is still running. */
  durationSeconds: number | null;
  /** Formatted "H:MM" for display; "—" while running. */
  duration: string;
  isBillable: boolean;
  isBilled: boolean;
  isCalendar: boolean;
  isRunning: boolean;
  notes: string | null;
};

/** The totals strip above the list. All seconds, converted once for display. */
export type TimeTotals = {
  totalSeconds: number;
  billableSeconds: number;
  calendarSeconds: number;
  entryCount: number;
  totalHours: number;
  billableHours: number;
  /** Billable as a share of logged time, 0-100. Null when nothing is logged. */
  billablePercent: number | null;
};

export type WeekSummaryRow = {
  memberId: number;
  memberName: string;
  weekStart: string;
  totalSeconds: number;
  billableSeconds: number;
  calendarSeconds: number;
  contractedSeconds: number;
  /** Logged against contracted, 0-∞. Null when no contract hours are known. */
  utilisationPercent: number | null;
};

/** What the entry form needs to offer as choices. */
export type TimeLookups = {
  customers: { id: number; name: string }[];
  projects: { id: number; name: string; customerId: number | null; isBillable: boolean }[];
  services: { id: number; name: string; isTravel: boolean; isPaidTravel: boolean }[];
  tasks: { id: number; name: string | null; projectId: number | null }[];
};

/**
 * The module's own view of "who am I".
 *
 * Returns null rather than throwing when the caller has no `time.member` row.
 * That is the normal state for a colleague who has never tracked time, and for
 * everyone until the first import runs, so it has to render as an empty state
 * rather than an error page.
 */
export async function getCurrentMemberId(
  supabase: SupabaseTyped,
): Promise<number | null> {
  try {
    const { data, error } = await timeSchema(supabase).rpc("current_member_id");
    if (error || data === null || data === undefined) return null;
    return typeof data === "number" ? data : Number(data);
  } catch {
    // The `time` schema is not applied to the live database yet. An empty
    // module beats an exception screen while that is still true.
    return null;
  }
}

/** Half-open [start, end) UTC bounds for a single YYYY-MM-DD day. */
function dayBounds(day: string): { from: string; to: string } {
  const from = new Date(`${day}T00:00:00.000Z`);
  const to = new Date(from.getTime() + 86_400_000);
  return { from: from.toISOString(), to: to.toISOString() };
}

/** Half-open [start, end) UTC bounds for the ISO week starting `weekStart`. */
function weekBounds(weekStart: string): { from: string; to: string } {
  const from = new Date(`${weekStart}T00:00:00.000Z`);
  const to = new Date(from.getTime() + 7 * 86_400_000);
  return { from: from.toISOString(), to: to.toISOString() };
}

/**
 * The embedded-relation shape PostgREST returns for the select below.
 *
 * Each FK embed comes back as an object or null, never an array, because every
 * one of these is a many-to-one. Typing it explicitly rather than trusting
 * inference keeps a column rename from silently degrading to `any`.
 */
type EntryJoinRow = {
  id: number;
  member_id: number;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  is_billable: boolean;
  is_billed: boolean;
  is_calendar: boolean;
  notes: string | null;
  member: { display_name: string } | null;
  task: { name: string | null } | null;
  project: { name: string } | null;
  customer: { name: string } | null;
  service: { name: string } | null;
};

const ENTRY_SELECT = `
  id, member_id, started_at, ended_at, duration_seconds,
  is_billable, is_billed, is_calendar, notes,
  member:member_id ( display_name ),
  task:task_id ( name ),
  project:project_id ( name ),
  customer:customer_id ( name ),
  service:service_id ( name )
`;

function toRow(e: EntryJoinRow): TimeEntryRow {
  const isRunning = e.ended_at === null;
  return {
    id: e.id,
    memberId: e.member_id,
    memberName: e.member?.display_name ?? "Unknown",
    taskName: e.task?.name ?? null,
    projectName: e.project?.name ?? null,
    customerName: e.customer?.name ?? null,
    serviceName: e.service?.name ?? null,
    startedAt: e.started_at,
    endedAt: e.ended_at,
    durationSeconds: e.duration_seconds,
    // A running timer has no duration yet. Showing "0:00" would read as "you
    // logged nothing", which is the opposite of what is happening.
    duration: isRunning ? "—" : formatSeconds(e.duration_seconds ?? 0),
    isBillable: e.is_billable,
    isBilled: e.is_billed,
    isCalendar: e.is_calendar,
    isRunning,
    notes: e.notes,
  };
}

/**
 * Entries overlapping a single day, newest first.
 *
 * Filtered on `started_at` in a half-open UTC range. Using `gte`/`lt` rather
 * than a `date()` cast matters twice over: the cast cannot use
 * `time_entry_started_idx`, and `lte` on the next midnight would double-count
 * an entry that starts exactly at 00:00:00.
 */
export async function getEntriesForDay(
  supabase: SupabaseTyped,
  day: string,
  opts: { memberId?: number | null } = {},
): Promise<TimeEntryRow[]> {
  const { from, to } = dayBounds(day);

  try {
    let query = timeSchema(supabase)
      .from("entry")
      .select(ENTRY_SELECT)
      .gte("started_at", from)
      .lt("started_at", to)
      .order("started_at", { ascending: false });

    // Only narrow when a member was actually requested. `undefined` means "every
    // member RLS allows"; a null memberId would otherwise become
    // `member_id=is.null` and silently match nothing.
    if (opts.memberId != null) query = query.eq("member_id", opts.memberId);

    const { data, error } = await query;
    if (error || !data) return [];
    return (data as EntryJoinRow[]).map(toRow);
  } catch {
    return [];
  }
}

/** Every entry in an ISO week, newest first. Same filtering rules as the day view. */
export async function getEntriesForWeek(
  supabase: SupabaseTyped,
  weekStart: string,
  opts: { memberId?: number | null } = {},
): Promise<TimeEntryRow[]> {
  const { from, to } = weekBounds(weekStart);

  try {
    let query = timeSchema(supabase)
      .from("entry")
      .select(ENTRY_SELECT)
      .gte("started_at", from)
      .lt("started_at", to)
      .order("started_at", { ascending: false })
      .limit(500);

    if (opts.memberId != null) query = query.eq("member_id", opts.memberId);

    const { data, error } = await query;
    if (error || !data) return [];
    return (data as EntryJoinRow[]).map(toRow);
  } catch {
    return [];
  }
}

/**
 * The entry currently running for this member, if any.
 *
 * A running entry is one with no `ended_at`. The database enforces at most one
 * per member with a partial unique index, so this is a lookup rather than a
 * "take the newest and hope" heuristic.
 */
export async function getRunningEntry(
  supabase: SupabaseTyped,
  memberId: number,
): Promise<TimeEntryRow | null> {
  try {
    const { data, error } = await timeSchema(supabase)
      .from("entry")
      .select(ENTRY_SELECT)
      .eq("member_id", memberId)
      .is("ended_at", null)
      .limit(1)
      .maybeSingle();

    if (error || !data) return null;
    return toRow(data as EntryJoinRow);
  } catch {
    return null;
  }
}

/**
 * Totals for a set of entries.
 *
 * Calendar time is reported alongside the total rather than folded into it. A
 * third of tracked time in this account is calendar-sourced GHOST time, so
 * letting it inflate a utilisation figure silently would make that number
 * meaningless — the split has to stay visible for the total to mean anything.
 */
export function summariseEntries(entries: TimeEntryRow[]): TimeTotals {
  let totalSeconds = 0;
  let billableSeconds = 0;
  let calendarSeconds = 0;

  for (const e of entries) {
    const s = e.durationSeconds ?? 0;
    totalSeconds += s;
    if (e.isBillable) billableSeconds += s;
    if (e.isCalendar) calendarSeconds += s;
  }

  return {
    totalSeconds,
    billableSeconds,
    calendarSeconds,
    entryCount: entries.length,
    totalHours: secondsToHours(totalSeconds),
    billableHours: secondsToHours(billableSeconds),
    // Null rather than 0 when nothing is logged: "0% billable" is a claim about
    // a week's work, "no data" is not.
    billablePercent: totalSeconds > 0 ? Math.round((billableSeconds / totalSeconds) * 100) : null,
  };
}

/**
 * Per-member weekly figures from `time.week_summary`.
 *
 * The view is `security_invoker`, so RLS still applies and a colleague sees
 * only their own row. Reading the view rather than aggregating here keeps the
 * contracted-hours denominator in one place.
 */
export async function getWeekSummary(
  supabase: SupabaseTyped,
  weekStart: string,
): Promise<WeekSummaryRow[]> {
  try {
    const { data, error } = await timeSchema(supabase)
      .from("week_summary")
      .select(
        "member_id, display_name, week_start, total_seconds, billable_seconds, calendar_seconds, contracted_seconds",
      )
      .eq("week_start", weekStart)
      .order("total_seconds", { ascending: false });

    if (error || !data) return [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data as any[]).map((r) => {
      const contracted = Number(r.contracted_seconds) || 0;
      const total = Number(r.total_seconds) || 0;
      return {
        memberId: Number(r.member_id),
        memberName: r.display_name ?? "Unknown",
        weekStart: r.week_start,
        totalSeconds: total,
        billableSeconds: Number(r.billable_seconds) || 0,
        calendarSeconds: Number(r.calendar_seconds) || 0,
        contractedSeconds: contracted,
        utilisationPercent: contracted > 0 ? Math.round((total / contracted) * 100) : null,
      };
    });
  } catch {
    return [];
  }
}

/** Customers, projects, services and tasks for the entry form's pickers. */
export async function getTimeLookups(supabase: SupabaseTyped): Promise<TimeLookups> {
  const empty: TimeLookups = { customers: [], projects: [], services: [], tasks: [] };

  try {
    const [customers, projects, services, tasks] = await Promise.all([
      timeSchema(supabase).from("customer").select("id, name").eq("is_archived", false).order("name"),
      timeSchema(supabase)
        .from("project")
        .select("id, name, customer_id, is_billable")
        .eq("is_archived", false)
        .order("name"),
      timeSchema(supabase)
        .from("service")
        .select("id, name, is_travel, is_paid_travel")
        .eq("is_active", true)
        .order("sort_order"),
      timeSchema(supabase)
        .from("task")
        .select("id, name, project_id")
        .eq("is_archived", false)
        // GHOST tasks are calendar placeholders, not things a person picks.
        .eq("task_type", "PERSONAL")
        .order("name")
        .limit(1000),
    ]);

    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      customers: ((customers.data as any[]) ?? []).map((c) => ({ id: c.id, name: c.name })),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      projects: ((projects.data as any[]) ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        customerId: p.customer_id,
        isBillable: p.is_billable,
      })),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      services: ((services.data as any[]) ?? []).map((s) => ({
        id: s.id,
        name: s.name,
        isTravel: s.is_travel,
        isPaidTravel: s.is_paid_travel,
      })),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tasks: ((tasks.data as any[]) ?? []).map((t) => ({
        id: t.id,
        name: t.name,
        projectId: t.project_id,
      })),
    };
  } catch {
    return empty;
  }
}

/** Today in UTC, as YYYY-MM-DD. */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Monday of the current ISO week, as YYYY-MM-DD. */
export function currentTimeWeek(): string {
  return isoWeekStart(new Date());
}

/**
 * The Monday of the ISO week containing a YYYY-MM-DD day.
 *
 * Delegates to isoWeekStart() rather than repeating the arithmetic: the Sunday
 * case (getUTCDay() === 0 belongs to the *previous* week) is the one everybody
 * gets wrong, and having it in two places means having it wrong in one of them.
 */
export function weekStartFor(day: string): string {
  return isoWeekStart(new Date(`${day}T00:00:00.000Z`));
}

/** Shift a YYYY-MM-DD day by n days. */
export function shiftDay(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Shift a YYYY-MM-DD week start by n weeks. */
export function shiftWeek(weekStart: string, weeks: number): string {
  return shiftDay(weekStart, weeks * 7);
}

/** Group a week's entries by calendar day, Monday first. */
export function groupByDay(
  entries: TimeEntryRow[],
  weekStart: string,
): { date: string; entries: TimeEntryRow[]; totalSeconds: number }[] {
  const days: { date: string; entries: TimeEntryRow[]; totalSeconds: number }[] = [];

  for (let i = 0; i < 7; i++) {
    const d = new Date(`${weekStart}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + i);
    days.push({ date: d.toISOString().slice(0, 10), entries: [], totalSeconds: 0 });
  }

  const byDate = new Map(days.map((d) => [d.date, d]));
  for (const e of entries) {
    const day = byDate.get(e.startedAt.slice(0, 10));
    if (!day) continue;
    day.entries.push(e);
    day.totalSeconds += e.durationSeconds ?? 0;
  }

  return days;
}
