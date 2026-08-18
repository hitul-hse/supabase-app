import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

export type SupabaseTyped = SupabaseClient<Database>;

/** Typed rows for the HSE Hub tables */
export type SyncSourceRow = Database["public"]["Tables"]["sync_sources"]["Row"];
export type ExecutiveMetricRow = Database["public"]["Tables"]["executive_metrics"]["Row"];
export type WeeklyTrendRow = Database["public"]["Tables"]["weekly_trends"]["Row"];
export type TeamUtilisationRow = Database["public"]["Tables"]["team_utilisations"]["Row"];
export type ProjectRow = Database["public"]["Tables"]["projects"]["Row"];
export type ProjectTimelineRow = Database["public"]["Tables"]["project_timeline"]["Row"];
export type ProjectTaskRow = Database["public"]["Tables"]["project_tasks"]["Row"];
export type ProjectSectionRow = Database["public"]["Tables"]["project_sections"]["Row"];
export type PersonRow = Database["public"]["Tables"]["people"]["Row"];
export type PersonAssignmentRow = Database["public"]["Tables"]["person_assignments"]["Row"];
export type PersonQualificationRow = Database["public"]["Tables"]["person_qualifications"]["Row"];
export type ApprovalDecisionRow = Database["public"]["Tables"]["approval_decisions"]["Row"];

/** A top-level task with its subtasks (one level deep) nested inline. */
export type TaskWithSubtasks = ProjectTaskRow & { subtasks: ProjectTaskRow[] };

export type ProjectDetail = ProjectRow & {
  project_timeline: ProjectTimelineRow[];
  project_tasks: TaskWithSubtasks[];
  /** Board columns / list headers -- the same objects, per Asana's model. */
  sections: ProjectSectionRow[];
};

export type PersonProfile = PersonRow & {
  person_assignments: PersonAssignmentRow[];
  person_qualifications: PersonQualificationRow[];
};

/** Company-wide billable split per synced week, from the vendor pipeline. */
export type WeeklyBillableTrendRow =
  Database["public"]["Views"]["weekly_billable_trend"]["Row"];

/** Per-person weekly figures derived from synced Factorial/TrackingTime data. */
export type PersonWeekMetricsRow =
  Database["public"]["Views"]["person_week_metrics"]["Row"];

/**
 * One bar in the Overview trend chart.
 *
 * `source` records where the numbers came from, because the two are not
 * interchangeable: "synced" is real Factorial/TrackingTime data, "sample" is
 * the seeded demo row. A BI page that renders them identically invites someone
 * to make a decision on invented figures.
 */
export type BillableTrendPoint = {
  label: string;
  billableHours: number;
  nonBillableHours: number;
  isOpen: boolean;
};

export type BillableTrend = {
  points: BillableTrendPoint[];
  source: "synced" | "sample";
};

export type TimesheetDayEntry = {
  entryGroup: number;
  taskName: string;
  projectName: string;
  isBillable: boolean;
  customer: string | null;
  warning: string | null;
  status: string;
  /**
   * Why a lead sent this week back.
   *
   * Mandatory when rejecting (team-lead/actions.ts refuses an empty one) and it
   * reached the database, but nothing ever read it: the employee saw the grid
   * become editable again with no indication of what to change. The lead typed a
   * required explanation into a void.
   */
  rejectionNote: string | null;
  hours: number[];
  /** DB row id per day-of-week (0=Mon..6=Sun), for targeted per-cell edits. */
  dayRowIds: (number | null)[];
};

export type PendingTimesheetWeek = {
  personId: string;
  personName: string;
  weekStart: string;
  totalHours: number;
  entryCount: number;
};

export type OrgChartNode = {
  id: string;
  name: string;
  role: string | null;
  department: string | null;
  managerId: string | null;
};

/**
 * Which project a board belongs to, carried through the task components.
 *
 * The board can hang off a Hub project (public.projects, text id) or a
 * TrackingTime one (time.project, bigint). Rather than have each form guess,
 * the field NAME travels with the value: whatever is posted lands in the column
 * it names, and the server re-derives it rather than trusting the client.
 */
export type BoardParent =
  | { field: "project_id"; id: string }
  | { field: "time_project_id"; id: number };

export type TaskComment = {
  id: number;
  taskId: number;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
};

export type LeaveRequestRow = Database["public"]["Tables"]["leave_requests"]["Row"];
export type LeaveBalanceRow = Database["public"]["Views"]["leave_balances"]["Row"];

export type LeaveRequestWithPerson = LeaveRequestRow & { personName: string };

export type BillableValueRow = Database["public"]["Views"]["billable_value_by_person"]["Row"];

export type ProjectBudgetStatusRow =
  Database["public"]["Views"]["project_budget_status"]["Row"];

/** A timer currently running for the signed-in person, if any. */
export type RunningTimer = {
  id: number;
  taskName: string;
  projectName: string;
  isBillable: boolean;
  /** ISO timestamp; the client ticks the elapsed display from this. */
  startedAt: string;
};
