import type {
  SupabaseTyped,
  SyncSourceRow,
  ExecutiveMetricRow,
  WeeklyTrendRow,
  TeamUtilisationRow,
  ProjectRow,
  ProjectDetail,
  PersonProfile,
  ApprovalDecisionRow,
  TeamLeadBooking,
  TimesheetDayEntry,
} from "./types";

/** Sync status strip shown at the top of every HSE Hub page. */
export async function getSyncSources(supabase: SupabaseTyped): Promise<SyncSourceRow[]> {
  const { data } = await supabase.from("sync_sources").select("*").order("sort_order");
  return data ?? [];
}

/** Metric cards, weekly billable/non-billable trend, and team utilisation for the Overview page. */
export async function getExecutiveOverview(supabase: SupabaseTyped): Promise<{
  metrics: ExecutiveMetricRow[];
  weeklyTrends: WeeklyTrendRow[];
  teamUtilisations: TeamUtilisationRow[];
  projects: ProjectRow[];
}> {
  const [{ data: metrics }, { data: weeklyTrends }, { data: teamUtilisations }, { data: projects }] =
    await Promise.all([
      supabase.from("executive_metrics").select("*").order("sort_order"),
      supabase.from("weekly_trends").select("*").order("sort_order"),
      supabase.from("team_utilisations").select("*").order("sort_order"),
      supabase.from("projects").select("*").order("id"),
    ]);

  return {
    metrics: metrics ?? [],
    weeklyTrends: weeklyTrends ?? [],
    teamUtilisations: teamUtilisations ?? [],
    projects: projects ?? [],
  };
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

/** Workload/booking board plus pending approvals, for the Team Lead page. */
export async function getTeamLeadBoard(supabase: SupabaseTyped): Promise<{
  bookings: TeamLeadBooking[];
  decisions: ApprovalDecisionRow[];
}> {
  const { data: rows } = await supabase
    .from("weekly_bookings")
    .select("*, people(id, name, timesheet_status, certificate_status, certificate_text)")
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
    switch (row.week) {
      case "W31":
        entry.w31 = week;
        break;
      case "W32":
        entry.w32 = week;
        break;
      case "W33":
        entry.w33 = week;
        break;
      case "W34":
        entry.w34 = week;
        break;
    }
  }

  const { data: decisions } = await supabase
    .from("approval_decisions")
    .select("*")
    .eq("status", "pending")
    .order("sort_order");

  return { bookings: Array.from(byPerson.values()), decisions: decisions ?? [] };
}

/** Current week's timesheet entries, grouped back into one row per task with a 7-day hours array. */
export async function getTimesheetEntries(supabase: SupabaseTyped): Promise<TimesheetDayEntry[]> {
  const { data } = await supabase
    .from("timesheet_entries")
    .select("*")
    .order("entry_group")
    .order("day_of_week");

  const byGroup = new Map<number, TimesheetDayEntry>();

  for (const row of data ?? []) {
    if (!byGroup.has(row.entry_group)) {
      byGroup.set(row.entry_group, {
        taskName: row.task_name,
        projectName: row.project_name,
        isBillable: row.is_billable,
        customer: row.customer,
        warning: row.warning,
        hours: [0, 0, 0, 0, 0, 0, 0],
      });
    }
    byGroup.get(row.entry_group)!.hours[row.day_of_week] = Number(row.hours);
  }

  return Array.from(byGroup.values());
}
