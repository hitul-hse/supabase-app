"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ComponentProps, ReactNode } from "react";

/**
 * Form-control and filter vocabulary for the app shell: search boxes, selects,
 * toggle chips, and sortable column headers.
 *
 * WHY THIS EXISTS
 * ---------------
 * The audit found six different `<input>` class signatures for what is the same
 * control — three font sizes (11.5 / 12 / 12.5px) and two paddings across the
 * People search, the dashboard filters, and the admin screens. Operate mode
 * calls consistent form-control vocabulary a virtue, not a nicety: a
 * category-fluent user should never pause to work out whether two boxes that
 * look slightly different behave differently.
 *
 * THE ONE NON-OBVIOUS RULE HERE
 * -----------------------------
 * `SearchInput` renders `type="search"`, not `type="text"`. That is what gives
 * keyboard users the native Escape-to-clear, and it is why the clear button is
 * `tabIndex={-1}` — duplicating a native affordance in the tab order makes the
 * toolbar longer to traverse for exactly the people who least need it.
 */

const CONTROL_BASE =
  "rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--page)] " +
  "text-[12px] text-[var(--text-primary)] placeholder-[var(--text-muted)] " +
  "transition-colors duration-150 " +
  "hover:border-[var(--text-faint)] " +
  // No `focus:outline-none` — the global :focus-visible ring is the whole
  // keyboard-accessibility story and removing it here would be invisible.
  "focus:border-[var(--accent)] " +
  "disabled:cursor-not-allowed disabled:text-[var(--text-faint)] disabled:hover:border-[var(--border-strong)]";

export function SearchInput({
  value,
  onValueChange,
  placeholder = "Search…",
  label,
  className = "",
  ...rest
}: {
  value: string;
  onValueChange: (next: string) => void;
  placeholder?: string;
  /** Visually hidden but read aloud — a bare search box announces as "search". */
  label: string;
} & Omit<ComponentProps<"input">, "value" | "onChange" | "type">) {
  return (
    <div className={`relative flex items-center ${className}`}>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-2.5 flex text-[var(--text-muted)]"
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
          <circle cx="7" cy="7" r="4.5" />
          <path d="M10.5 10.5 14 14" strokeLinecap="round" />
        </svg>
      </span>
      <input
        {...rest}
        type="search"
        aria-label={label}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        placeholder={placeholder}
        className={`${CONTROL_BASE} w-full py-1.5 pl-8 pr-7`}
      />
      {value !== "" && (
        <button
          type="button"
          // Not in the tab order: type="search" already gives keyboard users
          // Escape-to-clear, and a second path would only lengthen the toolbar.
          tabIndex={-1}
          onClick={() => onValueChange("")}
          aria-label="Clear search"
          className="absolute right-1.5 flex h-5 w-5 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M1 1l8 8M9 1l-8 8" />
          </svg>
        </button>
      )}
    </div>
  );
}

/**
 * A plain form input, uncontrolled by default so it works inside a Server
 * Action `<form action={...}>` without lifting every keystroke into state.
 *
 * Exists because the audit found the same `border border-[var(--border)]
 * bg-[var(--page)] px-2.5 py-1.5 text-[12px] outline-none focus:border-...`
 * string copied across the leave form, the invite form and the timesheet grid —
 * each with a slightly different font size, and each carrying its own
 * `outline-none` that quietly removed the focus ring.
 */
export function TextInput({
  label,
  className = "",
  ...rest
}: {
  /** Visually-hidden accessible name. Required: a bare date input announces only "date". */
  label: string;
} & ComponentProps<"input">) {
  return (
    <input
      {...rest}
      aria-label={label}
      className={`${CONTROL_BASE} px-2.5 py-1.5 disabled:opacity-60 ${className}`}
    />
  );
}

export function Select({
  label,
  className = "",
  children,
  ...rest
}: { label: string; children: ReactNode } & Omit<ComponentProps<"select">, "children">) {
  return (
    <select {...rest} aria-label={label} className={`${CONTROL_BASE} px-2.5 py-1.5 ${className}`}>
      {children}
    </select>
  );
}

/**
 * A toggleable filter. Renders as a real `<button>` with `aria-pressed`, so it
 * announces its on/off state — a styled `<div>` with a colour change announces
 * nothing at all, and filter state is the one thing a user must be able to
 * confirm before trusting the numbers on screen.
 */
export function FilterChip({
  active,
  onToggle,
  children,
  count,
}: {
  active: boolean;
  onToggle: () => void;
  children: ReactNode;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      className={
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 " +
        "font-mono text-[10px] tracking-[0.06em] transition-colors duration-150 " +
        "pointer-coarse:min-h-[36px] pointer-coarse:px-3.5 " +
        (active
          ? "border-[var(--accent)] bg-[var(--accent-wash)] text-[var(--accent)]"
          : "border-[var(--border-strong)] text-[var(--text-secondary)] hover:border-[var(--text-faint)] hover:text-[var(--text-primary)]")
      }
    >
      {/*
        A dot, not a checkmark-vs-nothing: the shape stays constant between
        states so the chip does not change width as you toggle it, which would
        reflow the whole filter row.
      */}
      <span
        aria-hidden="true"
        className={
          "h-1.5 w-1.5 rounded-full transition-colors " +
          (active ? "bg-[var(--accent)]" : "bg-[var(--border-strong)]")
        }
      />
      {children}
      {count !== undefined && (
        <span className={active ? "text-[var(--accent)]" : "text-[var(--text-faint)]"}>{count}</span>
      )}
    </button>
  );
}

export type SortDirection = "asc" | "desc";

/**
 * A sortable column header.
 *
 * The arrow glyph is `aria-hidden`, so the sort state is carried entirely by
 * `aria-label` ("Hours, sorted descending. Activate to reverse."). Without that
 * a screen-reader user hears only the column name and cannot tell which column
 * the table is ordered by. If the caller renders a real `<th>`, it should also
 * set `aria-sort` — this button cannot, since it is inside the cell.
 */
export function SortHeader({
  label,
  columnKey,
  activeKey,
  direction,
  onSort,
  align = "left",
  className = "",
}: {
  label: string;
  columnKey: string;
  activeKey: string;
  direction: SortDirection;
  onSort: (key: string) => void;
  align?: "left" | "right";
  className?: string;
}) {
  const isActive = activeKey === columnKey;
  return (
    <button
      type="button"
      onClick={() => onSort(columnKey)}
      aria-label={
        isActive
          ? `${label}, sorted ${direction === "asc" ? "ascending" : "descending"}. Activate to reverse.`
          : `Sort by ${label}`
      }
      className={
        "group inline-flex items-center gap-1 font-mono text-[10px] tracking-[0.1em] " +
        "transition-colors duration-150 " +
        (align === "right" ? "justify-end " : "") +
        (isActive
          ? "text-[var(--accent)] "
          : "text-[var(--text-muted)] hover:text-[var(--text-primary)] ") +
        className
      }
    >
      {label}
      {/*
        Reserved width whether or not this column is the sorted one, so
        clicking between columns does not shuffle the header row sideways.
      */}
      <span aria-hidden="true" className="inline-flex w-2 justify-center">
        {isActive ? (
          <svg
            width="7"
            height="7"
            viewBox="0 0 8 8"
            fill="currentColor"
            className={direction === "asc" ? "" : "rotate-180"}
          >
            <path d="M4 0 8 6H0z" />
          </svg>
        ) : (
          <span className="opacity-0 transition-opacity group-hover:opacity-40">
            <svg width="7" height="7" viewBox="0 0 8 8" fill="currentColor">
              <path d="M4 0 8 6H0z" />
            </svg>
          </span>
        )}
      </span>
    </button>
  );
}

/* ------------------------------------------------------- searchable select */

/**
 * A searchable single-select combobox — the single-choice sibling of the
 * dashboard's MultiSelect (ReportFilters.tsx), sharing its visual language
 * (rounded-full trigger, popover on the card tokens) and its keyboard grammar
 * (↑↓ move a clamped highlight, ⏎ picks, esc closes, outside click closes).
 *
 * WHY IT EXISTS. A native <select> over 334 projects is unusable: no search,
 * and no way to browse a list that long. This keeps the native select's FORM
 * SEMANTICS — pass `name` and a hidden input posts the chosen value inside a
 * Server Action <form action={...}> exactly as the native control did — while
 * adding a filterable option list.
 *
 * Keep native <select> for tiny enum lists (roles, teams, statuses): four
 * options need no search box, and the native control is one tap on mobile.
 */
export function SearchableSelect({
  label,
  options,
  value,
  onChange,
  placeholder = "Select…",
  allowEmpty,
  name,
  disabled = false,
  className = "",
}: {
  label: string;
  options: { value: string; name: string; hint?: string }[];
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  /** A "none" choice, listed first — e.g. { value: "", name: "No project" }. */
  allowEmpty?: { value: string; name: string };
  /** When set, a hidden input posts the value, so inside a Server Action form this submits exactly like the native select it replaced. */
  name?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listId = useId();

  const all = useMemo<{ value: string; name: string; hint?: string }[]>(
    () => (allowEmpty ? [allowEmpty, ...options] : options),
    [allowEmpty, options],
  );

  // Close on outside click. Escape is handled on the input instead, so it can
  // also return focus to the trigger — a document-level listener cannot.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      q
        ? all.filter(
            (o) =>
              o.name.toLowerCase().includes(q) ||
              (o.hint ? o.hint.toLowerCase().includes(q) : false),
          )
        : all,
    [all, q],
  );

  const current = all.find((o) => o.value === value);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const pick = (v: string) => {
    onChange(v);
    close();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      // Clamped, not wrapped — same reasoning as the dashboard MultiSelect:
      // wrapping a long list loses the reader's place entirely.
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
      if (opt) pick(opt.value);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      {/* The form contract: with a `name`, this posts exactly what the native
          select it replaced would have posted — nothing else changes. */}
      {name !== undefined && <input type="hidden" name={name} value={value} />}

      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          if (open) {
            setOpen(false);
            return;
          }
          setQuery("");
          // Re-open aimed at the current choice, so Enter straight away keeps
          // it rather than jumping to whatever is first alphabetically.
          const at = all.findIndex((o) => o.value === value);
          setCursor(at >= 0 ? at : 0);
          setOpen(true);
        }}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={`flex w-full items-center justify-between gap-2 rounded-full border px-3 py-1.5 text-left text-[12px] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
          current && (!allowEmpty || value !== allowEmpty.value)
            ? "border-[var(--accent)] text-[var(--text-primary)]"
            : "border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        }`}
      >
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="font-mono text-[9px] tracking-[0.12em] text-[var(--text-faint)]">
            {label.toUpperCase()}
          </span>
          <span className="truncate">{current ? current.name : placeholder}</span>
        </span>
        <span aria-hidden className="text-[9px] text-[var(--text-faint)]">
          ▼
        </span>
      </button>

      {open && (
        <div className="absolute left-0 z-30 mt-1 flex max-h-[19rem] w-full min-w-[16rem] flex-col overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] card-elev-raised">
          <div className="border-b border-[var(--border)] p-2">
            <input
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                // Re-aim at the first match: Enter after typing must pick what
                // is visibly first, not whatever sat at the old index.
                setCursor(0);
              }}
              onKeyDown={onKeyDown}
              role="combobox"
              aria-expanded
              aria-controls={listId}
              aria-autocomplete="list"
              placeholder={`Search ${label.toLowerCase()}…`}
              className="w-full rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1 text-[12px] text-[var(--text-primary)] focus:border-[var(--accent)]"
            />
            {/* The count line: a list that scrolls past the fold must never
                look complete when it is not. */}
            <p className="mt-1 flex items-center justify-between text-[10px] text-[var(--text-faint)]">
              <span>
                {filtered.length.toLocaleString("en-GB")}
                {filtered.length !== all.length
                  ? ` of ${all.length.toLocaleString("en-GB")}`
                  : ""}{" "}
                {all.length === 1 ? "option" : "options"}
              </span>
              <span aria-hidden>↑↓ move · ⏎ pick · esc close</span>
            </p>
          </div>

          <div
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={label}
            className="flex-1 overflow-y-auto"
          >
            {filtered.length === 0 ? (
              <p className="px-3 py-4 text-center text-[11px] text-[var(--text-faint)]">
                No {label.toLowerCase()} matches “{query.trim()}”
              </p>
            ) : (
              filtered.map((o, i) => {
                const on = o.value === value;
                const hot = i === cursor;
                return (
                  <button
                    key={o.value}
                    type="button"
                    role="option"
                    data-option
                    aria-selected={on}
                    // Hovering moves the keyboard cursor too, so the mouse and
                    // the keyboard never disagree about which row Enter hits.
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => pick(o.value)}
                    className={`flex w-full items-start gap-2 px-3 py-1.5 text-left text-[12px] transition-colors ${
                      hot ? "bg-[var(--surface-hover)]" : ""
                    } ${on ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]"}`}
                  >
                    {/* A dot, not a check glyph: constant footprint, and the
                        icon-set rule bans Unicode glyphs standing in for icons. */}
                    <span
                      aria-hidden
                      className={`mt-[5px] h-1.5 w-1.5 flex-none rounded-full ${
                        on ? "bg-[var(--accent)]" : "bg-transparent"
                      }`}
                    />
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
        </div>
      )}
    </div>
  );
}
