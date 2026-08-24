import type { SupabaseTyped } from "./types";
import { oncePerRequest } from "./request-cache";

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
 * Chosen display name, else the HR name, else a neutral fallback.
 *
 * Uses truthiness (after trimming), not `??`: `??` only falls through on
 * `null`/`undefined`, so a blank or whitespace-only display name would
 * render as an empty header instead of falling back. Today the app can't
 * actually produce that value — Task 1's check constraint requires
 * `display_name` to be null or 1-60 trimmed characters, and Task 5's
 * `updateDisplayName` writes `null` rather than `''` for empty input — but
 * this function shouldn't depend on a constraint two layers away for its
 * own correctness. If that constraint is ever relaxed, or a row arrives
 * from a backfill or a direct SQL fix, the header should still say
 * something sensible instead of rendering blank.
 */
export function effectiveNameOf(displayName: string | null, personName: string | null): string {
  const trimmedDisplay = displayName?.trim();
  if (trimmedDisplay) return trimmedDisplay;
  const trimmedPerson = personName?.trim();
  if (trimmedPerson) return trimmedPerson;
  return "Team member";
}

/**
 * Everything /profile renders, in one round trip.
 *
 * The HR half comes from people and is read-only everywhere in this feature:
 * that table is destined for Factorial/TrackingTime sync, so a value edited
 * here would be overwritten with no conflict-resolution story.
 * MEMOISED PER REQUEST. The shared app shell asks for this three times in a
 * single render -- <Sidebar/> is mounted twice by (app)/layout.tsx (desktop
 * shell + mobile drawer) and <TopBarChrome/> asks again -- and /profile then
 * asks a fourth time. That was four identical round trips for ONE row, in
 * series, on every navigation. Measured: the shared shell cost ~640ms of every
 * page render while the heaviest real query in the app is 62ms.
 *
 * See request-cache.ts for why this is per-user safe. In short: the scope is a
 * single render of a single request (not the Data Cache, not unstable_cache,
 * nothing that outlives the request), and the key is the subject's own userId.
 */
export async function getProfileView(
  supabase: SupabaseTyped,
  userId: string,
  email: string | null,
): Promise<ProfileView | null> {
  return oncePerRequest(`profileView:${userId}`, () => loadProfileView(supabase, userId, email));
}

async function loadProfileView(
  supabase: SupabaseTyped,
  userId: string,
  email: string | null,
): Promise<ProfileView | null> {
  const { data, error } = await supabase
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

  // A real query failure (RLS surprise, connection error, bad column, etc.)
  // is not the same thing as "this user has no active profile row" -- the
  // latter is a legitimate null (see below), the former is a bug or an
  // outage that deserves to be visible. Discarding `error` here previously
  // meant both cases looked identical to the caller, and page.tsx rendered
  // a blank page for either. Throwing lets (app)/error.tsx's route-level
  // boundary show a real error state and a retry, instead of silence.
  if (error) {
    console.error("[profile] getProfileView query failed:", error);
    throw new Error("Couldn't load your profile.");
  }

  if (!data || !data.app_role) return null;

  const person = data.people;

  return {
    userId: data.user_id,
    email,
    displayName: data.display_name,
    effectiveName: effectiveNameOf(data.display_name, person?.name ?? null),
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
