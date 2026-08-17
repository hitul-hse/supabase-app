import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import PageTransition from "@/components/animations/PageTransition";
import { createClient } from "@/utils/supabase/server";
import { requirePermission } from "@/utils/supabase/require-profile";
import { PERMISSIONS } from "@/lib/permissions";
import {
  currentTimeWeek,
  getCurrentMemberId,
  getEntriesForDay,
  getEntriesForWeek,
  getRunningEntry,
  getTimeLookups,
  getWeekSummary,
  groupByDay,
  summariseEntries,
  todayIso,
} from "@/lib/queries/time";
import { TimeViewTabs } from "./TimeViewTabs";
import { TimeTotalsStrip } from "./TimeTotalsStrip";
import { TimeEntryList } from "./TimeEntryList";
import { TimeTracker } from "./TimeTracker";
import { WeekSummaryTable } from "./WeekSummaryTable";

/**
 * The Time Tracking module's page — TrackingTime's week view.
 *
 * Gated with requirePermission() here in the page, not only in the proxy: per
 * CVE-2025-29927 middleware is defence-in-depth, never the auth boundary. That
 * makes the route dynamic, which is the correct trade rather than a regression.
 *
 * Distinct from /timesheets, which is the Hub's editable grid over
 * public.timesheet_entries (hours). This page reads the `time` schema (seconds)
 * and shows individual tracked intervals the way the vendor does.
 */

/** Trust only a well-formed YYYY-MM-DD that is also a real date. */
function parseWeekParam(raw: string | undefined): string {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return currentTimeWeek();
  // The shape can match while the date does not exist ("2026-02-31"), and Date
  // would silently roll that forward into March.
  const d = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== raw) {
    return currentTimeWeek();
  }
  return raw;
}

/**
 * "Only me" or "everyone I may see".
 *
 * Defaults to own time. `team` cannot leak anything: RLS restricts it to
 * whatever can_view_member() permits, so for a colleague with no reports it
 * returns exactly the same rows as `mine`.
 */
function parseScopeParam(raw: string | undefined): "mine" | "team" {
  return raw === "team" ? "team" : "mine";
}

/**
 * Which half of the module to show.
 *
 * Defaults to "track": the first thing somebody opening a time tracker wants is
 * to start the clock, not to read last week's report.
 */
function parseViewParam(raw: string | undefined): "records" | "track" {
  return raw === "records" ? "records" : "track";
}

export default async function TimePage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; scope?: string; view?: string }>;
}) {
  await requirePermission("/time", PERMISSIONS.TIMESHEETS_READ_OWN);
  const supabase = await createClient();

  const params = await searchParams;
  const weekStart = parseWeekParam(params.week);
  const scope = parseScopeParam(params.scope);
  const view = parseViewParam(params.view);

  // Who the caller is inside this module. Null is an ordinary state: a colleague
  // who has never tracked time has no time.member row, and nobody has one before
  // the first import runs.
  const memberId = await getCurrentMemberId(supabase);

  // `undefined` means "every member RLS allows". Passing null would filter on
  // `member_id is null` and match nothing, which looks identical to an empty week.
  const memberFilter = scope === "mine" ? memberId : undefined;

  // Own time was requested but there is no member row: an empty list would say
  // "you logged nothing this week", which is a different and wrong message. Skip
  // the entry query rather than issuing one that cannot be meaningful.
  const unlinked = scope === "mine" && memberId === null;

  // Read-only viewers still see the tracker, with its controls disabled and the
  // reason stated. Hiding it outright would leave them wondering where the timer
  // is; a disabled panel that explains itself is the honest version.
  const { data: canWrite } = await supabase.rpc("app_user_has_permission", {
    p_key: PERMISSIONS.TIMESHEETS_WRITE,
  });

  const today = todayIso();

  // Only fetch what the active view renders. The tracker needs lookups and
  // today's rows; the records view needs the week. Fetching both on every load
  // would put a 300-project lookup query on the critical path of a report that
  // never uses it.
  const wantsTracker = view === "track" && !unlinked;

  const [entries, weekSummary, running, lookups, todayEntries] = await Promise.all([
    unlinked || view === "track"
      ? Promise.resolve([])
      : getEntriesForWeek(supabase, weekStart, { memberId: memberFilter }),
    view === "records" ? getWeekSummary(supabase, weekStart) : Promise.resolve([]),
    wantsTracker && memberId !== null
      ? getRunningEntry(supabase, memberId)
      : Promise.resolve(null),
    wantsTracker ? getTimeLookups(supabase) : Promise.resolve(null),
    wantsTracker && memberId !== null
      ? getEntriesForDay(supabase, today, { memberId })
      : Promise.resolve([]),
  ]);

  const totals = summariseEntries(entries);
  const days = groupByDay(entries, weekStart);

  return (
    <PageTransition>
      <div className="flex flex-col">
        <PageHeader
          category={view === "track" ? "TIME TRACKING / TRACK" : "TIME TRACKING / RECORDS"}
          title="Time"
          meta={
            view === "track"
              ? `TRACKINGTIME-EQUIVALENT · SECONDS · ${
                  running ? "TIMER RUNNING" : "NO TIMER RUNNING"
                }`
              : `TRACKINGTIME-EQUIVALENT · SECONDS · ${
                  scope === "mine" ? "MY TIME" : "TEAM"
                }`
          }
        />

        <div className="flex flex-col gap-5 p-4 sm:p-6">
          <TimeViewTabs
            weekStart={weekStart}
            scope={scope}
            view={view}
            currentWeek={currentTimeWeek()}
          />

          {unlinked ? (
            <EmptyState
              title="No time-tracking record linked to your account"
              description="Your account isn't linked to a Time Tracking member yet, so there is no personal time to show. That is expected before the first TrackingTime import runs, or if your email doesn't match a tracked user. Switch to Team to see what you're permitted to view, or ask an administrator to link it."
            />
          ) : view === "track" && lookups !== null ? (
            <TimeTracker
              running={running}
              lookups={lookups}
              todayEntries={todayEntries}
              today={today}
              canWrite={canWrite === true}
            />
          ) : (
            <>
              <TimeTotalsStrip totals={totals} />

              {entries.length === 0 ? (
                <EmptyState
                  title="Nothing tracked this week"
                  description="Entries appear here once time is tracked or imported from TrackingTime. An empty list can also mean you don't have access to anybody else's time, which is the access model working rather than a fault."
                />
              ) : (
                <TimeEntryList days={days} showMember={scope === "team"} />
              )}
            </>
          )}

          {view === "records" && weekSummary.length > 0 && (
            <WeekSummaryTable rows={weekSummary} weekStart={weekStart} />
          )}
        </div>
      </div>
    </PageTransition>
  );
}
