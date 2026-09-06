"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ModalShell, type DialogOrigin } from "@/components/ui/ModalShell";

/**
 * The Management page's answer to "what is behind this number?" — the same
 * in-place popup pattern as the Overview hero: click a person, a service or a
 * stat tile and its composition opens without navigating away. Purely
 * client-side: the page already ships the whole read model, so the drill-down
 * is a re-projection of data on hand, never a second fetch that could
 * disagree with the table it came from.
 *
 * THE DIALOG IS ModalShell's (APPLE_REF §6.2 "Dialog"), shared with the drill
 * dialog and the Overview hero. It used to be hand-rolled and, like the hero,
 * entered on `.rise-in` -- the page-LOAD vocabulary applied to an overlay --
 * and then vanished in a single frame with no exit at all; its scrim was an
 * inline `rgba()` carrying a 4 px `backdrop-filter` that had already been
 * measured as halving the frame rate of this exact animation; focus was never
 * trapped and never returned; and the page behind it kept scrolling. It now
 * arrives on the 0.35 spring from the trigger's offset and leaves in 150 ms
 * along the same path, interruptibly.
 *
 * Wording comes from the `management.drill` catalogue. The German there is the
 * canonical glossary (Auslastung, Vertragsstunden) this dashboard spoke before
 * the i18n layer existed; the builders in ManagementMatrix resolve kicker,
 * title, subline and footer through the same catalogue, so the dialog speaks
 * the language of the panels around it.
 */
export type DrillRow = {
  name: string;
  /** secondary line under the name, e.g. the customer behind a project */
  sub?: string;
  hours: number;
  /** overrides the bar width (0-100); defaults to hours relative to the largest row */
  percent?: number;
};

export type Drill = {
  kicker: string;
  title: string;
  headline: string;
  subline?: string;
  rows: DrillRow[];
  footer: string;
};

const fmt = (value: number) =>
  new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(value);

const PAGE_SIZE = 10;

export function ManagementDrilldown({
  drill,
  onClose,
  origin = null,
}: {
  drill: Drill;
  onClose: () => void;
  /** The trigger's centre relative to the viewport centre; absent, it scales from the middle. */
  origin?: DialogOrigin | null;
}) {
  const t = useTranslations("management.drill");
  const [page, setPage] = useState(0);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Reset paging when a different drill opens in the same mount -- the
  // adjust-state-during-render pattern, not an effect (react-hooks rule).
  const [lastDrill, setLastDrill] = useState(drill);
  if (drill !== lastDrill) {
    setLastDrill(drill);
    setPage(0);
  }

  const pageCount = Math.max(1, Math.ceil(drill.rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visible = drill.rows.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const maxHours = Math.max(1, ...drill.rows.map((row) => row.hours));

  return (
    <ModalShell
      label={t("dialogLabel", { title: drill.title })}
      onDismiss={onClose}
      origin={origin}
      initialFocusTo={closeRef}
      panelClassName="card-elev-raised w-full max-w-xl rounded-[var(--radius-panel)] border border-[var(--border-strong)] bg-[var(--surface-raised)]"
    >
      <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-5 py-4">
        <div>
          <span className="font-mono text-[10px] tracking-[0.12em] text-[var(--text-faint)]">
            {drill.kicker}
          </span>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-mono text-[26px] font-semibold leading-none text-[var(--text-primary)]">
              {drill.headline}
            </span>
            {drill.subline && (
              <span className="font-mono text-[11px] text-[var(--text-secondary)]">{drill.subline}</span>
            )}
          </div>
          <div className="mt-1 text-[13px] font-medium text-[var(--text-primary)]">{drill.title}</div>
        </div>
        {/* No `autoFocus`: React focuses an autoFocus child during commit,
            ahead of the shell's effects, and the shell would then capture
            ITSELF as the element to return focus to. */}
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label={t("close")}
          className="rounded-[var(--radius-sm)] border border-[var(--border)] px-2.5 py-1 font-mono text-[11px] text-[var(--text-muted)] control-motion hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] active:translate-y-px"
        >
          {t("esc")}
        </button>
      </div>

      <div className="px-5 py-4">
        {drill.rows.length === 0 ? (
          <p className="py-6 text-center font-mono text-[11px] text-[var(--text-faint)]">
            {t("empty")}
          </p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {visible.map((row) => {
              const width = row.percent ?? Math.max(2, (row.hours / maxHours) * 100);
              return (
                <li key={`${row.name}·${row.sub ?? ""}`}>
                  <div className="flex items-baseline justify-between gap-2 text-[12px]">
                    <span className="min-w-0 truncate text-[var(--text-primary)]">
                      {row.name}
                      {row.sub && <span className="ml-2 text-[var(--text-faint)]">{row.sub}</span>}
                    </span>
                    <span className="flex-none font-mono text-[11px] text-[var(--text-secondary)]">
                      {row.percent !== undefined ? `${fmt(row.percent)}%` : `${fmt(row.hours)} h`}
                    </span>
                  </div>
                  <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-[var(--border)]">
                    <div
                      className="bar-grow h-full rounded-full bg-[var(--accent)]"
                      style={{
                        width: `${Math.min(100, width)}%`,
                        // Inside a dialog that has already arrived: 0.4s
                        // from frame 0, not the house 0.7s after 0.25s.
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

        {pageCount > 1 && (
          <div className="mt-4 flex items-center justify-between border-t border-[var(--divider)] pt-3">
            <button
              type="button"
              disabled={safePage === 0}
              onClick={() => setPage(safePage - 1)}
              className="rounded-[var(--radius-sm)] border border-[var(--border)] px-2.5 py-1 font-mono text-[10px] text-[var(--text-muted)] control-motion hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] active:translate-y-px disabled:opacity-40 disabled:hover:border-[var(--border)] disabled:hover:text-[var(--text-muted)] disabled:active:translate-y-0"
            >
              {t("back")}
            </button>
            <span className="font-mono text-[10px] text-[var(--text-faint)]">
              {t("page", { page: safePage + 1, count: pageCount })}
            </span>
            <button
              type="button"
              disabled={safePage >= pageCount - 1}
              onClick={() => setPage(safePage + 1)}
              className="rounded-[var(--radius-sm)] border border-[var(--border)] px-2.5 py-1 font-mono text-[10px] text-[var(--text-muted)] control-motion hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] active:translate-y-px disabled:opacity-40 disabled:hover:border-[var(--border)] disabled:hover:text-[var(--text-muted)] disabled:active:translate-y-0"
            >
              {t("next")}
            </button>
          </div>
        )}
      </div>

      <div className="border-t border-[var(--border)] px-5 py-3 font-mono text-[10px] text-[var(--text-faint)]">
        {drill.footer}
      </div>
    </ModalShell>
  );
}
