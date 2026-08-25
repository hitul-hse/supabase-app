"use client";

/**
 * The Team Lead figures: team hours per week as an area, and this week's workload
 * as a donut.
 *
 * Derived entirely from the board data the page already fetches -- same weeks, same
 * cells -- so the figures and the grid below them cannot disagree. That matters here
 * more than anywhere: this is an approval surface, and a chart contradicting the grid
 * it summarises would be read as one of them lying.
 */

import { Card, CardHeader, ChartNote } from "@/components/ui/Card";
import { TrendFigure, Donut, LegendDot } from "@/components/ui/Charts";
import type { TeamLeadBoardData } from "@/lib/queries/team-lead-live";

const h = (n: number) => n.toLocaleString("en-GB", { maximumFractionDigits: 1 });

export function TeamLeadCharts({ board }: { board: TeamLeadBoardData }) {
  const { weeks, rows } = board;
  if (weeks.length === 0 || rows.length === 0) return null;

  /*
   * Team total per week: the sum of every member's cell. Null cells contribute
   * nothing rather than zero -- the distinction the whole board is built on --
   * but the SUM is still a real number for the week, because "the team logged
   * 312h" is true regardless of who logged nothing.
   */
  const points = weeks.map((w, i) => {
    const total = rows.reduce((s, r) => s + (r.cells[i]?.hours ?? 0), 0);
    const people = rows.filter((r) => r.cells[i]?.hours !== null && (r.cells[i]?.hours ?? 0) > 0).length;
    return {
      key: w.weekStart,
      label: w.label,
      value: Math.round(total * 10) / 10,
      readout: `${w.label}: ${h(total)}h across ${people} ${people === 1 ? "person" : "people"}${w.isCurrent ? " · week in progress" : ""}`,
    };
  });

  /*
   * The workload donut reads the LAST COMPLETED week, not the current one: the
   * current week is partially filled by definition, and classifying somebody as
   * "under" on a Tuesday would be a false alarm three days early.
   */
  const doneIndex = weeks.map((w) => w.isCurrent).lastIndexOf(false);
  const donutWeek = doneIndex >= 0 ? weeks[doneIndex] : null;
  const statuses = donutWeek
    ? rows.reduce(
        (acc, r) => {
          const cell = r.cells[doneIndex];
          if (!cell || cell.hours === null) acc.none += 1;
          else if (cell.status === "over") acc.over += 1;
          else if (cell.status === "under") acc.under += 1;
          else acc.normal += 1;
          return acc;
        },
        { over: 0, under: 0, normal: 0, none: 0 },
      )
    : null;

  return (
    <div className="grid grid-cols-1 gap-[var(--card-gap)] px-4 pb-4 sm:px-6 lg:grid-cols-12">
      <Card tone="hero" className="flex min-h-[220px] flex-col lg:col-span-8">
        <CardHeader
          title="Team hours per week"
          qualifier={`${weeks[0].label}–${weeks[weeks.length - 1].label} · ${rows.length} PEOPLE`}
          actions={<LegendDot color="var(--accent)">TEAM TOTAL H</LegendDot>}
        />
        <div className="flex min-h-0 flex-1 flex-col gap-2 px-4 pb-4">
          <div className="min-h-[140px] flex-1">
            <TrendFigure
              id="team-lead-hours"
              points={points}
              label={`Team hours per week from ${weeks[0].label} to ${weeks[weeks.length - 1].label}`}
            />
          </div>
          <div className="flex justify-between border-t border-[var(--surface-accent-border)] pt-2 font-mono text-[10px] text-[var(--text-faint)]">
            <span>{weeks[0].label}</span>
            {weeks.length > 2 && <span>{weeks[Math.floor(weeks.length / 2)].label}</span>}
            <span>{weeks[weeks.length - 1].label}</span>
          </div>
        </div>
        {/*
          Total hours, not billable ones. A team can look busy here while the
          billable share falls, which is exactly the divergence a lead needs to
          see rather than have averaged away.
        */}
        <ChartNote>
          Hours logged by the whole team each week, billable and non-billable
          together. A week still in progress is marked as such in its readout,
          so a low final point is usually incompleteness rather than a drop.
        </ChartNote>
      </Card>

      <Card className="flex flex-col lg:col-span-4">
        <CardHeader
          title="Workload"
          qualifier={donutWeek ? `${donutWeek.label} · LAST COMPLETED WEEK` : "NO COMPLETED WEEK"}
        />
        <div className="flex flex-1 flex-wrap items-center justify-center gap-x-7 gap-y-3 px-4 pb-5">
          {statuses === null ? (
            <p className="font-mono text-[11px] text-[var(--text-faint)]">
              No completed week in this window yet.
            </p>
          ) : (
            <>
              <Donut
                slices={[
                  { label: "Over", value: statuses.over, color: "var(--critical)" },
                  { label: "On track", value: statuses.normal, color: "var(--accent)" },
                  { label: "Under", value: statuses.under, color: "var(--warning)" },
                  { label: "No hours", value: statuses.none, color: "var(--text-faint)" },
                ]}
                centre={String(statuses.over + statuses.normal + statuses.under)}
                centreLabel="logged"
                label={`Workload in ${donutWeek?.label}: ${statuses.over} over their nominal hours, ${statuses.normal} on track, ${statuses.under} under, ${statuses.none} with nothing logged`}
              />
              <div className="flex flex-col gap-1.5">
                <LegendDot color="var(--critical)">{statuses.over} OVER</LegendDot>
                <LegendDot color="var(--accent)">{statuses.normal} ON TRACK</LegendDot>
                <LegendDot color="var(--warning)">{statuses.under} UNDER</LegendDot>
                <LegendDot color="var(--text-faint)">{statuses.none} NO HOURS</LegendDot>
              </div>
            </>
          )}
        </div>
        {/*
          Three bands, and none of them is obvious from a colour. The widths are
          deliberately generous (see classify() in team-lead-live.ts): the donut
          exists to spot somebody drowning or idle, not to police a timesheet to
          the hour, so a narrow band would paint most weeks amber for ordinary
          variation.
        */}
        <ChartNote>
          People by hours logged in the last completed week, against their own
          nominal week. Over is more than 115%, under is below 50%, and the
          current week is deliberately excluded — it is part-filled by
          definition, so classifying anyone on a Tuesday would be a false alarm.
        </ChartNote>
      </Card>
    </div>
  );
}
