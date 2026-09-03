"use client";
/**
 * Filter bar for the TrackingTime Dashboard.
 *
 * A Client Component, unlike the link-based tabs elsewhere in this module. That
 * is a deliberate exception: multi-select over 334 projects needs a searchable
 * popover, which links cannot express. Everything it produces still lands in
 * the URL, so the report stays shareable and the back button still works — the
 * URL remains the source of truth, this is only a nicer way to edit it.
 *
 * `router.push` + `useTransition` rather than a form submit: the Server
 * Component re-renders with new data while the old numbers stay on screen,
 * dimmed, instead of blanking the page on every filter change.
 */
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { PRESETS, type PresetKey } from "@/lib/queries/trackingtime-report";
import { fmtInt } from "@/lib/locale-format";

type Option = { id: number; name: string; hint?: string | null };

/**
 * The dimensions this bar filters on.
 *
 * The KEY is the URL parameter and the catalogue key; it never changes with the
 * locale. Only the words the reader sees come from `timeDashboard.dimensions.*`,
 * so a German bar reads MITARBEITER / PROJEKT / KUNDE / SERVICE over exactly the
 * same query string an English one produces.
 */
const DIMENSIONS = ["member", "project", "customer", "service"] as const;
type Dimension = (typeof DIMENSIONS)[number];

/** The URL parameter each dimension writes. */
const PARAM: Record<Dimension, string> = {
  member: "members",
  project: "projects",
  customer: "customers",
  service: "services",
};

const GROUP_OPTIONS = ["member", "project", "customer", "service", "task"] as const;
const BUCKET_OPTIONS = ["day", "week", "month"] as const;

/* ----------------------------------------------------------------- toggle */

/**
 * A pressed/unpressed segment button.
 *
 * DECLARED AT MODULE SCOPE ON PURPOSE. This lived inside ReportFilters, which
 * makes it a NEW component type on every render -- React then unmounts the old
 * subtree and mounts a fresh one, so the button loses DOM state and focus on
 * each keystroke in the filter bar. Purely prop-driven (it closes over nothing
 * from the parent), so hoisting is behaviour-preserving.
 */
function Toggle({
  on,
  onClick,
  children,
  title,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      title={title}
      /* pointer-coarse:min-h-[36px] matches Segmented/FilterChip, the two
         shared capsule primitives. Without it these are ~20px tall — less than
         half the 44px iOS/WCAG target — and they are the ONLY way to change
         what the dashboard shows. Desktop keeps the dense 20px. */
      className={`rounded-full px-3 py-1 text-[12px] transition-colors pointer-coarse:min-h-[36px] pointer-coarse:px-3.5 ${
        on
          ? "bg-[var(--accent)] font-medium text-[var(--accent-contrast)]"
          : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
      }`}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------ multi-select */

/**
 * A searchable multi-select popover.
 *
 * THE OPTION LIST IS NO LONGER CAPPED AT 200. It was, for a real reason -- 334
 * projects each carrying a customer name is a lot of DOM to rebuild on every
 * keystroke -- but the cap was applied AFTER the search filter and never
 * mentioned on screen. So with an empty query the list simply stopped at 200 of
 * 334 with no scrollbar hint that anything was missing, and a project sorted
 * alphabetically past "S" could not be found by browsing at all. Two changes
 * make the cap unnecessary: the popover scrolls (it always did), and SELECTED
 * options are hoisted to the top so a long list never hides your own choices
 * below the fold.
 *
 * Keyboard support is deliberate rather than incidental: ↑/↓ move a highlight,
 * Enter toggles it, Escape closes. Without it the only way to use this control
 * is a mouse, and the whole filter bar sits above a table people drive from the
 * keyboard.
 */
function MultiSelect({
  dimension,
  options,
  selected,
  onChange,
}: {
  /** Catalogue + DOM key. Locale-independent, so the popover's ids are stable. */
  dimension: Dimension;
  options: Option[];
  selected: number[];
  onChange: (next: number[]) => void;
}) {
  const t = useTranslations("timeDashboard");
  const locale = useLocale();
  // The reader-facing name of the dimension, and the form the surrounding
  // sentences want. German capitalises nouns mid-sentence, so `lower` is not a
  // toLowerCase() of `label` -- it is its own catalogue entry.
  const label = t(`dimensions.${dimension}.label`);
  const lower = t(`dimensions.${dimension}.lower`);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Close on outside click and on Escape. Without the Escape handler a keyboard
  // user who opens this has no way to dismiss it without changing a value.
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
    // Selected first, then source order. Stable within each group, so the list
    // does not reshuffle as you tick boxes -- it only ever promotes.
    const chosen = new Set(selected);
    return [
      ...matched.filter((o) => chosen.has(o.id)),
      ...matched.filter((o) => !chosen.has(o.id)),
    ];
  }, [options, q, selected]);

  const toggle = (id: number) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  /**
   * Keyboard navigation, driven from the search input so typing and moving are
   * the same interaction. The highlight is clamped rather than wrapped: wrapping
   * from the last option back to the first, in a list of 334, loses the reader's
   * place entirely.
   */
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = Math.max(
        0,
        Math.min(filtered.length - 1, cursor + (e.key === "ArrowDown" ? 1 : -1)),
      );
      setCursor(next);
      // Keep the highlight in view. `block: "nearest"` scrolls the minimum
      // amount, so arrowing down one row does not jump the list by a screen.
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
      ? options.length
        ? t("select.allWithCount", { count: options.length })
        : t("select.all")
      : selected.length === 1
        ? (options.find((o) => o.id === selected[0])?.name ??
          t("select.nSelected", { count: 1 }))
        : t("select.nSelected", { count: selected.length });

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
            {label.toUpperCase()}
          </span>
          <span className="truncate">{summary}</span>
        </span>
        <span aria-hidden className="text-[9px] text-[var(--text-faint)]">
          ▼
        </span>
      </button>

      {open && (
        <div
          className="absolute left-0 z-30 mt-1 flex max-h-[19rem] w-[19rem] flex-col overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] card-elev-raised"
        >
          <div className="border-b border-[var(--divider)] p-2">
            <input
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                // Re-aim at the first match. Leaving the cursor where it was
                // means Enter after typing toggles whatever happened to be at
                // that index in the NEW list, which is never what was intended.
                setCursor(0);
              }}
              onKeyDown={onKeyDown}
              role="combobox"
              aria-expanded
              aria-controls={`${dimension}-options`}
              aria-autocomplete="list"
              placeholder={t("select.search", { label: lower })}
              className="w-full rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
            />
            {/* The count is the fix for the old silent 200-option cap: however
                many options there are, the number is on screen, so a list that
                scrolls past the fold never looks complete when it is not. */}
            <p className="mt-1 flex items-center justify-between text-[10px] text-[var(--text-faint)]">
              <span>
                {filtered.length !== options.length
                  ? t("select.optionsShown", {
                      shown: fmtInt(filtered.length, locale),
                      total: options.length,
                    })
                  : t("select.optionsAll", { total: options.length })}
                {selected.length > 0
                  ? ` · ${t("select.nSelected", { count: selected.length })}`
                  : ""}
              </span>
              <span aria-hidden>{t("select.keys")}</span>
            </p>
          </div>

          <div
            ref={listRef}
            id={`${dimension}-options`}
            role="listbox"
            aria-label={label}
            aria-multiselectable
            className="flex-1 overflow-y-auto"
          >
            {filtered.length === 0 ? (
              <p className="px-3 py-4 text-center text-[11px] text-[var(--text-faint)]">
                {t("select.noMatch", { label: lower, query: query.trim() })}
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
                    // Hovering moves the keyboard cursor too, so the mouse and
                    // the keyboard never disagree about which row Enter hits.
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => toggle(o.id)}
                    className={`flex w-full items-start gap-2 px-3 py-1.5 text-left text-[12px] transition-colors ${
                      hot ? "bg-[var(--surface-hover)]" : ""
                    } ${on ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]"}`}
                  >
                    <span
                      aria-hidden
                      className={`mt-[3px] flex h-3 w-3 flex-none items-center justify-center border text-[8px] ${
                        on
                          ? "border-[var(--accent)] bg-[var(--accent)] text-black"
                          : "border-[var(--border)]"
                      }`}
                    >
                      {on ? "✓" : ""}
                    </span>
                    <span className="flex min-w-0 flex-col leading-tight">
                      <span className="truncate">{o.name}</span>
                      {o.hint && (
                        <span className="truncate text-[10px] text-[var(--text-faint)]">
                          {o.hint}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })
            )}
          </div>

          <div className="flex items-center justify-between border-t border-[var(--divider)] px-3 py-1.5">
            {/* "Select these" applies to the SEARCH RESULT, not to all 334
                options. Selecting everything is identical to selecting nothing
                (both mean "no constraint"), so an unfiltered select-all would be
                a control that does nothing visible. Against a search it is the
                fast path to "these six projects". */}
            <button
              type="button"
              disabled={filtered.length === 0 || !q}
              onClick={() =>
                onChange([...new Set([...selected, ...filtered.map((o) => o.id)])])
              }
              title={
                q
                  ? t("select.selectTheseTitle", { count: filtered.length })
                  : t("select.selectTheseHint")
              }
              className="text-[11px] text-[var(--text-secondary)] transition-colors hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-[var(--text-secondary)]"
            >
              {q ? t("select.selectTheseN", { count: filtered.length }) : t("select.selectThese")}
            </button>
            <button
              type="button"
              disabled={selected.length === 0}
              onClick={() => onChange([])}
              className="text-[11px] text-[var(--text-secondary)] transition-colors hover:text-[var(--critical)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-[var(--text-secondary)]"
            >
              {selected.length > 0
                ? t("select.clearN", { count: selected.length })
                : t("select.clear")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------- bar */

export function ReportFilters({
  members,
  projects,
  customers,
  services,
  preset,
  from,
  to,
  memberIds,
  projectIds,
  customerIds,
  serviceIds,
  billable,
  includeCalendar,
  groupBy,
  bucket,
}: {
  members: Option[];
  projects: Option[];
  customers: Option[];
  services: Option[];
  preset: PresetKey;
  from: string;
  to: string;
  memberIds: number[];
  projectIds: number[];
  customerIds: number[];
  serviceIds: number[];
  billable: boolean | null;
  includeCalendar: boolean;
  groupBy: string;
  bucket: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const t = useTranslations("timeDashboard");
  const [pending, startTransition] = useTransition();

  /**
   * Push a patch onto the existing query string.
   *
   * Built from the CURRENT params rather than from props so that a change to
   * one control never resets another — the bug you get from reconstructing the
   * URL from a subset of state.
   */
  const push = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    startTransition(() => router.push(`/time/dashboard?${next.toString()}`, { scroll: false }));
  };

  const ids = (key: string) => (next: number[]) =>
    push({ [key]: next.length ? next.join(",") : null });

  const anyFilter =
    memberIds.length > 0 ||
    projectIds.length > 0 ||
    customerIds.length > 0 ||
    serviceIds.length > 0 ||
    billable !== null ||
    includeCalendar;

  return (
    <div
      // A stable hook for the gate, which asserts this bar's scroll behaviour by
      // GEOMETRY rather than by looking for a class name. That mattered when the
      // bar was sticky (`position: sticky` silently does nothing inside an ancestor
      // with `overflow: hidden`, so the class being present proved nothing) and it
      // matters now in reverse: the gate proves the bar actually scrolls AWAY, so
      // this cannot regress back to occupying the viewport.
      data-filter-bar="1"
      /**
       * NOT sticky, by request.
       *
       * It was sticky, on the reasoning that grouping by project is 334 rows and a
       * filter you have scrolled past is a filter you cannot reach. That reasoning
       * was about the tables; it ignored what a permanently parked bar does to the
       * rest of the page. This bar is tall -- two rows of pickers plus a summary
       * line -- so it held a large slice of a laptop viewport hostage on every
       * scroll, which is what the user reported.
       *
       * The filters sit at the top of the page, so scrolling back up is a wheel
       * flick rather than a hunt. That is a smaller cost than losing the vertical
       * space on every screen of a 334-row table.
       *
       * `z-20` is KEPT and still load-bearing: the pickers open downward over the
       * table below, whose headers are sticky at z-10, and without it the popovers
       * are clipped by them.
       */
      className={`z-20 flex flex-col gap-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-3 card-elev transition-opacity ${
        pending ? "opacity-70" : "opacity-100"
      }`}
    >
      {/*
       * An explicit "updating" line rather than dimming alone.
       *
       * Dimming was the only feedback, and on a fast filter change it reads as a
       * flicker while on a slow one it reads as a broken page -- in neither case
       * does it say that the numbers on screen are the PREVIOUS result. Stating
       * it costs one line and removes the ambiguity. aria-live so it is
       * announced rather than merely visible.
       */}
      <p
        aria-live="polite"
        className={`pointer-events-none absolute right-3 top-3 font-mono text-[10px] tracking-[0.12em] text-[var(--accent)] transition-opacity ${
          pending ? "opacity-100" : "opacity-0"
        }`}
      >
        {t("filters.updating")}
      </p>

      {/* Row 1 — period */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-0.5 rounded-full border border-[var(--border)] bg-[var(--surface-2)] p-0.5">
          {PRESETS.map((p) => (
            <Toggle
              key={p.key}
              on={preset === p.key}
              onClick={() => push({ preset: p.key, from: null, to: null })}
            >
              {/* PRESETS lives in the query module and carries the English label
                  the URL is keyed on; the word the reader sees comes from the
                  catalogue, keyed by the same preset key. */}
              {t(`filters.period.${p.key}`)}
            </Toggle>
          ))}
        </div>

        {/* flex-wrap: two native date inputs plus a separator have a hard
            minimum width the browser will not shrink below (~140px each on
            iOS). Without wrapping, the second input and the arrow are pushed
            off-screen at 360px with NO scroll affordance — the row simply
            appears cut off. */}
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            type="date"
            value={from}
            max={to}
            onChange={(e) => push({ preset: "custom", from: e.target.value, to })}
            aria-label={t("filters.fromDate")}
            /* text-[16px] BELOW sm, not text-[11px]. iOS Safari force-zooms the
               whole page whenever a focused input has a font-size under 16px,
               and a <input type="date"> is focused by tapping it. The page then
               stays zoomed — every other control is off-screen until the user
               pinches back out. This is the single worst mobile defect on this
               bar, and it is invisible on desktop and in devtools emulation. */
            className={`rounded-full border bg-[var(--surface-2)] px-3 py-1.5 font-mono text-[16px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] sm:text-[11px] ${
              preset === "custom" ? "border-[var(--accent)]" : "border-[var(--border)]"
            }`}
          />
          <span className="text-[11px] text-[var(--text-faint)]">→</span>
          <input
            type="date"
            value={to}
            min={from}
            onChange={(e) => push({ preset: "custom", from, to: e.target.value })}
            aria-label={t("filters.toDate")}
            className={`rounded-full border bg-[var(--surface-2)] px-3 py-1.5 font-mono text-[16px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] sm:text-[11px] ${
              preset === "custom" ? "border-[var(--accent)]" : "border-[var(--border)]"
            }`}
          />
        </div>
      </div>

      {/* Row 2 — dimensions */}
      <div className="flex flex-wrap items-center gap-2">
        {DIMENSIONS.map((dim) => (
          <MultiSelect
            key={dim}
            dimension={dim}
            options={{ member: members, project: projects, customer: customers, service: services }[dim]}
            selected={{ member: memberIds, project: projectIds, customer: customerIds, service: serviceIds }[dim]}
            onChange={ids(PARAM[dim])}
          />
        ))}

        <div className="flex flex-wrap items-center gap-0.5 rounded-full border border-[var(--border)] bg-[var(--surface-2)] p-0.5">
          <Toggle on={billable === null} onClick={() => push({ billable: null })}>
            {t("filters.billable.all")}
          </Toggle>
          <Toggle on={billable === true} onClick={() => push({ billable: "yes" })}>
            {t("filters.billable.yes")}
          </Toggle>
          <Toggle on={billable === false} onClick={() => push({ billable: "no" })}>
            {t("filters.billable.no")}
          </Toggle>
        </div>

        <Toggle
          on={includeCalendar}
          onClick={() => push({ calendar: includeCalendar ? null : "1" })}
          title={t("filters.calendar.title")}
        >
          <span>
            {includeCalendar ? "✓ " : ""}
            {t("filters.calendar.label")}
          </span>
        </Toggle>

        {anyFilter && (
          <button
            type="button"
            onClick={() =>
              push({
                members: null,
                projects: null,
                customers: null,
                services: null,
                billable: null,
                calendar: null,
              })
            }
            className="px-2.5 py-1.5 text-[12px] text-[var(--accent)] transition-opacity hover:opacity-75"
          >
            {t("filters.reset")}
          </button>
        )}
      </div>

      {/* Row 3 — presentation */}
      <div className="flex flex-wrap items-center gap-3 border-t border-[var(--divider)] pt-3">
        <span className="font-mono text-[9px] tracking-[0.12em] text-[var(--text-faint)]">
          {t("filters.groupBy")}
        </span>
        {/* flex-wrap, and this trough is WHY the bug was reported. Five pills
            (Member/Project/Customer/Service/Task) need ~350px; a 360px phone
            has ~336px of usable width inside the card padding. The parent row
            wraps, so the trough gets a full line and LOOKS like it should fit —
            but the trough itself did not wrap, so "Task" (and part of Service)
            ran off the right edge with no scrollbar and no fade. The options
            were not hidden behind a scroll: they were simply unreachable. */}
        <div className="flex flex-wrap items-center gap-0.5 rounded-full border border-[var(--border)] bg-[var(--surface-2)] p-0.5">
          {GROUP_OPTIONS.map((k) => (
            <Toggle key={k} on={groupBy === k} onClick={() => push({ group: k })}>
              {t(`dimensions.${k}.label`)}
            </Toggle>
          ))}
        </div>

        <span className="font-mono text-[9px] tracking-[0.12em] text-[var(--text-faint)]">
          {t("filters.trendLabel")}
        </span>
        <div className="flex flex-wrap items-center gap-0.5 rounded-full border border-[var(--border)] bg-[var(--surface-2)] p-0.5">
          {BUCKET_OPTIONS.map((k) => (
            <Toggle key={k} on={bucket === k} onClick={() => push({ bucket: k })}>
              {t(`filters.bucket.${k}`)}
            </Toggle>
          ))}
        </div>
      </div>
    </div>
  );
}
