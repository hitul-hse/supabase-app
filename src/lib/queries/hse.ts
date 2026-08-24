import type {
  SupabaseTyped,
  ProjectDetail,
  ProjectTaskRow,
  PersonProfile,
  ApprovalDecisionRow,
  TimesheetDayEntry,
  PendingTimesheetWeek,
  OrgChartNode,
  TaskComment,
  TaskWithSubtasks,
  ProjectSectionRow,
  LeaveRequestRow,
  LeaveBalanceRow,
  LeaveRequestWithPerson,
  BillableValueRow,
  RunningTimer,
  ProjectBudgetStatusRow,
} from "./types";

/*
 * REMOVED: getSyncSources() and getExecutiveOverview().
 *
 * Both existed only to serve the seeded demo tables that backed the original
 * frontend mockup, and both have been replaced by reads over real imported
 * TrackingTime:
 *
 *   getSyncSources      -> getSyncFreshness()  (queries/time-dashboard.ts)
 *   getExecutiveOverview -> getLiveOverview()  (queries/overview-live.ts)
 *
 * getExecutiveOverview read `executive_metrics` (five hand-written STRINGS like
 * "73.4%" and "612"), `weekly_trends` (12 invented weeks), `team_utilisations`
 * (five fictional teams) and `projects` (five sample rows). Its
 * buildBillableTrend() helper tried real sources first and fell back to those
 * invented weeks -- and because the Factorial pipeline has never run, the
 * fallback is what every signed-in user actually saw for months.
 *
 * The fallback is gone deliberately, not overlooked. A chart with no data now
 * says so; it does not substitute numbers that look like an answer. See
 * scripts/check-no-mock-data.mjs, which fails if any of these come back.
 */

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
    .select("*, project_timeline(*), project_tasks(*), project_sections(*)")
    .eq("id", id)
    .order("sort_order", { referencedTable: "project_timeline" })
    .order("sort_order", { referencedTable: "project_tasks" })
    .order("position", { referencedTable: "project_sections" })
    .single();

  if (!data) return null;
  const { project_sections, ...rest } = data;
  return { ...rest, sections: project_sections, project_tasks: nestTasks(data.project_tasks) };
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
 * Real, derived holiday balances for every person the caller can see (RLS:
 * can_view_person), keyed by person_id. The People page selects a person
 * entirely client-side, so this fetches every visible balance up front for
 * the KPI tile rather than the selected person's alone. Comes from the
 * leave_balances view rather than the static people.holiday_left column --
 * see supabase/schema.sql for why that column can't be trusted.
 */
export async function getLeaveBalances(supabase: SupabaseTyped): Promise<Record<string, LeaveBalanceRow>> {
  const { data } = await supabase.from("leave_balances").select("*");

  const balanceByPerson: Record<string, LeaveBalanceRow> = {};
  for (const b of data ?? []) {
    if (b.person_id) balanceByPerson[b.person_id] = b;
  }
  return balanceByPerson;
}

/** One person's derived holiday balance, for the dedicated Leave page's "my balance" view. */
export async function getLeaveBalance(
  supabase: SupabaseTyped,
  personId: string,
): Promise<LeaveBalanceRow | null> {
  const { data } = await supabase.from("leave_balances").select("*").eq("person_id", personId).maybeSingle();
  return data ?? null;
}

/** One person's leave request history (pending, approved, rejected), most recent first. */
export async function getLeaveRequests(
  supabase: SupabaseTyped,
  personId: string,
): Promise<LeaveRequestRow[]> {
  const { data } = await supabase
    .from("leave_requests")
    .select("*")
    .eq("person_id", personId)
    .order("requested_at", { ascending: false });

  return data ?? [];
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

/**
 * Real billed value per person the caller can see (RLS: can_view_person),
 * keyed by person_id (TrackingTime-equivalent). Rate x approved billable
 * hours, from billable_value_by_person rather than a static figure.
 */
export async function getBillableValues(supabase: SupabaseTyped): Promise<Record<string, BillableValueRow>> {
  const { data } = await supabase.from("billable_value_by_person").select("*");

  const byPerson: Record<string, BillableValueRow> = {};
  for (const b of data ?? []) {
    if (b.person_id) byPerson[b.person_id] = b;
  }
  return byPerson;
}

/**
 * The signed-in person's running timer, if one exists. A running timer is a
 * timesheet_entries row with started_at set and stopped_at still null -- the
 * database guarantees at most one per person, so maybeSingle() is safe here
 * rather than defensively taking the first of many.
 */
export async function getRunningTimer(
  supabase: SupabaseTyped,
  personId: string,
): Promise<RunningTimer | null> {
  const { data } = await supabase
    .from("timesheet_entries")
    .select("id, task_name, project_name, is_billable, started_at")
    .eq("person_id", personId)
    .not("started_at", "is", null)
    .is("stopped_at", null)
    .maybeSingle();

  if (!data?.started_at) return null;

  return {
    id: data.id,
    taskName: data.task_name,
    projectName: data.project_name,
    isBillable: data.is_billable,
    startedAt: data.started_at,
  };
}

/**
 * Budget burn and margin for one project. Null when the caller can't see the
 * project -- the view is security_invoker, so RLS does the filtering.
 */
export async function getProjectBudgetStatus(
  supabase: SupabaseTyped,
  projectId: string,
): Promise<ProjectBudgetStatusRow | null> {
  const { data } = await supabase
    .from("project_budget_status")
    .select("*")
    .eq("project_id", projectId)
    .maybeSingle();

  return data ?? null;
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

/**
 * Items awaiting a lead's approval.
 *
 * All that survives of the old getTeamLeadBoard, which also read `weekly_bookings`
 * joined to the mockup `people` table: twenty hand-written rows for five people
 * who do not exist. The workload grid now comes from measured time in
 * queries/team-lead-live.ts, and that function is gone rather than left exported,
 * because a dead export returning seeded rows is how mockup data survives a
 * rewire.
 *
 * approval_decisions is a real table the approve buttons write to, so this stays.
 * Its current three rows still describe mockup people ("A. Brandt - 46 h in week
 * 30") and are all already approved, so nothing seeded reaches the page: the
 * query filters to pending.
 */
export async function getApprovalDecisions(
  supabase: SupabaseTyped,
): Promise<ApprovalDecisionRow[]> {
  const { data } = await supabase
    .from("approval_decisions")
    .select("*")
    .eq("status", "pending")
    .order("sort_order");

  return data ?? [];
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

/*
 * currentWeekStart(), shiftWeekStart() and getTimesheetEntries() MOVED to
 * src/lib/queries/timesheets.ts.
 *
 * Not merely relocated for tidiness. public.timesheet_entries held 28 rows and
 * every one was mockup data for the seeded, inactive person 'emp-1'; they are
 * deleted in supabase/migrations/delete_mockup_timesheet_rows.sql. The reader
 * gained a state the old one could not express (an account with no linked person
 * is not an empty week), so the old signature is GONE rather than left exported
 * beside the new one: a dead export returning the same rows is how mockup data
 * survives a rewire, which is the lesson check-no-mockup-people.mjs already paid
 * for with getTeamLeadBoard.
 */

/**
 * The task board for a TrackingTime project.
 *
 * getProjectDetail() above answers the same question for a Hub project, but it
 * cannot serve this one: it selects FROM public.projects and embeds the board
 * through that table's foreign keys, and a time.project has no row there. The
 * board tables are queried directly instead, filtered on the second parent.
 *
 * Comments are fetched through the existing getTaskComments(), which keys on
 * task ids and so never needed to know which kind of project they belong to.
 */
export async function getTimeProjectBoard(
  supabase: SupabaseTyped,
  timeProjectId: number,
): Promise<{
  tasks: TaskWithSubtasks[];
  sections: ProjectSectionRow[];
  commentsByTask: Record<number, TaskComment[]>;
}> {
  const [{ data: tasks }, { data: sections }] = await Promise.all([
    supabase
      .from("project_tasks")
      .select("*")
      .eq("time_project_id", timeProjectId)
      .order("sort_order"),
    supabase
      .from("project_sections")
      .select("*")
      .eq("time_project_id", timeProjectId)
      .order("position"),
  ]);

  const rows = tasks ?? [];
  const comments = await getTaskComments(
    supabase,
    rows.map((t) => t.id),
  );

  return {
    tasks: nestTasks(rows),
    sections: sections ?? [],
    // A Map does not survive the server/client boundary as a Map, so it is
    // handed down as a plain object -- the same shape TasksSection already
    // expects.
    commentsByTask: Object.fromEntries(comments),
  };
}
