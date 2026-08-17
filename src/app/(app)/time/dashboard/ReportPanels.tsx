/**
 * The dashboard's non-tabular panels: the KPI strip and the freshness banner.
 *
 * Server Components, both of them — pure formatting over data the page already
 * fetched, so nothing here ships to the browser. The tables moved to
 * ReportTables.tsx when they gained sorting and paging (which need state), and
 * the trend chart to TrendChart.tsx when its tooltip became interactive. What
 * stays here is everything that is genuinely just text.
 *
 * The rule inherited from DashboardPanels.tsx: **a missing number is drawn as
 * "—", never as zero.** "No budget set" and "0% of budget consumed" are
 * different statements, and rendering the first as the second is a quiet lie.
 */
import Link from "next/link";
import type { Totals } from "@/lib/queries/trackingtime-report";
import type { SyncFreshness } from "@/lib/queries/time-dashboard";

function hrs(h: number): string {
  return `${h.toLocaleString("en-GB", { maximumFractionDigits: 1 })}h`;
}

/* --------------------------------------------------------------- KPI strip */

function Kpi({
  label,
  value,
  sub,
  strong = false,
  title,
  href,
}: {
  label: string;
  value: string;
  sub?: string;
  strong?: boolean;
  title?: string;
  /** When set, the whole tile filters the report. */
  href?: string;
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
      {sub && <span className="text-[10.5px] leading-tight text-[var(--text-faint)]">{sub}</span>}
    </>
  );

  const shell =
    "flex flex-col gap-0.5 border border-[var(--border)] bg-[var(--surface)] px-4 py-3 transition-colors";

  // Only the tiles that MEAN a filter are links. Making every tile clickable
  // would promise a drill-down from "avg per active day", which is a derived
  // figure with no rows of its own to show.
  return href ? (
    <Link
      href={href}
      scroll={false}
      title={title}
      className={`${shell} hover:border-[var(--accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]`}
    >
      {body}
    </Link>
  ) : (
    <div className={shell} title={title}>
      {body}
    </div>
  );
}

/**
 * The headline figures.
 *
 * BILLABLE and NON-BILLABLE are links: they are the two filters people reach for
 * most, and clicking the number you are already reading is a shorter path than
 * finding the segmented control below. `hrefFor` is supplied by the page because
 * only the page knows the rest of the filter state that must be preserved.
 */
export function TotalsStrip({
  totals,
  billableHref,
  nonBillableHref,
  groupLabel,
  calendarExcludedSeconds = 0,
  includeCalendarHref,
}: {
  totals: Totals;
  billableHref?: string;
  nonBillableHref?: string;
  /** What "PEOPLE"/"PROJECTS" are counted over, for the tooltip. */
  groupLabel?: string;
  /**
   * Seconds withheld by the calendar exclusion, 0 when calendar time is already
   * included. Stated next to TOTAL HOURS because the number is large enough
   * (39% of a live July) that omitting it silently makes this figure disagree
   * with TrackingTime's own report for the same period.
   */
  calendarExcludedSeconds?: number;
  /** Same report with calendar time switched on. */
  includeCalendarHref?: string;
}) {
  // Average over ACTIVE days, not calendar days in the range. Dividing by the
  // full span would report a part-time consultant who works Tuesdays as though
  // they were idle four days a week, which is a different claim entirely.
  const perDay = totals.activeDays > 0 ? totals.totalHours / totals.activeDays : null;
  const nonBillableHours = Math.round((totals.nonBillableSeconds / 3600) * 10) / 10;
  const calendarExcludedHours = Math.round((calendarExcludedSeconds / 3600) * 10) / 10;

  return (
    <>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <Kpi
        label="TOTAL HOURS"
        value={hrs(totals.totalHours)}
        sub={`${totals.entryCount.toLocaleString("en-GB")} entries`}
        strong
        title={groupLabel}
      />
      <Kpi
        label="BILLABLE"
        value={hrs(totals.billableHours)}
        sub={totals.billablePercent === null ? "—" : `${totals.billablePercent}% of logged`}
        href={billableHref}
        title="Show only billable entries"
      />
      <Kpi
        label="NON-BILLABLE"
        value={hrs(nonBillableHours)}
        sub={totals.billablePercent === null ? "—" : `${100 - totals.billablePercent}% of logged`}
        href={nonBillableHref}
        title="Show only non-billable entries"
      />
      <Kpi
        label="PEOPLE"
        value={String(totals.memberCount)}
        sub={`over ${totals.activeDays} active ${totals.activeDays === 1 ? "day" : "days"}`}
        title="Distinct people with at least one entry in this selection"
      />
      <Kpi
        label="PROJECTS"
        value={String(totals.projectCount)}
        sub={`${totals.customerCount} ${totals.customerCount === 1 ? "customer" : "customers"}`}
        title="Distinct projects with at least one entry in this selection"
      />
      <Kpi
        label="AVG / ACTIVE DAY"
        value={perDay === null ? "—" : hrs(Math.round(perDay * 10) / 10)}
        sub="hours per day worked"
        title="Total hours divided by the number of days that actually have entries, not by the length of the period"
      />
    </div>

    {/* Stated on the happy path too, not only when something looks wrong: a
        caveat that appears only in an empty state teaches people to read the
        absence of a note as "nothing was excluded". */}
    {calendarExcludedHours > 0 && (
      <p className="mt-2 text-[11.5px] text-[var(--text-muted)]">
        <span className="font-mono">{hrs(calendarExcludedHours)}</span> of calendar time is excluded
        from these figures.{" "}
        {includeCalendarHref ? (
          <a
            href={includeCalendarHref}
            className="text-[var(--accent)] underline-offset-2 hover:underline"
          >
            Include it
          </a>
        ) : null}{" "}
        to match TrackingTime&rsquo;s own report.
      </p>
    )}
    </>
  );
}

/* --------------------------------------------------------------- freshness */

/** "17 Aug, 14:30" — precise enough to correlate with a sync log. */
function stamp(isoTs: string): string {
  const d = new Date(isoTs);
  if (Number.isNaN(d.getTime())) return isoTs;
  return d.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function age(hours: number): string {
  if (hours < 1) return "less than an hour ago";
  if (hours === 1) return "1 hour ago";
  if (hours < 48) return `${hours} hours ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

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
 */
export function FreshnessBanner({ freshness }: { freshness: SyncFreshness }) {
  const { status, lastSuccessAt, hoursSince, recordCount, failedSince, inProgress } = freshness;

  if (status === "ok" && lastSuccessAt && hoursSince !== null) {
    return (
      <p className="text-[10.5px] text-[var(--text-faint)]">
        Imported from the TrackingTime API {age(hoursSince)} ({stamp(lastSuccessAt)})
        {recordCount !== null ? ` · ${recordCount.toLocaleString("en-GB")} entries` : ""}
        {inProgress ? " · a sync is running now" : ""}
      </p>
    );
  }

  // stale and missing share a shape and differ in tone: amber for "older than it
  // should be", red for "nobody has successfully synced in a week or ever".
  const critical = status === "missing";
  const colour = critical ? "var(--critical)" : "var(--warning)";
  const wash = critical ? "var(--critical-wash)" : "var(--warning-wash)";

  const headline = !lastSuccessAt
    ? "This data has never been refreshed automatically"
    : critical
      ? `This data is ${age(hoursSince ?? 0)} old`
      : `This data was last refreshed ${age(hoursSince ?? 0)}`;

  return (
    <div
      role="status"
      className="border px-4 py-2.5"
      style={{ borderColor: colour, background: wash }}
    >
      <p className="text-[12px] font-medium" style={{ color: colour }}>
        {headline}
        {lastSuccessAt ? ` (${stamp(lastSuccessAt)})` : ""}
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-secondary)]">
        {failedSince > 0 ? (
          <>
            {failedSince} sync {failedSince === 1 ? "attempt has" : "attempts have"} failed since
            then, so the figures below are correct but no longer updating.{" "}
          </>
        ) : !lastSuccessAt ? (
          <>
            Every figure below comes from a one-off manual import, so it reflects whenever that was
            run rather than today.{" "}
          </>
        ) : (
          <>Every figure below is a snapshot from that import, not a live reading. </>
        )}
        {inProgress
          ? "A sync is running right now — reload shortly."
          : "Run `npm run sync:trackingtime` to refresh."}
      </p>
    </div>
  );
}
