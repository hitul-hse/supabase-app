import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

export type SupabaseTyped = SupabaseClient<Database>;

/** Typed row from netflix_users */
export type NetflixUser = Database["public"]["Tables"]["netflix_users"]["Row"];

/** Typed row from files */
export type FileRecord = Database["public"]["Tables"]["files"]["Row"];

/** Result from netflix_overview view */
export type NetflixOverview =
  Database["public"]["Views"]["netflix_overview"]["Row"];

/** Result from netflix_country_stats view */
export type NetflixCountryStats =
  Database["public"]["Views"]["netflix_country_stats"]["Row"];

/** Result from netflix_genre_stats view */
export type NetflixGenreStats =
  Database["public"]["Views"]["netflix_genre_stats"]["Row"];

/** Result from netflix_subscription_stats view */
export type NetflixSubscriptionStats =
  Database["public"]["Views"]["netflix_subscription_stats"]["Row"];

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

export type TimesheetDayEntry = {
  taskName: string;
  projectName: string;
  isBillable: boolean;
  customer: string | null;
  warning: string | null;
  hours: number[];
};
