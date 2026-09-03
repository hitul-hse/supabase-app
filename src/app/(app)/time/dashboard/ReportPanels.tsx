/**
 * The dashboard's non-tabular panels: the KPI strip and the freshness banner.
 *
 * Server Components, both of them — pure formatting over data the page already
 * fetched, so nothing here ships to the browser except the small trigger that
 * opens a tile's composition (DrillTrigger, fed plain data). The tables moved to
 * ReportTables.tsx when they gained sorting and paging (which need state), and
 * the trend chart to TrendChart.tsx when its tooltip became interactive. What
 * stays here is everything that is genuinely just text.
 *
 * The rule inherited from DashboardPanels.tsx: **a missing number is drawn as
 * "—", never as zero.** "No budget set" and "0% of budget consumed" are
 * different statements, and rendering the first as the second is a quiet lie.
 */
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import type { Totals } from "@/lib/queries/trackingtime-report";
import type { SyncFreshness } from "@/lib/queries/time-dashboard";
import { secondsToHours } from "@/lib/time-transform";
import { fmtDate, fmtDateTime, fmtHours, fmtNum } from "@/lib/locale-format";
import { DrillTrigger, type Drill, type DrillRow } from "@/components/DrillDialog";
import type { DrillDatum, TimeTileDrillData } from "./drill-data";

/**
 * Hours in the reader's language: "5,638.4h" in en, "5.638,4 Std" in de. The
 * en-GB rendering is unchanged, which is the whole contract of this refactor --
 * extraction is not a redesign, so nothing on the English page may move.
 */
const hoursIn = (locale: string) => (h: number) => fmtHours(h, locale);

/* --------------------------------------------------------------- KPI strip */

function Kpi({
  tile,
  label,
  value,
  sub,
  strong = false,
  title,
  href,
  drill,
  drillId,
}: {
  /**
   * The tile's handle for gates and scripts (`data-tile`), always the English
   * label regardless of locale, so a check that waits for TOTAL HOURS finds it
   * on the German page too. `label` is what the reader sees.
   */
  tile: string;
  label: string;
  value: string;
  sub?: string;
  strong?: boolean;
  title?: string;
  /** When set, the whole tile filters the report. */
  href?: string;
  /**
   * When set instead, the tile opens its composition in place. A popup rather
   * than a filter because these figures (total, people, projects, per-day) are
   * what the reader is comparing; narrowing the report would cost the context
   * that made them curious. Plain data, so this stays a Server Component and
   * only the trigger ships to the browser.
   */
  drill?: Drill;
  drillId?: string;
}) {
  const body = (
    <>
      <span className="font-mono text-[9px] tracking-[0.12em] text-[var(--text-faint)]">
        {label}
      </span>
      <span
        className={`font-mono tabular-nums ${
          strong ? "text-[22px] text-[var(--accent)]" : "text-[19px] text-[var(--text-primary)]"
        }`}
      >
        {value}
      </span>
      {sub && <span className="text-[10px] leading-tight text-[var(--text-faint)]">{sub}</span>}
    </>
  );

  const shell =
    "flex flex-col gap-0.5 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 transition-colors card-elev";

  const interactive = `${shell} hover:border-[var(--accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]`;

  // Only the tiles that MEAN a filter are links; the tiles that HAVE a
  // composition open it in place. "Avg per active day" used to be the inert
  // one, on the grounds that a derived figure has no rows of its own -- but it
  // does: the active days, and listing them is exactly how a reader checks
  // whether one long day is dragging the average.
  if (href) {
    return (
      <Link href={href} scroll={false} data-tile={tile} title={title} className={interactive}>
        {body}
      </Link>
    );
  }
  if (drill) {
    return (
      <DrillTrigger drill={drill} id={drillId} data-tile={tile} className={`${interactive} w-full`}>
        {body}
      </DrillTrigger>
    );
  }
  return (
    <div className={shell} data-tile={tile} title={title}>
      {body}
    </div>
  );
}

/** A row of the popup from one folded datum, formatted like the tile it opened from. */
function hoursRow(
  d: DrillDatum,
  fallbackName: string,
  billableLabel: (percent: number) => string,
  hrs: (h: number) => string,
): DrillRow {
  const share = d.seconds > 0 ? Math.round((d.billableSeconds / d.seconds) * 100) : 0;
  return {
    name: d.name ?? fallbackName,
    sub: d.sub ?? undefined,
    value: `${hrs(secondsToHours(d.seconds))} · ${billableLabel(share)}`,
    // Unrounded: the rows must add up to the headline, and per-row rounding
    // would drift by up to a tenth per row.
    magnitude: d.seconds / 3600,
    tone: d.name === null ? "muted" : "accent",
  };
}

/** "Mon, 17 Aug 2026" (de: "Mo., 17. Aug. 2026"), read in UTC as the day is stored. */
function dayLabel(isoDay: string, locale: string): string {
  const d = new Date(`${isoDay}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return isoDay;
  return fmtDate(d, locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * The headline figures.
 *
 * BILLABLE and NON-BILLABLE are links: they are the two filters people reach for
 * most, and clicking the number you are already reading is a shorter path than
 * finding the segmented control below. `hrefFor` is supplied by the page because
 * only the page knows the rest of the filter state that must be preserved.
 */
export async function TotalsStrip({
  totals,
  billableHref,
  nonBillableHref,
  period,
  calendarExcludedSeconds = 0,
  includeCalendarHref,
  drills,
}: {
  totals: Totals;
  billableHref?: string;
  nonBillableHref?: string;
  /** The date range every figure covers (`from → to`), for the TOTAL HOURS tooltip. */
  period?: string;
  /**
   * Seconds withheld by the calendar exclusion, 0 when calendar time is already
   * included. Stated next to TOTAL HOURS because the number is large enough
   * (39% of a live July) that omitting it silently makes this figure disagree
   * with TrackingTime's own report for the same period.
   */
  calendarExcludedSeconds?: number;
  /** Same report with calendar time switched on. */
  includeCalendarHref?: string;
  /**
   * The composition behind the four non-filter tiles, folded by the page from
   * the SAME entries `totals` was summarised from (drill-data.ts). Optional so
   * the strip still renders as plain tiles when a caller has nothing to open.
   */
  drills?: TimeTileDrillData;
}) {
  const t = await getTranslations("drill");
  // The strip's own words -- labels, sublines, tooltips -- live under
  // timeDashboard.strip; the popups they open keep reading `drill`.
  const s = await getTranslations("timeDashboard.strip");
  const locale = await getLocale();
  const hrs = hoursIn(locale);
  // Average over ACTIVE days, not calendar days in the range. Dividing by the
  // full span would report a part-time consultant who works Tuesdays as though
  // they were idle four days a week, which is a different claim entirely.
  const perDay = totals.activeDays > 0 ? totals.totalHours / totals.activeDays : null;
  const nonBillableHours = Math.round((totals.nonBillableSeconds / 3600) * 10) / 10;
  const calendarExcludedHours = Math.round((calendarExcludedSeconds / 3600) * 10) / 10;

  const billableLabel = (percent: number) => t("billableShare", { percent });
  const noProject = t("noProject");

  /*
   * The four drill-downs, each a re-projection of the entries behind `totals`:
   *
   *   TOTAL HOURS   -> hours by project, the no-project bucket as its own row,
   *                    so the rows SUM to the tile.
   *   PEOPLE        -> one row per person: the row COUNT is the tile.
   *   PROJECTS      -> one row per distinct project: the COUNT is the tile. Time
   *                    without a project is not a project and is not a row here
   *                    (summarise() does not count it either).
   *   AVG / DAY     -> one row per active day: the MEAN of the rows is the tile.
   *
   * `check` states which relation holds, so the deployed-page gate can add the
   * rows up itself rather than trust this comment.
   */
  const totalHoursDrill: Drill | undefined = drills && {
    kicker: s("totalHours.label"),
    title: t("time.totalHours.title"),
    headline: hrs(totals.totalHours),
    headlineValue: totals.totalHours,
    check: "sum",
    subline: `${t("projectCount", { count: totals.projectCount })} · ${t("entries", { count: totals.entryCount })}`,
    rows: drills.byProject.map((d) => hoursRow(d, noProject, billableLabel, hrs)),
    footer: t("time.totalHours.footer"),
  };
  const peopleDrill: Drill | undefined = drills && {
    kicker: s("people.label"),
    title: t("time.people.title"),
    headline: String(totals.memberCount),
    headlineValue: totals.memberCount,
    check: "count",
    subline: `${hrs(totals.totalHours)} · ${t("entries", { count: totals.entryCount })}`,
    rows: drills.byMember.map((d) => hoursRow(d, t("unknownPerson"), billableLabel, hrs)),
    footer: t("time.people.footer"),
  };
  const projectsDrill: Drill | undefined = drills && {
    kicker: s("projects.label"),
    title: t("time.projects.title"),
    headline: String(totals.projectCount),
    headlineValue: totals.projectCount,
    check: "count",
    subline: s("projects.sub", { count: totals.customerCount }),
    rows: drills.byProject
      .filter((d) => d.id !== null)
      .map((d) => hoursRow(d, noProject, billableLabel, hrs)),
    footer: t("time.projects.footer"),
  };
  const avgDayDrill: Drill | undefined =
    drills && perDay !== null
      ? {
          kicker: s("avgDay.label"),
          title: t("time.avgDay.title"),
          headline: hrs(Math.round(perDay * 10) / 10),
          headlineValue: perDay,
          check: "mean",
          subline: t("time.avgDay.subline", {
            hours: fmtNum(totals.totalHours, locale, 1),
            days: totals.activeDays,
          }),
          rows: drills.byDay.map((d) => ({
            name: dayLabel(d.day, locale),
            value: `${hrs(secondsToHours(d.seconds))} · ${t("entries", { count: d.entries })}`,
            magnitude: d.seconds / 3600,
          })),
          footer: t("time.avgDay.footer"),
        }
      : undefined;

  return (
    <>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <Kpi
        tile="TOTAL HOURS"
        label={s("totalHours.label")}
        value={hrs(totals.totalHours)}
        sub={t("entries", { count: totals.entryCount })}
        strong
        title={period ? s("covers", { period }) : undefined}
        drill={totalHoursDrill}
        drillId="time-total-hours"
      />
      <Kpi
        tile="BILLABLE"
        label={s("billable.label")}
        value={hrs(totals.billableHours)}
        sub={totals.billablePercent === null ? "—" : s("billable.sub", { percent: totals.billablePercent })}
        href={billableHref}
        title={s("billable.title")}
      />
      <Kpi
        tile="NON-BILLABLE"
        label={s("nonBillable.label")}
        value={hrs(nonBillableHours)}
        sub={totals.billablePercent === null ? "—" : s("nonBillable.sub", { percent: 100 - totals.billablePercent })}
        href={nonBillableHref}
        title={s("nonBillable.title")}
      />
      <Kpi
        tile="PEOPLE"
        label={s("people.label")}
        value={String(totals.memberCount)}
        sub={s("people.sub", { days: totals.activeDays })}
        title={s("people.title")}
        drill={peopleDrill}
        drillId="time-people"
      />
      <Kpi
        tile="PROJECTS"
        label={s("projects.label")}
        value={String(totals.projectCount)}
        sub={s("projects.sub", { count: totals.customerCount })}
        title={s("projects.title")}
        drill={projectsDrill}
        drillId="time-projects"
      />
      <Kpi
        tile="AVG / ACTIVE DAY"
        label={s("avgDay.label")}
        value={perDay === null ? "—" : hrs(Math.round(perDay * 10) / 10)}
        sub={s("avgDay.sub")}
        title={s("avgDay.title")}
        drill={avgDayDrill}
        drillId="time-avg-day"
      />
    </div>

    {/* Stated on the happy path too, not only when something looks wrong: a
        caveat that appears only in an empty state teaches people to read the
        absence of a note as "nothing was excluded". */}
    {calendarExcludedHours > 0 && (
      <p className="mt-2 text-[11px] text-[var(--text-muted)]">
        {s.rich("calendarExcluded.note", {
          hours: hrs(calendarExcludedHours),
          mono: (chunks) => <span className="font-mono">{chunks}</span>,
        })}{" "}
        {s.rich("calendarExcluded.include", {
          // Without a target there is nothing to include, so the link text is
          // dropped and the rest of the sentence stays -- as it did before.
          link: (chunks) =>
            includeCalendarHref ? (
              <a
                href={includeCalendarHref}
                className="text-[var(--accent)] underline-offset-2 hover:underline"
              >
                {chunks}
              </a>
            ) : null,
        })}
      </p>
    )}
    </>
  );
}

/* --------------------------------------------------------------- freshness */

/**
 * States how old this data is, on the page itself.
 *
 * WHY IT IS ALWAYS RENDERED, even when everything is fine: the whole dashboard
 * is a snapshot of the last import, and a snapshot that does not say when it was
 * taken is indistinguishable from live data. Hiding the indicator on the happy
 * path would train people to assume freshness whenever they see nothing — which
 * is precisely the state a broken sync produces.
 *
 * The "ok" case is deliberately quiet: one faint line, no colour, no icon. A
 * green badge on every page view is noise, and noise is what stops anyone
 * reading the banner on the day it finally turns red.
 *
 * `failedSince > 0` is called out separately from age because it is a different
 * problem: the numbers are still correct, but they have stopped moving, and the
 * person reading needs to know the pipeline is broken rather than merely quiet.
 *
 * Async because the wording and the timestamp both follow the request locale:
 * "3 hours ago (17 Aug, 14:30)" and "vor 3 Stunden (17. Aug., 16:30)" are the
 * same sentence for two readers, and the age is an ICU plural rather than three
 * hand-built English branches.
 */
export async function FreshnessBanner({ freshness }: { freshness: SyncFreshness }) {
  const { status, lastSuccessAt, hoursSince, recordCount, failedSince, inProgress } = freshness;
  const t = await getTranslations("timeDashboard.freshness");
  const d = await getTranslations("drill");
  const locale = await getLocale();

  /** "17 Aug, 14:30" — precise enough to correlate with a sync log. */
  const stamp = (isoTs: string) => fmtDateTime(isoTs, locale);

  const age = (hours: number): string => {
    if (hours < 1) return t("ageUnderHour");
    if (hours < 48) return t("ageHours", { count: hours });
    return t("ageDays", { count: Math.floor(hours / 24) });
  };

  if (status === "ok" && lastSuccessAt && hoursSince !== null) {
    return (
      <p className="text-[10px] text-[var(--text-faint)]">
        {t("imported", { age: age(hoursSince), stamp: stamp(lastSuccessAt) })}
        {/* The entry count reuses drill.entries, whose ICU plural formats 1,234
            exactly as the old en-GB call did. */}
        {recordCount !== null ? ` · ${d("entries", { count: recordCount })}` : ""}
        {inProgress ? ` ${t("syncingNote")}` : ""}
      </p>
    );
  }

  // stale and missing share a shape and differ in tone: amber for "older than it
  // should be", red for "nobody has successfully synced in a week or ever".
  const critical = status === "missing";
  const colour = critical ? "var(--critical)" : "var(--warning)";
  const wash = critical ? "var(--critical-wash)" : "var(--warning-wash)";

  const headline = !lastSuccessAt
    ? t("neverRefreshed")
    : critical
      ? t("isOld", { age: age(hoursSince ?? 0) })
      : t("lastRefreshed", { age: age(hoursSince ?? 0) });

  return (
    <div
      role="status"
      className="rounded-[var(--radius-card)] border px-4 py-2.5 card-elev"
      style={{ borderColor: colour, background: wash }}
    >
      <p className="text-[12px] font-medium" style={{ color: colour }}>
        {lastSuccessAt ? t("withStamp", { headline, stamp: stamp(lastSuccessAt) }) : headline}
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-secondary)]">
        {failedSince > 0
          ? t("failedSince", { count: failedSince })
          : !lastSuccessAt
            ? t("manualOnly")
            : t("snapshot")}{" "}
        {inProgress ? t("runningNow") : t("runCommand")}
      </p>
    </div>
  );
}
