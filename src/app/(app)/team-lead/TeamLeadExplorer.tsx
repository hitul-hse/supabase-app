"use client";

/**
 * The Team Lead EXPLORER: a client shell that puts an interactive slice control
 * ABOVE the analysis, and re-derives the charts from the narrowed selection.
 *
 * WHY IT EXISTS. The page already fetches one `board` object and hands it to
 * every figure (TeamAnalysisSection, TeamDeepAnalysis, TeamLeadCharts) and the
 * grid (TeamLeadBoard). The period filter (BoardRangeFilter) moves the WHOLE
 * view by re-querying on the server. This adds the other axis a lead asks for --
 * WHO -- entirely in the browser: filter by TEAM (Orga/Operations/Tech/HR, plus
 * a "No team" group when the roster carries unassigned people) and by PERSON
 * (searchable multi-select). No new query, no widened access: this only ever
 * narrows the rows the viewer already received, so it is presentation, never
 * scope. RLS decided whose hours are in `board.rows`; this decides which of
 * those to look at right now.
 *
 * FAIL SAFE, ALWAYS OPEN. An empty selection means "everyone", never "nobody" --
 * a blank filter must not blank the page. Team and person combine as a UNION:
 * pick TECH and one person from ORGA and you see all of Tech plus that one
 * person, which is how a lead reasons ("my team, and also her").
 *
 * DERIVING THE NARROWED BOARD. The charts read `board.rows` (per-week sums,
 * utilisation, workload), plus `monthComparison.deltas` and `travelRows` (the
 * deep-analysis figures). All three are keyed by memberId, so narrowing is a
 * filter on the same ids. `monthComparison` keeps its ORG totals and labels
 * untouched -- that card is deliberately org-wide and calendar-anchored -- and
 * only its per-person `deltas` follow the selection, matching what the other
 * figures show. Board-level KPIs the grid reads (teamUtilisationPercent,
 * activeCount, idleCount) are recomputed on the SAME basis the query used, so
 * the grid's header agrees with its filtered rows.
 *
 * Visual language matches the dashboard's ReportFilters bar and the existing
 * BoardRangeFilter directly above it: rounded-full trough of accent pills for
 * teams, a searchable rounded-full popover for people, one "Clear" affordance,
 * and a live-region "N of M people" count. The two filter surfaces should not
 * teach two dialects.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { ApprovalDecisionRow } from "@/lib/queries/types";
import type { TeamLeadBoardData, BoardRow } from "@/lib/queries/team-lead-live";
import { teamLabel } from "@/lib/teams";
import { TeamAnalysisSection } from "./TeamAnalysisSection";
import { TeamDeepAnalysis } from "./TeamDeepAnalysis";
import { TeamLeadCharts } from "./TeamLeadCharts";
import { TeamLeadBoard } from "./TeamLeadBoard";

/** The key an unassigned row filters under. Distinct from any real team key. */
const NO_TEAM = "__none__";

/** One team choice in the pill trough, with the count of people it would show. */
type TeamChoice = { key: string; label: string; count: number };

/**
 * A searchable, keyboard-navigable people multi-select.
 *
 * Mirrors the dashboard MultiSelect (ReportFilters.tsx) rather than importing it
 * -- that control lives in the time module this task must not touch, and it is
 * keyed by number ids for projects. This is the same grammar (rounded-full
 * trigger, popover on card tokens, selected-first list, ↑↓ move / ⏎ pick / esc
 * close) scoped to board members. Declared at module scope so it is a stable
 * component type across renders and never loses focus mid-keystroke.
 */
function PeopleSelect({
  options,
  selected,
  onChange,
}: {
  options: { id: number; name: string; hint?: string | null }[];
  selected: number[];
  onChange: (next: number[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    const matched = q
      ? options.filter(
          (o) =>
            o.name.toLowerCase().includes(q) ||
            (o.hint ? o.hint.toLowerCase().includes(q) : false),
        )
      : options;
    // Selected first, then source order, stable within each group so ticking a
    // box promotes rather than reshuffles.
    const chosen = new Set(selected);
    return [
      ...matched.filter((o) => chosen.has(o.id)),
      ...matched.filter((o) => !chosen.has(o.id)),
    ];
  }, [options, q, selected]);

  const toggle = (id: number) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = Math.max(
        0,
        Math.min(filtered.length - 1, cursor + (e.key === "ArrowDown" ? 1 : -1)),
      );
      setCursor(next);
      listRef.current
        ?.querySelectorAll("[data-option]")
        [next]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      const opt = filtered[cursor];
      if (opt) toggle(opt.id);
    }
  };

  const summary =
    selected.length === 0
      ? `All (${options.length})`
      : selected.length === 1
        ? (options.find((o) => o.id === selected[0])?.name ?? "1 person")
        : `${selected.length} people`;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={`flex min-w-[9rem] max-w-[14rem] items-center justify-between gap-2 rounded-full border px-3 py-1.5 text-left text-[12px] transition-colors ${
          selected.length
            ? "border-[var(--accent)] text-[var(--text-primary)]"
            : "border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        }`}
      >
        <span className="flex flex-col leading-tight">
          <span className="font-mono text-[9px] tracking-[0.12em] text-[var(--text-faint)]">
            PERSON
          </span>
          <span className="truncate">{summary}</span>
        </span>
        <span aria-hidden className="text-[9px] text-[var(--text-faint)]">
          ▼
        </span>
      </button>

      {open && (
        <div className="absolute left-0 z-30 mt-1 flex max-h-[19rem] w-[19rem] flex-col overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] card-elev-raised">
          <div className="border-b border-[var(--border)] p-2">
            <input
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setCursor(0);
              }}
              onKeyDown={onKeyDown}
              role="combobox"
              aria-expanded
              aria-controls="teamlead-people-options"
              aria-autocomplete="list"
              placeholder="Search people…"
              className="w-full rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
            />
            <p className="mt-1 flex items-center justify-between text-[10px] text-[var(--text-faint)]">
              <span>
                {filtered.length.toLocaleString("en-GB")}
                {filtered.length !== options.length
                  ? ` of ${options.length.toLocaleString("en-GB")}`
                  : ""}{" "}
                {options.length === 1 ? "person" : "people"}
                {selected.length > 0 ? ` · ${selected.length} selected` : ""}
              </span>
              <span aria-hidden>↑↓ move · ⏎ pick · esc close</span>
            </p>
          </div>

          <div
            ref={listRef}
            id="teamlead-people-options"
            role="listbox"
            aria-label="People"
            aria-multiselectable
            className="flex-1 overflow-y-auto"
          >
            {filtered.length === 0 ? (
              <p className="px-3 py-4 text-center text-[11px] text-[var(--text-faint)]">
                No people match “{query.trim()}”
              </p>
            ) : (
              filtered.map((o, i) => {
                const on = selected.includes(o.id);
                const hot = i === cursor;
                return (
                  <button
                    key={o.id}
                    type="button"
                    role="option"
                    data-option
                    aria-selected={on}
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => toggle(o.id)}
                    className={`flex w-full items-start gap-2 px-3 py-1.5 text-left text-[12px] transition-colors ${
                      hot ? "bg-[var(--surface-hover)]" : ""
                    } ${on ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]"}`}
                  >
                    <span
                      aria-hidden
                      className={`mt-[3px] flex h-3 w-3 flex-none items-center justify-center border ${
                        on
                          ? "border-[var(--accent)] bg-[var(--accent)]"
                          : "border-[var(--border)]"
                      }`}
                    >
                      {on ? (
                        <svg
                          width="8"
                          height="8"
                          viewBox="0 0 10 10"
                          fill="none"
                          stroke="var(--accent-contrast)"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M1.5 5.5 4 8l4.5-6" />
                        </svg>
                      ) : null}
                    </span>
                    <span className="flex flex-col leading-tight">
                      <span className="truncate">{o.name}</span>
                      {o.hint ? (
                        <span className="font-mono text-[9px] tracking-[0.08em] text-[var(--text-faint)]">
                          {o.hint}
                        </span>
                      ) : null}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function TeamLeadExplorer({
  board,
  viewerRole,
  viewerTeam,
  initialDecisions,
}: {
  board: TeamLeadBoardData;
  /** Passed straight through to the analysis section (exec vs dept_head scope). */
  viewerRole: string;
  /** The viewer's own team key, already normalised. */
  viewerTeam: string | null;
  /** The approvals the grid seeds from; the grid stays on the filtered board. */
  initialDecisions: ApprovalDecisionRow[];
}) {
  const [selectedTeams, setSelectedTeams] = useState<Set<string>>(() => new Set());
  const [selectedMembers, setSelectedMembers] = useState<number[]>([]);

  /* ---- team choices: only the teams actually present, with live counts ---- */
  const teamChoices = useMemo<TeamChoice[]>(() => {
    const counts = new Map<string, number>();
    for (const r of board.rows) {
      const k = r.team ?? NO_TEAM;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const choices = [...counts.entries()]
      .map(([key, count]) => ({
        key,
        label: key === NO_TEAM ? "No team" : teamLabel(key),
        count,
      }))
      // Real teams by size, the unassigned group always last -- it is a data
      // gap, not a team, and must not read as the headline.
      .sort((a, b) => {
        if (a.key === NO_TEAM) return 1;
        if (b.key === NO_TEAM) return -1;
        return b.count - a.count;
      });
    return choices;
  }, [board.rows]);

  /* ---- people options: every row, name plus team hint, source order ---- */
  const peopleOptions = useMemo(
    () =>
      board.rows.map((r) => ({
        id: r.memberId,
        name: r.name,
        hint: r.team ? teamLabel(r.team) : null,
      })),
    [board.rows],
  );

  // Prune any stale selection if the underlying board changes (e.g. the period
  // filter re-queried and a person or team dropped out of the window). Without
  // this, a selection could silently reference ids no longer present, and the
  // "N of M" count would drift from what is on screen.
  useEffect(() => {
    const presentTeams = new Set(teamChoices.map((c) => c.key));
    const presentIds = new Set(board.rows.map((r) => r.memberId));
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setSelectedTeams((prev) => {
        const next = new Set([...prev].filter((k) => presentTeams.has(k)));
        return next.size === prev.size ? prev : next;
      });
      setSelectedMembers((prev) => {
        const next = prev.filter((id) => presentIds.has(id));
        return next.length === prev.length ? prev : next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [teamChoices, board.rows]);

  const anyFilter = selectedTeams.size > 0 || selectedMembers.length > 0;

  /* ---- which rows the current selection shows (team OR person; empty = all) ---- */
  const matches = useMemo(() => {
    const memberSet = new Set(selectedMembers);
    return (r: BoardRow) => {
      if (!anyFilter) return true;
      const teamKeyOf = r.team ?? NO_TEAM;
      return selectedTeams.has(teamKeyOf) || memberSet.has(r.memberId);
    };
  }, [anyFilter, selectedTeams, selectedMembers]);

  /* ---- the narrowed board the charts and grid re-derive from ---- */
  const filteredBoard = useMemo<TeamLeadBoardData>(() => {
    if (!anyFilter) return board;

    const rows = board.rows.filter(matches);
    const keptIds = new Set(rows.map((r) => r.memberId));

    // travelRows and monthComparison.deltas are keyed by the same memberIds, so
    // they follow the same selection and every figure agrees on WHO it shows.
    const travelRows = board.travelRows.filter((t) => keptIds.has(t.memberId));
    const monthComparison =
      board.monthComparison === null
        ? null
        : {
            ...board.monthComparison,
            deltas: board.monthComparison.deltas.filter((d) => keptIds.has(d.memberId)),
          };

    // Recompute the board-level KPIs the grid header reads, on the SAME basis
    // the server query used (see getLiveTeamLeadBoard): utilisation is tracked
    // over nominal across weeks each kept person actually logged; active/idle
    // are counted over the kept rows only.
    let tracked = 0;
    let contracted = 0;
    let activeCount = 0;
    let idleCount = 0;
    for (const r of rows) {
      tracked += r.totalHours;
      contracted += r.weeklyHours * r.cells.filter((c) => c.hours !== null).length;
      if (r.totalHours > 0) activeCount += 1;
      else idleCount += 1;
    }
    const teamUtilisationPercent =
      contracted > 0 ? Math.round((tracked / contracted) * 100) : null;

    return {
      ...board,
      rows,
      travelRows,
      monthComparison,
      teamUtilisationPercent,
      activeCount,
      idleCount,
    };
  }, [board, anyFilter, matches]);

  const shownCount = filteredBoard.rows.length;
  const totalCount = board.rows.length;

  const clear = () => {
    setSelectedTeams(new Set());
    setSelectedMembers([]);
  };

  const toggleTeam = (key: string) =>
    setSelectedTeams((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <>
      {/* ---- the slice control: team pills + people multi-select ---- */}
      <div
        data-teamlead-explorer="1"
        className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 pt-3 sm:px-6"
      >
        <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--text-faint)]">
          SLICE
        </span>

        <div className="flex flex-1 flex-wrap items-center gap-2">
          {/* Team pills: the same rounded-full trough as BoardRangeFilter's
              presets, each carrying its own count so the size of a team is
              legible before you pick it. */}
          {teamChoices.length > 0 && (
            <div className="flex flex-wrap items-center gap-0.5 rounded-full border border-[var(--border)] bg-[var(--surface-2)] p-0.5">
              {teamChoices.map((c) => {
                const on = selectedTeams.has(c.key);
                return (
                  <button
                    key={c.key}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleTeam(c.key)}
                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] transition-colors ${
                      on
                        ? "bg-[var(--accent)] font-medium text-[var(--accent-contrast)]"
                        : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    {c.label}
                    <span
                      className={`font-mono text-[10px] ${
                        on ? "text-[var(--accent-contrast)]" : "text-[var(--text-faint)]"
                      }`}
                    >
                      {c.count}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          <PeopleSelect
            options={peopleOptions}
            selected={selectedMembers}
            onChange={setSelectedMembers}
          />

          {anyFilter && (
            <button
              type="button"
              onClick={clear}
              className="rounded-full border border-[var(--border)] px-3 py-1 text-[12px] text-[var(--text-secondary)] transition-colors hover:border-[var(--text-faint)] hover:text-[var(--text-primary)]"
            >
              Clear
            </button>
          )}
        </div>

        {/* The one number that says whether a filter is on and how much it hides.
            aria-live so a screen-reader user hears the count change as they
            slice, since the charts themselves are visual. */}
        <span
          aria-live="polite"
          className={`font-mono text-[10px] tracking-[0.08em] ${
            anyFilter ? "text-[var(--accent)]" : "text-[var(--text-faint)]"
          }`}
        >
          {shownCount} of {totalCount} {totalCount === 1 ? "person" : "people"}
        </span>
      </div>

      {/* Everything below re-derives from the narrowed board, so the analysis,
          the deep figures, the org-wide charts and the grid all show the same
          people. Empty selection passes the original board straight through. */}
      <div className="pt-4">
        <TeamAnalysisSection
          board={filteredBoard}
          viewerRole={viewerRole}
          viewerTeam={viewerTeam}
        />
      </div>
      <TeamDeepAnalysis board={filteredBoard} />
      <TeamLeadCharts board={filteredBoard} />
      <TeamLeadBoard board={filteredBoard} initialDecisions={initialDecisions} />
    </>
  );
}
