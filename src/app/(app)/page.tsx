import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { ButtonLink } from "@/components/ui/Button";
import { Card, CardHeader, StatTile } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Segmented";
import { TopBarChrome } from "@/components/TopBarChrome";
import { IconWarning, IconArrowRight } from "@/components/nav-icons";
import { SyncBar } from "@/components/SyncBar";
import { createClient } from "@/utils/supabase/server";
import { getLiveOverview, OVERVIEW_WEEKS } from "@/lib/queries/overview-live";
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
export default async function OverviewPage() {
  await requireUser("/");
  const supabase = await createClient();
  const { metrics, weeks, teams, projects, counts, unlinkedPeople } =
    await getLiveOverview(supabase);

  const chartMax = Math.max(0, ...weeks.map((w) => w.totalHours));

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

      <div className="flex flex-col gap-[var(--card-gap)] p-4 sm:p-6">
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
        <div className="grid grid-cols-2 gap-[var(--card-gap)] sm:grid-cols-3 lg:grid-cols-5">
          {metrics.map((metric) => (
            <StatTile
              key={metric.key}
              data-metric={metric.key}
              label={metric.label}
              value={metric.value}
              hint={metric.subtext}
              tone={metric.tone}
              progressPercent={metric.progressPercent}
            />
          ))}
        </div>

        <div className="grid grid-cols-1 gap-[var(--card-gap)] lg:grid-cols-12">
          {/*
            Billable vs non-billable, per week, from time.org_week.

            `tone="hero"` — the ONE tinted card on this page. It is the primary
            chart, and without a material difference a grid of identically
            surfaced cards reads as wallpaper with no entry point.
          */}
          <Card tone="hero" className="flex flex-col lg:col-span-7">
            <CardHeader
              title="Billable vs non-billable hours"
              qualifier={`LAST ${OVERVIEW_WEEKS} WEEKS · TRACKINGTIME`}
              actions={
                <div className="flex items-center gap-3 font-mono text-[10px] text-[var(--text-secondary)]">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-[var(--accent)]" />
                    BILLABLE
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-[var(--text-faint)]" />
                    NON-BILLABLE
                  </span>
                </div>
              }
            />
            <div className="flex flex-col gap-3.5 px-4 pb-4">

            <div className="flex h-[140px] items-end gap-1.5 pt-4 sm:h-[160px] sm:gap-2">
              {chartMax === 0 ? (
                <p className="self-center font-mono text-[11px] text-[var(--text-faint)]">
                  No hours imported yet — run the TrackingTime sync.
                </p>
              ) : (
                weeks.map((week) => {
                  const nonBillable =
                    Math.round((week.totalHours - week.billableHours) * 10) / 10;
                  const billablePercent =
                    week.totalHours === 0
                      ? null
                      : Math.round((week.billableHours / week.totalHours) * 100);
                  const readout =
                    billablePercent === null
                      ? `${formatWeekLabel(week.weekStart)}: no hours`
                      : `${formatWeekLabel(week.weekStart)}: ${billablePercent}% billable (${week.billableHours}h of ${week.totalHours}h)`;
                  return (
                    /*
                     * A focusable group, not a bare div. The readout used to be
                     * `hidden group-hover:block`, which put the only way to
                     * read a week's actual numbers behind a mouse — a keyboard
                     * or screen-reader user could see twelve bars and no
                     * values at all. `tabIndex` + `group-focus-visible` gives
                     * the same detail to Tab, and the `title` covers touch.
                     */
                    <div
                      key={week.weekStart}
                      tabIndex={0}
                      role="img"
                      aria-label={readout}
                      title={readout}
                      className="group relative flex h-full flex-1 cursor-default flex-col justify-end gap-0.5 rounded-[2px]"
                    >
                      <div className="pointer-events-none absolute -top-8 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface-2)] px-2 py-1 font-mono text-[10px] text-[var(--text-primary)] shadow-lg group-hover:block group-focus-visible:block">
                        {readout}
                      </div>
                      {/*
                        Only the TOP of each stack is rounded, via rounded-t on
                        the upper segment. Rounding both segments would put a
                        visible notch where they meet, which reads as a gap in
                        the data rather than as a stacked bar.
                      */}
                      <div
                        className="w-full rounded-t-[3px] bg-[var(--text-faint)] transition-all duration-150 group-hover:brightness-125 group-focus-visible:brightness-125"
                        style={{ height: `${(nonBillable / chartMax) * 100}%` }}
                      />
                      <div
                        className="w-full bg-[var(--accent)] transition-all duration-150 group-hover:brightness-110 group-focus-visible:brightness-110"
                        style={{ height: `${(week.billableHours / chartMax) * 100}%` }}
                      />
                    </div>
                  );
                })
              )}
            </div>

            <div className="flex justify-between border-t border-[var(--surface-accent-border)] pt-2 font-mono text-[10px] text-[var(--text-faint)]">
              {axisTicks.map((label, index) => (
                <span key={`${label}-${index}`}>{label}</span>
              ))}
            </div>
            </div>
          </Card>

          {/* Utilisation per person, from time.member_utilisation */}
          <Card className="flex flex-col lg:col-span-5">
            <CardHeader title="Utilisation by person" qualifier="TOP 6 BY HOURS" />

            <div className="flex flex-col gap-2.5 px-4 pb-4">
              {teams.length === 0 ? (
                <p className="font-mono text-[11px] text-[var(--text-faint)]">
                  No members with logged time.
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
              </p>
            </div>
          </Card>
        </div>

        {/* Project ledger — real projects, ranked by hours logged */}
        <Card className="overflow-hidden">
          <CardHeader
            title="Project ledger"
            qualifier={`TOP ${projects.length} BY HOURS · TRACKINGTIME`}
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
