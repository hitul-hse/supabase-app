import type { SupabaseTyped } from "./types";

export type ProfileView = {
  userId: string;
  email: string | null;
  displayName: string | null;
  /** What to show: the chosen name, else the HR name, else a neutral fallback. */
  effectiveName: string;
  avatarUrl: string | null;
  roleKey: string;
  roleDisplayName: string;
  department: string | null;
  personId: string | null;
  employeeNumber: string | null;
  contractHours: number | null;
  holidayLeft: number | null;
  totalHoliday: number | null;
  certificateStatus: string | null;
  since: string | null;
  prefLandingPage: string;
  prefLocale: string;
  prefSidebarCollapsed: boolean;
};

/**
 * Everything /profile renders, in one round trip.
 *
 * The HR half comes from people and is read-only everywhere in this feature:
 * that table is destined for Factorial/TrackingTime sync, so a value edited
 * here would be overwritten with no conflict-resolution story.
 */
export async function getProfileView(
  supabase: SupabaseTyped,
  userId: string,
  email: string | null,
): Promise<ProfileView | null> {
  const { data } = await supabase
    .from("app_user_profile")
    .select(
      `user_id, display_name, avatar_url, department, person_id,
       pref_landing_page, pref_locale, pref_sidebar_collapsed,
       app_role(role_key, display_name),
       people(name, employee_number, contract_hours, holiday_left,
              total_holiday, certificate_status, since)`,
    )
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();

  if (!data || !data.app_role) return null;

  const person = data.people;

  return {
    userId: data.user_id,
    email,
    displayName: data.display_name,
    effectiveName: data.display_name ?? person?.name ?? "Team member",
    avatarUrl: data.avatar_url,
    roleKey: data.app_role.role_key,
    roleDisplayName: data.app_role.display_name,
    department: data.department,
    personId: data.person_id,
    employeeNumber: person?.employee_number ?? null,
    contractHours: person?.contract_hours ?? null,
    holidayLeft: person?.holiday_left ?? null,
    totalHoliday: person?.total_holiday ?? null,
    certificateStatus: person?.certificate_status ?? null,
    since: person?.since ?? null,
    prefLandingPage: data.pref_landing_page,
    prefLocale: data.pref_locale,
    prefSidebarCollapsed: data.pref_sidebar_collapsed,
  };
}
