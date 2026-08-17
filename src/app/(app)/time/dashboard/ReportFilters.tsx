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
import { PRESETS, type PresetKey } from "@/lib/queries/trackingtime-report";

type Option = { id: number; name: string; hint?: string | null };

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
      className={`px-2.5 py-1.5 text-[12px] transition-colors ${
        on
          ? "bg-[var(--surface-hover)] font-medium text-[var(--text-primary)]"
          : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
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
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: Option[];
  selected: number[];
  onChange: (next: number[]) => void;
}) {
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
      ? `All ${options.length ? `(${options.length})` : ""}`.trim()
      : selected.length === 1
        ? (options.find((o) => o.id === selected[0])?.name ?? "1 selected")
        : `${selected.length} selected`;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={`flex min-w-[9rem] max-w-[14rem] items-center justify-between gap-2 border px-2.5 py-1.5 text-left text-[12px] transition-colors ${
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
          className="absolute left-0 z-30 mt-1 flex max-h-[19rem] w-[19rem] flex-col border border-[var(--border)] bg-[var(--surface)] shadow-lg"
        >
          <div className="border-b border-[var(--border)] p-2">
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
              aria-controls={`${label}-options`}
              aria-autocomplete="list"
              placeholder={`Search ${label.toLowerCase()}…`}
              className="w-full border border-[var(--border)] bg-[var(--page)] px-2 py-1 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
            />
            {/* The count is the fix for the old silent 200-option cap: however
                many options there are, the number is on screen, so a list that
                scrolls past the fold never looks complete when it is not. */}
            <p className="mt-1 flex items-center justify-between text-[10px] text-[var(--text-faint)]">
              <span>
                {filtered.length.toLocaleString("en-GB")}
                {filtered.length !== options.length
                  ? ` of ${options.length.toLocaleString("en-GB")}`
                  : ""}{" "}
                {options.length === 1 ? "option" : "options"}
                {selected.length > 0 ? ` · ${selected.length} selected` : ""}
              </span>
              <span aria-hidden>↑↓ move · ⏎ pick · esc close</span>
            </p>
          </div>

          <div
            ref={listRef}
            id={`${label}-options`}
            role="listbox"
            aria-label={label}
            aria-multiselectable
            className="flex-1 overflow-y-auto"
          >
            {filtered.length === 0 ? (
              <p className="px-3 py-4 text-center text-[11.5px] text-[var(--text-faint)]">
                No {label.toLowerCase()} matches “{query.trim()}”
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

          <div className="flex items-center justify-between border-t border-[var(--border)] px-3 py-1.5">
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
                  ? `Add all ${filtered.length} matches to the selection`
                  : "Search first — selecting every option is the same as selecting none"
              }
              className="text-[11.5px] text-[var(--text-secondary)] transition-colors hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-[var(--text-secondary)]"
            >
              Select these {q ? filtered.length : ""}
            </button>
            <button
              type="button"
              disabled={selected.length === 0}
              onClick={() => onChange([])}
              className="text-[11.5px] text-[var(--text-secondary)] transition-colors hover:text-[var(--critical)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-[var(--text-secondary)]"
            >
              Clear {selected.length > 0 ? selected.length : ""}
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
      // A stable hook for the gate, which asserts stickiness by GEOMETRY rather
      // than by looking for a class name: `position: sticky` silently does
      // nothing inside an ancestor that sets `overflow: hidden`, so the class
      // being present proves nothing about the behaviour.
      data-filter-bar="1"
      /**
       * STICKY, because the tables below it are long. Grouping by project over
       * live data is 334 rows: by the time you have scrolled to a row worth
       * asking about, every control that could narrow the report is off-screen,
       * and the only way back is to scroll to the top and lose your place. It
       * stays reachable instead.
       *
       * `z-20` sits above the sticky table headers (z-10) so the popovers, which
       * open downward over the first rows, are not clipped by them.
       */
      //
      // No `relative` alongside `sticky`: both set `position`, so Tailwind would
      // emit two competing declarations. `position: sticky` already establishes a
      // containing block, which is what the absolutely-placed indicator needs.
      //
      // `top-12` on mobile, `top-0` from lg: MobileSidebar renders a FIXED 48px
      // (h-12) top bar below lg, so sticking to 0 would park the whole filter bar
      // underneath it -- visible in a screenshot only as controls that vanish
      // halfway through a scroll. The breakpoint matches the one that hides that
      // bar.
      className={`sticky top-12 z-20 flex flex-col gap-3 border border-[var(--border)] bg-[var(--surface)] p-3 shadow-[0_6px_16px_-12px_rgba(0,0,0,0.9)] transition-opacity lg:top-0 ${
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
        className={`pointer-events-none absolute right-3 top-3 font-mono text-[9.5px] tracking-[0.12em] text-[var(--accent)] transition-opacity ${
          pending ? "opacity-100" : "opacity-0"
        }`}
      >
        UPDATING…
      </p>

      {/* Row 1 — period */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap overflow-hidden border border-[var(--border)]">
          {PRESETS.map((p) => (
            <Toggle
              key={p.key}
              on={preset === p.key}
              onClick={() => push({ preset: p.key, from: null, to: null })}
            >
              {p.label}
            </Toggle>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={from}
            max={to}
            onChange={(e) => push({ preset: "custom", from: e.target.value, to })}
            aria-label="From date"
            className={`border bg-[var(--page)] px-2 py-1.5 font-mono text-[11.5px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] ${
              preset === "custom" ? "border-[var(--accent)]" : "border-[var(--border)]"
            }`}
          />
          <span className="text-[11px] text-[var(--text-faint)]">→</span>
          <input
            type="date"
            value={to}
            min={from}
            onChange={(e) => push({ preset: "custom", from, to: e.target.value })}
            aria-label="To date"
            className={`border bg-[var(--page)] px-2 py-1.5 font-mono text-[11.5px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] ${
              preset === "custom" ? "border-[var(--accent)]" : "border-[var(--border)]"
            }`}
          />
        </div>
      </div>

      {/* Row 2 — dimensions */}
      <div className="flex flex-wrap items-center gap-2">
        <MultiSelect label="Member" options={members} selected={memberIds} onChange={ids("members")} />
        <MultiSelect label="Project" options={projects} selected={projectIds} onChange={ids("projects")} />
        <MultiSelect label="Customer" options={customers} selected={customerIds} onChange={ids("customers")} />
        <MultiSelect label="Service" options={services} selected={serviceIds} onChange={ids("services")} />

        <div className="flex overflow-hidden border border-[var(--border)]">
          <Toggle on={billable === null} onClick={() => push({ billable: null })}>
            All
          </Toggle>
          <Toggle on={billable === true} onClick={() => push({ billable: "yes" })}>
            Billable
          </Toggle>
          <Toggle on={billable === false} onClick={() => push({ billable: "no" })}>
            Non-bill.
          </Toggle>
        </div>

        <Toggle
          on={includeCalendar}
          onClick={() => push({ calendar: includeCalendar ? null : "1" })}
          title="Calendar placeholders are 34% of imported events and almost never billable. Off by default so they cannot inflate a billable ratio."
        >
          <span className="border border-[var(--border)] px-2 py-1">
            {includeCalendar ? "✓ " : ""}Calendar time
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
            Reset filters
          </button>
        )}
      </div>

      {/* Row 3 — presentation */}
      <div className="flex flex-wrap items-center gap-3 border-t border-[var(--border)] pt-3">
        <span className="font-mono text-[9px] tracking-[0.12em] text-[var(--text-faint)]">
          GROUP BY
        </span>
        <div className="flex overflow-hidden border border-[var(--border)]">
          {[
            ["member", "Member"],
            ["project", "Project"],
            ["customer", "Customer"],
            ["service", "Service"],
            ["task", "Task"],
          ].map(([k, l]) => (
            <Toggle key={k} on={groupBy === k} onClick={() => push({ group: k })}>
              {l}
            </Toggle>
          ))}
        </div>

        <span className="font-mono text-[9px] tracking-[0.12em] text-[var(--text-faint)]">
          TREND
        </span>
        <div className="flex overflow-hidden border border-[var(--border)]">
          {[
            ["day", "Daily"],
            ["week", "Weekly"],
            ["month", "Monthly"],
          ].map(([k, l]) => (
            <Toggle key={k} on={bucket === k} onClick={() => push({ bucket: k })}>
              {l}
            </Toggle>
          ))}
        </div>
      </div>
    </div>
  );
}
