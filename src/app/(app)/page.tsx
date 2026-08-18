import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
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
        category="HSE HUB / ANALYSE"
        title="Business overview"
        meta={`${counts.currentQuarter} · ${counts.activeMembers} PEOPLE · ${counts.activeProjects} ACTIVE PROJECTS · ${counts.customers} CUSTOMERS`}
        actions={
          <Link
            href="/time/dashboard"
            className="rounded-[var(--radius-sm)] bg-[var(--accent)] px-3 py-1.5 text-[11.5px] font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)]"
          >
            Full dashboard
          </Link>
        }
      />

      <div className="flex flex-col gap-4 p-4 sm:gap-5 sm:p-6">
        {/*
          Surfaced rather than hidden: most of the roster has a TrackingTime
          record but no Hub sign-in, so their hours are counted in every figure
          on this page while they cannot log in to see them. That is an
          operational gap the exec reading this page is the one who can close.
        */}
        {unlinkedPeople > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5">
            <span className="text-[12px] text-[var(--text-secondary)]">
              <span className="font-mono font-semibold text-[var(--warning)]">
                {unlinkedPeople}
              </span>{" "}
              of {counts.activeMembers} people have no Hub sign-in yet — their hours
              count here, but they cannot see them.
            </span>
            <Link
              href="/people"
              className="whitespace-nowrap text-[11.5px] font-medium text-[var(--accent)] hover:underline"
            >
              Review people →
            </Link>
          </div>
        )}

        {/* KPI strip — 2 cols mobile, 3 md, 5 lg */}
        <div className="grid grid-cols-2 border border-[var(--border)] bg-[var(--surface)] sm:grid-cols-3 lg:grid-cols-5">
          {metrics.map((metric, idx) => (
            <div
              key={metric.key}
              data-metric={metric.key}
              className={`flex flex-col gap-1.5 p-3 sm:p-3.5 ${
                idx < metrics.length - 1
                  ? "border-b border-[var(--border)] lg:border-b-0 lg:border-r"
                  : ""
              }`}
            >
              <span className="font-mono text-[9.5px] tracking-[0.1em] text-[var(--text-muted)] sm:text-[10px]">
                {metric.label}
              </span>
              <span
                className="font-mono text-[20px] font-semibold tracking-[-0.02em] sm:text-[24px]"
                style={{
                  color:
                    metric.value === null
                      ? "var(--text-faint)"
                      : metric.tone === "critical"
                        ? "var(--critical)"
                        : "var(--text-primary)",
                }}
              >
                {/* Never 0 in place of "unknown" — see overview-live.ts. */}
                {metric.value ?? "n/a"}
              </span>
              {metric.progressPercent !== null ? (
                <div className="mt-1 h-1 w-full bg-[var(--border)]">
                  <div
                    className="h-full"
                    style={{
                      width: `${Math.min(100, metric.progressPercent)}%`,
                      background: toneColour(metric.tone),
                    }}
                  />
                </div>
              ) : null}
              <span className="font-mono text-[10.5px] text-[var(--text-faint)]">
                {metric.subtext}
              </span>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          {/* Billable vs non-billable, per week, from time.org_week */}
          <div className="flex flex-col gap-3.5 border border-[var(--border)] bg-[var(--surface)] p-4 lg:col-span-7">
            <div className="flex flex-wrap items-baseline gap-2.5">
              <span className="text-[12.5px] font-semibold text-[var(--text-primary)]">
                Billable vs non-billable hours
              </span>
              <span className="font-mono text-[10.5px] text-[var(--text-muted)]">
                LAST {OVERVIEW_WEEKS} WEEKS · TRACKINGTIME
              </span>
              <div className="ml-auto flex items-center gap-3 font-mono text-[10.5px] text-[var(--text-secondary)]">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 bg-[var(--accent)]" />
                  BILLABLE
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 bg-[#8a9197]" />
                  NON-BILLABLE
                </span>
              </div>
            </div>

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
                  return (
                    <div
                      key={week.weekStart}
                      className="group relative flex h-full flex-1 flex-col justify-end gap-0.5"
                    >
                      <div className="pointer-events-none absolute -top-8 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded bg-[#1c2427] px-2 py-1 font-mono text-[10px] text-white shadow group-hover:block">
                        {formatWeekLabel(week.weekStart)}
                        {billablePercent === null
                          ? ": no hours"
                          : `: ${billablePercent}% (${week.billableHours}h / ${week.totalHours}h)`}
                      </div>
                      <div
                        className="w-full bg-[#8a9197] transition-all"
                        style={{ height: `${(nonBillable / chartMax) * 100}%` }}
                      />
                      <div
                        className="w-full bg-[var(--accent)] transition-all"
                        style={{ height: `${(week.billableHours / chartMax) * 100}%` }}
                      />
                    </div>
                  );
                })
              )}
            </div>

            <div className="flex justify-between border-t border-[var(--border)] pt-2 font-mono text-[10px] text-[var(--text-faint)]">
              {axisTicks.map((label, index) => (
                <span key={`${label}-${index}`}>{label}</span>
              ))}
            </div>
          </div>

          {/* Utilisation per person, from time.member_utilisation */}
          <div className="flex flex-col gap-3.5 border border-[var(--border)] bg-[var(--surface)] p-4 lg:col-span-5">
            <div className="flex flex-wrap items-baseline gap-2.5">
              <span className="text-[12.5px] font-semibold text-[var(--text-primary)]">
                Utilisation by person
              </span>
              <span className="font-mono text-[10.5px] text-[var(--text-muted)]">
                TOP 6 BY HOURS
              </span>
            </div>

            <div className="flex flex-col gap-2.5">
              {teams.length === 0 ? (
                <p className="font-mono text-[11px] text-[var(--text-faint)]">
                  No members with logged time.
                </p>
              ) : (
                teams.map((team) => (
                  <div key={team.name} className="flex flex-col gap-1">
                    <div className="flex justify-between text-[12px] text-[var(--text-secondary)]">
                      <span className="truncate pr-2">{team.name}</span>
                      <span className="shrink-0 font-mono font-medium text-[var(--text-primary)]">
                        {/*
                          "n/a" not "0%": no contracted hours means the ratio is
                          undefined, and 0% would read as somebody idle.
                        */}
                        {team.percent !== null ? `${team.percent}%` : "n/a"}
                      </span>
                    </div>
                    <div className="h-1.5 w-full bg-[var(--border)]">
                      {team.percent !== null ? (
                        <div
                          className="h-full"
                          style={{
                            width: `${Math.min(100, team.percent)}%`,
                            background: toneColour(team.tone),
                          }}
                        />
                      ) : (
                        <div
                          className="h-full w-full"
                          style={{
                            background:
                              "repeating-linear-gradient(45deg, #414954, #414954 4px, #333a44 4px, #333a44 8px)",
                          }}
                        />
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="mt-auto flex flex-col gap-1 border-t border-[var(--border)] pt-3">
              <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--text-faint)]">
                BASIS
              </span>
              {/*
                "Nominal 40-hour week", not "contracted". Every TrackingTime
                member reports exactly 40 h/week because that is the account
                default — describing it as contracted would present a default
                as a fact about someone's employment.
              */}
              <p className="text-[11.5px] leading-relaxed text-[var(--text-secondary)]">
                Tracked hours against a nominal 40-hour week, across the weeks
                each person was active. TrackingTime holds no contracted hours.
              </p>
            </div>
          </div>
        </div>

        {/* Project ledger — real projects, ranked by hours logged */}
        <div className="border border-[var(--border)] bg-[var(--surface)]">
          <div className="flex items-baseline justify-between border-b border-[var(--border)] px-4 py-3">
            <div className="flex items-baseline gap-2.5">
              <span className="text-[12.5px] font-semibold text-[var(--text-primary)]">
                Project ledger
              </span>
              <span className="hidden font-mono text-[10.5px] text-[var(--text-muted)] sm:inline">
                TOP {projects.length} BY HOURS · TRACKINGTIME
              </span>
            </div>
            <Link
              href="/projects"
              className="text-[11.5px] font-medium text-[var(--accent)] hover:underline"
            >
              All projects →
            </Link>
          </div>

          {projects.length === 0 ? (
            <p className="p-4 font-mono text-[11px] text-[var(--text-faint)]">
              No projects with logged time yet.
            </p>
          ) : (
            <>
              {/* Mobile cards */}
              <div className="flex flex-col divide-y divide-[var(--border)] sm:hidden">
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
                    <span className="font-mono text-[10.5px] text-[var(--text-muted)]">
                      {prj.customerName ?? "No customer"}
                    </span>
                    <div className="h-1.5 w-full bg-[var(--border)]">
                      {prj.burnPercent !== null ? (
                        <div
                          className="h-full"
                          style={{
                            width: `${Math.min(prj.burnPercent, 100)}%`,
                            background: toneColour(prj.tone),
                          }}
                        />
                      ) : null}
                    </div>
                    <div className="flex gap-4 font-mono text-[10.5px] text-[var(--text-secondary)]">
                      <span>{prj.loggedHours.toLocaleString("de-DE")} H LOGGED</span>
                      <span>{prj.billableHours.toLocaleString("de-DE")} H BILLABLE</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop table */}
              <div className="hidden overflow-x-auto sm:block">
                <div className="grid min-w-[700px] grid-cols-12 gap-3 border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-2 font-mono text-[10px] tracking-[0.1em] text-[var(--text-faint)]">
                  <span className="col-span-4">PROJECT</span>
                  <span className="col-span-3">CUSTOMER</span>
                  <span className="col-span-1 text-right">BUDGET H</span>
                  <span className="col-span-1 text-right">LOGGED H</span>
                  <span className="col-span-3">BURN</span>
                </div>

                {projects.map((prj) => (
                  <div
                    key={prj.id}
                    className="grid min-w-[700px] grid-cols-12 items-center gap-3 border-b border-[#3a414c] px-4 py-2.5 text-[12.5px] hover:bg-[var(--surface-hover)]"
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
                      <div className="h-1.5 flex-1 bg-[var(--border)]">
                        {prj.burnPercent !== null ? (
                          <div
                            className="h-full"
                            style={{
                              width: `${Math.min(prj.burnPercent, 100)}%`,
                              background: toneColour(prj.tone),
                            }}
                          />
                        ) : null}
                      </div>
                      <span
                        className="w-20 shrink-0 text-right font-mono text-[11px] font-medium"
                        style={{ color: toneColour(prj.tone) }}
                      >
                        {prj.burnPercent !== null ? `${prj.burnPercent}%` : "no budget"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
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
