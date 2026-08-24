"use client";

/**
 * Per-team analysis for the Team Lead view.
 *
 * WHO SEES WHAT. An EXEC sees every team, segregated: one analysis block per team with
 * its own utilisation, weekly area and workload donut, so teams are compared rather than
 * blended into one org-wide soup. A DEPT_HEAD sees exactly one block -- their own team's
 * -- because their decisions only reach their own people. The page decides which rows
 * each viewer gets; this component just renders per-team analysis for whatever it is
 * handed.
 *
 * WHERE A TEAM COMES FROM. time.member.team, recorded in the Hub's org chart (the
 * vendor holds no teams). Most of the roster has no team recorded yet, so unassigned
 * people are a NAMED group rather than silently dropped -- dropping them would make the
 * team totals disagree with the board grid below, which shows everyone.
 */

import { Card, CardHeader } from "@/components/ui/Card";
import { TrendFigure, Gauge, LegendDot } from "@/components/ui/Charts";
import { teamLabel } from "@/lib/teams";
import type { TeamLeadBoardData, BoardRow } from "@/lib/queries/team-lead-live";

const h = (n: number) => n.toLocaleString("en-GB", { maximumFractionDigits: 1 });

/** The rows of one team, plus everything the figures need. */
type TeamBlock = {
  key: string;
  label: string;
  rows: BoardRow[];
};

/** Group rows into teams, unassigned last as its own named group. */
function groupByTeam(rows: BoardRow[]): TeamBlock[] {
  const map = new Map<string, BoardRow[]>();
  for (const r of rows) {
    const k = r.team ?? "__none__";
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(r);
  }
  const blocks = [...map.entries()]
    .map(([key, list]) => ({
      key,
      label: key === "__none__" ? "No team recorded" : teamLabel(key),
      rows: list,
    }))
    // Biggest teams first; the unassigned group always last, whatever its size --
    // it is a data gap, not a team, and sorting it above real teams would present
    // the gap as the headline.
    .sort((a, b) => {
      if (a.key === "__none__") return 1;
      if (b.key === "__none__") return -1;
      return b.rows.length - a.rows.length;
    });
  return blocks;
}

/** One team's analysis: KPIs, weekly area, workload donut. */
function TeamAnalysis({ block, board }: { block: TeamBlock; board: TeamLeadBoardData }) {
  const { weeks } = board;
  const { rows } = block;

  const points = weeks.map((w, i) => {
    const total = rows.reduce((s, r) => s + (r.cells[i]?.hours ?? 0), 0);
    const people = rows.filter((r) => (r.cells[i]?.hours ?? 0) > 0).length;
    return {
      key: w.weekStart,
      label: w.label,
      value: Math.round(total * 10) / 10,
      readout: `${w.label}: ${h(total)}h across ${people} ${people === 1 ? "person" : "people"}${w.isCurrent ? " · in progress" : ""}`,
    };
  });

  const totalHours = rows.reduce((s, r) => s + r.totalHours, 0);

  // Utilisation over the window, same basis as the board's own KPI: tracked over
  // nominal, counting only the weeks each person actually logged.
  let tracked = 0;
  let contracted = 0;
  for (const r of rows) {
    tracked += r.totalHours;
    contracted += r.weeklyHours * r.cells.filter((c) => c.hours !== null).length;
  }
  const utilisation = contracted > 0 ? Math.round((tracked / contracted) * 100) : null;

  // Workload on the last completed week, mirroring TeamLeadCharts' reasoning: the
  // current week is partially filled by definition.
  const doneIndex = weeks.map((w) => w.isCurrent).lastIndexOf(false);
  const statuses = doneIndex >= 0
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

  const gaugeColor =
    utilisation === null
      ? "var(--text-muted)"
      : utilisation < 40
        ? "var(--warning)"
        : utilisation > 115
          ? "var(--critical)"
          : "var(--accent)";

  return (
    <Card className="flex flex-col">
      <CardHeader
        title={block.label}
        qualifier={`${rows.length} ${rows.length === 1 ? "PERSON" : "PEOPLE"} · ${h(totalHours)}H IN WINDOW`}
      />

      <div className="grid flex-1 grid-cols-1 gap-4 px-4 pb-4 sm:grid-cols-3">
        {/* Weekly area, the team's rhythm. */}
        <div className="flex min-h-[150px] flex-col sm:col-span-2">
          <TrendFigure
            id={`team-analysis-${block.key}`}
            points={points}
            label={`${block.label}: hours per week from ${weeks[0].label} to ${weeks[weeks.length - 1].label}`}
          />
          <div className="flex justify-between pt-1 font-mono text-[9.5px] text-[var(--text-faint)]">
            <span>{weeks[0].label}</span>
            <span>{weeks[weeks.length - 1].label}</span>
          </div>
        </div>

        {/* Utilisation gauge and the last completed week's workload. */}
        <div className="flex flex-col items-center justify-center gap-3">
          {utilisation !== null ? (
            <Gauge
              value={utilisation}
              max={Math.max(100, utilisation)}
              color={gaugeColor}
              centre={`${utilisation}%`}
              centreLabel="of nominal"
              width={132}
              label={`${block.label} utilisation: ${utilisation} percent of nominal hours across the window`}
            />
          ) : (
            <p className="font-mono text-[10.5px] text-[var(--text-faint)]">no basis for utilisation</p>
          )}

          {statuses && (
            <div className="flex flex-wrap justify-center gap-x-3 gap-y-1">
              {statuses.over > 0 && <LegendDot color="var(--critical)">{statuses.over} OVER</LegendDot>}
              <LegendDot color="var(--accent)">{statuses.normal} ON TRACK</LegendDot>
              {statuses.under > 0 && <LegendDot color="var(--warning)">{statuses.under} UNDER</LegendDot>}
              {statuses.none > 0 && <LegendDot color="var(--text-faint)">{statuses.none} NO HOURS</LegendDot>}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

export function TeamAnalysisSection({
  board,
  viewerRole,
  viewerTeam,
}: {
  board: TeamLeadBoardData;
  /** The viewer's role key: analysis is segregated for exec, scoped for dept_head. */
  viewerRole: string;
  /** The viewer's own team key (already normalised), for the dept_head scope. */
  viewerTeam: string | null;
}) {
  if (board.rows.length === 0) return null;

  const blocks = groupByTeam(board.rows);
  const isExec = viewerRole === "exec";

  /*
   * The dept_head scope. Their block is their own team; if their team is not recorded
   * anywhere on the roster, say so rather than showing everything -- defaulting open on
   * a missing configuration would widen access by accident, which is the wrong failure
   * direction for a scoping feature.
   */
  const visible = isExec ? blocks : blocks.filter((b) => b.key === viewerTeam);

  if (!isExec && visible.length === 0) {
    return (
      <div className="px-4 pb-4 sm:px-6">
        <Card className="px-4 py-3">
          <p className="text-[12.5px] text-[var(--text-secondary)]">
            Your team{viewerTeam ? ` (${teamLabel(viewerTeam)})` : ""} has no members with logged
            hours in this window, or no roster members carry that team yet. Teams are recorded on
            the org chart under People.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[var(--card-gap)] px-4 pb-4 sm:px-6">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[13px] font-semibold text-[var(--text-primary)]">
          {isExec ? "Analysis by team" : `Your team${viewerTeam ? ` · ${teamLabel(viewerTeam)}` : ""}`}
        </h2>
        <span className="font-mono text-[10px] tracking-[0.08em] text-[var(--text-faint)]">
          {isExec
            ? `${blocks.filter((b) => b.key !== "__none__").length} TEAMS · TEAMS ARE RECORDED ON THE ORG CHART`
            : "SCOPED TO YOUR TEAM"}
        </span>
      </div>

      {/* Two abreast from lg up. Stacked, three teams cost 1,011px of the
          page's 3-screen budget for three cards that are read by comparison
          anyway, and side by side is both shorter AND the arrangement the
          comparison wants. Below lg they stack: a 132px gauge beside a trend
          line does not survive a narrow column. */}
      <div className="grid grid-cols-1 gap-[var(--card-gap)] lg:grid-cols-2">
        {visible.map((block) => (
          <TeamAnalysis key={block.key} block={block} board={board} />
        ))}
      </div>
    </div>
  );
}
