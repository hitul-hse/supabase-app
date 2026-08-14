import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { SyncBar } from "@/components/SyncBar";
import { createClient } from "@/utils/supabase/server";
import { getExecutiveOverview, getOverviewCounts } from "@/lib/queries/hse";
import { requireUser } from "@/utils/supabase/require-user";

export default async function OverviewPage() {
  await requireUser("/");
  const supabase = await createClient();
  const [{ metrics, billableTrend, teamUtilisations, projects }, { activePeople, activeProjects, currentQuarter }] =
    await Promise.all([getExecutiveOverview(supabase), getOverviewCounts(supabase)]);

  const chartMax = Math.max(
    0,
    ...billableTrend.points.map((p) => p.billableHours + p.nonBillableHours),
  );

  // First, last, and two evenly spaced weeks between them — deduplicated,
  // since with only a couple of synced weeks those four positions collapse
  // onto the same bars and would print the same label repeatedly.
  const tickIndexes = Array.from(
    new Set(
      [0, 0.33, 0.66, 1].map((fraction) =>
        Math.round(fraction * Math.max(0, billableTrend.points.length - 1)),
      ),
    ),
  );
  const axisTicks = tickIndexes
    .map((index) => billableTrend.points[index])
    .filter((point): point is NonNullable<typeof point> => point !== undefined)
    .map((point) => ({ label: point.label, isOpen: point.isOpen }));

  return (
    <div className="flex flex-col">
      <SyncBar />

      <PageHeader
        category="HSE HUB / ANALYSE"
        title="Business overview"
        meta={`${currentQuarter} · ${activePeople} PEOPLE · ${activeProjects} ACTIVE PROJECTS`}
        actions={
          <>
            <button className="rounded-[var(--radius-sm)] border border-[var(--border-strong)] px-3 py-1.5 text-[11.5px] font-medium text-[var(--text-primary)] hover:bg-[var(--surface-hover)]">
              Quarter to date
            </button>
            <button className="rounded-[var(--radius-sm)] border border-[var(--border-strong)] px-3 py-1.5 text-[11.5px] font-medium text-[var(--text-primary)] hover:bg-[var(--surface-hover)]">
              All teams
            </button>
            <button className="rounded-[var(--radius-sm)] bg-[var(--accent)] px-3 py-1.5 text-[11.5px] font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)]">
              Export
            </button>
          </>
        }
      />

      <div className="flex flex-col gap-5 p-6">
        {/* 5-Column Metric Strip */}
        <div className="grid grid-cols-1 border border-[var(--border)] bg-[var(--surface)] sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
          {metrics.map((metric, idx) => (
            <div
              key={metric.label}
              className={`flex flex-col gap-1.5 p-3.5 ${
                idx < metrics.length - 1
                  ? "border-b border-[var(--border)] lg:border-b-0 lg:border-r"
                  : ""
              }`}
            >
              <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--text-muted)]">
                {metric.label}
              </span>
              <span className="font-mono text-[24px] font-semibold tracking-[-0.02em] text-[var(--text-primary)]">
                {metric.value}
              </span>
              {metric.progress_percent !== null ? (
                <div className="mt-1 h-1 w-full bg-[var(--border)]">
                  <div
                    className="h-full"
                    style={{
                      width: `${metric.progress_percent}%`,
                      background: metric.progress_color || "var(--accent)",
                    }}
                  />
                </div>
              ) : (
                <span
                  className="font-mono text-[11px]"
                  style={{ color: metric.subtext_color || "var(--text-faint)" }}
                >
                  {metric.subtext}
                </span>
              )}
            </div>
          ))}
        </div>

        {/* Charts Grid: Weekly Billable vs Non-Billable & Team Utilisation */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          {/* Left: Weekly Stacked Bars (7 cols) */}
          <div className="flex flex-col gap-3.5 border border-[var(--border)] bg-[var(--surface)] p-4 lg:col-span-7">
            <div className="flex flex-wrap items-baseline gap-2.5">
              <span className="text-[12.5px] font-semibold text-[var(--text-primary)]">
                Billable vs non-billable hours
              </span>
              <span className="font-mono text-[10.5px] text-[var(--text-muted)]">
                {billableTrend.source === "synced"
                  ? "PER WEEK · TRACKINGTIME"
                  : "PER WEEK · SAMPLE DATA"}
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

            {/* Bars container. Scaled to the tallest week actually present:
                a fixed ceiling suits the ~2000h sample weeks but would flatten
                a real Operations roster's few hundred hours into slivers. */}
            <div className="flex h-[160px] items-end gap-2 pt-4">
              {chartMax === 0 ? (
                <p className="self-center font-mono text-[11px] text-[var(--text-faint)]">
                  No hours recorded for these weeks yet.
                </p>
              ) : (
                billableTrend.points.map((point) => {
                  const total = point.billableHours + point.nonBillableHours;
                  const billablePercent =
                    total === 0 ? null : Math.round((point.billableHours / total) * 100);
                  return (
                    <div
                      key={point.label}
                      className="group relative flex h-full flex-1 flex-col justify-end gap-0.5"
                    >
                      {/* Tooltip on hover */}
                      <div className="pointer-events-none absolute -top-8 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded bg-[#1c2427] px-2 py-1 font-mono text-[10px] text-white shadow group-hover:block">
                        {point.label}
                        {billablePercent === null
                          ? ": no hours"
                          : `: ${billablePercent}% (${point.billableHours}h / ${total}h)`}
                      </div>

                      {/* Non-billable segment */}
                      <div
                        className="w-full bg-[#8a9197] transition-all"
                        style={{ height: `${(point.nonBillableHours / chartMax) * 100}%` }}
                      />
                      {/* Billable segment */}
                      <div
                        className="w-full transition-all"
                        style={{
                          height: `${(point.billableHours / chartMax) * 100}%`,
                          background: point.isOpen
                            ? "repeating-linear-gradient(135deg, #91c2b7, #91c2b7 4px, #6ba79b 4px, #6ba79b 8px)"
                            : "var(--accent)",
                        }}
                      />
                    </div>
                  );
                })
              )}
            </div>

            {/* Axis ticks come from the data rather than being written in, so
                they cannot drift out of step with the bars above them. */}
            <div className="flex justify-between border-t border-[var(--border)] pt-2 font-mono text-[10px] text-[var(--text-faint)]">
              {axisTicks.map((tick, index) => (
                <span
                  key={`${tick.label}-${index}`}
                  className={tick.isOpen ? "font-medium text-[var(--accent)]" : undefined}
                >
                  {tick.label}
                  {tick.isOpen ? " OPEN" : ""}
                </span>
              ))}
            </div>
          </div>

          {/* Right: Utilisation by Team (5 cols) */}
          <div className="flex flex-col gap-3.5 border border-[var(--border)] bg-[var(--surface)] p-4 lg:col-span-5">
            <span className="text-[12.5px] font-semibold text-[var(--text-primary)]">
              Utilisation by team
            </span>

            <div className="flex flex-col gap-2.5">
              {teamUtilisations.map((team) => (
                <div key={team.team} className="flex flex-col gap-1">
                  <div className="flex justify-between text-[12px] text-[var(--text-secondary)]">
                    <span>{team.team}</span>
                    <span className="font-mono font-medium text-[var(--text-primary)]">
                      {team.percent !== null ? `${team.percent}%` : "n/a"}
                    </span>
                  </div>
                  <div className="h-1.5 w-full bg-[var(--border)]">
                    {team.percent !== null ? (
                      <div
                        className="h-full"
                        style={{
                          width: `${team.percent}%`,
                          background: team.status_color || "var(--accent)",
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
              ))}
            </div>

            <div className="mt-auto flex flex-col gap-1 border-t border-[var(--border)] pt-3">
              <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--text-faint)]">
                WORKLOAD FLAGS
              </span>
              <p className="text-[11.5px] leading-relaxed text-[var(--text-secondary)]">
                6 people over 105% planned capacity in W32 · 3 under 60%
              </p>
            </div>
          </div>
        </div>

        {/* Project Ledger Table */}
        <div className="border border-[var(--border)] bg-[var(--surface)]">
          <div className="flex items-baseline justify-between border-b border-[var(--border)] px-4 py-3">
            <div className="flex items-baseline gap-2.5">
              <span className="text-[12.5px] font-semibold text-[var(--text-primary)]">
                Project ledger
              </span>
              <span className="font-mono text-[10.5px] text-[var(--text-muted)]">
                CONTRACT · ASANA · TRACKINGTIME
              </span>
            </div>
            <Link
              href="/projects"
              className="text-[11.5px] font-medium text-[var(--accent)] hover:underline"
            >
              All 27 projects →
            </Link>
          </div>

          <div className="overflow-x-auto">
            {/* Table Header */}
            <div className="grid min-w-[700px] grid-cols-12 gap-3 border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-2 font-mono text-[10px] tracking-[0.1em] text-[var(--text-faint)]">
              <span className="col-span-4">PROJECT</span>
              <span className="col-span-2">CUSTOMER</span>
              <span className="col-span-1 text-right">CONTRACT H</span>
              <span className="col-span-1 text-right">BILLABLE H</span>
              <span className="col-span-2">CONSUMED</span>
              <span className="col-span-1 text-right">DUE</span>
              <span className="col-span-1 text-right">LEAD</span>
            </div>

            {/* Table Rows */}
            {projects.map((prj) => {
              const barColor =
                prj.status === "CRITICAL"
                  ? "var(--critical)"
                  : prj.status === "WARNING"
                  ? "var(--warning)"
                  : "var(--accent)";

              return (
                <div
                  key={prj.id}
                  className="grid min-w-[700px] grid-cols-12 items-center gap-3 border-b border-[#3a414c] px-4 py-2.5 text-[12.5px] hover:bg-[var(--surface-hover)]"
                >
                  <Link
                    href={`/projects`}
                    className="col-span-4 font-medium text-[var(--text-primary)] hover:text-[var(--accent)]"
                  >
                    {prj.name}
                  </Link>
                  <span className="col-span-2 text-[var(--text-secondary)]">{prj.customer}</span>
                  <span className="col-span-1 text-right font-mono text-[var(--text-primary)]">
                    {prj.contract_hours.toLocaleString("de-DE")}
                  </span>
                  <span className="col-span-1 text-right font-mono text-[var(--text-primary)]">
                    {prj.billable_hours.toLocaleString("de-DE")}
                  </span>
                  <div className="col-span-2 flex items-center gap-2">
                    <div className="h-1.5 flex-1 bg-[var(--border)]">
                      <div
                        className="h-full"
                        style={{ width: `${Math.min(prj.consumed_percent, 100)}%`, background: barColor }}
                      />
                    </div>
                    <span
                      className="w-8 font-mono text-[11px] font-medium"
                      style={{ color: barColor }}
                    >
                      {prj.consumed_percent}%
                    </span>
                  </div>
                  <span className="col-span-1 text-right font-mono text-[11.5px] text-[var(--text-secondary)]">
                    {prj.due}
                  </span>
                  <span className="col-span-1 text-right text-[var(--text-secondary)]">
                    {prj.lead}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
