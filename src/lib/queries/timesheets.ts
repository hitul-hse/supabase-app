/**
 * The Hub's own weekly timesheet grid — reads for /timesheets.
 *
 * WHY THIS FILE EXISTS, given getTimesheetEntries used to live in queries/hse.ts.
 *
 * public.timesheet_entries held 28 rows and all 28 were mockup data: one seeded,
 * inactive person ('emp-1' / 'Anna Brandt', source='seed'), no linked account,
 * project_id NULL on every row with free-text project names matching no project
 * in either time.project or public.projects, one week, all already 'approved'.
 * They are deleted — see supabase/migrations/delete_mockup_timesheet_rows.sql for
 * the full evidence and for why the fix was to remove the rows rather than to
 * repoint this page at time.entry.
 *
 * The short version of that reasoning, because it is the question a reader will
 * have: /timesheets is not a reporting surface wired to the wrong table. It is an
 * editable grid with a real write path — insert, submit, withdraw, lead
 * approve/reject, copy-last-week, running timer — all against this table and all
 * governed by its six RLS policies. time.entry is a read-only import of
 * TrackingTime in seconds, already rendered by /time next door, which RecordsTabs
 * deliberately presents as the sibling view. Repointing would have deleted a
 * working feature and shown the same hours twice.
 *
 * So the table stays and the fiction goes. What the module adds beyond the move
 * is the distinction the old function could not express: it returned `[]` both
 * for "this week is empty" and for "your account has no linked person", and the
 * grid rendered the same "no entries yet" sentence for both. The second is not an
 * empty week, it is a broken account — the Add-entry button cannot work, and
 * telling somebody to use it is a dead end. The result type below makes the
 * caller handle them separately.
 */
import type { SupabaseTyped, TimesheetDayEntry } from "@/lib/queries/types";

/** Monday of the current ISO week, YYYY-MM-DD — matches Postgres's date_trunc('week', now()). */
export function currentWeekStart(): string {
  const now = new Date();
  const isoDayOfWeek = (now.getUTCDay() + 6) % 7; // Mon=0 .. Sun=6
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() - isoDayOfWeek);
  return monday.toISOString().slice(0, 10);
}

/** Monday of the week `deltaWeeks` from the given week_start (negative = earlier). */
export function shiftWeekStart(weekStart: string, deltaWeeks: number): string {
  const d = new Date(`${weekStart}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaWeeks * 7);
  return d.toISOString().slice(0, 10);
}

/**
 * Why a discriminated union rather than `TimesheetDayEntry[]`.
 *
 * "no-person" is a different fact from an empty week and needs different words on
 * screen. Returning a bare array forces the page to guess, and the guess it made
 * was the wrong one: it invited an employee with no linked person to click a
 * button whose server action returns "No linked person profile" every time.
 */
export type TimesheetWeek =
  | { state: "no-person"; entries: [] }
  | { state: "ok"; entries: TimesheetDayEntry[] };

/**
 * The caller's OWN timesheet rows for one week, grouped back into one row per
 * task with a 7-day hours array.
 *
 * Scoped explicitly to the caller's person_id rather than leaning on RLS alone.
 * RLS is can_view_person(), so an exec may legitimately SELECT everybody's rows —
 * but this page is "my timesheet", and grouping by entry_group without a person
 * filter would merge two people's rows together whenever their entry_group
 * numbers collide.
 */
export async function getTimesheetWeek(
  supabase: SupabaseTyped,
  weekStart: string = currentWeekStart(),
): Promise<TimesheetWeek> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { state: "no-person", entries: [] };

  const { data: profile } = await supabase
    .from("app_user_profile")
    .select("person_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!profile?.person_id) return { state: "no-person", entries: [] };

  const { data } = await supabase
    .from("timesheet_entries")
    .select("*")
    .eq("person_id", profile.person_id)
    .eq("week_start", weekStart)
    .order("entry_group")
    .order("day_of_week");

  const byGroup = new Map<number, TimesheetDayEntry>();

  for (const row of data ?? []) {
    if (!byGroup.has(row.entry_group)) {
      byGroup.set(row.entry_group, {
        entryGroup: row.entry_group,
        taskName: row.task_name,
        projectName: row.project_name,
        isBillable: row.is_billable,
        customer: row.customer,
        warning: row.warning,
        status: row.status,
        rejectionNote: row.rejection_note ?? null,
        hours: [0, 0, 0, 0, 0, 0, 0],
        dayRowIds: [null, null, null, null, null, null, null],
      });
    }
    const group = byGroup.get(row.entry_group)!;
    group.hours[row.day_of_week] = Number(row.hours);
    group.dayRowIds[row.day_of_week] = row.id;
  }

  return { state: "ok", entries: Array.from(byGroup.values()) };
}
