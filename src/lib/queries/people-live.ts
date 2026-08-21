/**
 * The real people directory, built from imported TrackingTime members rather
 * than the seeded `public.people` mockup.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `/people` rendered `public.people`: EIGHT rows seeded for the original
 * frontend mockup -- "Anna Brandt", "C. Haas", "L. Fischer" -- none of whom
 * work here. The company has FORTY-NINE members in `time.member`, imported from
 * the TrackingTime API, with real names and real hours. So the page every
 * manager opens to look someone up listed eight strangers and not one colleague.
 *
 * As with the Overview page, nothing errored. The directory looked complete,
 * the avatars rendered, the percentages were plausible, and the whole thing was
 * fiction. The tell was in the detail pane: "Anna Brandt ... 168 / 160 H,
 * 84% billable, 23 open tasks" -- numbers precise enough that nobody would
 * think to check them.
 *
 * ARCHIVED IS NOT THE SAME AS INACTIVE
 * ------------------------------------
 * 30 of the 49 are `is_archived` in TrackingTime -- leavers and dormant
 * accounts. They are excluded by default, because a directory is a list of
 * people you can staff, not a historical register. But their HOURS are real and
 * still count towards project totals, which is why `time-dashboard.ts` keeps
 * them and this module does not. The two are answering different questions.
 *
 * SHARED MAILBOXES ARE NOT PEOPLE
 * -------------------------------
 * TrackingTime's roster includes `info@hs-experts.com` and `jobs@hs-experts.com`
 * -- inboxes with member records, not colleagues. They are excluded here.
 * Listing an inbox as a member of staff is the same class of fiction as
 * listing "Anna Brandt", just harder to notice.
 *
 * WEEKLY HOURS ARE A DEFAULT, NOT A CONTRACT
 * ------------------------------------------
 * Every one of the 49 members reports exactly 40 h/week, which is TrackingTime's
 * account-wide default rather than anybody's actual contract. Utilisation built
 * on it is therefore "against a nominal 40-hour week", and the page must say so
 * rather than implying a contractual ratio we do not have.
 *
 * THE RULE THIS MODULE FOLLOWS
 * ----------------------------
 * Same as overview-live.ts: a figure with nothing behind it is `null`, and the
 * page renders "n/a". Never 0. Four of the 19 active members have logged no
 * time at all, and "0% billable" would read as an accusation rather than an
 * absence of data.
 *
 * The facts above are pinned by scripts/check-people-live-source.mjs, so a sync
 * that invalidates one fails there rather than surfacing as a wrong page.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { getMemberUtilisation, type MemberUtilisationRow } from "./time-dashboard";
import { secondsToHours } from "@/lib/time-transform";
import { fetchAllPaged } from "@/lib/queries/paged";

type SupabaseTyped = SupabaseClient<Database>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const timeSchema = (s: SupabaseTyped) => (s as any).schema("time");

/** PostgREST caps a single response at 1000 rows; page rather than truncate. */
const PAGE = 1000;

/** Projects listed in one person's assignment table. */
const ASSIGNMENTS_PER_PERSON = 8;

/**
 * Shared inboxes that hold TrackingTime member records but are not colleagues.
 * Matched on the local part so a domain change does not silently re-admit them.
 */
const SHARED_MAILBOX = /^(info|jobs|no-reply|noreply|office|admin|team)@/i;

/** True when this member record is an inbox rather than a person. */
export function isSharedMailbox(email: string | null): boolean {
  return email !== null && SHARED_MAILBOX.test(email);
}

/** One project a person has actually logged time against. */
export type PersonAssignment = {
  projectId: number | null;
  projectName: string;
  loggedHours: number;
  billableHours: number;
  entryCount: number;
  /** Share of this person's total hours, 0-100. */
  sharePercent: number;
};

/**
 * One row in the directory.
 *
 * Every field is either measured from TrackingTime or explicitly null. There is
 * deliberately no `department`, `employeeNumber`, `since`, `holidayLeft` or
 * `qualifications` here: TrackingTime holds none of those, and the mockup's
 * habit of showing a confident "EMP-0142 · SINCE 03/2021" for data we do not
 * have is exactly what this module removes.
 */
export type LivePerson = {
  memberId: number;
  name: string;
  email: string | null;
  /** TrackingTime account role: ADMIN, MANAGER, PROJECT_MANAGER, CO_WORKER. */
  accountRole: string | null;
  /** VERIFIED / INVITED / REGISTERED — whether they ever activated the account. */
  status: string | null;
  isArchived: boolean;
  /** Contracted hours per week, from TrackingTime. */
  weeklyHours: number;
  totalHours: number;
  billableHours: number;
  entryCount: number;
  weeksActive: number;
  lastActivityAt: string | null;
  /** Billable share of logged hours, 0-100, or null when nothing is logged. */
  billablePercent: number | null;
  /** Tracked over contracted across weeks ACTIVE, or null with no basis. */
  utilisationPercent: number | null;
  /** True when this member is linked to a Hub sign-in account. */
  hasAccount: boolean;
  assignments: PersonAssignment[];
};

export type PeopleDirectoryData = {
  people: LivePerson[];
  /** Members excluded because they are archived in TrackingTime. */
  archivedCount: number;
  /** Active members not yet linked to a Hub login. */
  unlinkedCount: number;
  /** Shared inboxes excluded from the roster (info@, jobs@). */
  mailboxCount: number;
};

/**
 * Capacity badge for a person.
 *
 * Returns null when there is no utilisation to judge — rendering "AVAILABLE"
 * for someone with no data would be a claim we cannot support.
 */
export function capacityLabel(utilisationPercent: number | null): {
  label: string;
  tone: "critical" | "warning" | "good" | "neutral";
} | null {
  if (utilisationPercent === null) return null;
  if (utilisationPercent > 110) return { label: "OVER CAPACITY", tone: "critical" };
  if (utilisationPercent < 50) return { label: "LOW UTILISATION", tone: "warning" };
  return { label: "ON TRACK", tone: "good" };
}

/**
 * Everything `/people` renders.
 *
 * `includeArchived` exists because the same data answers two questions: "who
 * can I staff" (no) and "whose hours am I looking at in a report" (yes).
 */
export async function getLivePeople(
  supabase: SupabaseTyped,
  opts: { includeArchived?: boolean } = {},
): Promise<PeopleDirectoryData> {
  const { includeArchived = false } = opts;

  try {
    const [allMembers, memberMeta] = await Promise.all([
      // Archived members are fetched regardless so `archivedCount` is honest —
      // the page states how many it is hiding rather than silently shrinking.
      getMemberUtilisation(supabase, { includeArchived: true }),
      getMemberMeta(supabase),
    ]);

    if (allMembers.length === 0) {
      return { people: [], archivedCount: 0, unlinkedCount: 0, mailboxCount: 0 };
    }

    // Inboxes are dropped before anything else, so they cannot be counted as
    // archived, as unlinked, or as staff.
    const mailboxes = allMembers.filter((m) =>
      isSharedMailbox(memberMeta.get(m.memberId)?.email ?? null),
    );
    const humans = allMembers.filter(
      (m) => !isSharedMailbox(memberMeta.get(m.memberId)?.email ?? null),
    );

    const visible = includeArchived ? humans : humans.filter((m) => !m.isArchived);

    const assignmentsByMember = await getAssignments(
      supabase,
      visible.map((m) => m.memberId),
    );

    const people = visible.map((m) => toLivePerson(m, memberMeta, assignmentsByMember));

    return {
      people,
      archivedCount: humans.filter((m) => m.isArchived).length,
      unlinkedCount: people.filter((p) => !p.hasAccount).length,
      mailboxCount: mailboxes.length,
    };
  } catch {
    return { people: [], archivedCount: 0, unlinkedCount: 0, mailboxCount: 0 };
  }
}

/** Roster headline counts, without the expensive per-project aggregation. */
export type RosterCounts = {
  /** Non-archived people, shared inboxes excluded. */
  activePeople: number;
  archivedPeople: number;
  /** Active people with no Hub sign-in — they cannot see their own hours. */
  unlinkedPeople: number;
  mailboxCount: number;
};

/**
 * Just the counts, for callers that need the roster shape but not the detail.
 *
 * Deliberately does NOT reuse getLivePeople: that pages all 5,218 entries to
 * build per-project assignments, which is the right cost for the directory and
 * an absurd one for a KPI on the landing page.
 */
export async function getRosterCounts(supabase: SupabaseTyped): Promise<RosterCounts> {
  const empty: RosterCounts = {
    activePeople: 0,
    archivedPeople: 0,
    unlinkedPeople: 0,
    mailboxCount: 0,
  };

  try {
    const { data, error } = await timeSchema(supabase)
      .from("member")
      .select("email, is_archived, user_id");

    if (error || !data) return empty;

    let activePeople = 0;
    let archivedPeople = 0;
    let unlinkedPeople = 0;
    let mailboxCount = 0;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const r of data as any[]) {
      if (isSharedMailbox(r.email ?? null)) {
        mailboxCount += 1;
        continue;
      }
      if (r.is_archived) {
        archivedPeople += 1;
        continue;
      }
      activePeople += 1;
      if (!r.user_id) unlinkedPeople += 1;
    }

    return { activePeople, archivedPeople, unlinkedPeople, mailboxCount };
  } catch {
    return empty;
  }
}

type MemberMeta = {
  email: string | null;
  accountRole: string | null;
  status: string | null;
  hasAccount: boolean;
};

/**
 * Email, account role and sign-in linkage, which `member_utilisation` does not
 * carry. Read straight from `time.member`.
 */
async function getMemberMeta(
  supabase: SupabaseTyped,
): Promise<Map<number, MemberMeta>> {
  const out = new Map<number, MemberMeta>();

  try {
    const { data, error } = await timeSchema(supabase)
      .from("member")
      .select("id, email, role, status, user_id");

    if (error || !data) return out;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const r of data as any[]) {
      out.set(Number(r.id), {
        email: r.email ?? null,
        accountRole: r.role ?? null,
        status: r.status ?? null,
        hasAccount: Boolean(r.user_id),
      });
    }
  } catch {
    /* fall through to an empty map — the directory still renders names+hours */
  }

  return out;
}

/**
 * Hours per member per project.
 *
 * Aggregated in JS from `time.entry` because PostgREST cannot GROUP BY over
 * REST, and there is no per-member-per-project view. Paged at 1000: a single
 * request silently truncates at PostgREST's `db-max-rows`, which over 5,218
 * entries would under-report every person's hours with no error at all.
 */
async function getAssignments(
  supabase: SupabaseTyped,
  memberIds: number[],
): Promise<Map<number, PersonAssignment[]>> {
  const out = new Map<number, PersonAssignment[]>();
  if (memberIds.length === 0) return out;

  // memberId -> projectId -> tally
  const tally = new Map<
    number,
    Map<number | null, { name: string; total: number; billable: number; count: number }>
  >();

  try {
    // Pages fetched in PARALLEL batches (see paged.ts for the measurements):
    // this scan of all ~5.3k entries was the directory's whole latency, and
    // awaiting each page serially paid the RLS toll one page at a time.
    const { rows: entryRows } = await fetchAllPaged<Record<string, unknown>>((from, to) =>
      timeSchema(supabase)
        .from("entry")
        .select("member_id, project_id, duration_seconds, is_billable, project:project_id(name)")
        .in("member_id", memberIds)
        .not("duration_seconds", "is", null)
        .range(from, to),
    );

    {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const row of entryRows as any[]) {
        const memberId = Number(row.member_id);
        const projectId = row.project_id === null ? null : Number(row.project_id);
        const seconds = Number(row.duration_seconds) || 0;

        if (!tally.has(memberId)) tally.set(memberId, new Map());
        const byProject = tally.get(memberId)!;

        if (!byProject.has(projectId)) {
          byProject.set(projectId, {
            // 40% of live entries carry no project_id. Their hours are real, so
            // they are grouped into one honest row rather than dropped.
            name: row.project?.name ?? "(no project)",
            total: 0,
            billable: 0,
            count: 0,
          });
        }

        const cell = byProject.get(projectId)!;
        cell.total += seconds;
        if (row.is_billable) cell.billable += seconds;
        cell.count += 1;
      }
    }
  } catch {
    return out;
  }

  for (const [memberId, byProject] of tally) {
    const memberTotal = [...byProject.values()].reduce((sum, c) => sum + c.total, 0);

    const rows: PersonAssignment[] = [...byProject.entries()]
      .map(([projectId, c]) => ({
        projectId,
        projectName: c.name,
        loggedHours: secondsToHours(c.total),
        billableHours: secondsToHours(c.billable),
        entryCount: c.count,
        sharePercent: memberTotal > 0 ? Math.round((c.total / memberTotal) * 100) : 0,
      }))
      .sort((a, b) => b.loggedHours - a.loggedHours)
      .slice(0, ASSIGNMENTS_PER_PERSON);

    out.set(memberId, rows);
  }

  return out;
}

/** Join one utilisation row with its member metadata and assignments. */
function toLivePerson(
  m: MemberUtilisationRow,
  meta: Map<number, MemberMeta>,
  assignments: Map<number, PersonAssignment[]>,
): LivePerson {
  const info = meta.get(m.memberId);

  return {
    memberId: m.memberId,
    name: m.displayName,
    email: info?.email ?? null,
    accountRole: info?.accountRole ?? null,
    status: info?.status ?? null,
    isArchived: m.isArchived,
    weeklyHours: m.weeklyHours,
    totalHours: m.totalHours,
    billableHours: secondsToHours(m.billableSeconds),
    entryCount: m.entryCount,
    weeksActive: m.weeksActive,
    lastActivityAt: m.lastActivityAt,
    // Null, never 0: four active members have logged nothing, and a "0%"
    // billable badge reads as a performance claim rather than missing data.
    billablePercent:
      m.totalSeconds > 0 ? Math.round((m.billableSeconds / m.totalSeconds) * 100) : null,
    utilisationPercent: m.utilisationPercent,
    hasAccount: info?.hasAccount ?? false,
    assignments: assignments.get(m.memberId) ?? [],
  };
}
