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
import { getRosterCounts } from "./people-live";

type SupabaseTyped = SupabaseClient<Database>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const timeSchema = (s: SupabaseTyped) => (s as any).schema("time");

/** Weeks of history behind the landing page's trend chart and KPI strip. */
export const OVERVIEW_WEEKS = 12;

/** Rows in the landing page's project ledger. The full list lives at /projects. */
const LEDGER_ROWS = 8;

/**
 * A single KPI card.
 *
 * `value` is null when there is nothing to measure, and the card renders "n/a".
 * `tone` drives colour only -- it is never the sole carrier of meaning, because
 * a red bar and a green bar look identical to a colourblind reader and to a
 * printed page.
 */
export type OverviewMetric = {
  key: string;
  label: string;
  /** Pre-formatted for display, or null when there is no data behind it. */
  value: string | null;
  subtext: string;
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
export async function getLiveOverview(supabase: SupabaseTyped): Promise<OverviewData> {
  const [weeks, projectRows, memberRows, customerCount, projectCount, roster] =
    await Promise.all([
      getOrgWeeks(supabase, OVERVIEW_WEEKS),
      getProjectSummary(supabase, { limit: LEDGER_ROWS }),
      getMemberUtilisation(supabase),
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
    ]);

  const totals = summariseOrgWeeks(weeks);

  // Contracted capacity across the window, from each person's own weekly_hours
  // rather than an assumed 40. Only weeks a person was ACTUALLY active count --
  // see getMemberUtilisation for why dividing by the full window misrepresents
  // anyone who joined partway through.
  let contractedHours = 0;
  for (const m of memberRows) {
    contractedHours += m.weeklyHours * Math.min(m.weeksActive, OVERVIEW_WEEKS);
  }

  const overBudget = projectRows.filter(
    (p) => p.burnPercent !== null && p.burnPercent >= 100,
  ).length;
  const noBudget = projectRows.filter((p) => p.estimatedHours === null).length;

  const metrics: OverviewMetric[] = [
    {
      key: "billable-share",
      label: "BILLABLE SHARE",
      value: totals.billablePercent === null ? null : `${totals.billablePercent}%`,
      subtext:
        totals.billablePercent === null
          ? "NO HOURS IN WINDOW"
          : `${fmtHours(totals.billableHours)} H OF ${fmtHours(totals.totalHours)} H`,
      // Deliberately not colour-coded against a target. There is no agreed
      // company target in the data, and inventing one here would put us right
      // back where we started.
      tone: "neutral",
      progressPercent: totals.billablePercent,
    },
    {
      key: "hours-logged",
      label: "HOURS LOGGED",
      value: totals.totalHours > 0 ? fmtHours(totals.totalHours) : null,
      subtext:
        totals.weeksCovered > 0
          ? `${totals.weeksCovered} WEEKS · ${totals.entryCount.toLocaleString("de-DE")} ENTRIES`
          : "NO DATA IMPORTED YET",
      tone: "neutral",
      progressPercent: null,
    },
    {
      key: "capacity",
      label: "TRACKED / CONTRACTED",
      value:
        contractedHours > 0
          ? `${fmtHours(totals.trackedSeconds / 3600)} / ${fmtHours(contractedHours)}`
          : null,
      subtext:
        contractedHours > 0
          ? `${Math.round((totals.trackedSeconds / 3600 / contractedHours) * 100)}% OF CONTRACTED`
          : "NO CONTRACTED HOURS ON RECORD",
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
      label: "ACTIVE PEOPLE",
      value: totals.activeMembers > 0 ? String(totals.activeMembers) : null,
      subtext:
        totals.activeMembers > 0
          ? // `memberRows.length` counted every member record including the
            // info@ and jobs@ inboxes. The roster count is people.
            `PEAK IN ANY WEEK · ${roster.activePeople} ON ROSTER`
          : "NOBODY LOGGED TIME",
      tone: "neutral",
      progressPercent: null,
    },
    {
      key: "budget-risk",
      label: "PROJECTS OVER BUDGET",
      value: projectRows.length > 0 ? String(overBudget) : null,
      subtext:
        projectRows.length === 0
          ? "NO PROJECTS WITH LOGGED TIME"
          : // Naming the unbudgeted count matters: "0 over budget" sounds like
            // health, but it is meaningless if most projects have no budget to
            // exceed. The reader needs the denominator's caveat.
            `OF TOP ${projectRows.length} BY HOURS · ${noBudget} WITH NO BUDGET`,
      tone: overBudget > 0 ? "critical" : "neutral",
      progressPercent: null,
    },
  ];

  const teams: TeamUtilisation[] = memberRows.slice(0, 6).map((m) => ({
    name: m.displayName,
    percent: m.utilisationPercent,
    hours: m.totalHours,
    weeksActive: m.weeksActive,
    tone: utilisationTone(m.utilisationPercent),
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

  return {
    metrics,
    weeks,
    teams,
    projects,
    counts: {
      activeMembers: roster.activePeople,
      activeProjects: projectCount,
      customers: customerCount,
      currentQuarter: `Q${quarter} ${now.getUTCFullYear()}`,
    },
    unlinkedPeople: roster.unlinkedPeople,
  };
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
