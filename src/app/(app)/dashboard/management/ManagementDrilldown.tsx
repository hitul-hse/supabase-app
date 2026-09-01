"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

/**
 * The Management page's answer to "what is behind this number?" — the same
 * in-place popup pattern as the Overview hero: click a person, a service or a
 * stat tile and its composition opens without navigating away. Purely
 * client-side: the page already ships the whole read model, so the drill-down
 * is a re-projection of data on hand, never a second fetch that could
 * disagree with the table it came from.
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

export function ManagementDrilldown({ drill, onClose }: { drill: Drill; onClose: () => void }) {
  const t = useTranslations("management.drill");
  const [page, setPage] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(10, 14, 15, 0.66)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("dialogLabel", { title: drill.title })}
        className="rise-in card-elev-raised w-full max-w-xl rounded-[var(--radius-panel)] border border-[var(--border-strong)] bg-[var(--surface)]"
        onClick={(e) => e.stopPropagation()}
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
          <button
            type="button"
            onClick={onClose}
            autoFocus
            aria-label={t("close")}
            className="rounded-[var(--radius-sm)] border border-[var(--border)] px-2.5 py-1 font-mono text-[11px] text-[var(--text-muted)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
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
            <ul className="stagger flex flex-col gap-2.5">
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
                        style={{ width: `${Math.min(100, width)}%` }}
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
                className="rounded-[var(--radius-sm)] border border-[var(--border)] px-2.5 py-1 font-mono text-[10px] text-[var(--text-muted)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] disabled:opacity-40"
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
                className="rounded-[var(--radius-sm)] border border-[var(--border)] px-2.5 py-1 font-mono text-[10px] text-[var(--text-muted)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] disabled:opacity-40"
              >
                {t("next")}
              </button>
            </div>
          )}
        </div>

        <div className="border-t border-[var(--border)] px-5 py-3 font-mono text-[10px] text-[var(--text-faint)]">
          {drill.footer}
        </div>
      </div>
    </div>
  );
}
