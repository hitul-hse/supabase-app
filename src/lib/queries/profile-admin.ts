/**
 * The READ side of administering somebody else's record.
 *
 * Its write counterpart is src/app/(app)/admin/users/profile-actions.ts, which
 * re-checks every permission server-side. This file only reads, and it reads
 * through the caller's RLS-scoped client on purpose: an admin page that renders
 * rows the caller may not see is a data leak dressed as a feature.
 *
 * WHY A FILE OF ITS OWN rather than more functions in auth.ts. auth.ts answers
 * "who is signed in" and "list the accounts"; this answers "everything about ONE
 * other person, across three schemas". Keeping it apart means the per-person read
 * can join into `time` without auth.ts — imported by the middleware-adjacent
 * profile gate — growing a dependency on the time module.
 *
 * THREE RULES, each because the obvious version is wrong:
 *
 * 1. ABSENCE IS ABSENCE. A person with no `time.member` row is `member: null`,
 *    not a member with zero hours. Utilisation of "0h against 0h" reads as a
 *    performance problem; "not linked" reads as the setup task it actually is.
 *
 * 2. PAGED READS ARE ORDERED. `.range()` without `.order()` lets PostgREST
 *    choose the row order per request, so page 2 can repeat and skip rows from
 *    page 1 — silently. That cost a CI failure on 2026-08-22. See paged.ts.
 *
 * 3. THE ENTRY LIST IS BOUNDED AND SORTED IN SQL. Newest 50, ordered by
 *    started_at in the database. Sorting a truncated page in JavaScript sorts
 *    the wrong 50 rows.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { formatSeconds } from "@/lib/time-transform";
import { fetchAllPaged } from "./paged";
import { effectiveNameOf } from "./profile";

type SupabaseTyped = SupabaseClient<Database>;
/**
 * `time` is a separate Postgres schema, deliberately absent from the generated
 * `public` types, so the generated client rejects `.schema("time")` outright.
 * Narrowed once here, exactly as every other query module does, with the row
 * shapes below carrying the safety the generated types cannot.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const timeSchema = (s: SupabaseTyped) => (s as any).schema("time");

/** How many of a person's most recent entries the admin page shows. */
export const ADMIN_ENTRY_LIMIT = 50;

/**
 * TrackingTime's account-wide default contracted week.
 *
 * Every one of the 49 imported members reports exactly this, which is why every
 * utilisation figure in the app is labelled "nominal". The page uses it to say
 * so next to the field, rather than leaving an admin to wonder why the number is
 * suspiciously round.
 */
export const NOMINAL_WEEKLY_HOURS = 40;

export type AdminProfileTarget = {
  userId: string;
  displayName: string | null;
  /** The chosen name, else the HR name, else a neutral fallback. Never blank. */
  effectiveName: string;
  department: string | null;
  roleKey: string;
  roleDisplayName: string;
  isActive: boolean;
  createdAt: string;
  personId: string | null;
  personName: string | null;
};

export type AdminMemberLink = {
  id: number;
  displayName: string | null;
  email: string | null;
  /** Contracted hours per week. Null when the column is genuinely empty. */
  weeklyHours: number | null;
  /** True when weeklyHours is TrackingTime's untouched account default. */
  isNominalWeek: boolean;
  isArchived: boolean;
  jobTitle: string | null;
  team: string | null;
};

export type AdminEntryRow = {
  id: number;
  /** YYYY-MM-DD, from started_at. */
  day: string;
  startedAt: string;
  /** Seconds. Null while a timer is still running. */
  durationSeconds: number | null;
  /** "H:MM", or "—" while running. */
  duration: string;
  /** Decimal hours for the edit field. Null while running. */
  hours: number | null;
  projectName: string | null;
  customerName: string | null;
  taskName: string | null;
  isBillable: boolean;
  /** Invoiced. Locks the row: the correction is a credit note, not an edit. */
  isBilled: boolean;
  isCalendar: boolean;
  notes: string | null;
};

export type AdminProfileView = {
  target: AdminProfileTarget;
  /** Null means NOT LINKED, which is a state to render, not a zero. */
  member: AdminMemberLink | null;
  entries: AdminEntryRow[];
  /** True when the person has more entries than the page shows. */
  hasMoreEntries: boolean;
};

/** A finite number, or null. Never 0 as a stand-in for "unknown". */
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Everything the per-person admin page renders, for ONE user.
 *
 * Returns null when there is no profile row the caller may read — which covers
 * both "no such user" and "RLS refused", deliberately indistinguishable to the
 * caller so a 404 page cannot be used to enumerate accounts.
 *
 * The member lookup runs after the profile because it needs `person_id` as a
 * second route in: `time.member.user_id` is populated by identity linking, but
 * members imported before their Hub account existed are matched on
 * `hub_person_id` instead, and reporting "not linked" for those would send an
 * admin off to fix a link that already exists.
 */
export async function getAdminProfileView(
  supabase: SupabaseTyped,
  userId: string,
): Promise<AdminProfileView | null> {
  const { data: profile, error } = await supabase
    .from("app_user_profile")
    .select(
      `user_id, display_name, department, is_active, created_at, person_id,
       app_role(role_key, display_name),
       people(name)`,
    )
    .eq("user_id", userId)
    .maybeSingle();

  // A real query failure is not the same thing as "no such row". Throwing lets
  // the route error boundary show a retry instead of a page that says, wrongly,
  // that this person does not exist.
  if (error) {
    console.error("[profile-admin] target profile read failed:", error);
    throw new Error("Couldn't load that person's record.");
  }
  if (!profile || !profile.app_role) return null;

  const personName = profile.people?.name ?? null;
  const target: AdminProfileTarget = {
    userId: profile.user_id,
    displayName: profile.display_name,
    effectiveName: effectiveNameOf(profile.display_name, personName),
    department: profile.department,
    roleKey: profile.app_role.role_key,
    roleDisplayName: profile.app_role.display_name,
    isActive: profile.is_active,
    createdAt: profile.created_at,
    personId: profile.person_id,
    personName,
  };

  const member = await findMember(supabase, userId, profile.person_id);
  const { entries, hasMore } = member
    ? await readEntries(supabase, member.id)
    : { entries: [], hasMore: false };

  return { target, member, entries, hasMoreEntries: hasMore };
}

/** The person's TrackingTime member row, by account link then by HR identity. */
async function findMember(
  supabase: SupabaseTyped,
  userId: string,
  personId: string | null,
): Promise<AdminMemberLink | null> {
  const SELECT = "id, display_name, email, weekly_hours, is_archived, job_title, team";

  try {
    // Ordered even though at most one row is expected: `time_member_user_idx`
    // does not enforce uniqueness, so a duplicated link must resolve to the same
    // member on every request rather than to whichever row Postgres returns first.
    const byUser = await timeSchema(supabase)
      .from("member")
      .select(SELECT)
      .eq("user_id", userId)
      .order("id", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (byUser.data) return toMember(byUser.data);

    if (personId) {
      const byPerson = await timeSchema(supabase)
        .from("member")
        .select(SELECT)
        .eq("hub_person_id", personId)
        .order("id", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (byPerson.data) return toMember(byPerson.data);
    }

    return null;
  } catch {
    // The `time` schema is not applied to this database yet. "Not linked" is the
    // honest rendering of that, and it is the same word the UI already uses.
    return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toMember(row: any): AdminMemberLink {
  const weeklyHours = num(row.weekly_hours);
  return {
    id: Number(row.id),
    displayName: row.display_name ?? null,
    email: row.email ?? null,
    weeklyHours,
    isNominalWeek: weeklyHours === NOMINAL_WEEKLY_HOURS,
    isArchived: Boolean(row.is_archived),
    jobTitle: row.job_title ?? null,
    team: row.team ?? null,
  };
}

/**
 * The newest ADMIN_ENTRY_LIMIT entries for one member, plus whether there are
 * more.
 *
 * Bounded in SQL, so this cannot approach PostgREST's 1000-row cap. One extra
 * row is fetched purely to answer "is this the whole story?" honestly — a list
 * that stops at 50 without saying so reads as "this person logged 50 entries,
 * ever", which would be wrong for all 49 of them.
 */
async function readEntries(
  supabase: SupabaseTyped,
  memberId: number,
): Promise<{ entries: AdminEntryRow[]; hasMore: boolean }> {
  try {
    const { data, error } = await timeSchema(supabase)
      .from("entry")
      .select(
        `id, started_at, duration_seconds, is_billable, is_billed, is_calendar, notes,
         project:project_id ( name ),
         customer:customer_id ( name ),
         task:task_id ( name )`,
      )
      .eq("member_id", memberId)
      // Newest first, decided by the database. Sorting a truncated page in JS
      // would sort the wrong 50 rows.
      .order("started_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(ADMIN_ENTRY_LIMIT + 1);

    if (error || !data) return { entries: [], hasMore: false };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = data as any[];
    const hasMore = rows.length > ADMIN_ENTRY_LIMIT;
    return { entries: rows.slice(0, ADMIN_ENTRY_LIMIT).map(toEntry), hasMore };
  } catch {
    return { entries: [], hasMore: false };
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toEntry(row: any): AdminEntryRow {
  const seconds = num(row.duration_seconds);
  return {
    id: Number(row.id),
    day: String(row.started_at ?? "").slice(0, 10),
    startedAt: row.started_at,
    durationSeconds: seconds,
    // A running timer has no duration yet. "0:00" would read as "logged
    // nothing", which is the opposite of what is happening.
    duration: seconds === null ? "—" : formatSeconds(seconds),
    // Two decimals, because the edit field posts this straight back and
    // 1.9999999h would be stored as a rounded-then-re-rounded duration.
    hours: seconds === null ? null : Math.round((seconds / 3600) * 100) / 100,
    projectName: row.project?.name ?? null,
    customerName: row.customer?.name ?? null,
    taskName: row.task?.name ?? null,
    isBillable: Boolean(row.is_billable),
    isBilled: Boolean(row.is_billed),
    isCalendar: Boolean(row.is_calendar),
    notes: row.notes ?? null,
  };
}

/**
 * Every member id whose contracted week is still TrackingTime's default.
 *
 * The one read here that can grow past PostgREST's 1000-row cap: it is the whole
 * roster, unfiltered by person. Paged through fetchAllPaged WITH an .order(),
 * per rule 2 above — the count is the whole point of the callout on the page, so
 * a silently repeated or skipped row would make it lie.
 */
export async function countNominalWeeks(
  supabase: SupabaseTyped,
): Promise<{ nominal: number; total: number } | null> {
  type Row = { id: number; weekly_hours: number | null };
  try {
    const { rows } = await fetchAllPaged<Row>((from, to) =>
      timeSchema(supabase)
        .from("member")
        .select("id, weekly_hours")
        .eq("is_archived", false)
        // Ordered: unordered paging repeats and skips rows.
        .order("id", { ascending: true })
        .range(from, to),
    );
    if (rows.length === 0) return null;
    const nominal = rows.filter((r) => num(r.weekly_hours) === NOMINAL_WEEKLY_HOURS).length;
    return { nominal, total: rows.length };
  } catch {
    return null;
  }
}
