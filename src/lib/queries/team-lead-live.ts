/**
 * The Team Lead workload board, from measured time rather than seeded rows.
 *
 * WHAT WAS THERE. `weekly_bookings`: twenty hand-written rows covering five
 * mockup people (`emp-1`, `emp-2`, `emp-4`, `emp-5`, `emp-8`) across four week
 * labels — "W31" to "W34" — that were literal strings in the table, not dates. So
 * the board a team lead opened to decide who was overloaded showed Anna Brandt,
 * C. Haas, P. Novak and R. Yilmaz, none of whom exist, with hours nobody
 * measured. The People tab had already been rewired to the real 49-person
 * roster, which made the contradiction visible: two tabs, two different
 * companies.
 *
 * WHAT IT READS NOW. `time.entry`, bucketed per member per ISO week. Eleven real
 * people have logged hours in the last four weeks, so this is a rewire rather
 * than a removal — there was enough measured data to fill the board honestly.
 *
 * THE WINDOW IS BOUNDED AT TODAY, and that is load-bearing. TrackingTime stores
 * PLANNED entries months ahead; nine members carry future-dated time, one out to
 * 2026-12-31. An unbounded board would show a colleague "booked" for work they
 * have not started, which on a page used to reassign people is worse than showing
 * nothing. The bound matches `getOrgWeeks`, so Team Lead and Overview agree.
 *
 * WEEKS ARE DATES, NOT LABELS. Each column is an ISO week Monday, computed in
 * UTC to match how `week_start` is stored elsewhere, and rendered as "W##" for
 * display only. The old fixed `w31`..`w34` fields meant the board silently
 * described the wrong weeks the moment the calendar moved past week 34.
 *
 * WHAT IS DELIBERATELY ABSENT. No timesheet status and no certificate expiry.
 * Those came from `people.timesheet_status` and `people.certificate_text` —
 * invented strings ("SIFA EXP 12 SEP") for data no system here holds. A board
 * that says "CERTS OK" when nothing tracks certificates is a liability, so the
 * columns are gone rather than filled with a guess.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { isSharedMailbox } from "./people-live";
import { fetchAllPaged } from "./paged";

type SupabaseTyped = SupabaseClient<Database>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const timeSchema = (s: SupabaseTyped) => (s as any).schema("time");

/** PostgREST caps one response at 1000 rows; page rather than truncate. */
const PAGE = 1000;

/** The default window, and the windows the board offers. */
export const BOARD_WEEKS = 4;
export const BOARD_WINDOWS = [4, 8, 12, 26] as const;
export type BoardWindow = (typeof BOARD_WINDOWS)[number];

/** Parse a ?weeks= param to an allowed window; anything else is the default. */
export function parseBoardWindow(raw: string | undefined): BoardWindow {
  const n = Number(raw);
  return (BOARD_WINDOWS as readonly number[]).includes(n) ? (n as BoardWindow) : BOARD_WEEKS;
}

/**
 * Normalise a stored team value to a comparable key.
 *
 * Uppercased because that is the convention teams.ts stores ("ORGA", "TECH"), while
 * time.member.team has arrived from hand entry in both cases. Null stays null: an
 * unrecorded team is a fact to show, not a value to invent.
 */
export function teamKey(raw: string | null | undefined): string | null {
  const t = (raw ?? "").trim().toUpperCase();
  return t === "" ? null : t;
}

/** Projects on the team panel: the few that need a decision, not a ledger. */
const TEAM_PROJECTS = 5;

/**
 * The ISO week Monday containing `iso`, in UTC.
 *
 * UTC throughout: entries are timestamptz and `week_start` is stored as a UTC
 * date elsewhere, so using local midnight would shift a person's hours into the
 * neighbouring week for anyone west of Greenwich.
 */
export function isoWeekMonday(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - (day === 0 ? 6 : day - 1));
  return d.toISOString().slice(0, 10);
}

/** ISO week number, for the column label only. */
export function isoWeekNumber(mondayIso: string): number {
  const d = new Date(`${mondayIso}T00:00:00Z`);
  // The Thursday of this week decides the year the week belongs to.
  d.setUTCDate(d.getUTCDate() + 3);
  const year = d.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const firstThursday = new Date(jan4);
  firstThursday.setUTCDate(jan4.getUTCDate() + 3 - ((jan4.getUTCDay() + 6) % 7));
  return 1 + Math.round((d.getTime() - firstThursday.getTime()) / 604_800_000);
}

/** One week column: the Monday it starts, and its display label. */
export type BoardWeek = {
  /** ISO date of the Monday, e.g. "2026-08-17". */
  weekStart: string;
  /** Display label, e.g. "W34". */
  label: string;
  /** True for the week currently in progress, which is only partly filled. */
  isCurrent: boolean;
};

/** How one person's week compares with their contracted hours. */
export type BoardCellStatus = "over" | "under" | "normal" | "none";

export type BoardCell = {
  hours: number | null;
  status: BoardCellStatus;
};

export type BoardRow = {
  memberId: number;
  name: string;
  /**
   * The member's team, normalised to the uppercase keys teams.ts defines, or null
   * when nobody has recorded one. Live data holds both "OPERATIONS" and "Operations";
   * without normalisation one team would render as two.
   */
  team: string | null;
  isArchived: boolean;
  /** Contracted hours per week from TrackingTime (an account-wide default). */
  weeklyHours: number;
  /** One cell per week in `weeks`, same order. */
  cells: BoardCell[];
  /** Total logged hours across the window. */
  totalHours: number;
};

export type TeamLeadBoardData = {
  weeks: BoardWeek[];
  rows: BoardRow[];
  /** Members with a contract but no logged time in the window. */
  idleCount: number;
  /**
   * Whether contracted hours are a real contract or TrackingTime's default.
   * Every member currently reports exactly 40h, which is the account default, so
   * the UI must say "nominal" rather than implying a signed figure.
   */
  weeklyHoursAreNominal: boolean;
  /** Team-wide tracked-over-contracted across the window, or null with no basis. */
  teamUtilisationPercent: number | null;
  /** People who logged anything in the window. */
  activeCount: number;
  /** Projects over their estimate, worth a lead's attention. */
  overBudgetProjects: TeamProject[];
};

/**
 * One project on the team panel.
 *
 * Only projects that have BOTH an estimate and logged time appear: a burn
 * percentage needs both, and 83 of 334 live projects have no estimate at all.
 * Showing those as "0%" would read as healthy when the truth is "unbudgeted".
 */
export type TeamProject = {
  projectId: number;
  name: string;
  loggedHours: number;
  estimatedHours: number;
  burnPercent: number;
};


/**
 * Classify a week against contracted hours.
 *
 * The thresholds are deliberately wide. This board exists to spot someone
 * drowning or idle, not to police a timesheet to the hour, and a narrow band
 * would paint most of the grid amber for normal variation.
 */
function classify(hours: number | null, weeklyHours: number): BoardCellStatus {
  if (hours === null || hours === 0) return "none";
  if (weeklyHours <= 0) return "normal";
  const ratio = hours / weeklyHours;
  if (ratio > 1.15) return "over";
  if (ratio < 0.5) return "under";
  return "normal";
}

export async function getLiveTeamLeadBoard(
  supabase: SupabaseTyped,
  windowWeeks: BoardWindow = BOARD_WEEKS,
): Promise<TeamLeadBoardData> {
  const today = new Date().toISOString().slice(0, 10);
  const thisMonday = isoWeekMonday(today);

  // The window: the current week plus the three before it. The current week is
  // included because a lead needs to see the week they are in, even part-filled.
  const weeks: BoardWeek[] = [];
  for (let back = windowWeeks - 1; back >= 0; back -= 1) {
    const d = new Date(`${thisMonday}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - back * 7);
    const weekStart = d.toISOString().slice(0, 10);
    weeks.push({
      weekStart,
      label: `W${isoWeekNumber(weekStart)}`,
      isCurrent: weekStart === thisMonday,
    });
  }
  const windowStart = weeks[0].weekStart;
  const weekIndex = new Map(weeks.map((w, i) => [w.weekStart, i]));

  const { data: members, error: memberError } = await timeSchema(supabase)
    .from("member")
    .select("id, display_name, email, is_archived, weekly_hours, team");

  if (memberError || !members) return {
    weeks,
    rows: [],
    idleCount: 0,
    weeklyHoursAreNominal: false,
    teamUtilisationPercent: null,
    activeCount: 0,
    overBudgetProjects: [],
  };

  type MemberRow = {
    id: number; display_name: string | null; email: string | null;
    is_archived: boolean | null; weekly_hours: number | null; team: string | null;
  };
  const roster = (members as MemberRow[]).filter((m) => !isSharedMailbox(m.email));
  const byId = new Map(roster.map((m) => [Number(m.id), m]));

  // Per member, per week seconds. Aggregated here because PostgREST cannot
  // GROUP BY, and paged because a single request truncates at 1000 rows with no
  // error -- which over 5,218 entries would quietly under-report everyone.
  // Pages fetched in parallel (paged.ts): the serial loop paid the per-row RLS
  // toll once per awaited page and dominated the board's latency at wide windows.
  const tally = new Map<number, number[]>();
  type EntryRow = { member_id: number | null; duration_seconds: number | null; started_at: string | null };
  let entryRows: EntryRow[] = [];
  try {
    ({ rows: entryRows } = await fetchAllPaged<EntryRow>((from, to) =>
      timeSchema(supabase)
        .from("entry")
        .select("member_id, duration_seconds, started_at")
        .not("duration_seconds", "is", null)
        // Bounded both ends: the window start, and today so planned work is out.
        .gte("started_at", `${windowStart}T00:00:00Z`)
        .lte("started_at", `${today}T23:59:59Z`)
        .range(from, to),
    ));
  } catch {
    entryRows = [];
  }
  {
    for (const row of entryRows) {
      const memberId = row.member_id === null ? null : Number(row.member_id);
      if (memberId === null || !byId.has(memberId)) continue;
      const day = (row.started_at ?? "").slice(0, 10);
      if (!day) continue;
      const idx = weekIndex.get(isoWeekMonday(day));
      if (idx === undefined) continue;

      if (!tally.has(memberId)) tally.set(memberId, new Array(weeks.length).fill(0));
      tally.get(memberId)![idx] += Number(row.duration_seconds) || 0;
    }
  }

  const rows: BoardRow[] = [];
  for (const [memberId, seconds] of tally) {
    const m = byId.get(memberId)!;
    const weeklyHours = Number(m.weekly_hours) || 0;
    const cells = seconds.map((s) => {
      const hours = s > 0 ? Math.round(s / 360) / 10 : null;
      return { hours, status: classify(hours, weeklyHours) };
    });
    rows.push({
      memberId,
      name: m.display_name ?? `Member ${memberId}`,
      team: teamKey(m.team),
      isArchived: Boolean(m.is_archived),
      weeklyHours,
      cells,
      totalHours: Math.round(seconds.reduce((a, b) => a + b, 0) / 360) / 10,
    });
  }

  // Busiest first: the board's purpose is spotting overload.
  rows.sort((a, b) => b.totalHours - a.totalHours);

  const contracted = roster.filter((m) => !m.is_archived).length;
  const distinctWeekly = new Set(roster.map((m) => Number(m.weekly_hours) || 0));

  // Team utilisation over THIS window, not all time: a lead cares whether the
  // team is stretched now. Only people who logged something are in the
  // denominator, because dividing by the full roster would report the whole team
  // as idle whenever most of it is on other work.
  let trackedSeconds = 0;
  let contractedSeconds = 0;
  for (const r of rows) {
    if (r.isArchived) continue;
    trackedSeconds += r.totalHours * 3600;
    // Only weeks the person actually appears in, matching getMemberUtilisation.
    const weeksWithTime = r.cells.filter((c) => c.hours !== null).length;
    contractedSeconds += r.weeklyHours * 3600 * weeksWithTime;
  }

  const overBudgetProjects = await getOverBudgetProjects(supabase);

  return {
    weeks,
    rows,
    idleCount: Math.max(0, contracted - rows.filter((r) => !r.isArchived).length),
    // One distinct value across the whole roster means it is the account default
    // rather than anybody's negotiated hours.
    weeklyHoursAreNominal: distinctWeekly.size === 1,
    teamUtilisationPercent:
      contractedSeconds > 0 ? Math.round((trackedSeconds / contractedSeconds) * 100) : null,
    activeCount: rows.filter((r) => !r.isArchived).length,
    overBudgetProjects,
  };
}

/**
 * Projects that have burned past their estimate.
 *
 * Replaces three hardcoded projects ("Site risk assessment 2026", 1 164/1 200 h)
 * that existed only in the component. Sorted worst-first and capped, because a
 * lead needs the few that need intervention, not a 142-row ledger.
 *
 * Requires BOTH an estimate and logged time. 83 of 334 live projects carry no
 * estimate; rendering those at 0% would read as healthy when the honest answer is
 * "nobody budgeted this".
 */
async function getOverBudgetProjects(supabase: SupabaseTyped): Promise<TeamProject[]> {
  const { data, error } = await timeSchema(supabase)
    .from("project_summary")
    .select("project_id, project_name, estimated_hours, total_seconds, is_archived, burn_percent")
    .eq("is_archived", false)
    .not("estimated_hours", "is", null)
    .gt("estimated_hours", 0)
    .order("burn_percent", { ascending: false })
    .limit(TEAM_PROJECTS);

  if (error || !data) return [];

  type SummaryRow = {
    project_id: number; project_name: string | null;
    estimated_hours: number | null; total_seconds: number | null; burn_percent: number | null;
  };
  return (data as SummaryRow[])
    .filter((p) => Number(p.total_seconds) > 0)
    .map((p) => ({
      projectId: Number(p.project_id),
      name: p.project_name ?? `Project ${p.project_id}`,
      loggedHours: Math.round(Number(p.total_seconds) / 360) / 10,
      estimatedHours: Number(p.estimated_hours),
      burnPercent: Math.round(Number(p.burn_percent ?? 0)),
    }));
}
