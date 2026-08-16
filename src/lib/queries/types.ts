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
export type PersonRow = Database["public"]["Tables"]["people"]["Row"];
export type PersonAssignmentRow = Database["public"]["Tables"]["person_assignments"]["Row"];
export type PersonQualificationRow = Database["public"]["Tables"]["person_qualifications"]["Row"];
export type ApprovalDecisionRow = Database["public"]["Tables"]["approval_decisions"]["Row"];

export type ProjectDetail = ProjectRow & {
  project_timeline: ProjectTimelineRow[];
  project_tasks: ProjectTaskRow[];
};

export type PersonProfile = PersonRow & {
  person_assignments: PersonAssignmentRow[];
  person_qualifications: PersonQualificationRow[];
};

export type WeekBooking = { hours: number | null; status: string };

export type TeamLeadBooking = {
  name: string;
  w31: WeekBooking;
  w32: WeekBooking;
  w33: WeekBooking;
  w34: WeekBooking;
  timesheetStatus: string | null;
  certificates: { status: string | null; text: string | null };
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

export type TaskComment = {
  id: number;
  taskId: number;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
};
