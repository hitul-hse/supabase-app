/**
 * Real figures for the Hub landing page (`/`), computed from imported
 * TrackingTime rather than the seeded demo tables.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The Overview page is the first thing every signed-in person sees, and until
 * now every number on it was invented. `public.executive_metrics` held five
 * hand-written STRINGS -- "73.4%", "18 240 / 24 900", "612 OPEN TASKS" -- seeded
 * once for a frontend mockup and never touched again. `public.team_utilisations`
 * held five fictional teams. `public.sync_sources` claimed ASANA, FACTORIAL,
 * SAMDOCK and HUBSPOT were all "ok, 4m ago" when none of those pipelines has
 * ever run.
 *
 * None of it errored. It rendered as a confident, precise, well-designed
 * business-intelligence page, and it was fiction end to end. That is the failure
 * class this module exists to remove: not a crash, a plausible wrong number on
 * the page people use to make decisions.
 *
 * WHAT REPLACES IT
 * ----------------
 * Everything here derives from `time.*` -- the 5,218 entries, 49 members and
 * 334 projects actually imported from the TrackingTime API -- reusing the
 * already-tested reads in `time-dashboard.ts` rather than issuing new queries.
 * That reuse is deliberate: those functions encode corrections that are easy to
 * get wrong and expensive to get wrong silently (billable divided by TOTAL not
 * tracked; utilisation divided by weeks ACTIVE not weeks elapsed; MAX not SUM
 * for distinct member counts across weeks).
 *
 * THE RULE THIS MODULE FOLLOWS
 * ----------------------------
 * A metric with no data underneath returns `null`, and the page renders "n/a".
 * It never returns 0. "Nobody has logged anything" and "the value is zero" are
 * different claims, and on a KPI strip the difference is the whole point --
 * a green 0% reads as a measurement, not as an absence.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import {
  getOrgWeeks,
  summariseOrgWeeks,
  getProjectSummary,
  getMemberUtilisation,
  type OrgWeekRow,
} from "./time-dashboard";
import { getRosterCounts, isSharedMailbox } from "./people-live";
import {
  boardRangeForPreset,
  isoWeekMonday,
  isoWeekNumber,
  teamKey,
  type BoardPreset,
  type BoardRange,
} from "./team-lead-live";
import { fetchAllPaged } from "./paged";
import { secondsToHours } from "@/lib/time-transform";
import { teamLabel } from "@/lib/teams";

type SupabaseTyped = SupabaseClient<Database>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const timeSchema = (s: SupabaseTyped) => (s as any).schema("time");

/** Weeks of history behind the landing page's trend chart and KPI strip. */
export const OVERVIEW_WEEKS = 12;

/** Rows in the landing page's project ledger. The full list lives at /projects. */
const LEDGER_ROWS = 8;

/**
 * The Overview's period filter reuses the Team Lead board's range grammar --
 * the SAME presets, the same custom from/to parsing, the same URL keys. Two
 * filter surfaces one click apart that disagree about what "?range=month"
 * means is a worse defect than either surface lacking a control, because the
 * reader has no way to tell which dialect they are reading.
 *
 * Only the DEFAULT differs, and deliberately: the board defaults to 4 weeks
 * because a lead reads the near term, and this page defaults to the 12 weeks
 * it has always shown, so a reader who never touches the filter sees exactly
 * what they saw before.
 */
export type OverviewPreset = BoardPreset;
export type OverviewRange = BoardRange;

/** The preset that reproduces the historical hardcoded window. */
export const OVERVIEW_DEFAULT_PRESET: OverviewPreset = "12w";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const PRESET_KEYS: OverviewPreset[] = [
  "4w",
  "12w",
  "26w",
  "month",
  "prev-month",
  "year",
];

/**
 * The URL value for "people with no team recorded".
 *
 * A sentinel rather than an empty string, because empty means "no filter" and
 * the no-team bucket is a REAL, selectable population -- 14 of the 19 people on
 * the roster are in it. Hiding them behind "all teams" would make the one
 * honest answer to "who is unassigned?" unreachable from this page.
 *
 * Lowercase, while every real team key is uppercased by teamKey(), so the
 * sentinel cannot collide with a stored team value.
 */
export const NO_TEAM = "none";

/** Parse the URL into an Overview range. Same precedence as parseBoardRange. */
export function parseOverviewRange(params: {
  range?: string;
  from?: string;
  to?: string;
}): OverviewRange {
  const { from, to } = params;
  if (from && to && ISO_DATE.test(from) && ISO_DATE.test(to) && from <= to) {
    return { from, to, preset: null };
  }
  const named = params.range as OverviewPreset | undefined;
  if (named && PRESET_KEYS.includes(named)) return boardRangeForPreset(named);
  return boardRangeForPreset(OVERVIEW_DEFAULT_PRESET);
}

/**
 * Parse the team parameter. Anything unrecognised falls back to "all teams",
 * because a filter must never be able to empty the page.
 */
export function parseOverviewTeam(raw: string | undefined): string | null {
  if (!raw) return null;
  if (raw.toLowerCase() === NO_TEAM) return NO_TEAM;
  return teamKey(raw);
}

/** One selectable team on the filter bar, with the headcount behind it. */
export type OverviewTeamOption = {
  /** Stored team key, or NO_TEAM for the unassigned bucket. */
  key: string;
  label: string;
  /** People on the roster carrying this team. */
  people: number;
};

/**
 * How much of the roster the active team filter actually covers.
 *
 * Stated on screen because only 5 of 19 people have a team recorded: without
 * the denominator, filtering to Tech makes every figure collapse and looks
 * exactly like a business emergency rather than like missing metadata.
 */
export type OverviewTeamCoverage = {
  /** People on the roster (non-archived, excluding shared mailboxes). */
  totalPeople: number;
  /** Of those, how many carry any team at all. */
  withTeam: number;
  /** Of those, how many match the active filter. null when no filter. */
  inSelected: number | null;
};

/**
 * Which figures on the page could NOT be narrowed to the selected period, and
 * therefore have to say so.
 *
 * The rule this encodes: a page may mix scopes, but it may never mix them
 * SILENTLY. Every flag here has a visible label attached at the render site.
 */
export type OverviewScopeNotes = {
  /** Per-person utilisation comes from time.member_utilisation: all time. */
  utilisationAllTime: boolean;
  /** The project ledger comes from time.project_summary: all time. */
  projectsAllTime: boolean;
  /** Header counts (projects, customers) are table counts, not period figures. */
  countsAllTime: boolean;
  /**
   * True when the weekly figures were snapped out to whole ISO weeks because
   * the requested range starts or ends mid-week. time.org_week aggregates by
   * week, so a mid-week boundary cannot be honoured to the day.
   */
  snappedToWholeWeeks: boolean;
};

/**
 * A single KPI card.
 *
 * `value` is null when there is nothing to measure, and the card renders "n/a".
 * `tone` drives colour only -- it is never the sole carrier of meaning, because
 * a red bar and a green bar look identical to a colourblind reader and to a
 * printed page.
 */
/**
 * A user-visible string as a message-catalogue reference rather than English
 * text: the key under `overview` in messages/{en,de}.json plus the values the
 * message interpolates. The page renders it through next-intl, so the query
 * layer never has to know which language the reader chose.
 *
 * Numbers that must render exactly (de-DE thousands separators) are passed
 * PRE-FORMATTED as strings; bare numbers are passed only where ICU needs them
 * for plural selection.
 */
export type OverviewMessage = {
  key: string;
  values?: Record<string, string | number>;
};

export type OverviewMetric = {
  key: string;
  label: OverviewMessage;
  /** Pre-formatted for display, or null when there is no data behind it. */
  value: string | null;
  subtext: OverviewMessage;
  tone: "neutral" | "good" | "warning" | "critical";
  /** 0-100 for a progress bar, or null for a plain figure. */
  progressPercent: number | null;
};

export type TeamUtilisation = {
  /** Member display name -- TrackingTime has no team/department concept. */
  name: string;
  /** Tracked hours over contracted hours, 0-∞, or null with no contract. */
  percent: number | null;
  hours: number;
  weeksActive: number;
  tone: "neutral" | "good" | "warning" | "critical";
  /** The person's team, or null when nobody recorded one. */
  team: string | null;
};

export type OverviewProject = {
  id: number;
  name: string;
  customerName: string | null;
  loggedHours: number;
  billableHours: number;
  estimatedHours: number | null;
  burnPercent: number | null;
  tone: "neutral" | "good" | "warning" | "critical";
};

export type OverviewData = {
  metrics: OverviewMetric[];
  weeks: OrgWeekRow[];
  teams: TeamUtilisation[];
  projects: OverviewProject[];
  counts: {
    activeMembers: number;
    activeProjects: number;
    customers: number;
    currentQuarter: string;
  };
  /** People with a TrackingTime record but no Hub sign-in. */
  unlinkedPeople: number;
  /** The period every weekly figure on the page covers. */
  range: OverviewRange;
  /** ISO week labels of the first and last week actually counted, or null. */
  coveredWeeks: { first: string; last: string; count: number } | null;
  /** The active team filter: a team key, NO_TEAM, or null for all teams. */
  team: string | null;
  /** Teams offered by the filter, including the no-team bucket. */
  teamOptions: OverviewTeamOption[];
  teamCoverage: OverviewTeamCoverage;
  scopeNotes: OverviewScopeNotes;
};

/** One decimal, thousands-separated the way the rest of the app formats hours. */
function fmtHours(hours: number): string {
  return hours.toLocaleString("de-DE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

/**
 * Burn severity. Over budget is critical, near it is a warning, and NO BUDGET
 * is explicitly neutral rather than good -- 83 of 334 live projects have
 * `estimated_hours = 0`, meaning nobody set one, and painting those green
 * would be a health claim over a quarter of the portfolio.
 */
function burnTone(burnPercent: number | null): OverviewProject["tone"] {
  if (burnPercent === null) return "neutral";
  if (burnPercent >= 100) return "critical";
  if (burnPercent >= 85) return "warning";
  return "good";
}

/**
 * Utilisation severity. Both ends are flagged: chronically over 100% is a
 * burnout signal, and well under is unsold capacity. Neither is "good".
 */
function utilisationTone(percent: number | null): TeamUtilisation["tone"] {
  if (percent === null) return "neutral";
  if (percent > 110) return "critical";
  if (percent < 60) return "warning";
  return "good";
}

/**
 * Everything the Overview page renders, in one round of parallel reads.
 *
 * Degrades to empty rather than throwing. The `time` schema may not be applied
 * in a given environment, and a landing page that 500s on a fresh database is
 * worse than one that says it has no data yet -- but note the difference from
 * the old behaviour: empty now renders "n/a", where before it silently
 * substituted invented numbers.
 */

/**
 * Budget posture across the WHOLE active portfolio, not the ledger's top 8.
 *
 * The over-budget tile links to /projects, and /projects counts every active
 * project with `actualHours > estimatedHours` (projects-live.ts `isOver`).
 * Counting only the eight ledger rows here produced "2" on the tile and "11"
 * on the page it opens -- the exact contradiction a KPI must not have. Same
 * rule as /projects: strictly over, and only projects that HAVE a budget.
 * `burn_percent` is actual/estimate*100, so "> 100" is that rule in view terms.
 *
 * Paged read per the house rule: .order() before .range(), no bare limit.
 */
async function getBudgetPosture(
  supabase: SupabaseTyped,
): Promise<{ activeProjects: number; overBudget: number; noBudget: number } | null> {
  try {
    const { data, error } = await timeSchema(supabase)
      .from("project_summary")
      .select("project_id, burn_percent, estimated_hours")
      .eq("is_archived", false)
      .order("project_id", { ascending: true })
      .range(0, 9999);
    if (error || !data) return null;
    const rows = data as { burn_percent: number | null; estimated_hours: number | null }[];
    return {
      activeProjects: rows.length,
      // The view writes "no budget" as 0, not null (84 of 338 rows), and its
      // burn_percent is null for those -- so a budget is real only when > 0.
      overBudget: rows.filter((r) => Number(r.estimated_hours) > 0 && Number(r.burn_percent) > 100).length,
      noBudget: rows.filter((r) => !(Number(r.estimated_hours) > 0)).length,
    };
  } catch {
    return null;
  }
}

/**
 * Future-dated entries, per ISO week, inside the window.
 *
 * TrackingTime lets people pre-log time for days that have not happened, and
 * `org_week` aggregates those like any worked hour. getOrgWeeks already drops
 * whole FUTURE WEEKS (see time-dashboard.ts), but the current part-week and a
 * chosen period can still carry entries dated after now(). The week popup
 * (week-drilldown.ts) excludes them with `started_at <= now()`, so the tile
 * and its own drill-down disagreed by exactly those hours (live: 70 h of
 * 2.857 h, 54 of them billable). A KPI must not count work not yet done.
 *
 * Read from time.entry, subtracted per week below. Paged read per the house
 * rule (.order before .range); the row count is tiny by construction.
 */
async function getFutureEntryAdjustments(
  supabase: SupabaseTyped,
  firstMonday: string,
  lastMonday: string,
): Promise<Map<string, { seconds: number; billable: number; entries: number }>> {
  const out = new Map<string, { seconds: number; billable: number; entries: number }>();
  const nowIso = new Date().toISOString();
  const windowEnd = new Date(`${lastMonday}T00:00:00Z`);
  windowEnd.setUTCDate(windowEnd.getUTCDate() + 7);
  try {
    const { data, error } = await timeSchema(supabase)
      .from("entry")
      .select("started_at, duration_seconds, is_billable")
      .not("duration_seconds", "is", null)
      .gt("started_at", nowIso)
      .gte("started_at", `${firstMonday}T00:00:00Z`)
      .lt("started_at", windowEnd.toISOString())
      .order("id", { ascending: true })
      .range(0, 9999);
    if (error || !data) return out;
    for (const r of data as { started_at: string; duration_seconds: number; is_billable: boolean | null }[]) {
      const d = new Date(r.started_at);
      const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
      d.setUTCDate(d.getUTCDate() - dow);
      const key = d.toISOString().slice(0, 10);
      const acc = out.get(key) ?? { seconds: 0, billable: 0, entries: 0 };
      acc.seconds += num(r.duration_seconds);
      if (r.is_billable) acc.billable += num(r.duration_seconds);
      acc.entries += 1;
      out.set(key, acc);
    }
  } catch {
    // On failure the tile keeps the view's figure; the truth check will flag it.
  }
  return out;
}

function excludeFutureEntries(
  weeks: OrgWeekRow[],
  adjustments: Map<string, { seconds: number; billable: number; entries: number }>,
): OrgWeekRow[] {
  if (adjustments.size === 0) return weeks;
  return weeks.map((w) => {
    const a = adjustments.get(w.weekStart);
    if (!a) return w;
    const totalSeconds = Math.max(0, w.totalSeconds - a.seconds);
    const billableSeconds = Math.max(0, w.billableSeconds - a.billable);
    return {
      ...w,
      totalSeconds,
      billableSeconds,
      trackedSeconds: Math.max(0, w.trackedSeconds - a.seconds),
      entryCount: Math.max(0, w.entryCount - a.entries),
      totalHours: secondsToHours(totalSeconds),
      billableHours: secondsToHours(billableSeconds),
    };
  });
}

export async function getLiveOverview(
  supabase: SupabaseTyped,
  opts: { range?: OverviewRange; team?: string | null } = {},
): Promise<OverviewData> {
  /*
   * No range asked for means the historical window, expressed through the
   * constant rather than a literal 12 so existing callers and the trend-window
   * check keep reading the same source of truth.
   */
  const range = opts.range ?? boardRangeForPreset(OVERVIEW_DEFAULT_PRESET);
  const team = opts.team ?? null;

  const today = new Date().toISOString().slice(0, 10);
  // Whole ISO weeks: time.org_week aggregates by week, so a mid-week boundary
  // cannot be honoured to the day. Snapping OUTWARDS (Monday of the start week
  // to Sunday of the end week) rather than inwards, because dropping a partial
  // week would silently discard logged hours the reader asked to see.
  const firstMonday = isoWeekMonday(range.from);
  const lastMonday = isoWeekMonday(range.to <= today ? range.to : today);
  const snappedToWholeWeeks =
    firstMonday !== range.from || !isSundayOfWeek(range.to <= today ? range.to : today);

  const [rangedWeeksRaw, projectRows, memberRows, memberMeta, customerCount, projectCount, roster, budgetPosture, futureAdjustments] =
    await Promise.all([
      /*
       * The default window still goes through getOrgWeeks(supabase,
       * OVERVIEW_WEEKS) -- the ordering contract (DESC + limit + reverse, see
       * check-trend-window) lives there and a hand-rolled second query would
       * not inherit it. A CHOSEN period cannot use a row limit at all, because
       * "last month" is a date bound and not a count of the newest rows, so it
       * takes the date-bounded read below, which reuses the same mapping.
       */
      isDefaultWindow(range)
        ? getOrgWeeks(supabase, OVERVIEW_WEEKS)
        : getOrgWeeksBetween(supabase, firstMonday, lastMonday),
      getProjectSummary(supabase, { limit: LEDGER_ROWS }),
      getMemberUtilisation(supabase),
      // Team lives on time.member, not on the utilisation view, so the filter
      // needs its own (small) read of the roster's team column.
      getMemberTeams(supabase),
      countRows(supabase, "customer"),
      // The ledger's own length is NOT the project count. It is capped at
      // LEDGER_ROWS, so using it in the header claimed "8 ACTIVE PROJECTS" for an
      // organisation with 334 — a figure that looks like a measurement and is
      // actually a page-size constant.
      countRows(supabase, "project"),
      // Roster counts exclude info@/jobs@, which hold member records but are
      // inboxes. Counting them as staff inflates the headcount on the page the
      // whole company reads.
      getRosterCounts(supabase),
      getBudgetPosture(supabase),
      getFutureEntryAdjustments(supabase, firstMonday, lastMonday),
    ]);

  /*
   * TEAM SCOPING OF THE WEEKLY FIGURES.
   *
   * time.org_week has no team column -- it groups entries by week and nothing
   * else -- so a team-scoped weekly series has to be rebuilt from time.entry
   * joined to the roster's team. That read only happens when a team filter is
   * ACTIVE: with no filter the page keeps reading the same view it always did,
   * so the unfiltered figures are byte-for-byte what production shows today.
   *
   * getTeamWeeks deliberately applies the SAME rules as the view (every entry
   * with a duration, calendar events included, aggregated to the ISO week) so
   * that switching the team filter on and off cannot change what "hours
   * logged" means underneath the reader.
   */
  const teamMemberIds =
    team === null ? null : memberIdsForTeam(memberMeta, team);

  // Same rule as the week drill-down: nothing dated after now() counts.
  const rangedWeeks = excludeFutureEntries(rangedWeeksRaw, futureAdjustments);
  const weeks =
    teamMemberIds === null
      ? rangedWeeks
      : await getTeamWeeks(supabase, firstMonday, lastMonday, teamMemberIds);

  const totals = summariseOrgWeeks(weeks);
  const rangeWeekCount = Math.max(1, weeksBetween(firstMonday, lastMonday));

  // Contracted capacity across the window, from each person's own weekly_hours
  // rather than an assumed 40. Only weeks a person was ACTUALLY active count --
  // see getMemberUtilisation for why dividing by the full window misrepresents
  // anyone who joined partway through.
  //
  // Capped at the weeks in the SELECTED period rather than a constant 12: with
  // a one-month filter, crediting somebody twelve weeks of capacity would make
  // the tracked-over-contracted ratio a third of the truth.
  const utilisationRows =
    teamMemberIds === null
      ? memberRows
      : memberRows.filter((m) => teamMemberIds.has(m.memberId));

  let contractedHours = 0;
  for (const m of utilisationRows) {
    contractedHours += m.weeklyHours * Math.min(m.weeksActive, rangeWeekCount);
  }

  // Portfolio-wide (see getBudgetPosture). The ledger rows are a top-8 slice
  // and must not be the denominator of a KPI that links to the full list.
  const overBudget = budgetPosture?.overBudget ?? null;
  const noBudget = budgetPosture?.noBudget ?? 0;
  const activeProjects = budgetPosture?.activeProjects ?? 0;

  const metrics: OverviewMetric[] = [
    {
      key: "billable-share",
      label: { key: "tiles.billableShare.label" },
      value: totals.billablePercent === null ? null : `${totals.billablePercent}%`,
      subtext:
        totals.billablePercent === null
          ? { key: "tiles.billableShare.noHours" }
          : {
              key: "tiles.billableShare.ofHours",
              values: {
                billable: fmtHours(totals.billableHours),
                total: fmtHours(totals.totalHours),
              },
            },
      // Deliberately not colour-coded against a target. There is no agreed
      // company target in the data, and inventing one here would put us right
      // back where we started.
      tone: "neutral",
      progressPercent: totals.billablePercent,
    },
    {
      key: "hours-logged",
      label: { key: "tiles.hoursLogged.label" },
      value: totals.totalHours > 0 ? fmtHours(totals.totalHours) : null,
      subtext:
        totals.weeksCovered > 0
          ? {
              key: "tiles.hoursLogged.weeksEntries",
              values: {
                weeks: totals.weeksCovered,
                entries: totals.entryCount.toLocaleString("de-DE"),
                entryCount: totals.entryCount,
              },
            }
          : team === null
            ? { key: "tiles.hoursLogged.noData" }
            : // A team filter emptying a figure is a different fact from an
              // empty database, and it must not read as one.
              { key: "tiles.hoursLogged.noHoursForTeam" },
      tone: "neutral",
      progressPercent: null,
    },
    {
      key: "capacity",
      label: { key: "tiles.capacity.label" },
      value:
        contractedHours > 0
          ? `${fmtHours(totals.trackedSeconds / 3600)} / ${fmtHours(contractedHours)}`
          : null,
      subtext:
        contractedHours > 0
          ? {
              key: "tiles.capacity.ofNominal",
              values: {
                percent: Math.round((totals.trackedSeconds / 3600 / contractedHours) * 100),
                weeks: rangeWeekCount,
              },
            }
          : { key: "tiles.capacity.noContract" },
      tone: "neutral",
      progressPercent:
        contractedHours > 0
          ? Math.min(
              100,
              Math.round((totals.trackedSeconds / 3600 / contractedHours) * 100),
            )
          : null,
    },
    {
      key: "active-people",
      label: { key: "tiles.activePeople.label" },
      value: totals.activeMembers > 0 ? String(totals.activeMembers) : null,
      subtext:
        totals.activeMembers > 0
          ? // `memberRows.length` counted every member record including the
            // info@ and jobs@ inboxes. The roster count is people.
            { key: "tiles.activePeople.peak", values: { roster: roster.activePeople } }
          : { key: "tiles.activePeople.nobody" },
      tone: "neutral",
      progressPercent: null,
    },
    {
      key: "budget-risk",
      label: { key: "tiles.budgetRisk.label" },
      value: overBudget === null ? null : String(overBudget),
      subtext:
        overBudget === null
          ? { key: "tiles.budgetRisk.noProjects" }
          : // Naming the unbudgeted count matters: "0 over budget" sounds like
            // health, but it is meaningless if most projects have no budget to
            // exceed. The reader needs the denominator's caveat.
            // "ALL TIME" is not decoration: project_summary is not period-bounded,
            // so this count sits beside period figures and would otherwise be read
            // as one of them.
            {
              key: "tiles.budgetRisk.allTime",
              values: { count: activeProjects, noBudget },
            },
      tone: overBudget !== null && overBudget > 0 ? "critical" : "neutral",
      progressPercent: null,
    },
  ];

  const teams: TeamUtilisation[] = utilisationRows.slice(0, 6).map((m) => ({
    name: m.displayName,
    percent: m.utilisationPercent,
    hours: m.totalHours,
    weeksActive: m.weeksActive,
    tone: utilisationTone(m.utilisationPercent),
    team: memberMeta.get(m.memberId)?.team ?? null,
  }));

  const projects: OverviewProject[] = projectRows.map((p) => ({
    id: p.projectId,
    name: p.projectName,
    customerName: p.customerName,
    loggedHours: p.totalHours,
    billableHours: p.billableHours,
    estimatedHours: p.estimatedHours,
    burnPercent: p.burnPercent,
    tone: burnTone(p.burnPercent),
  }));

  const now = new Date();
  const quarter = Math.ceil((now.getUTCMonth() + 1) / 3);

  const rosterPeople = [...memberMeta.values()];
  const withTeam = rosterPeople.filter((m) => m.team !== null).length;
  const teamOptions = buildTeamOptions(rosterPeople);

  return {
    metrics,
    weeks,
    teams,
    projects,
    range,
    coveredWeeks:
      weeks.length > 0
        ? {
            first: `W${isoWeekNumber(weeks[0].weekStart)}`,
            last: `W${isoWeekNumber(weeks[weeks.length - 1].weekStart)}`,
            count: weeks.length,
          }
        : null,
    team,
    teamOptions,
    teamCoverage: {
      totalPeople: rosterPeople.length,
      withTeam,
      inSelected: teamMemberIds === null ? null : teamMemberIds.size,
    },
    scopeNotes: {
      utilisationAllTime: true,
      projectsAllTime: true,
      countsAllTime: true,
      snappedToWholeWeeks,
    },
    counts: {
      activeMembers: roster.activePeople,
      activeProjects: projectCount,
      customers: customerCount,
      currentQuarter: `Q${quarter} ${now.getUTCFullYear()}`,
    },
    unlinkedPeople: roster.unlinkedPeople,
  };
}

/** True when `iso` is the Sunday closing its ISO week. */
function isSundayOfWeek(iso: string): boolean {
  return new Date(`${iso}T00:00:00Z`).getUTCDay() === 0;
}

/** Whole ISO weeks between two Mondays, inclusive. */
function weeksBetween(firstMonday: string, lastMonday: string): number {
  const a = new Date(`${firstMonday}T00:00:00Z`).getTime();
  const b = new Date(`${lastMonday}T00:00:00Z`).getTime();
  return Math.round((b - a) / 604_800_000) + 1;
}

/**
 * Is this the window the page has always shown?
 *
 * Only then may the row-limited read be used. The check is on the RESOLVED
 * dates, not on `preset`, so a hand-typed URL that happens to reproduce the
 * default window behaves identically to clicking the default pill.
 */
function isDefaultWindow(range: OverviewRange): boolean {
  const dflt = boardRangeForPreset(OVERVIEW_DEFAULT_PRESET);
  return range.from === dflt.from && range.to === dflt.to;
}

/** The team of every person on the roster, keyed by TrackingTime member id. */
type MemberTeam = { memberId: number; name: string; team: string | null };

/**
 * Read the roster's team column.
 *
 * Shared mailboxes (info@, jobs@) are dropped: they hold member records but are
 * not colleagues, and counting them would inflate the "x of y people" coverage
 * figure the team filter reports.
 */
async function getMemberTeams(
  supabase: SupabaseTyped,
): Promise<Map<number, MemberTeam>> {
  const out = new Map<number, MemberTeam>();
  try {
    const { data, error } = await timeSchema(supabase)
      .from("member")
      .select("id, display_name, email, is_archived, team");
    if (error || !data) return out;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const r of data as any[]) {
      if (r.is_archived) continue;
      if (isSharedMailbox(r.email ?? null)) continue;
      out.set(Number(r.id), {
        memberId: Number(r.id),
        name: r.display_name ?? "Unknown",
        // Normalised through teamKey so "Operations" and "OPERATIONS" are one
        // team on the filter bar rather than two.
        team: teamKey(r.team ?? null),
      });
    }
    return out;
  } catch {
    return out;
  }
}

/** The member ids matching a team selection (NO_TEAM = team is unrecorded). */
function memberIdsForTeam(
  roster: Map<number, MemberTeam>,
  team: string,
): Set<number> {
  const ids = new Set<number>();
  for (const m of roster.values()) {
    if (team === NO_TEAM ? m.team === null : m.team === team) ids.add(m.memberId);
  }
  return ids;
}

/**
 * The teams to offer, biggest first, with the no-team bucket always present.
 *
 * Built from the teams ACTUALLY STORED rather than from the canonical list in
 * lib/teams.ts, because the live roster still carries legacy values and a
 * filter offering a team nobody is in -- or hiding one somebody is in -- would
 * misdescribe the data it filters.
 */
function buildTeamOptions(roster: MemberTeam[]): OverviewTeamOption[] {
  const counts = new Map<string, number>();
  let none = 0;
  for (const m of roster) {
    if (m.team === null) none += 1;
    else counts.set(m.team, (counts.get(m.team) ?? 0) + 1);
  }
  const options: OverviewTeamOption[] = [...counts.entries()]
    .map(([key, people]) => ({ key, label: teamLabel(key), people }))
    .sort((a, b) => b.people - a.people || a.label.localeCompare(b.label));

  // Always offered, even at zero: its absence would be indistinguishable from
  // "everybody has a team", which is the opposite of what the data says.
  options.push({ key: NO_TEAM, label: "No team recorded", people: none });
  return options;
}

/**
 * The weekly series for an arbitrary date range.
 *
 * A date bound, NOT a row limit: "last month" is a pair of dates, and
 * `limit(n)` would return the n newest weeks regardless of the period asked
 * for. Rows come back ascending here, so no reverse is needed -- the ordering
 * hazard getOrgWeeks guards against belongs to limit+order, and there is no
 * limit on this read.
 */
async function getOrgWeeksBetween(
  supabase: SupabaseTyped,
  firstMonday: string,
  lastMonday: string,
): Promise<OrgWeekRow[]> {
  try {
    const { data, error } = await timeSchema(supabase)
      .from("org_week")
      .select("*")
      .gte("week_start", firstMonday)
      .lte("week_start", lastMonday)
      .order("week_start", { ascending: true });
    if (error || !data) return [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data as any[]).map((r) => {
      const totalSeconds = num(r.total_seconds);
      const billableSeconds = num(r.billable_seconds);
      return {
        weekStart: String(r.week_start).slice(0, 10),
        totalSeconds,
        billableSeconds,
        calendarSeconds: num(r.calendar_seconds),
        trackedSeconds: num(r.tracked_seconds),
        entryCount: num(r.entry_count),
        activeMembers: num(r.active_members),
        activeProjects: num(r.active_projects),
        totalHours: secondsToHours(totalSeconds),
        billableHours: secondsToHours(billableSeconds),
      };
    });
  } catch {
    return [];
  }
}

/**
 * The weekly series restricted to one team, rebuilt from time.entry.
 *
 * Same aggregation rules as time.org_week -- every entry with a duration,
 * calendar events INCLUDED, grouped by ISO week Monday -- so the team-scoped
 * figures answer the same question as the org-wide ones. Excluding calendar
 * entries here would make a team filter look like it halved the hours.
 */
async function getTeamWeeks(
  supabase: SupabaseTyped,
  firstMonday: string,
  lastMonday: string,
  memberIds: Set<number>,
): Promise<OrgWeekRow[]> {
  if (memberIds.size === 0) return [];

  // The window's last day: the Sunday closing the final week, matching
  // org_week's whole-week rows rather than clipping at today.
  const lastDay = new Date(`${lastMonday}T00:00:00Z`);
  lastDay.setUTCDate(lastDay.getUTCDate() + 6);
  const to = lastDay.toISOString().slice(0, 10);

  type EntryRow = {
    member_id: number | null;
    project_id: number | null;
    duration_seconds: number | null;
    started_at: string | null;
    is_billable: boolean | null;
    is_calendar: boolean | null;
  };

  let rows: EntryRow[];
  try {
    const paged = await fetchAllPaged<EntryRow>((from, upto) =>
      timeSchema(supabase)
        .from("entry")
        .select(
          "member_id, project_id, duration_seconds, started_at, is_billable, is_calendar",
        )
        .not("duration_seconds", "is", null)
        .in("member_id", [...memberIds])
        .gte("started_at", `${firstMonday}T00:00:00Z`)
        .lte("started_at", `${to}T23:59:59Z`)
        // Future-dated entries are excluded here too (see getFutureEntryAdjustments).
        .lte("started_at", new Date().toISOString())
        // Ordered so paging is deterministic: an unordered range() walk can
        // repeat and skip rows (measured: 299 duplicates in a 5,299-row read).
        .order("id", { ascending: true })
        .range(from, upto),
    );
    rows = paged.rows;
  } catch {
    return [];
  }

  type Acc = {
    total: number;
    billable: number;
    calendar: number;
    tracked: number;
    entries: number;
    members: Set<number>;
    projects: Set<number>;
  };
  const byWeek = new Map<string, Acc>();

  for (const r of rows) {
    const day = (r.started_at ?? "").slice(0, 10);
    if (!day) continue;
    const memberId = r.member_id === null ? null : Number(r.member_id);
    if (memberId === null || !memberIds.has(memberId)) continue;

    const week = isoWeekMonday(day);
    let acc = byWeek.get(week);
    if (!acc) {
      acc = {
        total: 0,
        billable: 0,
        calendar: 0,
        tracked: 0,
        entries: 0,
        members: new Set(),
        projects: new Set(),
      };
      byWeek.set(week, acc);
    }
    const seconds = Number(r.duration_seconds) || 0;
    acc.total += seconds;
    if (r.is_billable) acc.billable += seconds;
    if (r.is_calendar) acc.calendar += seconds;
    else acc.tracked += seconds;
    acc.entries += 1;
    acc.members.add(memberId);
    if (r.project_id !== null) acc.projects.add(Number(r.project_id));
  }

  return [...byWeek.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([weekStart, a]) => ({
      weekStart,
      totalSeconds: a.total,
      billableSeconds: a.billable,
      calendarSeconds: a.calendar,
      trackedSeconds: a.tracked,
      entryCount: a.entries,
      activeMembers: a.members.size,
      activeProjects: a.projects.size,
      totalHours: secondsToHours(a.total),
      billableHours: secondsToHours(a.billable),
    }));
}

/** Numeric coercion for PostgREST payloads, mirroring time-dashboard's `num`. */
function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * How many non-archived rows a `time` table holds.
 *
 * A head-count request, so PostgREST returns the number without transferring
 * 334 rows nobody renders.
 */
async function countRows(
  supabase: SupabaseTyped,
  table: "customer" | "project",
): Promise<number> {
  try {
    const { count, error } = await timeSchema(supabase)
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("is_archived", false);
    return error ? 0 : (count ?? 0);
  } catch {
    return 0;
  }
}
