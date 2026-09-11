import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/PageHeader";
import { ButtonLink } from "@/components/ui/Button";
import { Card, CardHeader, ChartNote, StatTile } from "@/components/ui/Card";
import { Meter } from "@/components/ui/Meter";
import { OverBudgetQueue, UtilisationQueue } from "./OverviewQueues";
import { EmptyState } from "@/components/EmptyState";
import { fmtNum } from "@/lib/locale-format";
import { Donut, Gauge, LegendDot } from "@/components/ui/Charts";
import { Pill } from "@/components/ui/Segmented";
import { IconWarning, IconArrowRight } from "@/components/nav-icons";
import { SyncBar } from "@/components/SyncBar";
import { MobileDisclosure } from "@/components/MobileDisclosure";
import { createClient } from "@/utils/supabase/server";
import {
  getLiveOverview,
  NO_TEAM,
  parseOverviewRange,
  parseOverviewTeam,
  UTILISATION_BANDS,
  type OverviewMessage,
} from "@/lib/queries/overview-live";
import { OverviewFilters } from "./OverviewFilters";

/*
 * Every figure on this page is formatted de-DE, in both languages, and has been
 * since it was rebuilt off the seeded tables (see the module note above:
 * "Numbers keep their de-DE formatting … so the catalogue never reformats a
 * figure the reader has already learned to read"). The regions added since then
 * pass this to `fmtNum`/`fmtPct` rather than the request locale, because ONE
 * page showing "2.999" in a tile and "1,953" in the card beside it is a defect
 * a reader notices immediately, and the choice of dialect is a page-wide one.
 */
const NUMBER_LOCALE = "de";

/**
 * A percentage in this page's dialect: de-DE separators, and the sign tight
 * against the figure.
 *
 * `fmtPct` puts a space before the sign in German, which is correct German
 * typography and WRONG here: every existing figure on this page — the five
 * tiles, the donut centre, the chart headline — has always been written "65%",
 * and one card writing "65 %" beside four writing "65%" is a defect a reader
 * notices before they notice anything else. The dialect is a property of the
 * page, so it is stated once, here.
 */
const pct = (n: number, dp = 0) => `${fmtNum(n, NUMBER_LOCALE, dp)}%`;
import { OverviewHero } from "./OverviewHero";
import { requireUser } from "@/utils/supabase/require-user";
import { enforceRoleRouteAccess } from "@/utils/supabase/require-profile";

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
 *
 * Every user-visible string comes from messages/{en,de}.json under `overview`
 * (next-intl, cookie-selected locale). Numbers keep their de-DE formatting and
 * are passed to the messages pre-formatted, so the catalogue never reformats
 * a figure the reader has already learned to read.
 */
export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string; team?: string }>;
}) {
  await requireUser("/");
  /*
    THE LINCHPIN OF THE ROUTE ALLOW-LIST, not just one more guarded page.

    Every refusal in this app -- requirePermission(), requireProfile(roles) --
    redirects to "/". So a role that must not see the Overview but is only
    refused by those gates lands on the Overview every time it is refused: the
    restriction would fail open on exactly the path a restricted user takes most
    often. And "/" is where sign-in lands by default (safeRedirect's fallback in
    auth/login), so it is also the first page they would ever see.

    This must therefore run BEFORE getLiveOverview() -- redirecting after the
    query would still have executed a full portfolio read for someone not
    allowed to see one.
  */
  await enforceRoleRouteAccess("/");
  const supabase = await createClient();
  const t = await getTranslations("overview");
  const tc = await getTranslations("common");

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
    budgetsWithheld,
    metrics,
    weeks,
    teams,
    projects,
    overBudgetProjects,
    counts,
    unlinkedPeople,
    teamOptions,
    teamCoverage,
    coveredWeeks,
    scopeNotes,
  } = await getLiveOverview(supabase, { range, team });

  /** A message reference from the query layer, rendered in the reader's locale. */
  const msg = (m: OverviewMessage) => t(m.key, m.values);

  /**
   * The no-team bucket is the one option whose label is prose rather than a
   * stored team name, so it is translated here at the server boundary; the
   * query module keeps the English literal as its fallback.
   */
  const localisedTeamOptions = teamOptions.map((option) =>
    option.key === NO_TEAM ? { ...option, label: t("filters.noTeam") } : option,
  );

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
      ? t("period.noWeeks")
      : coveredWeeks.count === 1
        ? `${coveredWeeks.first}`
        : t("period.range", {
            first: coveredWeeks.first,
            last: coveredWeeks.last,
            count: coveredWeeks.count,
          });

  const teamLabelForScope =
    team === null
      ? null
      : (localisedTeamOptions.find((t) => t.key === team)?.label ?? team);

  /** " for Tech" / " für Tech", or nothing when the page is unscoped. */
  const forTeam = teamLabelForScope ? t("qualifiers.forTeam", { team: teamLabelForScope }) : "";

  /** The qualifier under a card title: period, plus the team when one is set. */
  const scopedQualifier = (extra?: string) =>
    [periodLabel, teamLabelForScope?.toUpperCase(), extra]
      .filter(Boolean)
      .join(" · ");

  /** "W32" / "KW32": the ISO week, named the way the reader's language names it. */
  const weekLabel = (weekStart: string) => {
    const week = isoWeekNumber(weekStart);
    return week === null ? "—" : t("weekLabel", { week });
  };

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
        label: weekLabel(w.weekStart),
        value: share,
        readout: t("billableShare.readout", {
          week: weekLabel(w.weekStart),
          share,
          billable: w.billableHours.toLocaleString("de-DE"),
          total: w.totalHours.toLocaleString("de-DE"),
        }),
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
  /* The SAME cuts the utilisation queue words are drawn from, imported rather
     than repeated: 40/105 here against 60/110 there let the page call a person
     low at 54 % and paint a 53 % average healthy on the same screen. */
  const gaugeColor =
    avgUtilisation === null
      ? "var(--text-muted)"
      : avgUtilisation < UTILISATION_BANDS.low
        ? "var(--warning)"
        : avgUtilisation > UTILISATION_BANDS.overCapacity
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
    .map((week) => weekLabel(week.weekStart));

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
        title={t("title")}
        meta={t("header.meta", {
          quarter: counts.currentQuarter,
          people: counts.activeMembers,
          projects: counts.activeProjects,
          customers: counts.customers,
        })}
        actions={
          <ButtonLink variant="primary" href="/time/dashboard">
            {t("header.fullDashboard")}
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
          teamOptions={localisedTeamOptions}
          coverage={teamCoverage}
        />

        {/*
          Said out loud because org_week aggregates by ISO week: a range starting
          mid-month is widened to whole weeks, and a reader comparing this page
          against a to-the-day report deserves to know why the totals differ.
        */}
        {scopeNotes.snappedToWholeWeeks && (
          <p className="font-mono text-[10px] tracking-[0.1em] text-[var(--text-faint)]">
            {t("period.widened", { period: periodLabel })}
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
                {t.rich("unlinked.message", {
                  count: unlinkedPeople,
                  total: counts.activeMembers,
                  strong: (chunks) => (
                    <span className="font-mono font-semibold text-[var(--warning)]">
                      {chunks}
                    </span>
                  ),
                })}
              </span>
            </span>
            <Link
              href="/people"
              className="flex items-center gap-1.5 whitespace-nowrap text-[11px] font-medium text-[var(--accent)] hover:underline"
            >
              {t("unlinked.review")}
              <IconArrowRight className="flex-none" />
            </Link>
          </Card>
        )}

        {/*
          THE HERO BAND (APPLE_REF §5.5, §3.3 "Hero tone once per page").

          One sentence and one figure. The page's opening question is "how did
          the business do this week", and it was answered by an area chart with
          a segmented control — a shape that rewards study rather than a glance,
          and that made the reader derive the headline from a curve. The band
          states it instead: the sentence carries the meaning, the fig-xl carries
          the figure, and the meter carries the shape of it.

          It ADDS a reading; it removes none. The chart below keeps every point,
          every hover readout and its own control, and the numbers here are the
          same ones it plots — `trendPoints`' last value, and the period
          aggregate already computed for the split donut. Nothing new was
          queried and no figure changed its basis.

          `tone="hero"` moved here from that chart card, because there is exactly
          one per page and the headline figure is now here. The chart card is an
          ordinary panel below.
        */}
        <Card tone="hero" className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-end sm:justify-between sm:gap-8">
          <div className="flex min-w-0 flex-col gap-1.5">
            {/*
              The scope, stated before the claim. "The week is 73 % billable"
              is a different sentence depending on WHICH week, and the meta line
              of a hero that does not say so is how a stale figure keeps looking
              current (§5.9).
            */}
            <span className="t-label text-[var(--text-faint)]">
              {t("heroBand.kicker", {
                week: trendPoints.length > 0 ? trendPoints[trendPoints.length - 1].label : "—",
              })}
            </span>
            <h2 className="t-large text-[var(--text-primary)]">
              {trendPoints.length > 0
                ? t("heroBand.headline", {
                    share: pct(trendPoints[trendPoints.length - 1].value),
                  })
                : t("heroBand.noWeek")}
            </h2>
            {/*
              The period figure beside the weekly one, so the headline cannot be
              read as the whole quarter. Both scopes are named (§8 F2).
            */}
            {billableShareAll !== null && (
              <p className="t-subhead text-[var(--text-muted)]">
                {t("heroBand.hint", {
                  across: pct(billableShareAll),
                  /* Not lower-cased. `periodLabel` is "W25–W36 · 12 WEEKS" /
                     "· 12 Wochen": German capitalises the noun, and folding it
                     turns the ISO week label into "w25" as well. */
                  period: periodLabel,
                  billable: fmtNum(billableHoursAll, NUMBER_LOCALE, 0),
                  total: fmtNum(totalHoursAll, NUMBER_LOCALE, 0),
                  people: counts.activeMembers,
                })}
              </p>
            )}
          </div>

          {trendPoints.length > 0 && (
            <div className="flex flex-none flex-col items-start gap-2 sm:items-end">
              {/* The ONE teal figure on the page: fig-xl in --accent lives in
                  the hero tile and nowhere else (§5.5, §8 #5). Verified rather
                  than asserted — the "This period" card's BILLABLE figure was
                  the second one, and it is in the text ladder now. Grep for
                  `text-[var(--accent)]` before adding a third: everything else
                  that matches on this page is a LINK, which is what teal is
                  for. */}
              <span className="fig-xl text-[var(--accent)]">
                {pct(trendPoints[trendPoints.length - 1].value)}
              </span>
              <Meter
                percent={trendPoints[trendPoints.length - 1].value}
                color="var(--accent)"
                className="w-full sm:w-60"
              />
              <span className="t-label text-[var(--text-faint)]">{t("heroBand.caption")}</span>
            </div>
          )}
        </Card>

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
            const label = msg(metric.label);
            const tile = (
              <StatTile
                key={href ? undefined : metric.key}
                data-metric={metric.key}
                label={label}
                value={metric.value}
                hint={msg(metric.subtext)}
                tone={metric.tone}
                progressPercent={metric.progressPercent}
                className={href ? "h-full cursor-pointer" : undefined}
              />
            );
            return href ? (
              <Link key={metric.key} href={href} aria-label={t("tiles.openDetails", { label })} className="block focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]">
                {tile}
              </Link>
            ) : (
              tile
            );
          })}
        </div>

        {/*
          THE TWO WORKED QUEUES (UI-CONVENTIONS rules 1, 3, 5, 6; APPLE_REF §5.4,
          §8 #11). Ten rows each, worst first, the honest count in the card
          header, and the page in the URL.

          "Over budget" is NEW and answers a question this page could only count
          before: the PROJECTS OVER BUDGET tile stated 11 and linked away, so
          reading the names meant leaving the Overview. Its rows come out of the
          same `getBudgetPosture` pass as that tile, so the count in the header
          and the count in the tile are the same number by construction.

          "Utilisation by person" is the same card as before, in a shape that
          can answer with it. It was six rows sorted by hours DESCENDING — the
          six people who logged the most — which put the eleven the figure exists
          to surface out of reach entirely. It is all seventeen now, lowest
          first, with the team, the hours and, for the first time, the status as
          a word rather than only as the colour of a bar (§8 #5).

          Neither figure changed its basis: the same query, the same denominator,
          the same "all time" caveat, stated in the same words.
        */}
        {/*
          COLLAPSED ON A PHONE ONLY, and for a measured reason.

          Two ten-row tables stacked into one column at 390px added 854px to
          this route (3,106px -> 3,960px measured, against
          check-table-scroll-budget's four-screen ceiling). Nothing is hidden by
          it: the summary states both headline figures, and the queues are one
          tap away. `MobileDisclosure` keeps `sm:block` on its content, so at
          1440 this is a bare wrapper and the desktop grid below is byte for
          byte what it was — the same mechanism, and the same reasoning, as the
          proportion strip further down this page.
        */}
        <MobileDisclosure
          title={t("queues.title")}
          summary={t("queues.summary", {
            overBudget: overBudgetProjects === null ? tc("notAvailable") : overBudgetProjects.length,
            people: teams.length,
          })}
        >
        {/*
          SIDE BY SIDE FROM 1440, not from `xl` (1280). At 1280 with the sidebar
          open each queue got 491px, and both tables need more than that --
          check-table-width.mjs measured 526px (over budget) and 539px
          (utilisation) in German -- so each scrolled sideways and hid the
          BURN / UTILISATION figures it exists to show, which is the failure
          the column caps in OverviewQueues.tsx were written against. Stacked
          between 1280 and 1439, each gets the full 995px; from 1440 each gets
          ~571px and they fit side by side again, as before.
        */}
        <div className="stagger grid grid-cols-1 gap-[var(--card-gap)] min-[1440px]:grid-cols-2">
          {overBudgetProjects === null ? (
            /*
              Withheld or unreadable, NOT empty. An empty queue here would read
              as "no project is over budget" — a confident claim about the
              portfolio produced by a permission check, which is the exact
              substitution the three-state budget posture exists to prevent.
            */
            <Card className="flex flex-col">
              <CardHeader title={t("overBudget.title")} />
              <div className="px-4 pb-4">
                <EmptyState
                  title={t("overBudget.title")}
                  description={t("overBudget.withheld")}
                />
              </div>
            </Card>
          ) : (
            <OverBudgetQueue
              rows={overBudgetProjects}
              hint={t("overBudget.qualifier")}
              footnote={t("overBudget.footnote")}
              emptyText={t("overBudget.empty")}
              locale={NUMBER_LOCALE}
            />
          )}

          <UtilisationQueue
            rows={teams}
            /*
              "ALL TIME" is load-bearing and stays exactly as it was:
              time.member_utilisation is not period-bounded, so this card
              genuinely cannot honour the filter, and labelling it is the
              difference between a mixed-scope page and a lying one. The team
              filter DOES apply — it selects which people appear — so both facts
              are stated.
            */
            hint={[
              scopeNotes.utilisationAllTime ? t("qualifiers.allTime") : null,
              teamLabelForScope?.toUpperCase(),
              t("utilisationByPerson.qualifier"),
            ]
              .filter(Boolean)
              .join(" · ")}
            emptyText={
              team !== null
                ? t("utilisationByPerson.nobodyTeam", { team: teamLabelForScope ?? "" })
                : t("utilisationByPerson.noMembers")
            }
            footnote={
              <>
                {/*
                  "Nominal 40-hour week", not "contracted". Every TrackingTime
                  member reports exactly 40 h/week because that is the account
                  default — describing it as contracted would present a default
                  as a fact about someone's employment.
                */}
                {t("utilisationByPerson.basisNote")}{" "}
                {t("utilisationByPerson.teamNote")}
              </>
            }
            locale={NUMBER_LOCALE}
          />
        </div>
        </MobileDisclosure>

        <div className="stagger grid grid-cols-1 gap-[var(--card-gap)] lg:grid-cols-12">
          {/*
            The hero figure: billable share per week, as a smooth area.

            An ordinary panel now, not the hero. `tone="hero"` is once per page
            (§3.3), and the headline figure moved up into the band at the top of
            the page — a chart whose own headline is already stated three cards
            above does not need the tinted material as well, and two tinted cards
            would flatten the page back to wallpaper (Card.tsx "TONES").

            Everything IN the card is unchanged: the same series, the same
            per-point readouts, the same axis, the same three distinct
            "no hours" sentences.
          */}
          {/* `data-chart="billable-share"` is the CHART's own hook.
              check-charts-ui.mjs used to find this card by `data-card="hero"`,
              which is how it asserted that the figure is an SVG filling at
              least 45 % of its card rather than the old ~25 % bar strip. That
              tone moved to the hero band above (one hero per page), and the
              gate went on reading `data-card="hero"` — where it found a text
              tile with no SVG in it and failed three assertions that are still
              true of this card. A name that says what the element IS, rather
              than what tone it happens to carry, cannot come loose that way. */}
          <Card data-chart="billable-share" className="flex flex-col lg:col-span-12">
            <CardHeader
              title={t("billableShare.title")}
              qualifier={scopedQualifier(t("qualifiers.trackingTime"))}
              actions={
                <div className="flex items-center gap-3">
                  <LegendDot color="var(--accent)">{t("billableShare.legend")}</LegendDot>
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
                    ? t("billableShare.noHoursTeam", { team: teamLabelForScope ?? "" })
                    : coveredWeeks !== null
                      ? t("billableShare.noHoursPeriod")
                      : t("billableShare.noImport")}
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
                      {t("billableShare.latestWeek")}
                      {billableShareAll !== null &&
                        t("billableShare.acrossPeriod", { share: billableShareAll })}
                    </span>
                  </div>

                  {/* min-h keeps the figure honest on short viewports; flex-1 is what
                      lets it use the card's height on tall ones. */}
                  <div className="min-h-[180px] flex-1">
                    <OverviewHero
                      points={trendPoints}
                      yDomain={[0, 100]}
                      team={team}
                      label={t("billableShare.chartLabel", {
                        period: periodLabel.toLowerCase(),
                        forTeam,
                        from: trendPoints[0].label,
                        to: trendPoints[trendPoints.length - 1].label,
                      })}
                    />
                  </div>

                  <div className="flex justify-between border-t border-[var(--divider)] pt-2 font-mono text-[10px] text-[var(--text-faint)]">
                    {axisTicks.map((tick, index) => (
                      <span key={`${tick}-${index}`}>{tick}</span>
                    ))}
                  </div>
                </>
              )}
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
          title={t("disclosure.title")}
          summary={t("disclosure.summary", {
            billable: billableShareAll === null ? "—" : `${billableShareAll}%`,
            utilisation: avgUtilisation === null ? "—" : `${avgUtilisation}%`,
            hours: Math.round(totalHoursAll).toLocaleString("de-DE"),
          })}
        >
        <div className="stagger grid grid-cols-1 gap-[var(--card-gap)] sm:grid-cols-2 lg:grid-cols-3">
          <Card className="flex flex-col">
            <CardHeader title={t("billableSplit.title")} qualifier={scopedQualifier()} />
            <div className="flex flex-1 flex-wrap items-center justify-center gap-x-8 gap-y-3 px-4 pb-5">
              {billableShareAll === null ? (
                <p className="font-mono text-[11px] text-[var(--text-faint)]">
                  {team !== null || coveredWeeks !== null
                    ? t("billableSplit.noHoursPeriod")
                    : t("billableSplit.noHoursYet")}
                </p>
              ) : (
                <>
                  <Donut
                    slices={[
                      { label: t("billableSplit.billable"), value: billableHoursAll, color: "var(--accent)" },
                      {
                        label: t("billableSplit.nonBillable"),
                        value: Math.max(0, totalHoursAll - billableHoursAll),
                        color: "var(--text-faint)",
                      },
                    ]}
                    centre={`${billableShareAll}%`}
                    centreLabel={t("billableSplit.centreLabel")}
                    label={t("billableSplit.chartLabel", {
                      period: periodLabel.toLowerCase(),
                      forTeam,
                      share: billableShareAll,
                      hours: Math.round(totalHoursAll).toLocaleString("de-DE"),
                    })}
                  />
                  <div className="flex flex-col gap-2">
                    <LegendDot color="var(--accent)">
                      {t("billableSplit.legendBillable", {
                        hours: Math.round(billableHoursAll).toLocaleString("de-DE"),
                      })}
                    </LegendDot>
                    <LegendDot color="var(--text-faint)">
                      {t("billableSplit.legendNonBillable", {
                        hours: Math.round(totalHoursAll - billableHoursAll).toLocaleString("de-DE"),
                      })}
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
        <ChartNote>{t("billableSplit.note")}</ChartNote>
          </Card>

          <Card className="flex flex-col">
            {/* The gauge averages the rows in the card above, so it inherits
                their scope exactly -- all-time, team-filtered when one is set --
                and must not imply otherwise by saying "ROSTER AVERAGE". */}
            <CardHeader
              title={t("utilisation.title")}
              qualifier={[
                team === null
                  ? t("utilisation.rosterAverage")
                  : t("utilisation.teamAverage", { team: (teamLabelForScope ?? "").toUpperCase() }),
                t("qualifiers.allTime"),
              ].join(" · ")}
            />
            <div className="flex flex-1 items-center justify-center px-4 pb-5">
              {avgUtilisation === null ? (
                <p className="font-mono text-[11px] text-[var(--text-faint)]">
                  {team !== null
                    ? t("utilisation.noBasisTeam", { team: teamLabelForScope ?? "" })
                    : t("utilisation.noBasis")}
                </p>
              ) : (
                <Gauge
                  value={avgUtilisation}
                  max={100}
                  color={gaugeColor}
                  centreLabel={t("utilisation.centreLabel")}
                  label={t("utilisation.chartLabel", {
                    count: utilised.length,
                    percent: avgUtilisation,
                  })}
                />
              )}
            </div>
        {/*
          The 40h nominal is the assumption most likely to be misread, and it is
          not the only one in the app: the management page reckons capacity as
          1,304 planned hours a year at 75% billable. A reader comparing the two
          figures needs to know they rest on different bases.
        */}
        <ChartNote>{t("utilisation.note")}</ChartNote>
          </Card>

          <Card className="flex flex-col sm:col-span-2 lg:col-span-1">
            <CardHeader title={t("thisPeriod.title")} qualifier={scopedQualifier()} />
            {/* The plain numbers beside the two figures, so the strip answers
                magnitude as well as proportion without a trip back to the tiles. */}
            <div className="flex flex-1 flex-col justify-center gap-3 px-4 pb-5">
              <div className="flex items-baseline justify-between">
                <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--text-faint)]">{t("thisPeriod.hoursLogged")}</span>
                <span className="font-mono text-[18px] font-semibold text-[var(--text-primary)]">
                  {Math.round(totalHoursAll).toLocaleString("de-DE")}
                </span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--text-faint)]">{t("thisPeriod.billable")}</span>
                {/* --text-primary, not --accent. This was the SECOND teal
                    figure on the page, three cards under a hero whose comment
                    claims to hold the only one — both above the fold at 1440.
                    Teal on a figure is decoration, which §8 #5 and
                    UI-CONVENTIONS forbid in the same words; the label beside it
                    already says which of the two numbers is the billable one. */}
                <span className="font-mono text-[18px] font-semibold text-[var(--text-primary)]">
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
                  {t("thisPeriod.peopleOnRoster")}
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
            title={t("projectLedger.title")}
            /* All time, and said so: project_summary is not date-bounded, so
               this ledger does not move with the period filter above it. */
            qualifier={t("projectLedger.qualifier", { count: projects.length })}
            actions={
              <Link
                href="/projects"
                className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--accent)] hover:underline"
              >
                {t("projectLedger.allProjects")}
                <IconArrowRight className="flex-none" />
              </Link>
            }
          />

          {projects.length === 0 ? (
            <p className="p-4 font-mono text-[11px] text-[var(--text-faint)]">
              {t("projectLedger.empty")}
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
                        {prj.burnPercent !== null
                          ? `${prj.burnPercent}%`
                          : budgetsWithheld
                            ? t("projectLedger.budgetWithheld")
                            : t("projectLedger.noBudget")}
                      </span>
                    </div>
                    <span className="font-mono text-[10px] text-[var(--text-muted)]">
                      {prj.customerName ?? t("projectLedger.noCustomer")}
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
                      <span>{t("projectLedger.loggedH", { hours: prj.loggedHours.toLocaleString("de-DE") })}</span>
                      <span>{t("projectLedger.billableH", { hours: prj.billableHours.toLocaleString("de-DE") })}</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop table */}
              <div className="hidden overflow-x-auto sm:block">
                <div className="grid min-w-[700px] grid-cols-12 gap-3 border-y border-[var(--divider)] bg-[var(--surface-2)] px-4 py-2 font-mono text-[10px] tracking-[0.1em] text-[var(--text-faint)]">
                  <span className="col-span-4">{t("projectLedger.columns.project")}</span>
                  <span className="col-span-3">{t("projectLedger.columns.customer")}</span>
                  <span className="col-span-1 text-right">{t("projectLedger.columns.budgetH")}</span>
                  <span className="col-span-1 text-right">{t("projectLedger.columns.loggedH")}</span>
                  <span className="col-span-3">{t("projectLedger.columns.burn")}</span>
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
                        {prj.burnPercent !== null
                          ? `${prj.burnPercent}%`
                          : budgetsWithheld
                            ? t("projectLedger.budgetWithheld")
                            : t("projectLedger.noBudget")}
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
 * "2026-08-03" -> 32. The ISO week number, matching how the team refers to
 * weeks; the page names it "W32" or "KW32" through the message catalogue.
 *
 * Parsed as UTC on purpose. `new Date("2026-08-03")` is already UTC, but
 * `.getMonth()`/`.getDate()` on it are LOCAL, and in Berlin a Monday-00:00 UTC
 * date reads as the previous Sunday — shifting the whole label by a week.
 */
function isoWeekNumber(weekStart: string): number | null {
  const date = new Date(`${weekStart}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;

  const thursday = thursdayOf(date);
  const jan4 = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
  const firstThursday = thursdayOf(jan4);
  return 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / 604800000);
}

/** The Thursday of the ISO week containing `date`. */
function thursdayOf(date: Date): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + 3 - ((date.getUTCDay() + 6) % 7));
  return result;
}
