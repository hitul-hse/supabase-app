"use client";

/**
 * The Team Lead workload grid: one row per person, one column per week.
 *
 * WHY IT MOVED TO THE SHARED PRIMITIVE. The hand-rolled version rendered every
 * board row unpaged. That is eight rows on this data and 49 in production, with
 * nothing in getLiveTeamLeadBoard capping it — DESIGN.md rule 1 exactly. It also
 * pinned its name column with `sticky left-0` on a cell whose only sticky
 * ancestor was the horizontal scroller, so the HEADER row scrolled away
 * vertically while the names stayed put horizontally.
 *
 * WHAT IS PRESERVED. Every cell renders the same status wash and the same
 * em-dash-for-nothing text (`cellText`), the TOTAL column is unchanged, the
 * ARCHIVED marker stays on the name, and both footnotes — the over/under basis
 * and the week-in-progress note — are carried verbatim into the table's
 * footnote. The counts are stated over ALL rows, so a paged grid still says how
 * many people it is bounding.
 *
 * The week columns are numbers, so they sort with cmpNum and nulls sink in both
 * directions: sorting "who logged least in W34" must not float the people with
 * no data at all to the top.
 */

import { DataTable, cmpNum, cmpText, type Column } from "@/components/data-table/DataTable";
import type { TeamLeadBoardData, BoardCell, BoardRow } from "@/lib/queries/team-lead-live";

/** Hours to one decimal, or an em dash when the person logged nothing. */
function cellText(cell: BoardCell | undefined): string {
  if (!cell || cell.hours === null) return "–";
  return cell.hours % 1 === 0 ? String(cell.hours) : cell.hours.toFixed(1);
}

/** The status wash, unchanged from the hand-rolled grid. */
function cellClass(cell: BoardCell | undefined): string {
  switch (cell?.status) {
    case "over":
      return "bg-[var(--critical)] text-black";
    case "none":
      return "bg-transparent text-[var(--text-faint)]";
    case "under":
      return "bg-[#3a2f11] text-[#e5be6a]";
    default:
      return "bg-[#2a474b] text-[#b4d6ce]";
  }
}

export function TeamWorkloadGrid({ board }: { board: TeamLeadBoardData }) {
  const { weeks, rows } = board;

  const columns: Column<BoardRow>[] = [
    {
      key: "person",
      header: "PERSON",
      className: "min-w-[12rem]",
      compare: (a, b) => cmpText(a.name, b.name),
      descFirst: false,
      cell: (member) => (
        <span className="flex items-center gap-2">
          <span
            aria-hidden
            className="h-5 w-5 flex-none rounded-full"
            style={{
              background:
                "repeating-linear-gradient(45deg, #4a525d, #4a525d 3px, #3c434e 3px, #3c434e 6px)",
            }}
          />
          <span className="whitespace-nowrap font-medium text-[var(--text-primary)]">
            {member.name}
          </span>
          {member.isArchived && (
            <span className="font-mono text-[9px] tracking-[0.08em] text-[var(--text-faint)]">
              ARCHIVED
            </span>
          )}
        </span>
      ),
      csv: (member) => member.name,
      search: (member) => member.name,
    },
    ...weeks.map<Column<BoardRow>>((week, idx) => ({
      key: week.weekStart,
      // The current week is only partly elapsed, so a low number there is not
      // the same signal as a low number in a finished week.
      header: week.isCurrent ? `${week.label} ·` : week.label,
      align: "right",
      compare: (a, b) => cmpNum(a.cells[idx]?.hours ?? null, b.cells[idx]?.hours ?? null),
      cell: (member) => (
        <span
          className={`inline-block min-w-[3rem] px-1 py-0.5 text-center font-mono text-[11px] font-medium ${cellClass(
            member.cells[idx],
          )}`}
        >
          {cellText(member.cells[idx])}
        </span>
      ),
      csv: (member) => (member.cells[idx]?.hours === null ? "n/a" : (member.cells[idx]?.hours ?? "n/a")),
      title: week.isCurrent
        ? `${week.label} — the week in progress, so far`
        : `Hours logged in ${week.label}`,
    })),
    {
      key: "total",
      header: "TOTAL",
      align: "right",
      compare: (a, b) => a.totalHours - b.totalHours,
      cell: (member) => (
        <span className="font-mono text-[11px] tabular-nums text-[var(--text-secondary)]">
          {member.totalHours} h
        </span>
      ),
      csv: (member) => member.totalHours,
    },
  ];

  // Totals over EVERY row, never over the page on screen.
  const totalHours = rows.reduce((sum, member) => sum + member.totalHours, 0);
  const logged = rows.filter((member) => member.totalHours > 0).length;

  return (
    <DataTable
      rows={rows}
      columns={columns}
      rowKey={(member) => member.memberId}
      title="Hours logged per week"
      hint="FROM TRACKINGTIME ENTRIES · BOUNDED AT TODAY"
      initialSort="total"
      exportName="workload-per-week"
      searchPlaceholder="Search people…"
      defaultPageSize={25}
      // Past ~8 columns the grid scrolls sideways and a row of numbers whose
      // name has slid off the left edge cannot be attributed to anyone.
      freezeFirstColumn={weeks.length + 2 > 8}
      maxBodyHeight="44vh"
      emptyText={`NO TIME LOGGED IN THE LAST ${weeks.length} WEEKS`}
      footnote={
        <span className="block leading-relaxed">
          <span className="block font-mono text-[10px] text-[var(--text-faint)]">
            {board.weeklyHoursAreNominal
              ? "OVER / UNDER IS AGAINST A NOMINAL 40 H WEEK — TRACKINGTIME'S ACCOUNT DEFAULT, NOT A CONTRACT"
              : "OVER / UNDER IS AGAINST CONTRACTED HOURS"}
            {weeks.some((w) => w.isCurrent) && " · THE LAST COLUMN IS THE WEEK IN PROGRESS"}
          </span>
          <span className="block text-[var(--text-secondary)]">
            {rows.length} {rows.length === 1 ? "person" : "people"} in this window ·{" "}
            {logged} logged time · {totalHours.toLocaleString("en-GB", { maximumFractionDigits: 1 })} h
            total across all rows
          </span>
        </span>
      }
    />
  );
}
