"use client";

/**
 * The Team Lead range filter: preset pills PLUS real from/to date inputs.
 *
 * Replaced the fixed "4/8/12/26 weeks" pill row by request ("i want proper
 * date and time filters"). The presets stay because they are the fast path a
 * lead actually clicks daily; the date inputs are the point — any inclusive
 * range, shareable, back-button-safe, because the range is URL state.
 *
 * Same interaction grammar as the TrackingTime dashboard's filter bar
 * (ReportFilters.tsx): preset click clears the custom dates, touching a date
 * switches to custom. The two surfaces should not teach two dialects.
 */

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import type { BoardPreset, BoardRange } from "@/lib/queries/team-lead-live";

const PRESETS: { key: BoardPreset; label: string }[] = [
  { key: "4w", label: "4 weeks" },
  { key: "12w", label: "12 weeks" },
  { key: "26w", label: "26 weeks" },
  { key: "month", label: "This month" },
  { key: "prev-month", label: "Last month" },
  { key: "year", label: "This year" },
];

export function BoardRangeFilter({ range }: { range: BoardRange }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const go = (query: string) =>
    startTransition(() => router.push(`/team-lead${query}`, { scroll: false }));

  return (
    <div
      data-board-range-filter="1"
      className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4 sm:px-6"
    >
      <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--text-faint)]">
        PERIOD
        <span
          aria-live="polite"
          className={`ml-2 text-[var(--accent)] transition-opacity ${pending ? "opacity-100" : "opacity-0"}`}
        >
          UPDATING…
        </span>
      </span>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-0.5 rounded-full border border-[var(--border)] bg-[var(--surface-2)] p-0.5">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              aria-pressed={range.preset === p.key}
              onClick={() => go(p.key === "4w" ? "" : `?range=${p.key}`)}
              className={`rounded-full px-3 py-1 text-[12px] transition-colors pointer-coarse:min-h-[36px] pointer-coarse:px-3.5 ${
                range.preset === p.key
                  ? "bg-[var(--accent)] font-medium text-[var(--accent-contrast)]"
                  : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Custom dates: editing either one switches to a custom range built
            from BOTH current values, so the untouched end never resets.

            flex-wrap: two native date inputs plus the arrow exceed a 360px
            phone's usable width, and unwrapped the second is clipped off the
            right edge with no scroll affordance. */}
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            type="date"
            value={range.from}
            max={range.to}
            aria-label="From date"
            onChange={(e) => {
              if (e.target.value) go(`?from=${e.target.value}&to=${range.to}`);
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
            aria-label="To date"
            onChange={(e) => {
              if (e.target.value) go(`?from=${range.from}&to=${e.target.value}`);
            }}
            className={`rounded-full border bg-[var(--surface-2)] px-3 py-1.5 font-mono text-[16px] sm:text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] ${
              range.preset === null ? "border-[var(--accent)]" : "border-[var(--border)]"
            }`}
          />
        </div>
      </div>
    </div>
  );
}
