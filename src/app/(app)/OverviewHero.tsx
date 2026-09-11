"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { AnimatePresence } from "framer-motion";
import { TrendFigure, type AreaPoint } from "@/components/ui/Charts";
import { ModalShell, dialogOriginFromPoint, type DialogOrigin } from "@/components/ui/ModalShell";
import { getWeekDrilldown, type WeekDrilldown } from "./week-drilldown";

/**
 * The client half of the Overview's hero figure: same chart, plus the answer
 * to "what is behind this number?" — click any week and its story opens in
 * place: who logged the hours, on what, and how billable it was. A popup
 * rather than a page because the reader is mid-comparison; navigating away
 * would cost the very context that made them curious.
 *
 * THE DIALOG IS ModalShell's (APPLE_REF §6.2 "Dialog"), and it used to be
 * hand-rolled. Four things that fixes, in order of how visible they are:
 *
 *   1. It has an EXIT. The panel entered on `.rise-in` -- the page-LOAD
 *      vocabulary, on an overlay -- and then vanished in a single frame, so a
 *      dismissal read as a rendering fault. It now leaves along the entrance's
 *      own path in 150 ms, and Escape mid-entrance reverses from wherever the
 *      panel has got to (§6.1 #6, #3).
 *   2. The scrim is `.scrim`, the house token, not an inline
 *      `rgba(10, 14, 15, 0.66)` with `backdrop-filter: blur(4px)` -- a blur
 *      the drill dialog had already measured as halving the frame rate of
 *      this exact animation, and which §4.2 does not give an M5 scrim at all.
 *   3. Focus is trapped inside the panel and returned to the chart on
 *      dismissal. Before, Tab walked straight out of the dialog onto the page
 *      behind it.
 *   4. Dismissal is one path. `close` used to null the DATA, so Escape during
 *      the fetch left a "fetching…" dialog on screen with nothing to fetch
 *      into: `pending` was still true and the old `(open || pending)` gate
 *      re-opened it on the next render. Visibility is now its own flag.
 *
 * The panel grows out of the POINT that was tapped. `TrendFigure` reports a
 * selection by key rather than by element, so the origin is taken from the
 * last pointer-down inside the chart (captured on the wrapper, which is
 * `display: contents` and therefore costs the chart's height chain nothing).
 * A keyboard activation leaves it null and the panel scales from the middle,
 * which is the honest answer to "it came from nowhere in particular".
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
  const t = useTranslations("overview.hero");
  const tc = useTranslations("common");
  const [open, setOpen] = useState<WeekDrilldown | null>(null);
  const [visible, setVisible] = useState(false);
  const [openLabel, setOpenLabel] = useState<string>("");
  const [origin, setOrigin] = useState<DialogOrigin | null>(null);
  const [pending, startTransition] = useTransition();
  const pointRef = useRef<DialogOrigin | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Visibility, not the data: a dismissal must end the dialog even while the
  // server action behind it is still in flight. ModalShell owns Escape.
  const close = useCallback(() => setVisible(false), []);

  const onSelect = (key: string) => {
    const point = points.find((p) => p.key === key);
    setOpenLabel(point?.label ?? key);
    // Captured on the pointer-down that preceded this selection.
    setOrigin(pointRef.current);
    // Clear the previous week before fetching, so re-opening shows "fetching"
    // rather than the last week's numbers under this week's title.
    setOpen(null);
    setVisible(true);
    startTransition(async () => {
      setOpen(await getWeekDrilldown(key, team));
    });
  };

  return (
    <>
      {/* The dialog's spatial origin: the point inside the chart that was
          tapped. `contents` so the wrapper adds no box of its own. */}
      <div
        className="contents"
        onPointerDownCapture={(e) => {
          pointRef.current = dialogOriginFromPoint(e.clientX, e.clientY);
        }}
      >
        <TrendFigure
          id="overview-billable-share"
          points={points}
          yDomain={yDomain}
          label={label}
          onSelect={onSelect}
        />
      </div>

      <AnimatePresence>
        {visible && (
          <ModalShell
            label={t("dialogLabel", { week: openLabel })}
            onDismiss={close}
            origin={origin}
            initialFocusTo={closeRef}
            panelClassName="card-elev-raised w-full max-w-2xl rounded-[var(--radius-panel)] border border-[var(--border-strong)] bg-[var(--surface-raised)]"
          >
            <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-5 py-4">
              <div>
                <span className="font-mono text-[10px] tracking-[0.12em] text-[var(--text-faint)]">
                  {t("weekOf", { week: openLabel.toUpperCase() })}
                </span>
                {open && !open.error && (
                  <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="font-mono text-[26px] font-semibold leading-none text-[var(--text-primary)]">
                      {open.totals.share === null ? tc("notAvailable") : `${open.totals.share}%`}
                    </span>
                    <span className="font-mono text-[11px] text-[var(--text-secondary)]">
                      {t("totals", {
                        billable: open.totals.billableHours.toLocaleString("de-DE"),
                        total: open.totals.hours.toLocaleString("de-DE"),
                        people: open.totals.people,
                        entries: open.totals.entries,
                      })}
                    </span>
                  </div>
                )}
              </div>
              {/*
                No `autoFocus`: React focuses an autoFocus child during commit,
                ahead of the shell's own effects, and the shell would then
                capture ITSELF as the element to return focus to. It is handed
                the ref instead (ModalShell `initialFocusTo`).
              */}
              <button
                ref={closeRef}
                type="button"
                onClick={close}
                aria-label={t("close")}
                className="rounded-[var(--radius-sm)] border border-[var(--border)] px-2.5 py-1 font-mono text-[11px] text-[var(--text-muted)] control-motion hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] active:translate-y-px"
              >
                {t("esc")}
              </button>
            </div>

            <div className="px-5 py-4">
              {pending && !open && (
                <p className="py-8 text-center font-mono text-[11px] text-[var(--text-faint)]">
                  {t("fetching")}
                </p>
              )}
              {open?.error && (
                <p className="py-6 text-center text-sm text-[var(--critical)]">{open.error}</p>
              )}
              {open && !open.error && (
                // No stagger: the panel has already arrived on its own spring,
                // and a second entrance under it is two arrivals for one event
                // (DrillDialog reached the same conclusion after measuring the
                // last bar landing ~1.3s after the open).
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                  <DrillList title={t("byPerson")} rows={open.byPerson} totalHours={open.totals.hours} />
                  <DrillList title={t("byProject")} rows={open.byProject} totalHours={open.totals.hours} />
                </div>
              )}
            </div>

            <div className="border-t border-[var(--border)] px-5 py-3 font-mono text-[10px] text-[var(--text-faint)]">
              {t("footer")}
            </div>
          </ModalShell>
        )}
      </AnimatePresence>
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
  const t = useTranslations("overview.hero");
  return (
    <div>
      <h3 className="mb-2 font-mono text-[10px] tracking-[0.12em] text-[var(--text-faint)]">
        {title}
      </h3>
      {rows.length === 0 ? (
        <p className="font-mono text-[11px] text-[var(--text-faint)]">{t("nothingLogged")}</p>
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
                    style={{
                      width: `${width}%`,
                      opacity: 0.35 + (billableShare / 100) * 0.65,
                      // The house bar-grow is 0.7s after a 0.25s delay; inside
                      // a dialog that has already arrived, 0.4s from frame 0.
                      animationDuration: "400ms",
                      animationDelay: "0ms",
                    }}
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
