"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { TrendFigure, type AreaPoint } from "@/components/ui/Charts";
import { getWeekDrilldown, type WeekDrilldown } from "./week-drilldown";

/**
 * The client half of the Overview's hero figure: same chart, plus the answer
 * to "what is behind this number?" — click any week and its story opens in
 * place: who logged the hours, on what, and how billable it was. A popup
 * rather than a page because the reader is mid-comparison; navigating away
 * would cost the very context that made them curious.
 */
export function OverviewHero({
  points,
  yDomain,
  label,
  team,
}: {
  points: AreaPoint[];
  yDomain?: [number, number];
  label: string;
  team: string | null;
}) {
  const [open, setOpen] = useState<WeekDrilldown | null>(null);
  const [openLabel, setOpenLabel] = useState<string>("");
  const [pending, startTransition] = useTransition();

  const close = useCallback(() => setOpen(null), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  const onSelect = (key: string) => {
    const point = points.find((p) => p.key === key);
    setOpenLabel(point?.label ?? key);
    startTransition(async () => {
      setOpen(await getWeekDrilldown(key, team));
    });
  };

  return (
    <>
      <TrendFigure
        id="overview-billable-share"
        points={points}
        yDomain={yDomain}
        label={label}
        onSelect={onSelect}
      />

      {(open || pending) && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(10, 14, 15, 0.66)", backdropFilter: "blur(4px)" }}
          onClick={close}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Week of ${openLabel} in detail`}
            className="rise-in card-elev-raised w-full max-w-2xl rounded-[var(--radius-panel)] border border-[var(--border-strong)] bg-[var(--surface)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-5 py-4">
              <div>
                <span className="font-mono text-[10px] tracking-[0.12em] text-[var(--text-faint)]">
                  WEEK OF {openLabel.toUpperCase()}
                </span>
                {open && !open.error && (
                  <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="font-mono text-[26px] font-semibold leading-none text-[var(--text-primary)]">
                      {open.totals.share === null ? "n/a" : `${open.totals.share}%`}
                    </span>
                    <span className="font-mono text-[11px] text-[var(--text-secondary)]">
                      {open.totals.billableHours.toLocaleString("de-DE")}h billable of{" "}
                      {open.totals.hours.toLocaleString("de-DE")}h · {open.totals.people} people ·{" "}
                      {open.totals.entries} entries
                    </span>
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={close}
                autoFocus
                aria-label="Close week detail"
                className="rounded-[var(--radius-sm)] border border-[var(--border)] px-2.5 py-1 font-mono text-[11px] text-[var(--text-muted)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
              >
                ESC
              </button>
            </div>

            <div className="px-5 py-4">
              {pending && !open && (
                <p className="py-8 text-center font-mono text-[11px] text-[var(--text-faint)]">
                  Fetching the week…
                </p>
              )}
              {open?.error && (
                <p className="py-6 text-center text-sm text-[var(--critical)]">{open.error}</p>
              )}
              {open && !open.error && (
                <div className="stagger grid grid-cols-1 gap-5 sm:grid-cols-2">
                  <DrillList title="BY PERSON" rows={open.byPerson} totalHours={open.totals.hours} />
                  <DrillList title="BY PROJECT" rows={open.byProject} totalHours={open.totals.hours} />
                </div>
              )}
            </div>

            <div className="border-t border-[var(--border)] px-5 py-3 font-mono text-[10px] text-[var(--text-faint)]">
              TOP 8 EACH, BY HOURS · SAME SCOPE AS THE CHART · FUTURE-DATED ENTRIES EXCLUDED
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function DrillList({
  title,
  rows,
  totalHours,
}: {
  title: string;
  rows: { name: string; hours: number; billableHours: number }[];
  totalHours: number;
}) {
  return (
    <div>
      <h3 className="mb-2 font-mono text-[10px] tracking-[0.12em] text-[var(--text-faint)]">
        {title}
      </h3>
      {rows.length === 0 ? (
        <p className="font-mono text-[11px] text-[var(--text-faint)]">Nothing logged.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => {
            const width = totalHours > 0 ? Math.max(2, (row.hours / totalHours) * 100) : 0;
            const billableShare = row.hours > 0 ? Math.round((row.billableHours / row.hours) * 100) : 0;
            return (
              <li key={row.name}>
                <div className="flex items-baseline justify-between gap-2 text-[12px]">
                  <span className="truncate text-[var(--text-primary)]">{row.name}</span>
                  <span className="flex-none font-mono text-[11px] text-[var(--text-secondary)]">
                    {row.hours.toLocaleString("de-DE")}h · {billableShare}%
                  </span>
                </div>
                <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-[var(--border)]">
                  <div
                    className="bar-grow h-full rounded-full bg-[var(--accent)]"
                    style={{ width: `${width}%`, opacity: 0.35 + (billableShare / 100) * 0.65 }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
