import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { ButtonLink } from "@/components/ui/Button";
import { Card, CardHeader, ChartNote, StatTile } from "@/components/ui/Card";
import { Donut, Gauge, LegendDot } from "@/components/ui/Charts";
import { Pill } from "@/components/ui/Segmented";
import { TopBarChrome } from "@/components/TopBarChrome";
import { IconWarning, IconArrowRight } from "@/components/nav-icons";
import { SyncBar } from "@/components/SyncBar";
import { MobileDisclosure } from "@/components/MobileDisclosure";
import { createClient } from "@/utils/supabase/server";
import {
  getLiveOverview,
  parseOverviewRange,
  parseOverviewTeam,
} from "@/lib/queries/overview-live";
import { OverviewFilters } from "./OverviewFilters";
import { OverviewHero } from "./OverviewHero";
import { requireUser } from "@/utils/supabase/require-user";

/**
 * The Hub landing page.
 *
 * Every figure here comes from imported TrackingTime (`time.*`) via
 * queries/overview-live.ts. It previously rendered `public.executive_metrics`,
 * `public.weekly_trends`, `public.team_utilisations` and `public.projects` --
 * four seeded demo tables holding hand-written strings from the original
 * frontend mockup. See overview-live.ts for the full account of what was
 * invented and why it mattered.
 *
 * The rule that shapes this file: a missing number renders "n/a", never 0 and
 * never a plausible substitute.
 */
export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string; team?: string }>;
}) {
  await requireUser("/");
  const supabase = await createClient();

  /*
   * The period and team come from the URL, so a scoped view is shareable and
   * survives the back button. Both parsers fall back to the historical default
   * on anything unrecognised: a hand-edited or stale link must never be able to
   * empty this page, only to show it unfiltered.
   */
  const params = await searchParams;
  const range = parseOverviewRange(params);
  const team = parseOverviewTeam(params.team);
  const {
    metrics,
    weeks,
    teams,
    projects,
    counts,
    unlinkedPeople,
    teamOptions,
    teamCoverage,
    coveredWeeks,
    scopeNotes,
  } = await getLiveOverview(supabase, { range, team });

  /*
   * How the period is named everywhere on the page, once.
   *
   * Derived from the weeks ACTUALLY COUNTED rather than from the requested
   * dates. Those differ whenever data does not span the whole request -- ask
   * for this year in January and you get three weeks -- and printing the
   * request would claim coverage the figures do not have.
   */
  const periodLabel =
    coveredWeeks === null
      ? "NO WEEKS IN PERIOD"
      : coveredWeeks.count === 1
        ? `${coveredWeeks.first}`
        : `${coveredWeeks.first}–${coveredWeeks.last} · ${coveredWeeks.count} WEEKS`;

  const teamLabelForScope =
    team === null
      ? null
      : (teamOptions.find((t) => t.key === team)?.label ?? team);

  /** The qualifier under a card title: period, plus the team when one is set. */
  const scopedQualifier = (extra?: string) =>
    [periodLabel, teamLabelForScope?.toUpperCase(), extra]
      .filter(Boolean)
      .join(" · ");

  // (chartMax is gone: it scaled the old bar strip, and the area chart owns its own scale.)

  /*
   * The hero series: billable share per week, as an area.
   *
   * Share rather than raw hours, deliberately. Raw weekly hours swing with headcount and
   * holidays, and the question the exec actually asks of this card is "are we billing
   * enough of what we work?" -- a ratio. The raw magnitudes stay one hover away in each
   * point's readout, and the totals live in the KPI tiles directly above.
   */
  const trendPoints = weeks
    .filter((w) => w.totalHours > 0)
    .map((w) => {
      const share = Math.round((w.billableHours / w.totalHours) * 100);
      return {
        key: w.weekStart,
        label: formatWeekLabel(w.weekStart),
        value: share,
        readout: `${formatWeekLabel(w.weekStart)}: ${share}% billable · ${w.billableHours.toLocaleString("de-DE")}h of ${w.totalHours.toLocaleString("de-DE")}h`,
      };
    });

  const totalHoursAll = weeks.reduce((s, w) => s + w.totalHours, 0);
  const billableHoursAll = weeks.reduce((s, w) => s + w.billableHours, 0);
  const billableShareAll =
    totalHoursAll > 0 ? Math.round((billableHoursAll / totalHoursAll) * 100) : null;

  /*
   * Roster-wide utilisation for the gauge: tracked hours over the nominal capacity of the
   * people who were actually active, averaged over the people with a defined ratio. The
   * BASIS note under the utilisation list states the 40h caveat; the gauge shares it.
   */
  const utilised = teams.filter((t) => t.percent !== null);
  const avgUtilisation =
    utilised.length > 0
      ? Math.round(utilised.reduce((s, t) => s + (t.percent ?? 0), 0) / utilised.length)
      : null;
  const gaugeColor =
    avgUtilisation === null
      ? "var(--text-muted)"
      : avgUtilisation < 40
        ? "var(--warning)"
        : avgUtilisation > 105
          ? "var(--critical)"
          : "var(--accent)";

  const tickIndexes = Array.from(
    new Set(
      [0, 0.33, 0.66, 1].map((fraction) =>
        Math.round(fraction * Math.max(0, weeks.length - 1)),
      ),
    ),
  );
  const axisTicks = tickIndexes
    .map((index) => weeks[index])
    .filter((week): week is NonNullable<typeof week> => week !== undefined)
    .map((week) => formatWeekLabel(week.weekStart));

  const toneColour = (tone: string) =>
    tone === "critical"
      ? "var(--critical)"
      : tone === "warning"
        ? "var(--warning)"
        : tone === "good"
          ? "var(--accent)"
          : "var(--text-muted)";

  return (
    <div className="flex flex-col">
      <SyncBar />

      <PageHeader
        title="Overview"
        meta={`${counts.currentQuarter} · ${counts.activeMembers} PEOPLE · ${counts.activeProjects} ACTIVE PROJECTS · ${counts.customers} CUSTOMERS`}
        chrome={<TopBarChrome />}
        actions={
          <ButtonLink variant="primary" href="/time/dashboard">
            Full dashboard
          </ButtonLink>
        }
      />

      <div className="flex flex-col gap-[var(--card-gap)] page-shell">
        {/*
          The filter surface. Every weekly figure below derives from the period
          it resolves; the figures that CANNOT be period-scoped say "all time"
          in their own qualifier rather than being quietly left unscoped.
        */}
        <OverviewFilters
          range={range}
          team={team}
          teamOptions={teamOptions}
          coverage={teamCoverage}
        />

        {/*
          Said out loud because org_week aggregates by ISO week: a range starting
          mid-month is widened to whole weeks, and a reader comparing this page
          against a to-the-day report deserves to know why the totals differ.
        */}
        {scopeNotes.snappedToWholeWeeks && (
          <p className="font-mono text-[10px] tracking-[0.1em] text-[var(--text-faint)]">
            PERIOD WIDENED TO WHOLE ISO WEEKS ({periodLabel}) — WEEKLY TOTALS ARE
            NOT AVAILABLE PER DAY
          </p>
        )}
        {/*
          Surfaced rather than hidden: most of the roster has a TrackingTime
          record but no Hub sign-in, so their hours are counted in every figure
          on this page while they cannot log in to see them. That is an
          operational gap the exec reading this page is the one who can close.
        */}
        {unlinkedPeople > 0 && (
          <Card className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
            <span className="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
              <IconWarning className="flex-none text-[var(--warning)]" />
              <span>
                <span className="font-mono font-semibold text-[var(--warning)]">
                  {unlinkedPeople}
                </span>{" "}
                of {counts.activeMembers} people have no Hub sign-in yet — their
                hours count here, but they cannot see them.
              </span>
            </span>
            <Link
              href="/people"
              className="flex items-center gap-1.5 whitespace-nowrap text-[11px] font-medium text-[var(--accent)] hover:underline"
            >
              Review people
              <IconArrowRight className="flex-none" />
            </Link>
          </Card>
        )}

        {/*
          KPI tiles — SEPARATE cards on a gap, not one fused grid.

          This was a single bordered box whose five cells shared hairlines, with
          `border-b lg:border-b-0 lg:border-r` computed against the last-child
          index. Two things were wrong with it. A shared border says "these cells
          are one record", so five independent facts about the business read as a
          single table row and none of them was scannable. And the last-child
          arithmetic had to be re-derived by hand at every call site, which is
          exactly where fused grids acquire a missing rule on one breakpoint.
        */}
        <div className="stagger grid grid-cols-2 gap-[var(--card-gap)] sm:grid-cols-3 lg:grid-cols-5">
          {metrics.map((metric) => {
            /* Every figure answers "where do I see more?" -- the tile IS the
               link. Wrapping keeps data-metric on the tile itself, which is
               what the deployed-page checks select on. */
            const drill: Record<string, string> = {
              "billable-share": "/time/dashboard",
              "hours-logged": "/timesheets",
              capacity: "/time/dashboard",
              "active-people": "/people",
              "budget-risk": "/projects",
            };
            const href = drill[metric.key];
            const tile = (
              <StatTile
                key={href ? undefined : metric.key}
                data-metric={metric.key}
                label={metric.label}
                value={metric.value}
                hint={metric.subtext}
                tone={metric.tone}
                progressPercent={metric.progressPercent}
                className={href ? "h-full cursor-pointer" : undefined}
              />
            );
            return href ? (
              <Link key={metric.key} href={href} aria-label={`${metric.label} — open details`} className="block focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]">
                {tile}
              </Link>
            ) : (
              tile
            );
          })}
        </div>

        <div className="stagger grid grid-cols-1 gap-[var(--card-gap)] lg:grid-cols-12">
          {/*
            The hero figure: billable share per week, as a smooth area.

            tone="hero" -- the ONE tinted card on this page. The previous version was a
            bar strip FIXED at 140-160px inside a card its neighbour stretches to ~400px,
            which left the bottom half of the tinted surface empty -- the "space at the
            bottom of the graph" the user reported. The area chart fills the card's real
            height instead, and the share headline sits where the reference puts it.
          */}
          <Card tone="hero" className="flex flex-col lg:col-span-7">
            <CardHeader
              title="Billable share"
              qualifier={scopedQualifier("TRACKINGTIME")}
              actions={
                <div className="flex items-center gap-3">
                  <LegendDot color="var(--accent)">BILLABLE %</LegendDot>
                </div>
              }
            />

            <div className="flex min-h-0 flex-1 flex-col gap-2 px-4 pb-4">
              {trendPoints.length === 0 ? (
                <p className="self-center py-10 text-center font-mono text-[11px] text-[var(--text-faint)]">
                  {/*
                    Three different absences, three different sentences. "No
                    hours in this period" is a fact about the filter; "run the
                    sync" is a fact about the database, and offering the wrong
                    one sends the reader to fix something that is not broken.
                  */}
                  {team !== null
                    ? `No hours logged by ${teamLabelForScope} in this period.`
                    : coveredWeeks !== null
                      ? "No hours logged in this period."
                      : "No hours imported yet — run the TrackingTime sync."}
                </p>
              ) : (
                <>
                  {/* The headline: the reference leads its chart with the current
                      figure, big, with the aggregate beside it. */}
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="font-mono text-[30px] font-semibold leading-none tracking-tight text-[var(--text-primary)]">
                      {trendPoints[trendPoints.length - 1].value}%
                    </span>
                    <span className="font-mono text-[10px] text-[var(--text-secondary)]">
                      LATEST WEEK
                      {billableShareAll !== null && ` · ${billableShareAll}% ACROSS THE PERIOD`}
                    </span>
                  </div>

                  {/* min-h keeps the figure honest on short viewports; flex-1 is what
                      lets it use the card's height on tall ones. */}
                  <div className="min-h-[180px] flex-1">
                    <OverviewHero
                      points={trendPoints}
                      yDomain={[0, 100]}
                      team={team}
                      label={`Billable share per week over ${periodLabel.toLowerCase()}${teamLabelForScope ? ` for ${teamLabelForScope}` : ""}, from ${trendPoints[0].label} to ${trendPoints[trendPoints.length - 1].label}. Click a week for its breakdown.`}
                    />
                  </div>

                  <div className="flex justify-between border-t border-[var(--surface-accent-border)] pt-2 font-mono text-[10px] text-[var(--text-faint)]">
                    {axisTicks.map((tick, index) => (
                      <span key={`${tick}-${index}`}>{tick}</span>
                    ))}
                  </div>
                </>
              )}
            </div>
          </Card>

          {/* Utilisation per person, from time.member_utilisation */}
          <Card className="flex flex-col lg:col-span-5">
            {/*
              "ALL TIME" is load-bearing. time.member_utilisation is not
              period-bounded, so this card genuinely cannot honour the filter,
              and labelling it is the difference between a mixed-scope page and
              a lying one. The team filter DOES apply -- it selects which people
              appear -- so both facts are stated.
            */}
            <CardHeader
              title="Utilisation by person"
              qualifier={[
                "TOP 6 BY HOURS",
                scopeNotes.utilisationAllTime ? "ALL TIME" : null,
                teamLabelForScope?.toUpperCase(),
              ]
                .filter(Boolean)
                .join(" · ")}
            />

            <div className="flex flex-col gap-2.5 px-4 pb-4">
              {teams.length === 0 ? (
                <p className="font-mono text-[11px] text-[var(--text-faint)]">
                  {team !== null
                    ? `Nobody with ${teamLabelForScope} recorded has logged time.`
                    : "No members with logged time."}
                </p>
              ) : (
                teams.map((team) => (
                  /*
                   * Each row names a real person who has a record on /people —
                   * so it links there. A bar chart of colleagues where nothing
                   * is clickable makes the reader go find the search box and
                   * retype a name they are already looking at.
                   */
                  <Link
                    key={team.name}
                    href={`/people?q=${encodeURIComponent(team.name)}`}
                    className="group -mx-1.5 flex flex-col gap-1 rounded-[var(--radius-sm)] px-1.5 py-1 transition-colors hover:bg-[var(--surface-hover)]"
                  >
                    <div className="flex justify-between text-[12px] text-[var(--text-secondary)]">
                      <span className="truncate pr-2 group-hover:text-[var(--text-primary)]">
                        {team.name}
                      </span>
                      <span className="shrink-0 font-mono font-medium text-[var(--text-primary)]">
                        {/*
                          "n/a" not "0%": no contracted hours means the ratio is
                          undefined, and 0% would read as somebody idle.
                        */}
                        {team.percent !== null ? `${team.percent}%` : "n/a"}
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--border)]">
                      {team.percent !== null ? (
                        <div
                          className="h-full rounded-full transition-[filter] duration-150 group-hover:brightness-110"
                          style={{
                            width: `${Math.min(100, team.percent)}%`,
                            background: toneColour(team.tone),
                          }}
                        />
                      ) : (
                        /*
                         * Hatched, not empty and not zero-width: "we have no
                         * basis to compute this" must look different from
                         * "this person is at 0%".
                         */
                        <div
                          className="h-full w-full"
                          style={{
                            background:
                              "repeating-linear-gradient(45deg, var(--border), var(--border) 4px, var(--surface-2) 4px, var(--surface-2) 8px)",
                          }}
                        />
                      )}
                    </div>
                  </Link>
                ))
              )}
            </div>

            <div className="mt-auto flex flex-col gap-1 border-t border-[var(--divider)] px-4 pb-4 pt-3">
              <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--text-faint)]">
                BASIS
              </span>
              {/*
                "Nominal 40-hour week", not "contracted". Every TrackingTime
                member reports exactly 40 h/week because that is the account
                default — describing it as contracted would present a default
                as a fact about someone's employment.
              */}
              <p className="text-[11px] leading-relaxed text-[var(--text-secondary)]">
                Tracked hours against a nominal 40-hour week, across the weeks
                each person was active. TrackingTime holds no contracted hours.
                These percentages are all-time, not for the selected period —
                the per-person view is not date-bounded.
              </p>
            </div>
          </Card>
        </div>

        {/*
          The proportion strip: a donut for the billable split and a gauge for
          utilisation. Different questions get different shapes -- the user asked for
          more than bars, and the reference uses exactly these: a ring for "how does
          the whole divide", a semicircular gauge for "one bounded number with a
          judgement". Both draw from figures already on this page, so they add a
          reading, not a new source.
        */}
        {/*
          COLLAPSED ON A PHONE ONLY. Measured at 390x844 this strip was 576px of
          the route's 3,492px, and it is by construction the most redundant block
          on the page: every figure in it is a RE-READING of numbers already
          stated above (the billable donut re-draws the billable KPI tile, the
          gauge averages the card above it, and "This period" restates the tiles
          verbatim). Three abreast on a desktop that redundancy is the point --
          proportion beside magnitude, read in one glance. Stacked into one
          column on a phone it is three screens of the same three numbers.

          The summary carries those numbers, so nothing is lost while shut, and
          MobileDisclosure keeps `sm:block` on the content, so at 1440px this is
          a bare wrapper and the desktop grid is unchanged.
        */}
        <MobileDisclosure
          title="Billable split & utilisation"
          summary={
            `${billableShareAll === null ? "—" : `${billableShareAll}%`} billable` +
            ` · ${avgUtilisation === null ? "—" : `${avgUtilisation}%`} utilisation` +
            ` · ${Math.round(totalHoursAll).toLocaleString("de-DE")}h logged`
          }
        >
        <div className="stagger grid grid-cols-1 gap-[var(--card-gap)] sm:grid-cols-2 lg:grid-cols-3">
          <Card className="flex flex-col">
            <CardHeader title="Billable split" qualifier={scopedQualifier()} />
            <div className="flex flex-1 flex-wrap items-center justify-center gap-x-8 gap-y-3 px-4 pb-5">
              {billableShareAll === null ? (
                <p className="font-mono text-[11px] text-[var(--text-faint)]">
                  {team !== null || coveredWeeks !== null
                    ? "No hours in this period."
                    : "No hours yet."}
                </p>
              ) : (
                <>
                  <Donut
                    slices={[
                      { label: "Billable", value: billableHoursAll, color: "var(--accent)" },
                      {
                        label: "Non-billable",
                        value: Math.max(0, totalHoursAll - billableHoursAll),
                        color: "var(--text-faint)",
                      },
                    ]}
                    centre={`${billableShareAll}%`}
                    centreLabel="billable"
                    label={`Billable split over ${periodLabel.toLowerCase()}${teamLabelForScope ? ` for ${teamLabelForScope}` : ""}: ${billableShareAll}% of ${Math.round(totalHoursAll).toLocaleString("de-DE")} hours billable`}
                  />
                  <div className="flex flex-col gap-2">
                    <LegendDot color="var(--accent)">
                      {Math.round(billableHoursAll).toLocaleString("de-DE")} H BILLABLE
                    </LegendDot>
                    <LegendDot color="var(--text-faint)">
                      {Math.round(totalHoursAll - billableHoursAll).toLocaleString("de-DE")} H NON-BILLABLE
                    </LegendDot>
                  </div>
                </>
              )}
            </div>
        {/*
          "Billable share" is ambiguous without a denominator: share of tracked
          hours, or share of contracted capacity? The two give very different
          numbers from the same week. Stating which one stops a reader taking
          63% of logged time as 63% of their working week.
        */}
        <ChartNote>
          Billable hours as a share of all tracked hours in this period. The
          denominator is time actually logged, not contracted capacity —
          utilisation, in the card beside this one, answers that instead.
        </ChartNote>
          </Card>

          <Card className="flex flex-col">
            {/* The gauge averages the rows in the card above, so it inherits
                their scope exactly -- all-time, team-filtered when one is set --
                and must not imply otherwise by saying "ROSTER AVERAGE". */}
            <CardHeader
              title="Utilisation"
              qualifier={[
                team === null ? "ROSTER AVERAGE" : `${teamLabelForScope?.toUpperCase()} AVERAGE`,
                "ALL TIME",
              ].join(" · ")}
            />
            <div className="flex flex-1 items-center justify-center px-4 pb-5">
              {avgUtilisation === null ? (
                <p className="font-mono text-[11px] text-[var(--text-faint)]">
                  {team !== null
                    ? `No basis to compute — nobody with ${teamLabelForScope} recorded has a utilisation figure.`
                    : "No basis to compute — nobody has tracked hours yet."}
                </p>
              ) : (
                <Gauge
                  value={avgUtilisation}
                  max={100}
                  color={gaugeColor}
                  centreLabel="of a 40h week"
                  label={`Average utilisation across ${utilised.length} active people: ${avgUtilisation} percent of a nominal 40-hour week`}
                />
              )}
            </div>
        {/*
          The 40h nominal is the assumption most likely to be misread, and it is
          not the only one in the app: the management page reckons capacity as
          1,304 planned hours a year at 75% billable. A reader comparing the two
          figures needs to know they rest on different bases.
        */}
        <ChartNote>
          Tracked hours against a nominal 40-hour week, averaged over people who
          logged time in the period. People with no hours are left out rather
          than counted as zero, so this is the average of those working.
        </ChartNote>
          </Card>

          <Card className="flex flex-col sm:col-span-2 lg:col-span-1">
            <CardHeader title="This period" qualifier={scopedQualifier()} />
            {/* The plain numbers beside the two figures, so the strip answers
                magnitude as well as proportion without a trip back to the tiles. */}
            <div className="flex flex-1 flex-col justify-center gap-3 px-4 pb-5">
              <div className="flex items-baseline justify-between">
                <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--text-faint)]">HOURS LOGGED</span>
                <span className="font-mono text-[18px] font-semibold text-[var(--text-primary)]">
                  {Math.round(totalHoursAll).toLocaleString("de-DE")}
                </span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--text-faint)]">BILLABLE</span>
                <span className="font-mono text-[18px] font-semibold text-[var(--accent)]">
                  {Math.round(billableHoursAll).toLocaleString("de-DE")}
                </span>
              </div>
              <div className="flex items-baseline justify-between">
                {/*
                  The roster count is a headcount, not a period figure, so it is
                  labelled ON ROSTER rather than sitting unqualified between two
                  period totals.
                */}
                <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--text-faint)]">
                  PEOPLE ON ROSTER
                </span>
                <span className="font-mono text-[18px] font-semibold text-[var(--text-primary)]">
                  {counts.activeMembers}
                </span>
              </div>
            </div>
          </Card>
        </div>
        </MobileDisclosure>

        {/* Project ledger — real projects, ranked by hours logged */}
        <Card className="overflow-hidden">
          <CardHeader
            title="Project ledger"
            /* All time, and said so: project_summary is not date-bounded, so
               this ledger does not move with the period filter above it. */
            qualifier={`TOP ${projects.length} BY HOURS · ALL TIME`}
            actions={
              <Link
                href="/projects"
                className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--accent)] hover:underline"
              >
                All projects
                <IconArrowRight className="flex-none" />
              </Link>
            }
          />

          {projects.length === 0 ? (
            <p className="p-4 font-mono text-[11px] text-[var(--text-faint)]">
              No projects with logged time yet.
            </p>
          ) : (
            <>
              {/* Mobile cards */}
              <div className="flex flex-col divide-y divide-[var(--divider)] border-t border-[var(--divider)] sm:hidden">
                {projects.map((prj) => (
                  <div key={prj.id} className="flex flex-col gap-2 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <Link
                        href={`/projects/${prj.id}`}
                        className="text-[13px] font-medium text-[var(--text-primary)] hover:text-[var(--accent)]"
                      >
                        {prj.name}
                      </Link>
                      <span
                        className="shrink-0 font-mono text-[11px] font-semibold"
                        style={{ color: toneColour(prj.tone) }}
                      >
                        {prj.burnPercent !== null ? `${prj.burnPercent}%` : "no budget"}
                      </span>
                    </div>
                    <span className="font-mono text-[10px] text-[var(--text-muted)]">
                      {prj.customerName ?? "No customer"}
                    </span>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--border)]">
                      {prj.burnPercent !== null ? (
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.min(prj.burnPercent, 100)}%`,
                            background: toneColour(prj.tone),
                          }}
                        />
                      ) : null}
                    </div>
                    <div className="flex gap-4 font-mono text-[10px] text-[var(--text-secondary)]">
                      <span>{prj.loggedHours.toLocaleString("de-DE")} H LOGGED</span>
                      <span>{prj.billableHours.toLocaleString("de-DE")} H BILLABLE</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop table */}
              <div className="hidden overflow-x-auto sm:block">
                <div className="grid min-w-[700px] grid-cols-12 gap-3 border-y border-[var(--divider)] bg-[var(--surface-2)] px-4 py-2 font-mono text-[10px] tracking-[0.1em] text-[var(--text-faint)]">
                  <span className="col-span-4">PROJECT</span>
                  <span className="col-span-3">CUSTOMER</span>
                  <span className="col-span-1 text-right">BUDGET H</span>
                  <span className="col-span-1 text-right">LOGGED H</span>
                  <span className="col-span-3">BURN</span>
                </div>

                {projects.map((prj) => (
                  <div
                    key={prj.id}
                    className="grid min-w-[700px] grid-cols-12 items-center gap-3 border-b border-[var(--divider)] px-4 py-2.5 text-[12px] transition-colors last:border-b-0 hover:bg-[var(--surface-hover)]"
                  >
                    <Link
                      href={`/projects/${prj.id}`}
                      className="col-span-4 truncate font-medium text-[var(--text-primary)] hover:text-[var(--accent)]"
                    >
                      {prj.name}
                    </Link>
                    <span className="col-span-3 truncate text-[var(--text-secondary)]">
                      {prj.customerName ?? "—"}
                    </span>
                    <span className="col-span-1 text-right font-mono text-[var(--text-secondary)]">
                      {prj.estimatedHours !== null
                        ? prj.estimatedHours.toLocaleString("de-DE")
                        : "—"}
                    </span>
                    <span className="col-span-1 text-right font-mono text-[var(--text-primary)]">
                      {prj.loggedHours.toLocaleString("de-DE")}
                    </span>
                    <div className="col-span-3 flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--border)]">
                        {prj.burnPercent !== null ? (
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${Math.min(prj.burnPercent, 100)}%`,
                              background: toneColour(prj.tone),
                            }}
                          />
                        ) : null}
                      </div>
                      {/*
                        A Pill, not bare coloured text. "no budget" is a state
                        rather than a measurement, and 83 of 334 projects are in
                        it -- painting that as a figure invites reading it as 0%.
                      */}
                      <Pill
                        tone={
                          prj.burnPercent === null
                            ? "neutral"
                            : prj.tone === "critical"
                              ? "critical"
                              : prj.tone === "warning"
                                ? "warning"
                                : "good"
                        }
                        className="w-[74px] shrink-0 justify-center"
                      >
                        {prj.burnPercent !== null ? `${prj.burnPercent}%` : "no budget"}
                      </Pill>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

/**
 * "2026-08-03" -> "W32". ISO week, matching how the team refers to weeks.
 *
 * Parsed as UTC on purpose. `new Date("2026-08-03")` is already UTC, but
 * `.getMonth()`/`.getDate()` on it are LOCAL, and in Berlin a Monday-00:00 UTC
 * date reads as the previous Sunday — shifting the whole label by a week.
 */
function formatWeekLabel(weekStart: string): string {
  const date = new Date(`${weekStart}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return "—";

  const thursday = thursdayOf(date);
  const jan4 = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
  const firstThursday = thursdayOf(jan4);
  const week =
    1 + Math.round((thursday.getTime() - firstThursday.getTime()) / 604800000);
  return `W${week}`;
}

/** The Thursday of the ISO week containing `date`. */
function thursdayOf(date: Date): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + 3 - ((date.getUTCDay() + 6) % 7));
  return result;
}
