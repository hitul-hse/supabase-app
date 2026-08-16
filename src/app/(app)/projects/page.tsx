import { PageHeader } from "@/components/PageHeader";
import { SyncBar } from "@/components/SyncBar";
import { createClient } from "@/utils/supabase/server";
import { getProjectDetail, getTaskComments, getProjectBudgetStatus } from "@/lib/queries/hse";
import { requireUser } from "@/utils/supabase/require-user";
import { TasksSection } from "./TasksSection";
import { BudgetPanel } from "./BudgetPanel";

export default async function ProjectsPage() {
  await requireUser("/projects");
  const supabase = await createClient();
  const prj = await getProjectDetail(supabase, "prj-1");
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!prj) {
    return (
      <div>
        <PageHeader category="HSE HUB / RECORDS" title="Project Record" />
        <div className="p-6 text-[var(--text-secondary)]">Project not found.</div>
      </div>
    );
  }

  const budgetStatus = await getProjectBudgetStatus(supabase, prj.id);

  const commentsByTask = Object.fromEntries(
    await getTaskComments(
      supabase,
      prj.project_tasks.map((t) => t.id),
    ),
  );

  return (
    <div className="flex flex-col">
      <SyncBar />

      <PageHeader
        category="HSE HUB / RECORDS"
        title="Project Record"
        meta="PROJECTS · CONTRACTS · ASANA TASKS"
      />

      <div className="flex flex-col gap-5 p-6">
        {/* Project Header Banner */}
        <div className="flex flex-wrap items-start justify-between gap-4 border border-[var(--border)] bg-[var(--surface)] p-5">
          <div className="flex flex-col gap-1.5">
            <span className="font-mono text-[10.5px] tracking-[0.1em] text-[var(--text-muted)]">
              {prj.customer.toUpperCase()} · {prj.code} · {prj.contract_type}
            </span>
            <h2 className="text-[20px] font-semibold text-[var(--text-primary)]">{prj.name}</h2>
            <div className="flex flex-wrap gap-2 pt-1 font-mono text-[10.5px]">
              <span className="bg-[#4a251d] px-2 py-0.5 font-medium text-[#f0a08c]">
                {prj.status}
              </span>
              <span className="bg-[var(--surface-2)] px-2 py-0.5 text-[var(--text-secondary)]">
                LEAD {prj.lead}
              </span>
              <span className="bg-[var(--surface-2)] px-2 py-0.5 text-[var(--text-secondary)]">
                {prj.team_size} PEOPLE ASSIGNED
              </span>
            </div>
          </div>

          {/* Quick Metrics */}
          <div className="flex flex-wrap items-center gap-6 pt-1 font-mono">
            <div className="flex flex-col">
              <span className="text-[10px] tracking-[0.1em] text-[var(--text-muted)]">
                CONTRACTED
              </span>
              <span className="text-[18px] font-semibold text-[var(--text-primary)]">
                {prj.contract_hours} h
              </span>
            </div>

            <div className="flex flex-col">
              <span className="text-[10px] tracking-[0.1em] text-[var(--text-muted)]">LOGGED</span>
              <span className="text-[18px] font-semibold text-[var(--text-primary)]">
                {prj.logged_hours} h
              </span>
            </div>

            <div className="flex flex-col">
              <span className="text-[10px] tracking-[0.1em] text-[var(--text-muted)]">
                REMAINING
              </span>
              <span className="text-[18px] font-semibold text-[var(--critical)]">
                {prj.remaining_hours} h
              </span>
            </div>

            <div className="flex flex-col">
              <span className="text-[10px] tracking-[0.1em] text-[var(--text-muted)]">FORECAST</span>
              <span className="text-[18px] font-semibold text-[var(--critical)]">
                +{prj.forecast_overrun} h
              </span>
            </div>
          </div>
        </div>

        <BudgetPanel status={budgetStatus} />

        {/* Hours Burndown Chart */}
        <div className="flex flex-col gap-3 border border-[var(--border)] bg-[var(--surface)] p-5">
          <div className="flex flex-wrap items-baseline gap-3">
            <span className="text-[13px] font-semibold text-[var(--text-primary)]">
              Hours burn-down
            </span>
            <span className="font-mono text-[10.5px] text-[var(--text-muted)]">
              SIGNED 12 JAN · PLANNED END 30 SEP
            </span>
            <div className="ml-auto flex items-center gap-4 font-mono text-[10.5px] text-[var(--text-secondary)]">
              <span className="flex items-center gap-1.5">
                <span className="h-0.5 w-3 bg-[#8f979d]" /> PLANNED
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-0.5 w-3 bg-[var(--accent)]" /> ACTUAL
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-0.5 w-3 bg-[var(--critical)]" /> FORECAST
              </span>
            </div>
          </div>

          {/* SVG Burn-down chart */}
          <div className="relative h-[180px] w-full border-b border-l border-[#4d5661] pt-2">
            {/* Gridlines */}
            <div className="absolute inset-0 flex flex-col justify-between opacity-20">
              <div className="border-b border-[#4d5661]" />
              <div className="border-b border-[#4d5661]" />
              <div className="border-b border-[#4d5661]" />
              <div className="border-b border-[#4d5661]" />
            </div>

            <svg
              viewBox="0 0 900 170"
              preserveAspectRatio="none"
              className="absolute inset-0 h-full w-full"
            >
              {/* Planned trajectory line (dashed gray) */}
              <polyline
                points="0,10 100,28 200,45 300,64 400,82 500,101 600,120 700,138 800,157 900,165"
                fill="none"
                stroke="#8f979d"
                strokeWidth="2"
                strokeDasharray="6 5"
              />
              {/* Actual consumed hours line (solid mint) */}
              <polyline
                points="0,10 90,22 180,38 270,47 360,69 450,78 540,98 630,110 700,134 760,161"
                fill="none"
                stroke="#91c2b7"
                strokeWidth="2.5"
              />
              {/* Forecast overrun line (dashed red) */}
              <polyline
                points="760,161 830,185 900,205"
                fill="none"
                stroke="#e0603f"
                strokeWidth="2.5"
                strokeDasharray="5 4"
              />
              <circle cx="760" cy="161" r="4.5" fill="#91c2b7" />
            </svg>

            {/* Today vertical line */}
            <div className="absolute bottom-0 top-0 left-[78%] w-px bg-[#616a75]" />
            <div className="absolute top-1.5 left-[calc(78%+8px)] font-mono text-[10.5px] font-medium text-[var(--text-primary)]">
              TODAY · 36 H LEFT
            </div>
          </div>

          <div className="flex justify-between font-mono text-[10.5px] text-[var(--text-faint)]">
            <span>JAN</span>
            <span>MAR</span>
            <span>MAY</span>
            <span>JUL</span>
            <span>SEP</span>
            <span className="text-[var(--critical)]">OVERRUN NOV</span>
          </div>
        </div>

        {/* Lower Grid: Tasks Breakdown & Milestone Timeline */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
          {/* Asana Tasks & Hours (7 cols) */}
          <TasksSection
            projectId={prj.id}
            tasks={prj.project_tasks}
            commentsByTask={commentsByTask}
            currentUserId={user?.id ?? null}
          />

          {/* Timeline & Invoicing (5 cols) */}
          <div className="flex flex-col gap-4 lg:col-span-5">
            {/* Timeline */}
            <div className="flex flex-col gap-3 border border-[var(--border)] bg-[var(--surface)] p-4">
              <span className="text-[12.5px] font-semibold text-[var(--text-primary)]">
                Milestone Timeline
              </span>
              <div className="flex flex-col gap-2.5">
                {prj.project_timeline.map((t) => (
                  <div key={t.period} className="flex items-center gap-3 text-[11.5px]">
                    <span className="w-16 font-mono text-[10.5px] text-[var(--text-muted)]">
                      {t.period}
                    </span>
                    <div className="h-2.5 flex-1 bg-[var(--border)]">
                      <div
                        className="h-full"
                        style={{
                          width: `${t.progress_percent}%`,
                          background:
                            t.status === "forecast"
                              ? "repeating-linear-gradient(45deg, #4a251d, #4a251d 4px, #2a1613 4px, #2a1613 8px)"
                              : t.status === "in_progress"
                              ? "var(--warning)"
                              : t.status === "done"
                              ? "var(--accent)"
                              : "var(--border)",
                        }}
                      />
                    </div>
                    <span className="w-16 text-right text-[var(--text-secondary)]">{t.title}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Contract & Documents */}
            <div className="flex flex-col gap-3 border border-[var(--border)] bg-[var(--surface)] p-4">
              <span className="text-[12.5px] font-semibold text-[var(--text-primary)]">
                Contract &amp; Invoicing
              </span>
              <div className="flex flex-col gap-1.5 text-[12px]">
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Contract value:</span>
                  <span className="font-mono text-[var(--text-primary)]">
                    €{(prj.contract_value_eur ?? 0).toLocaleString("de-DE")}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Invoiced to date:</span>
                  <span className="font-mono text-[var(--text-primary)]">
                    €{(prj.invoiced_eur ?? 0).toLocaleString("de-DE")}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Change requests:</span>
                  <span className="font-mono text-[var(--warning)]">{prj.change_requests}</span>
                </div>
              </div>

              <div className="mt-1 flex gap-2">
                {["CONTRACT", "CR-01", "REPORT"].map((slot) => (
                  <div
                    key={slot}
                    className="flex h-11 flex-1 items-end p-1.5"
                    style={{
                      background:
                        "repeating-linear-gradient(45deg, #3a414c, #3a414c 4px, #15191c 4px, #15191c 8px)",
                    }}
                  >
                    <span className="font-mono text-[9px] text-[var(--text-faint)]">{slot}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
