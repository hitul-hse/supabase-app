import type {
  SupabaseTyped,
  SyncSourceRow,
  ExecutiveMetricRow,
  WeeklyTrendRow,
  TeamUtilisationRow,
  ProjectRow,
  ProjectDetail,
  ProjectTaskRow,
  PersonProfile,
  ApprovalDecisionRow,
  TeamLeadBooking,
  TimesheetDayEntry,
  PendingTimesheetWeek,
  OrgChartNode,
  TaskComment,
  LeaveRequestRow,
  LeaveBalanceRow,
  LeaveRequestWithPerson,
  BillableTrend,
  WeeklyBillableTrendRow,
} from "./types";

/** Sync status strip shown at the top of every HSE Hub page. */
export async function getSyncSources(supabase: SupabaseTyped): Promise<SyncSourceRow[]> {
  const { data } = await supabase.from("sync_sources").select("*").order("sort_order");
  return data ?? [];
}

/** Metric cards, weekly billable/non-billable trend, and team utilisation for the Overview page. */
export async function getExecutiveOverview(supabase: SupabaseTyped): Promise<{
  metrics: ExecutiveMetricRow[];
  billableTrend: BillableTrend;
  teamUtilisations: TeamUtilisationRow[];
  projects: ProjectRow[];
}> {
  const [
    { data: metrics },
    { data: syncedTrend },
    { data: seededTrend },
    { data: teamUtilisations },
    { data: projects },
  ] = await Promise.all([
    supabase.from("executive_metrics").select("*").order("sort_order"),
    // Real Factorial/TrackingTime figures, once the sync has run at least once.
    supabase
      .from("weekly_billable_trend")
      .select("*")
      .order("period_start")
      .limit(WEEKS_ON_TREND_CHART),
    supabase.from("weekly_trends").select("*").order("sort_order"),
    supabase.from("team_utilisations").select("*").order("sort_order"),
    supabase.from("projects").select("*").order("id"),
  ]);

  return {
    metrics: metrics ?? [],
    billableTrend: buildBillableTrend(syncedTrend ?? [], seededTrend ?? []),
    teamUtilisations: teamUtilisations ?? [],
    projects: projects ?? [],
  };
}

const WEEKS_ON_TREND_CHART = 12;

/**
 * Prefer synced data, fall back to the seeded rows, and say which it is.
 *
 * The fallback exists so the page still demonstrates its layout before the
 * first sync, but the caller is told the numbers are sample data so it can
 * label them. Silently swapping invented figures in where real ones are
 * expected is the failure mode worth avoiding on a page people read to make
 * decisions.
 */
function buildBillableTrend(
  synced: WeeklyBillableTrendRow[],
  seeded: WeeklyTrendRow[],
): BillableTrend {
  if (synced.length > 0) {
    return {
      source: "synced",
      points: synced.map((row) => ({
        // Weeks are identified by their Monday, which is what the report
        // period is keyed on upstream.
        label: formatWeekLabel(row.period_start),
        billableHours: Number(row.billable_hours ?? 0),
        nonBillableHours: Number(row.non_billable_hours ?? 0),
        isOpen: false,
      })),
    };
  }

  return {
    source: "sample",
    points: seeded.map((row) => ({
      label: row.week,
      // The seeded table stores hours directly.
      billableHours: Number(row.billable_hours),
      nonBillableHours: Number(row.non_billable_hours),
      isOpen: row.is_open,
    })),
  };
}

/** "2026-08-03" -> "W32". ISO week, so it lines up with how the team refers to weeks. */
function formatWeekLabel(periodStart: string | null): string {
  if (!periodStart) return "—";
  const date = new Date(`${periodStart}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return "—";

  // ISO-8601: a week belongs to the year containing its Thursday, and week 1
  // is the week containing 4 January. Compare this week's Thursday against
  // that week's Thursday, so both sides are the same weekday and the gap is a
  // whole number of weeks.
  const thursday = thursdayOf(date);
  const jan4 = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
  const firstThursday = thursdayOf(jan4);
  const week =
    1 + Math.round((thursday.getTime() - firstThursday.getTime()) / 604800000);
  return `W${week}`;
}

/** The Thursday of the ISO week containing `date`. */
function thursdayOf(date: Date): Date {
  const result = new Date(date);
  // (day + 6) % 7 maps Monday to 0 ... Sunday to 6.
  result.setUTCDate(result.getUTCDate() + 3 - ((date.getUTCDay() + 6) % 7));
  return result;
}

/**
 * Nests subtasks (project_tasks rows with parent_task_id set) under their
 * parent, one level deep -- Asana doesn't nest subtasks of subtasks either,
 * so a flat child list per top-level task is enough.
 */
function nestTasks(tasks: ProjectTaskRow[]) {
  const byParent = new Map<number, ProjectTaskRow[]>();
  for (const task of tasks) {
    if (task.parent_task_id == null) continue;
    const siblings = byParent.get(task.parent_task_id) ?? [];
    siblings.push(task);
    byParent.set(task.parent_task_id, siblings);
  }
  return tasks
    .filter((task) => task.parent_task_id == null)
    .map((task) => ({ ...task, subtasks: byParent.get(task.id) ?? [] }));
}

/** Single project with its timeline and task breakdown, for the Projects page. */
export async function getProjectDetail(
  supabase: SupabaseTyped,
  id: string,
): Promise<ProjectDetail | null> {
  const { data } = await supabase
    .from("projects")
    .select("*, project_timeline(*), project_tasks(*)")
    .eq("id", id)
    .order("sort_order", { referencedTable: "project_timeline" })
    .order("sort_order", { referencedTable: "project_tasks" })
    .single();

  if (!data) return null;
  return { ...data, project_tasks: nestTasks(data.project_tasks) };
}

/**
 * Comments for a set of tasks, grouped by task_id. Author names are resolved
 * via user_display_names (a deliberate RLS-bypass view, same reasoning as
 * org_chart_nodes below): app_user_profile's own policy only lets you read
 * your own row (or every row if you're exec), so without it you could see
 * that a comment exists but not who wrote it unless you happened to be exec.
 */
export async function getTaskComments(
  supabase: SupabaseTyped,
  taskIds: number[],
): Promise<Map<number, TaskComment[]>> {
  const byTask = new Map<number, TaskComment[]>();
  if (taskIds.length === 0) return byTask;

  const { data: comments } = await supabase
    .from("task_comments")
    .select("*")
    .in("task_id", taskIds)
    .order("created_at");

  if (!comments || comments.length === 0) return byTask;

  const authorIds = [...new Set(comments.map((c) => c.author_id))];
  const { data: names } = await supabase
    .from("user_display_names")
    .select("*")
    .in("user_id", authorIds);

  const nameByUserId = new Map((names ?? []).map((n) => [n.user_id, n.display_name]));

  for (const c of comments) {
    if (!byTask.has(c.task_id)) byTask.set(c.task_id, []);
    byTask.get(c.task_id)!.push({
      id: c.id,
      taskId: c.task_id,
      authorId: c.author_id,
      authorName: nameByUserId.get(c.author_id) ?? "Team member",
      body: c.body,
      createdAt: c.created_at,
    });
  }

  return byTask;
}

/**
 * Company-wide org chart nodes. Reads org_chart_nodes, not `people` directly --
 * that view deliberately bypasses can_view_person() so every employee sees the
 * whole reporting line, not just their own row (see supabase/schema.sql for why
 * that's safe: only identity/reporting-line columns are exposed).
 */
export async function getOrgChart(supabase: SupabaseTyped): Promise<OrgChartNode[]> {
  const { data } = await supabase.from("org_chart_nodes").select("*").order("id");

  return (data ?? [])
    .filter((row): row is typeof row & { id: string; name: string } => row.id !== null && row.name !== null)
    .map((row) => ({
      id: row.id,
      name: row.name,
      role: row.role,
      department: row.department,
      managerId: row.manager_id,
    }));
}

/**
 * Real, derived holiday balances and leave history for every person the
 * caller can see (RLS: can_view_person), keyed by person_id. The People page
 * selects a person entirely client-side, so this fetches everything visible
 * up front rather than the selected person's data. Balances come from the
 * leave_balances view rather than the static people.holiday_left column --
 * see supabase/schema.sql for why that column can't be trusted.
 */
export async function getLeaveOverview(supabase: SupabaseTyped): Promise<{
  balances: Record<string, LeaveBalanceRow>;
  requestsByPerson: Record<string, LeaveRequestRow[]>;
}> {
  const [{ data: balances }, { data: requests }] = await Promise.all([
    supabase.from("leave_balances").select("*"),
    supabase.from("leave_requests").select("*").order("requested_at", { ascending: false }),
  ]);

  const balanceByPerson: Record<string, LeaveBalanceRow> = {};
  for (const b of balances ?? []) {
    if (b.person_id) balanceByPerson[b.person_id] = b;
  }

  const requestsByPerson: Record<string, LeaveRequestRow[]> = {};
  for (const r of requests ?? []) {
    (requestsByPerson[r.person_id] ??= []).push(r);
  }

  return { balances: balanceByPerson, requestsByPerson };
}

/**
 * Pending leave requests a lead can act on. RLS (can_view_person) already
 * scopes this to whoever the caller is allowed to see, same as
 * getPendingTimesheetApprovals above.
 */
export async function getPendingLeaveApprovals(
  supabase: SupabaseTyped,
): Promise<LeaveRequestWithPerson[]> {
  const { data } = await supabase
    .from("leave_requests")
    .select("*, people(name)")
    .eq("status", "pending")
    .order("requested_at");

  return (data ?? []).map(({ people, ...row }) => ({
    ...row,
    personName: people?.name ?? row.person_id,
  }));
}

/** Full people directory with each person's assignments and qualifications, for the People page. */
export async function getPeopleDirectory(supabase: SupabaseTyped): Promise<PersonProfile[]> {
  const { data } = await supabase
    .from("people")
    .select("*, person_assignments(*), person_qualifications(*)")
    .order("id")
    .order("sort_order", { referencedTable: "person_assignments" })
    .order("sort_order", { referencedTable: "person_qualifications" });

  return data ?? [];
}

/**
 * Derive the current 4-week window dynamically from the ISO week of today.
 * Returns an array of 4 week labels like ["W32", "W33", "W34", "W35"].
 */
function currentFourWeeks(): string[] {
  const today = new Date();
  const thursday = thursdayOf(today);
  const jan4 = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
  const firstThursday = thursdayOf(jan4);
  const currentWeek = 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / 604800000);
  // Show current week and 3 preceding — the most useful window for a team lead
  return [-3, -2, -1, 0].map((offset) => `W${currentWeek + offset}`);
}

/**
 * Submitted (not yet approved/rejected) timesheet weeks, grouped by person
 * and week. RLS (can_view_person) already scopes this to whoever the caller
 * is allowed to see -- dept_head gets their department, exec gets everyone --
 * so no extra filtering is needed here beyond status.
 */
export async function getPendingTimesheetApprovals(
  supabase: SupabaseTyped,
): Promise<PendingTimesheetWeek[]> {
  const { data } = await supabase
    .from("timesheet_entries")
    .select("person_id, week_start, hours, people(name)")
    .eq("status", "submitted");

  const byKey = new Map<string, PendingTimesheetWeek>();

  for (const row of data ?? []) {
    const key = `${row.person_id}__${row.week_start}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        personId: row.person_id,
        personName: row.people?.name ?? row.person_id,
        weekStart: row.week_start,
        totalHours: 0,
        entryCount: 0,
      });
    }
    const entry = byKey.get(key)!;
    entry.totalHours += Number(row.hours);
    entry.entryCount += 1;
  }

  return Array.from(byKey.values()).sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

/** Workload/booking board plus pending approvals, for the Team Lead page. */
export async function getTeamLeadBoard(supabase: SupabaseTyped): Promise<{
  bookings: TeamLeadBooking[];
  decisions: ApprovalDecisionRow[];
  weeks: string[];
}> {
  const weeks = currentFourWeeks();

  const { data: rows } = await supabase
    .from("weekly_bookings")
    .select("*, people(id, name, timesheet_status, certificate_status, certificate_text)")
    .in("week", weeks)
    .order("id");

  const byPerson = new Map<string, TeamLeadBooking>();

  for (const row of rows ?? []) {
    const person = row.people;
    if (!person) continue;

    if (!byPerson.has(person.id)) {
      byPerson.set(person.id, {
        name: person.name,
        w31: { hours: null, status: "normal" },
        w32: { hours: null, status: "normal" },
        w33: { hours: null, status: "normal" },
        w34: { hours: null, status: "normal" },
        timesheetStatus: person.timesheet_status,
        certificates: { status: person.certificate_status, text: person.certificate_text },
      });
    }

    const entry = byPerson.get(person.id)!;
    const week = { hours: row.hours, status: row.status };
    // Map to the entry keys using the weeks array index
    const idx = weeks.indexOf(row.week);
    if (idx === 0) entry.w31 = week;
    else if (idx === 1) entry.w32 = week;
    else if (idx === 2) entry.w33 = week;
    else if (idx === 3) entry.w34 = week;
  }

  const { data: decisions } = await supabase
    .from("approval_decisions")
    .select("*")
    .eq("status", "pending")
    .order("sort_order");

  return { bookings: Array.from(byPerson.values()), decisions: decisions ?? [], weeks };
}

/** Live counts for the Overview page header — replaces hardcoded "41 PEOPLE · 27 ACTIVE PROJECTS". */
export async function getOverviewCounts(supabase: SupabaseTyped): Promise<{
  activePeople: number;
  activeProjects: number;
  currentQuarter: string;
}> {
  const [{ count: peopleCount }, { count: projectCount }] = await Promise.all([
    // people.is_active is a real column on the people table
    supabase.from("people").select("id", { count: "exact", head: true }),
    supabase.from("projects").select("id", { count: "exact", head: true }),
  ]);

  const now = new Date();
  const q = Math.ceil((now.getMonth() + 1) / 3);
  const currentQuarter = `Q${q} ${now.getFullYear()}`;

  return {
    activePeople: peopleCount ?? 0,
    activeProjects: projectCount ?? 0,
    currentQuarter,
  };
}

/** Monday of the current ISO week, as a YYYY-MM-DD string -- matches Postgres's date_trunc('week', now()). */
export function currentWeekStart(): string {
  const now = new Date();
  const isoDayOfWeek = (now.getUTCDay() + 6) % 7; // Mon=0 .. Sun=6
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() - isoDayOfWeek);
  return monday.toISOString().slice(0, 10);
}

/** Monday of the week `deltaWeeks` away from the given week_start (negative = earlier). */
export function shiftWeekStart(weekStart: string, deltaWeeks: number): string {
  const d = new Date(weekStart + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + deltaWeeks * 7);
  return d.toISOString().slice(0, 10);
}

/**
 * The current user's own timesheet entries for the given week (defaults to
 * the current week), grouped back into one row per task with a 7-day hours
 * array. Scoped explicitly to the caller's own person_id (not just relying
 * on RLS): an exec can VIEW everyone's entries, but this page is "my own
 * timesheet", and grouping by entry_group alone -- without a person filter --
 * would merge different people's rows together if their entry_group numbers
 * ever collide.
 */
export async function getTimesheetEntries(
  supabase: SupabaseTyped,
  weekStart: string = currentWeekStart(),
): Promise<TimesheetDayEntry[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data: profile } = await supabase
    .from("app_user_profile")
    .select("person_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!profile?.person_id) return [];

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
        hours: [0, 0, 0, 0, 0, 0, 0],
        dayRowIds: [null, null, null, null, null, null, null],
      });
    }
    const group = byGroup.get(row.entry_group)!;
    group.hours[row.day_of_week] = Number(row.hours);
    group.dayRowIds[row.day_of_week] = row.id;
  }

  return Array.from(byGroup.values());
}
