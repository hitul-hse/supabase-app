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
 * HUB PEOPLE WITHOUT A TRACKINGTIME MEMBER (2026-09-02)
 * ---------------------------------------------------
 * Three current Factorial employees -- created from the identity queue into
 * `public.people` with `source = 'factorial'` -- have no TrackingTime member at
 * all. They are colleagues, so a directory that omits them is incomplete in the
 * same way the mockup was fictional. They are read from `public.people` as a
 * SECOND source and merged in, flagged `source: "hub"`.
 *
 * The join is the exact key `time.member.hub_person_id = people.id`, never a
 * name comparison (ADR-001): a person is Hub-only when no member row -- archived
 * or not -- carries their id. RLS keeps the two reads consistent, because
 * `time.can_view_member()` is defined THROUGH `can_view_person(hub_person_id)`:
 * any person you can see whose member exists is a member you can also see, so a
 * member hidden by RLS can never be re-labelled as "Hub-only".
 *
 * The seed rows are excluded by `source`, not only by `is_active`: all eight
 * are inactive today, but "inactive" is one admin click from changing and
 * "seed" is not. scripts/check-no-mockup-people.mjs pins that exclusion.
 *
 * Everything TrackingTime would have measured is null for these people --
 * hours, billable share, utilisation, weeks active, weekly hours, and whether
 * they hold a Hub sign-in (recorded on time.member.user_id, so unknowable
 * here). The page renders every one of those as "n/a" with the reason, never 0.
 *
 * The facts above are pinned by scripts/check-people-live-source.mjs, so a sync
 * that invalidates one fails there rather than surfacing as a wrong page.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { getMemberUtilisation, type MemberUtilisationRow } from "./time-dashboard";
// Imported rather than re-implemented: the team board already normalises
// time.member.team, and live data holds both "OPERATIONS" and "Operations".
// Two copies of that rule would eventually disagree, and then the directory
// and the board would show different teams for the same person.
import { teamKey } from "./team-lead-live";
import { secondsToHours } from "@/lib/time-transform";
import { fetchAllPaged } from "@/lib/queries/paged";

type SupabaseTyped = SupabaseClient<Database>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const timeSchema = (s: SupabaseTyped) => (s as any).schema("time");

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
export type PersonSource = "trackingtime" | "hub";

export type LivePerson = {
  /**
   * Stable identity across BOTH sources: `tt-<memberId>` for a TrackingTime
   * member, `hub-<peopleId>` for a Hub-only person. A numeric member id cannot
   * key a list that now contains people who have none.
   */
  key: string;
  /** Where this row comes from. Everything below that is measured needs TrackingTime. */
  source: PersonSource;
  /** TrackingTime member id, or null for a person with no TrackingTime account. */
  memberId: number | null;
  /** public.people id when a Hub person record exists (linked member, or Hub-only). */
  hubPersonId: string | null;
  name: string;
  email: string | null;
  /** TrackingTime account role: ADMIN, MANAGER, PROJECT_MANAGER, CO_WORKER. */
  accountRole: string | null;
  /** VERIFIED / INVITED / REGISTERED — whether they ever activated the account. */
  status: string | null;
  isArchived: boolean;
  /** Nominal hours per week, from TrackingTime; null without an account. */
  weeklyHours: number | null;
  /** Null, not 0, for a Hub-only person: nothing was measured, so nothing is claimed. */
  totalHours: number | null;
  billableHours: number | null;
  entryCount: number | null;
  weeksActive: number | null;
  lastActivityAt: string | null;
  /** Billable share of logged hours, 0-100, or null when nothing is logged. */
  billablePercent: number | null;
  /** Tracked over contracted across weeks ACTIVE, or null with no basis. */
  utilisationPercent: number | null;
  /**
   * True when this member is linked to a Hub sign-in account. Null for a
   * Hub-only person: the link lives on time.member.user_id, and an empty read of
   * app_user_profile under RLS is "not visible", not "no account".
   */
  hasAccount: boolean | null;
  /**
   * Team recorded on time.member, normalised by teamKey() so "Operations"
   * and "OPERATIONS" are one team.
   *
   * Null for the many members with nothing recorded. That is a real bucket
   * the directory offers as "No team recorded" -- not a hidden row, and
   * never guessed from a role or a project.
   */
  team: string | null;
  assignments: PersonAssignment[];
};

export type PeopleDirectoryData = {
  /** Both sources, merged. The page sorts; nothing here implies an order. */
  people: LivePerson[];
  /**
   * Rows in `people` with a TrackingTime account. With `includeArchived` off
   * this is the roster the page has always counted: members minus archived
   * minus shared inboxes.
   */
  trackedCount: number;
  /** Rows in `people` that exist only in the Hub: no time.member links to them. */
  hubOnlyCount: number;
  /** Members excluded because they are archived in TrackingTime. */
  archivedCount: number;
  /** Active members not yet linked to a Hub login. Hub-only people are unknowable here. */
  unlinkedCount: number;
  /** Shared inboxes excluded from the roster (info@, jobs@). */
  mailboxCount: number;
};

const EMPTY_DIRECTORY: PeopleDirectoryData = {
  people: [],
  trackedCount: 0,
  hubOnlyCount: 0,
  archivedCount: 0,
  unlinkedCount: 0,
  mailboxCount: 0,
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
    /*
     * ONE round of parallel requests. The assignments scan used to wait for the
     * utilisation read so it could filter on the visible member ids -- which
     * serialised the two slowest reads in the app (measured on /people, the
     * slowest page: ~14s to DOM-content-loaded). The entry scan costs the same
     * with or without the member filter (it reads the whole table either way
     * under RLS), so it now runs unfiltered alongside the others, and the
     * visible-member narrowing happens where it belongs: at lookup.
     */
    const [allMembers, memberMeta, assignmentsByMember, hubPeople] = await Promise.all([
      // Archived members are fetched regardless so `archivedCount` is honest —
      // the page states how many it is hiding rather than silently shrinking.
      getMemberUtilisation(supabase, { includeArchived: true }),
      getMemberMeta(supabase),
      getAssignments(supabase, null),
      // The second source: current Hub people, some of whom have no member.
      getHubPeople(supabase),
    ]);

    /*
     * Exact-key link, ADR-001: a person is Hub-only when NO member row carries
     * their id. Archived members count as a link too -- a leaver whose member
     * is archived is not "Hub-only", they are archived, and the archived toggle
     * is the honest way to see them.
     */
    const linkedPersonIds = new Set<string>();
    for (const m of memberMeta.values()) {
      if (m.hubPersonId !== null) linkedPersonIds.add(m.hubPersonId);
    }
    /*
     * The link set is only trustworthy if the meta read succeeded. getMemberMeta
     * swallows its error into an empty map (the roster still renders names and
     * hours without it), but an empty map here would make every linked person
     * look unlinked and list all 21 of them a second time as "Hub-only". So
     * when members exist and meta does not, no Hub-only rows are derived: the
     * header then says 0 HUB-ONLY, an undercount it states, not a duplicate.
     */
    const linksReadable = memberMeta.size > 0 || allMembers.length === 0;
    const hubOnly = linksReadable
      ? hubPeople.filter((p) => !linkedPersonIds.has(p.id)).map(toHubOnlyPerson)
      : [];

    if (allMembers.length === 0 && hubOnly.length === 0) return EMPTY_DIRECTORY;

    // Inboxes are dropped before anything else, so they cannot be counted as
    // archived, as unlinked, or as staff.
    const mailboxes = allMembers.filter((m) =>
      isSharedMailbox(memberMeta.get(m.memberId)?.email ?? null),
    );
    const humans = allMembers.filter(
      (m) => !isSharedMailbox(memberMeta.get(m.memberId)?.email ?? null),
    );

    const visible = includeArchived ? humans : humans.filter((m) => !m.isArchived);

    const tracked = visible.map((m) => toLivePerson(m, memberMeta, assignmentsByMember));

    return {
      people: [...tracked, ...hubOnly],
      trackedCount: tracked.length,
      hubOnlyCount: hubOnly.length,
      archivedCount: humans.filter((m) => m.isArchived).length,
      // `=== false`, not `!`: a Hub-only person's sign-in is null (unknown),
      // and counting unknown as missing would overstate the gap.
      unlinkedCount: tracked.filter((p) => p.hasAccount === false).length,
      mailboxCount: mailboxes.length,
    };
  } catch {
    return EMPTY_DIRECTORY;
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
  team: string | null;
  /** The exact-key link to public.people; null for the many unlinked members. */
  hubPersonId: string | null;
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
      .select("id, email, role, status, user_id, team, hub_person_id");

    if (error || !data) return out;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const r of data as any[]) {
      out.set(Number(r.id), {
        email: r.email ?? null,
        accountRole: r.role ?? null,
        status: r.status ?? null,
        hasAccount: Boolean(r.user_id),
        team: teamKey(r.team),
        hubPersonId: typeof r.hub_person_id === "string" && r.hub_person_id !== "" ? r.hub_person_id : null,
      });
    }
  } catch {
    /* fall through to an empty map — the directory still renders names+hours */
  }

  return out;
}

type HubPersonRow = {
  id: string;
  name: string;
  department: string | null;
};

/**
 * Current people recorded in the Hub, whether or not TrackingTime knows them.
 *
 * `public.people` is the table the mockup lived in, and it is read here ON
 * PURPOSE and under two guards: `is_active = true`, and `source <> 'seed'` so
 * the eight invented rows can never return through this path even if one is
 * re-activated by hand. The caller narrows to the rows no member links to.
 *
 * Typed through the generated Database client, not the untyped `time` schema
 * escape hatch, so a renamed column fails at compile time rather than as an
 * empty roster at runtime. Paged through the shared helper like every other
 * roster read, `.order()` before `.range()`, so it stays deterministic.
 */
async function getHubPeople(supabase: SupabaseTyped): Promise<HubPersonRow[]> {
  try {
    const { rows } = await fetchAllPaged<HubPersonRow>((from, to) =>
      supabase
        .from("people")
        .select("id, name, department")
        .eq("is_active", true)
        .neq("source", "seed")
        .order("id", { ascending: true })
        .range(from, to),
    );
    return rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      department: r.department ?? null,
    }));
  } catch {
    // The directory still renders the TrackingTime roster; the header count
    // then says 0 Hub-only, which is an undercount the page states rather
    // than a crash. Same failure posture as getMemberMeta.
    return [];
  }
}

/**
 * A Hub-only row. Every TrackingTime-derived field is null and stays null:
 * there is no member, so no hours, no nominal week, no last activity, and no
 * way to know whether they hold a sign-in. The page owes each of those an
 * "n/a" with the reason, and this shape makes 0 unrepresentable.
 */
function toHubOnlyPerson(p: HubPersonRow): LivePerson {
  return {
    key: `hub-${p.id}`,
    source: "hub",
    memberId: null,
    hubPersonId: p.id,
    name: p.name,
    // public.people has no email column; none is invented.
    email: null,
    accountRole: null,
    status: null,
    isArchived: false,
    weeklyHours: null,
    totalHours: null,
    billableHours: null,
    entryCount: null,
    weeksActive: null,
    lastActivityAt: null,
    billablePercent: null,
    utilisationPercent: null,
    hasAccount: null,
    // people.department holds the same vocabulary as time.member.team -- the
    // propagate-people-departments script copies one onto the other -- so the
    // same normaliser applies. Null stays null: "No team recorded".
    team: teamKey(p.department),
    assignments: [],
  };
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
  /** null = every member; the caller narrows at lookup. */
  memberIds: number[] | null,
): Promise<Map<number, PersonAssignment[]>> {
  const out = new Map<number, PersonAssignment[]>();
  if (memberIds !== null && memberIds.length === 0) return out;

  // memberId -> projectId -> tally
  const tally = new Map<
    number,
    Map<number | null, { name: string; total: number; billable: number; count: number }>
  >();

  try {
    // Pages fetched in PARALLEL batches (see paged.ts for the measurements):
    // this scan of all ~5.3k entries was the directory's whole latency, and
    // awaiting each page serially paid the RLS toll one page at a time.
    const { rows: entryRows } = await fetchAllPaged<Record<string, unknown>>((from, to) => {
      let q = timeSchema(supabase)
        .from("entry")
        .select("member_id, project_id, duration_seconds, is_billable, project:project_id(name)")
        .not("duration_seconds", "is", null)
        // Ordered so paging is deterministic (see paged.ts): without it,
        // pages can repeat and skip rows and every per-person total drifts.
        .order("id", { ascending: true })
        .range(from, to);
      if (memberIds !== null) q = q.in("member_id", memberIds);
      return q;
    });

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
    key: `tt-${m.memberId}`,
    source: "trackingtime",
    memberId: m.memberId,
    hubPersonId: info?.hubPersonId ?? null,
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
    // Already normalised in getMemberMeta; null stays null.
    team: info?.team ?? null,
    assignments: assignments.get(m.memberId) ?? [],
  };
}
