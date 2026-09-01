"use client";

/**
 * The Overview's filter surface: period presets PLUS real from/to dates, and a
 * team selector.
 *
 * WHY THIS EXISTS. Until now this page was hardcoded to the last twelve weeks
 * with no controls at all, so the only two questions anyone actually asks of a
 * landing page -- "what about last month" and "just the Tech team" -- had no
 * answer here. The reader's alternative was to believe the twelve-week figure
 * was the only figure, which is the same failure class as the invented numbers
 * this page was built to remove: not wrong arithmetic, an unstated scope.
 *
 * WHY IT LOOKS LIKE THE TEAM LEAD BOARD'S FILTER. It is deliberately the same
 * grammar as BoardRangeFilter: identical presets, identical URL keys, preset
 * click clears the custom dates, touching a date switches to custom. Two filter
 * surfaces one click apart that behave differently teach two dialects, and the
 * reader then cannot trust that "?range=month" means the same thing on both.
 *
 * WHY THE TEAM CONTROL STATES A HEADCOUNT. Only a handful of the roster has a
 * team recorded in TrackingTime. Filtering to a team therefore makes almost
 * every figure on the page small, and a small number with no denominator beside
 * it reads as a business collapse rather than as missing metadata. The covered
 * headcount is rendered next to the selection for exactly that reason, and the
 * unassigned population is a first-class, selectable bucket rather than a
 * hidden remainder.
 */

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useTranslations } from "next-intl";
import type {
  OverviewPreset,
  OverviewRange,
  OverviewTeamCoverage,
  OverviewTeamOption,
} from "@/lib/queries/overview-live";

/*
 * Presets in display order. The label for each lives in messages/{en,de}.json
 * under `overview.filters.presets.<key>`, so the key doubles as the message
 * path; the URL value stays the key, in both languages.
 */
const PRESETS: { key: OverviewPreset }[] = [
  { key: "4w" },
  { key: "12w" },
  { key: "26w" },
  { key: "month" },
  { key: "prev-month" },
  { key: "year" },
];

/** The preset the page shows when nothing is asked for. */
const DEFAULT_PRESET: OverviewPreset = "12w";

export function OverviewFilters({
  range,
  team,
  teamOptions,
  coverage,
}: {
  range: OverviewRange;
  team: string | null;
  teamOptions: OverviewTeamOption[];
  coverage: OverviewTeamCoverage;
}) {
  const router = useRouter();
  const t = useTranslations("overview.filters");
  const [pending, startTransition] = useTransition();

  /*
   * Every navigation is built from the FULL current selection, so changing the
   * period does not silently drop the team (and vice versa). A filter bar whose
   * controls reset each other is worse than one control, because the reader
   * believes both are applied.
   */
  const go = (next: { preset?: OverviewPreset | null; from?: string; to?: string; team?: string | null }) => {
    const params = new URLSearchParams();

    if (next.from !== undefined || next.to !== undefined) {
      params.set("from", next.from ?? range.from);
      params.set("to", next.to ?? range.to);
    } else {
      const preset = next.preset === undefined ? range.preset : next.preset;
      if (preset === null) {
        // Custom dates are the current period and no preset was clicked: keep them.
        params.set("from", range.from);
        params.set("to", range.to);
      } else if (preset !== DEFAULT_PRESET) {
        params.set("range", preset);
      }
    }

    const nextTeam = next.team === undefined ? team : next.team;
    if (nextTeam) params.set("team", nextTeam);

    const query = params.toString();
    startTransition(() => router.push(query ? `/?${query}` : "/", { scroll: false }));
  };

  const activeCount = coverage.inSelected;

  return (
    <div
      data-overview-filters="1"
      className="flex flex-col gap-2 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--text-faint)]">
          {t("period")}
          <span
            aria-live="polite"
            className={`ml-2 text-[var(--accent)] transition-opacity ${pending ? "opacity-100" : "opacity-0"}`}
          >
            {t("updating")}
          </span>
        </span>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-0.5 rounded-full border border-[var(--border)] bg-[var(--surface-2)] p-0.5">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                aria-pressed={range.preset === p.key}
                onClick={() => go({ preset: p.key })}
                className={`rounded-full px-3 py-1 text-[12px] transition-colors pointer-coarse:min-h-[36px] pointer-coarse:px-3.5 ${
                  range.preset === p.key
                    ? "bg-[var(--accent)] font-medium text-[var(--accent-contrast)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
                }`}
              >
                {t(`presets.${p.key}`)}
              </button>
            ))}
          </div>

          {/* Custom dates: editing either one builds a range from BOTH current
              values, so the untouched end never resets to a default.

              flex-wrap: a native date input has a hard minimum width the
              browser will not shrink below, so two of them plus the arrow are
              wider than a 360px phone. Unwrapped, the second one is simply cut
              off the right edge with no scrollbar to reveal it. */}
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              type="date"
              value={range.from}
              max={range.to}
              aria-label={t("fromDate")}
              onChange={(e) => {
                if (e.target.value) go({ from: e.target.value, to: range.to });
              }}
              className={`rounded-full border bg-[var(--surface-2)] px-3 py-1.5 font-mono text-[16px] sm:text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] ${
                range.preset === null ? "border-[var(--accent)]" : "border-[var(--border)]"
              }`}
            />
            <span aria-hidden className="text-[11px] text-[var(--text-faint)]">
              →
            </span>
            <input
              type="date"
              value={range.to}
              min={range.from}
              aria-label={t("toDate")}
              onChange={(e) => {
                if (e.target.value) go({ from: range.from, to: e.target.value });
              }}
              className={`rounded-full border bg-[var(--surface-2)] px-3 py-1.5 font-mono text-[16px] sm:text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] ${
                range.preset === null ? "border-[var(--accent)]" : "border-[var(--border)]"
              }`}
            />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--divider)] pt-2">
        <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--text-faint)]">
          {t("team")}
        </span>

        <div className="flex flex-wrap items-center gap-0.5 rounded-full border border-[var(--border)] bg-[var(--surface-2)] p-0.5">
          {/* "All teams" is the empty selection, and it is a real pill rather
              than an implicit state: a filter bar that can be entered but not
              left is how a reader ends up believing a scoped figure is total. */}
          <button
            type="button"
            aria-pressed={team === null}
            onClick={() => go({ team: null })}
            className={`rounded-full px-3 py-1 text-[12px] transition-colors pointer-coarse:min-h-[36px] pointer-coarse:px-3.5 ${
              team === null
                ? "bg-[var(--accent)] font-medium text-[var(--accent-contrast)]"
                : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
            }`}
          >
            {t("allTeams")}
          </button>
          {teamOptions.map((option) => (
            <button
              key={option.key}
              type="button"
              aria-pressed={team === option.key}
              onClick={() => go({ team: option.key })}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] transition-colors pointer-coarse:min-h-[36px] pointer-coarse:px-3.5 ${
                team === option.key
                  ? "bg-[var(--accent)] font-medium text-[var(--accent-contrast)]"
                  : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
              }`}
            >
              {option.label}
              {/* The headcount rides on the pill itself, so the size of the
                  population is visible BEFORE the click that shrinks every
                  figure on the page. */}
              <span
                className={`font-mono text-[10px] ${
                  team === option.key ? "opacity-80" : "text-[var(--text-faint)]"
                }`}
              >
                {option.people}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/*
        The coverage sentence. This is the whole reason the team filter is safe
        to ship: with 5 of 19 people carrying a team, a filtered page shows
        genuinely tiny numbers, and without this line they are indistinguishable
        from a catastrophe. The "x of y" headcount is the emphasised span; the
        partial-coverage clause is appended only when TrackingTime holds a team
        for fewer than everyone.
      */}
      {team !== null && (
        <p role="status" className="text-[11px] leading-relaxed text-[var(--text-secondary)]">
          {t.rich("coverage.recorded", {
            count: activeCount ?? 0,
            total: coverage.totalPeople,
            partial:
              coverage.withTeam < coverage.totalPeople
                ? t("coverage.partial", {
                    withTeam: coverage.withTeam,
                    total: coverage.totalPeople,
                  })
                : "",
            strong: (chunks) => (
              <span className="font-mono font-semibold text-[var(--warning)]">{chunks}</span>
            ),
          })}
        </p>
      )}
    </div>
  );
}
