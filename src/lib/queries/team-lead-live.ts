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
import { fetchAllPaged } from "@/lib/queries/paged";

type SupabaseTyped = SupabaseClient<Database>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const timeSchema = (s: SupabaseTyped) => (s as any).schema("time");

/** The default window when nothing is asked for: the last four ISO weeks. */
export const BOARD_WEEKS = 4;

/** The presets the range filter offers. Custom from/to dates bypass them. */
export type BoardPreset = "4w" | "12w" | "26w" | "month" | "prev-month" | "year";

/**
 * An inclusive date range the whole page reads. This replaced fixed week-count
 * windows (?weeks=4/8/12/26) BY REQUEST: "i dont want just 4,8,12,26 weeks
 * options, i want proper date and time filters". Presets are still the fast
 * path; arbitrary from/to is the point.
 */
export type BoardRange = {
  /** Inclusive ISO date (YYYY-MM-DD). */
  from: string;
  /** Inclusive ISO date. May exceed today; actuals are clamped when reading. */
  to: string;
  /** Which preset produced this range, for highlighting. null = custom dates. */
  preset: BoardPreset | null;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** The last n ISO weeks including the current one, as a range. */
function weeksBack(n: number, preset: BoardPreset | null): BoardRange {
  const today = todayIso();
  const monday = isoWeekMonday(today);
  const d = new Date(`${monday}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (n - 1) * 7);
  return { from: d.toISOString().slice(0, 10), to: today, preset };
}

export function boardRangeForPreset(preset: BoardPreset): BoardRange {
  const today = todayIso();
  const monthStart = `${today.slice(0, 7)}-01`;
  switch (preset) {
    case "4w":
      return weeksBack(4, preset);
    case "12w":
      return weeksBack(12, preset);
    case "26w":
      return weeksBack(26, preset);
    case "month": {
      const end = new Date(`${monthStart}T00:00:00Z`);
      end.setUTCMonth(end.getUTCMonth() + 1);
      end.setUTCDate(0);
      return { from: monthStart, to: end.toISOString().slice(0, 10), preset };
    }
    case "prev-month": {
      const start = new Date(`${monthStart}T00:00:00Z`);
      start.setUTCMonth(start.getUTCMonth() - 1);
      const end = new Date(`${monthStart}T00:00:00Z`);
      end.setUTCDate(0);
      return {
        from: start.toISOString().slice(0, 10),
        to: end.toISOString().slice(0, 10),
        preset,
      };
    }
    case "year":
      return { from: `${today.slice(0, 4)}-01-01`, to: today, preset };
  }
}

/**
 * Parse the URL into a range. Custom from/to (both valid, ordered) wins; then a
 * named preset; then the legacy ?weeks= numbers, kept so old links and the old
 * check scripts do not break; then the default.
 */
export function parseBoardRange(params: {
  weeks?: string;
  range?: string;
  from?: string;
  to?: string;
}): BoardRange {
  const { from, to } = params;
  if (from && to && ISO_DATE.test(from) && ISO_DATE.test(to) && from <= to) {
    return { from, to, preset: null };
  }
  const named = params.range as BoardPreset | undefined;
  if (named && ["4w", "12w", "26w", "month", "prev-month", "year"].includes(named)) {
    return boardRangeForPreset(named);
  }
  const legacy = Number(params.weeks);
  if ([4, 8, 12, 26].includes(legacy)) {
    return weeksBack(legacy, legacy === 4 ? "4w" : legacy === 12 ? "12w" : legacy === 26 ? "26w" : null);
  }
  return boardRangeForPreset("4w");
}

/**
 * Week columns are capped at a year. Uncapped, a custom 2020->2026 range would
 * render thousands of empty cells; clamped FROM THE LEFT because the recent end
 * is the end a lead is reading.
 */
const MAX_BOARD_WEEKS = 53;

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
  /** The range every figure on the page covers. */
  range: BoardRange;
  /** This calendar month against the previous one, or null with no data. */
  monthComparison: MonthComparison | null;
  /** Travel/internal/client composition per person over the range. */
  travelRows: TravelRow[];
};

/** One person's movement between last month and this one. */
export type MonthDelta = {
  memberId: number;
  name: string;
  prevHours: number;
  currHours: number;
  /** currHours - prevHours, rounded to 0.1h. */
  deltaHours: number;
};

/**
 * This month against last month -- the core comparison the analysis spec ranks
 * first. Always CALENDAR months anchored at today, independent of the selected
 * range: "are we doing more than last month" is a fixed question, and tying it
 * to the range filter would quietly change what the figure means.
 */
export type MonthComparison = {
  /** e.g. "AUG". */
  currLabel: string;
  prevLabel: string;
  orgPrevHours: number;
  orgCurrHours: number;
  orgPrevBillablePercent: number | null;
  orgCurrBillablePercent: number | null;
  /**
   * The current month projected to month-end at the observed per-working-day
   * pace, or null before any working day has elapsed. Stated because a partial
   * month always reads as a collapse next to a complete one.
   */
  orgPaceHours: number | null;
  /** Sorted by delta, biggest riser first. */
  deltas: MonthDelta[];
};

/**
 * Where one person's tracked time goes: client work, paid travel, unpaid
 * travel, internal. Travel is 22% of all tracked time in the live data and
 * unpaid travel is the actionable slice -- see the analysis spec (#7).
 */
export type TravelRow = {
  memberId: number;
  name: string;
  clientHours: number;
  paidTravelHours: number;
  unpaidTravelHours: number;
  internalHours: number;
  totalHours: number;
};

/** Working days (Mon-Fri) between two inclusive ISO dates. Holidays are not
 * modelled; the pace figure says "working-day pace", not "business-day pace". */
function workingDaysBetween(fromIso: string, toIso: string): number {
  let n = 0;
  const d = new Date(`${fromIso}T00:00:00Z`);
  const end = new Date(`${toIso}T00:00:00Z`);
  while (d <= end) {
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) n += 1;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return n;
}

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
  range?: BoardRange,
): Promise<TeamLeadBoardData> {
  const today = todayIso();
  const thisMonday = isoWeekMonday(today);
  const r = range ?? boardRangeForPreset("4w");

  // Week columns spanning the range, oldest first. Clamped from the left at a
  // year of columns (MAX_BOARD_WEEKS) -- see the constant.
  const firstMonday = isoWeekMonday(r.from);
  const lastMonday = isoWeekMonday(r.to <= today ? r.to : today);
  const weeks: BoardWeek[] = [];
  for (
    const d = new Date(`${firstMonday}T00:00:00Z`);
    d.toISOString().slice(0, 10) <= lastMonday;
    d.setUTCDate(d.getUTCDate() + 7)
  ) {
    const weekStart = d.toISOString().slice(0, 10);
    weeks.push({
      weekStart,
      label: `W${isoWeekNumber(weekStart)}`,
      isCurrent: weekStart === thisMonday,
    });
  }
  while (weeks.length > MAX_BOARD_WEEKS) weeks.shift();
  if (weeks.length === 0) {
    weeks.push({
      weekStart: lastMonday,
      label: `W${isoWeekNumber(lastMonday)}`,
      isCurrent: lastMonday === thisMonday,
    });
  }

  const windowStart = weeks[0].weekStart;
  // Actuals stop at the range end or today, whichever is earlier. The live data
  // contains future-dated TRACKED entries (retainers pre-logged months ahead,
  // 430h of them); without this clamp they would book hours into weeks that
  // have not happened.
  const effTo = r.to <= today ? r.to : today;
  const weekIndex = new Map(weeks.map((w, i) => [w.weekStart, i]));

  // Month-over-month is anchored at TODAY's calendar month, not at the range --
  // see MonthComparison. Its scan is separate and runs in parallel below.
  const monthStart = `${today.slice(0, 7)}-01`;
  const prevMonthStart = (() => {
    const d = new Date(`${monthStart}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - 1);
    return d.toISOString().slice(0, 10);
  })();

  type MemberRow = {
    id: number; display_name: string | null; email: string | null;
    is_archived: boolean | null; weekly_hours: number | null; team: string | null;
  };
  type EntryRow = {
    member_id: number | null; duration_seconds: number | null;
    started_at: string | null; is_billable: boolean | null; service_id: number | null;
  };
  type MomRow = {
    member_id: number | null; duration_seconds: number | null;
    started_at: string | null; is_billable: boolean | null;
  };
  type ServiceRow = {
    id: number; is_travel: boolean | null; is_paid_travel: boolean | null; is_internal: boolean | null;
  };

  /*
   * Everything in ONE round of parallel requests. These used to run in
   * sequence (members, then a page-by-page entry loop, then projects), which
   * serialised both the network and the per-row RLS evaluation.
   *
   * Both entry scans filter is_calendar = false. Calendar placeholders are
   * imported plans, not work -- 2,438 of the 5,260 live entries -- and counting
   * them inflated every cell of this board. Measured in the analysis spec:
   * 3,288 calendar hours next to 5,026 tracked ones.
   */
  const emptyPaged = { rows: [] as EntryRow[], truncated: false };
  const emptyMom = { rows: [] as MomRow[], truncated: false };
  const [memberRes, entryRes, momRes, serviceRes, overBudgetProjects] = await Promise.all([
    timeSchema(supabase)
      .from("member")
      .select("id, display_name, email, is_archived, weekly_hours, team"),
    fetchAllPaged<EntryRow>((from, to) =>
      timeSchema(supabase)
        .from("entry")
        .select("member_id, duration_seconds, started_at, is_billable, service_id")
        .not("duration_seconds", "is", null)
        .eq("is_calendar", false)
        .gte("started_at", `${windowStart}T00:00:00Z`)
        .lte("started_at", `${effTo}T23:59:59Z`)
        .range(from, to),
    ).catch(() => emptyPaged),
    fetchAllPaged<MomRow>((from, to) =>
      timeSchema(supabase)
        .from("entry")
        .select("member_id, duration_seconds, started_at, is_billable")
        .not("duration_seconds", "is", null)
        .eq("is_calendar", false)
        .gte("started_at", `${prevMonthStart}T00:00:00Z`)
        .lte("started_at", `${today}T23:59:59Z`)
        .range(from, to),
    ).catch(() => emptyMom),
    timeSchema(supabase).from("service").select("id, is_travel, is_paid_travel, is_internal"),
    getOverBudgetProjects(supabase),
  ]);

  if (memberRes.error || !memberRes.data) {
    return {
      weeks,
      rows: [],
      idleCount: 0,
      weeklyHoursAreNominal: false,
      teamUtilisationPercent: null,
      activeCount: 0,
      overBudgetProjects: [],
      range: r,
      monthComparison: null,
      travelRows: [],
    };
  }

  const roster = (memberRes.data as MemberRow[]).filter((m) => !isSharedMailbox(m.email));
  const byId = new Map(roster.map((m) => [Number(m.id), m]));

  const services = new Map<number, ServiceRow>(
    ((serviceRes.data ?? []) as ServiceRow[]).map((s) => [Number(s.id), s]),
  );

  // Per member: per-week seconds for the grid, and the travel split -- one pass
  // over the same rows, so the two figures cannot disagree about the window.
  const tally = new Map<number, number[]>();
  const travel = new Map<number, { client: number; paid: number; unpaid: number; internal: number }>();
  for (const row of entryRes.rows) {
    const memberId = row.member_id === null ? null : Number(row.member_id);
    if (memberId === null || !byId.has(memberId)) continue;
    const day = (row.started_at ?? "").slice(0, 10);
    if (!day) continue;
    const seconds = Number(row.duration_seconds) || 0;

    const idx = weekIndex.get(isoWeekMonday(day));
    if (idx !== undefined) {
      if (!tally.has(memberId)) tally.set(memberId, new Array(weeks.length).fill(0));
      tally.get(memberId)![idx] += seconds;
    }

    if (!travel.has(memberId)) travel.set(memberId, { client: 0, paid: 0, unpaid: 0, internal: 0 });
    const t = travel.get(memberId)!;
    const svc = row.service_id === null ? undefined : services.get(Number(row.service_id));
    if (svc?.is_travel) {
      if (svc.is_paid_travel) t.paid += seconds;
      else t.unpaid += seconds;
    } else if (svc?.is_internal) {
      t.internal += seconds;
    } else {
      t.client += seconds;
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
  for (const row of rows) {
    if (row.isArchived) continue;
    trackedSeconds += row.totalHours * 3600;
    // Only weeks the person actually appears in, matching getMemberUtilisation.
    const weeksWithTime = row.cells.filter((c) => c.hours !== null).length;
    contractedSeconds += row.weeklyHours * 3600 * weeksWithTime;
  }

  /* ------------------------------------------------- month over month */
  const mom = new Map<number, { prev: number; curr: number }>();
  let orgPrev = 0;
  let orgCurr = 0;
  let orgPrevBillable = 0;
  let orgCurrBillable = 0;
  for (const row of momRes.rows) {
    const memberId = row.member_id === null ? null : Number(row.member_id);
    if (memberId === null || !byId.has(memberId)) continue;
    const day = (row.started_at ?? "").slice(0, 10);
    if (!day) continue;
    const seconds = Number(row.duration_seconds) || 0;
    const isCurr = day >= monthStart;
    if (!mom.has(memberId)) mom.set(memberId, { prev: 0, curr: 0 });
    const cell = mom.get(memberId)!;
    if (isCurr) {
      cell.curr += seconds;
      orgCurr += seconds;
      if (row.is_billable) orgCurrBillable += seconds;
    } else {
      cell.prev += seconds;
      orgPrev += seconds;
      if (row.is_billable) orgPrevBillable += seconds;
    }
  }

  let monthComparison: MonthComparison | null = null;
  if (orgPrev > 0 || orgCurr > 0) {
    const monthEnd = (() => {
      const d = new Date(`${monthStart}T00:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() + 1);
      d.setUTCDate(0);
      return d.toISOString().slice(0, 10);
    })();
    const elapsed = workingDaysBetween(monthStart, today);
    const totalDays = workingDaysBetween(monthStart, monthEnd);
    const monthLabel = (iso: string) =>
      new Date(`${iso}T00:00:00Z`)
        .toLocaleString("en-GB", { month: "short", timeZone: "UTC" })
        .toUpperCase();
    const deltas: MonthDelta[] = [...mom.entries()]
      .map(([memberId, v]) => ({
        memberId,
        name: byId.get(memberId)?.display_name ?? `Member ${memberId}`,
        prevHours: Math.round(v.prev / 360) / 10,
        currHours: Math.round(v.curr / 360) / 10,
        deltaHours: Math.round((v.curr - v.prev) / 360) / 10,
      }))
      // Zero-movement rows say nothing a reader needs; the org line covers them.
      .filter((d) => d.prevHours > 0 || d.currHours > 0)
      .sort((a, b) => b.deltaHours - a.deltaHours);

    monthComparison = {
      currLabel: monthLabel(monthStart),
      prevLabel: monthLabel(prevMonthStart),
      orgPrevHours: Math.round(orgPrev / 360) / 10,
      orgCurrHours: Math.round(orgCurr / 360) / 10,
      orgPrevBillablePercent: orgPrev > 0 ? Math.round((orgPrevBillable / orgPrev) * 100) : null,
      orgCurrBillablePercent: orgCurr > 0 ? Math.round((orgCurrBillable / orgCurr) * 100) : null,
      orgPaceHours:
        elapsed > 0 ? Math.round(((orgCurr / elapsed) * totalDays) / 360) / 10 : null,
      deltas,
    };
  }

  /* --------------------------------------------------- travel burden */
  const travelRows: TravelRow[] = [...travel.entries()]
    .map(([memberId, t]) => {
      const total = t.client + t.paid + t.unpaid + t.internal;
      return {
        memberId,
        name: byId.get(memberId)?.display_name ?? `Member ${memberId}`,
        clientHours: Math.round(t.client / 360) / 10,
        paidTravelHours: Math.round(t.paid / 360) / 10,
        unpaidTravelHours: Math.round(t.unpaid / 360) / 10,
        internalHours: Math.round(t.internal / 360) / 10,
        totalHours: Math.round(total / 360) / 10,
      };
    })
    .filter((t) => t.totalHours > 0)
    .sort((a, b) => b.totalHours - a.totalHours);

  return {
    weeks,
    rows,
    idleCount: Math.max(0, contracted - rows.filter((row) => !row.isArchived).length),
    // One distinct value across the whole roster means it is the account default
    // rather than anybody's negotiated hours.
    weeklyHoursAreNominal: distinctWeekly.size === 1,
    teamUtilisationPercent:
      contractedSeconds > 0 ? Math.round((trackedSeconds / contractedSeconds) * 100) : null,
    activeCount: rows.filter((row) => !row.isArchived).length,
    overBudgetProjects,
    range: r,
    monthComparison,
    travelRows,
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
