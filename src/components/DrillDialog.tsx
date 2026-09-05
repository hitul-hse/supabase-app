"use client";

import { useCallback, useEffect, useState, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { AnimatePresence, motion } from "framer-motion";
import { buttonClass } from "@/components/ui/Button";
import { SPRING_UI } from "@/components/animations/springs";

/**
 * The house answer to "what is behind this number?" — one dialog shape shared
 * by every surface that makes a figure tappable, so the Overview hero, the
 * Management matrix, the TrackingTime dashboard and the Projects portfolio all
 * open the same popup and a reader learns it once.
 *
 * THE ONE LAW: the rows must sum to the headline. The caller is responsible for
 * that (an explicit, labelled remainder row rather than a silent gap), and the
 * dialog makes it checkable: every row carries `data-value`, the headline
 * carries `data-value` and `data-check` says which relation must hold (sum,
 * count or mean), so a deployed-page gate can add the rows up itself rather
 * than trusting the component that drew them.
 *
 * Purely presentational: it never fetches. A caller either re-projects data
 * already on the page (the Management pattern) or awaits a server action and
 * hands the result over (the Overview pattern, with `loading` set meanwhile).
 *
 * Chrome is translated through the `drill` namespace; content (kicker, title,
 * footer, row names) arrives already in the reader's language because only the
 * caller knows which vocabulary the surface speaks.
 */

export type DrillRow = {
  name: string;
  /** Secondary text after the name, e.g. the customer behind a project. */
  sub?: string;
  /** The figure as the reader should see it, formatted like the page it came from. */
  value: string;
  /**
   * The number behind `value`, used for the bar width AND for verification
   * (rendered as `data-value`). Unrounded, so the rows add up exactly.
   */
  magnitude: number;
  /** Bar width override, 0–100. Defaults to magnitude relative to the largest row. */
  percent?: number;
  /** When the row leads to an existing page, it is a link — never a second popup. */
  href?: string;
  tone?: "accent" | "critical" | "warning" | "muted";
};

export type DrillSection = { title: string; rows: DrillRow[] };

export type Drill = {
  kicker: string;
  title: string;
  headline: string;
  /** The number behind `headline`, for verification against the rows. */
  headlineValue?: number;
  /** Which relation the gate should assert between the rows and the headline. */
  check?: "sum" | "count" | "mean";
  subline?: string;
  /** One list, paged ten at a time (docs/UI-CONVENTIONS.md: >10 rows means pages). */
  rows?: DrillRow[];
  /** Or several short lists side by side (top-N each, remainder folded), unpaged. */
  sections?: DrillSection[];
  footer?: string;
  /** Rendered while a server action is still on its way. */
  loading?: boolean;
  /** Rendered in place of the rows: an honest failure, never an empty list. */
  error?: string;
};

const PAGE_SIZE = 10;

const TONE: Record<NonNullable<DrillRow["tone"]>, string> = {
  accent: "var(--accent)",
  critical: "var(--critical)",
  warning: "var(--warning)",
  muted: "var(--text-faint)",
};

/** The dialog's own controls (ESC, BACK, NEXT) are ghost Buttons, like every pager's. */
const chrome = buttonClass("ghost", "sm", "font-mono tracking-[0.06em] disabled:opacity-40");

/**
 * Where the dialog comes from: the trigger's centre, as an offset from the
 * viewport centre, clamped so a tile at the far edge still arrives from
 * nearby rather than flying in. Apple's spatial-consistency rule -- a panel
 * emerges from the element that opened it and returns there -- and the exit
 * runs the same path in reverse, so Esc during the entrance reverses from
 * wherever the panel has got to.
 */
export type DrillOrigin = { x: number; y: number };

const ORIGIN_REACH = 160;

/** The origin for a dialog opened from `el`, or null when there is no viewport (SSR). */
export function drillOriginFrom(el: Element): DrillOrigin | null {
  if (typeof window === "undefined") return null;
  const r = el.getBoundingClientRect();
  const clamp = (v: number) => Math.max(-ORIGIN_REACH, Math.min(ORIGIN_REACH, v));
  return {
    x: clamp(r.left + r.width / 2 - window.innerWidth / 2),
    y: clamp(r.top + r.height / 2 - window.innerHeight / 2),
  };
}

export function DrillDialog({
  drill,
  onClose,
  origin = null,
}: {
  drill: Drill;
  onClose: () => void;
  /** The trigger's centre relative to the viewport centre; absent, the dialog scales from the middle. */
  origin?: DrillOrigin | null;
}) {
  const t = useTranslations("drill");
  const [page, setPage] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    // The page behind must not scroll while the dialog owns the viewport.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  // Reset paging when a different drill opens in the same mount -- the
  // adjust-state-during-render pattern, not an effect (react-hooks rule).
  const [lastDrill, setLastDrill] = useState(drill);
  if (drill !== lastDrill) {
    setLastDrill(drill);
    setPage(0);
  }

  const rows = drill.rows ?? [];
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visible = rows.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const hasSections = (drill.sections?.length ?? 0) > 0;
  const empty = !drill.loading && !drill.error && !hasSections && rows.length === 0;

  // The panel's resting pose and its off-stage pose: the same values in and
  // out, on the same spring, so an interrupted entrance reverses along the path
  // it was travelling rather than cutting to a different exit.
  const offstage = { opacity: 0, scale: 0.96, x: origin?.x ?? 0, y: origin?.y ?? 0 };

  return (
    <motion.div
      // `.scrim` (globals.css) owns the dim AND the blur, with the no-blur
      // fallbacks for reduced transparency and increased contrast. It replaces
      // an inline rgba() that belonged to no token.
      className="scrim fixed inset-0 z-50 flex items-center justify-center p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      onClick={onClose}
      role="presentation"
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label={t("dialogLabel", { title: drill.title })}
        data-drill-dialog
        data-check={drill.check}
        initial={offstage}
        animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
        exit={offstage}
        transition={SPRING_UI}
        className={`card-elev-raised w-full max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-[var(--radius-panel)] border border-[var(--border-strong)] bg-[var(--surface-raised)] ${
          hasSections ? "max-w-2xl" : "max-w-xl"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-5 py-4">
          <div className="min-w-0">
            <span className="t-label text-[var(--text-faint)]">
              {drill.kicker}
            </span>
            {/*
              Title above the figure, not below it. APPLE_REF §5.8 sets the
              dialog title in t-title-2 (17) and the headline figure in fig-md
              (15): the title is the larger of the two, so it reads first, and
              the figure answers it. The old order had a 26px figure over a
              13px title -- the number you tapped, restated -- and the reader
              met the answer before the question.
            */}
            <div className="mt-0.5 t-title-2 text-[var(--text-primary)]">{drill.title}</div>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span
                className="fig-md text-[var(--text-primary)]"
                data-drill-headline
                data-value={drill.headlineValue}
              >
                {drill.headline}
              </span>
              {drill.subline && (
                <span className="fig text-[var(--text-secondary)]">{drill.subline}</span>
              )}
            </div>
          </div>
          <button type="button" onClick={onClose} autoFocus aria-label={t("close")} className={chrome}>
            {t("esc")}
          </button>
        </div>

        <div className="px-5 py-4">
          {drill.loading && (
            <p className="py-8 text-center t-subhead text-[var(--text-faint)]">{t("fetching")}</p>
          )}
          {drill.error && (
            <p className="py-6 text-center t-callout text-[var(--critical)]">{drill.error}</p>
          )}
          {empty && (
            <p className="py-6 text-center t-subhead text-[var(--text-faint)]">
              {t("nothingLogged")}
            </p>
          )}

          {!drill.loading && !drill.error && hasSections && (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              {drill.sections!.map((section) => (
                <div key={section.title} data-drill-section>
                  <h3 className="mb-2 t-label text-[var(--text-faint)]">
                    {section.title}
                  </h3>
                  {section.rows.length === 0 ? (
                    <p className="t-subhead text-[var(--text-faint)]">{t("nothingLogged")}</p>
                  ) : (
                    <RowList rows={section.rows} />
                  )}
                </div>
              ))}
            </div>
          )}

          {!drill.loading && !drill.error && !hasSections && rows.length > 0 && (
            <RowList rows={visible} scaleTo={rows} />
          )}

          {!hasSections && pageCount > 1 && (
            <div className="mt-4 flex items-center justify-between border-t border-[var(--divider)] pt-3">
              <button
                type="button"
                disabled={safePage === 0}
                onClick={() => setPage(safePage - 1)}
                className={chrome}
                data-drill-prev
              >
                {t("back")}
              </button>
              <span
                className="t-label text-[var(--text-faint)]"
                data-drill-page={safePage + 1}
                data-drill-pages={pageCount}
              >
                {t("page", { page: safePage + 1, count: pageCount })}
              </span>
              <button
                type="button"
                disabled={safePage >= pageCount - 1}
                onClick={() => setPage(safePage + 1)}
                className={chrome}
                data-drill-next
              >
                {t("next")}
              </button>
            </div>
          )}
        </div>

        {drill.footer && (
          <div className="border-t border-[var(--border)] px-5 py-3 t-label text-[var(--text-faint)]">
            {drill.footer}
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

/*
 * No stagger on the rows. Ten rows staggered on top of the 0.25s bar delay
 * landed the last bar ~1.3s after the dialog opened (measured); the panel
 * itself has already arrived on the spring, and the figures are what the
 * reader opened it for. Every bar draws in 0.4s from the moment it mounts.
 */
function RowList({
  rows,
  scaleTo,
}: {
  rows: DrillRow[];
  /** Bars scale to the largest row of the WHOLE list, not the visible page. */
  scaleTo?: DrillRow[];
}) {
  const max = Math.max(1, ...(scaleTo ?? rows).map((row) => Math.abs(row.magnitude)));
  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((row) => {
        const width = row.percent ?? Math.max(2, (Math.abs(row.magnitude) / max) * 100);
        const colour = TONE[row.tone ?? "accent"];
        const name = row.href ? (
          <Link
            href={row.href}
            className="underline-offset-4 hover:text-[var(--accent)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
          >
            {row.name}
          </Link>
        ) : (
          row.name
        );
        return (
          <li key={`${row.name}·${row.sub ?? ""}`} data-drill-row data-value={row.magnitude}>
            <div className="flex items-baseline justify-between gap-2 t-callout">
              <span
                className={`min-w-0 truncate ${row.tone === "muted" ? "text-[var(--text-secondary)]" : "text-[var(--text-primary)]"}`}
              >
                {name}
                {row.sub && <span className="ml-2 text-[var(--text-faint)]">{row.sub}</span>}
              </span>
              <span className="flex-none fig text-[var(--text-secondary)]">
                {row.value}
              </span>
            </div>
            <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-[var(--border)]">
              <div
                className="bar-grow h-full rounded-full"
                style={{
                  width: `${Math.min(100, width)}%`,
                  background: colour,
                  // The house bar-grow is 0.7s after a 0.25s delay; inside a
                  // dialog that has already arrived, 0.4s from frame 0.
                  animationDuration: "400ms",
                  animationDelay: "0ms",
                }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * A figure that opens its own drill-down. Wraps whatever the caller renders
 * (a stat tile, a KPI body, a table cell) in a button that owns the open
 * state, so a server component can make a tile tappable by handing over a
 * serialisable `Drill` and nothing else.
 */
export function DrillTrigger({
  drill,
  id,
  className = "",
  children,
  ...rest
}: {
  drill: Drill;
  /** Stable handle for the deployed-page checks: rendered as data-drill-trigger. */
  id?: string;
  className?: string;
  children: ReactNode;
  /** Anything else (a `data-tile`, say) lands on the button, so a tile keeps its handle. */
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "type" | "children">) {
  const t = useTranslations("drill");
  const [open, setOpen] = useState(false);
  const [origin, setOrigin] = useState<DrillOrigin | null>(null);
  const close = useCallback(() => setOpen(false), []);
  const label = t("open", { title: drill.title });
  const openFrom = (e: MouseEvent<HTMLButtonElement>) => {
    // Captured on the click, not at render: the tile may have scrolled.
    setOrigin(drillOriginFrom(e.currentTarget));
    setOpen(true);
  };
  return (
    <>
      <button
        {...rest}
        type="button"
        onClick={openFrom}
        aria-haspopup="dialog"
        aria-label={label}
        title={label}
        data-drill-trigger={id ?? drill.title}
        className={`cursor-pointer text-left ${className}`}
      >
        {children}
      </button>
      {/* AnimatePresence keeps the dialog mounted through its exit, so Esc
          plays the entrance in reverse and a re-tap mid-exit re-targets. */}
      <AnimatePresence>
        {open && <DrillDialog drill={drill} onClose={close} origin={origin} />}
      </AnimatePresence>
    </>
  );
}
