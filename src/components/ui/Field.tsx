"use client";

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
  "text-[12.5px] text-[var(--text-primary)] placeholder-[var(--text-muted)] " +
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
        "font-mono text-[10.5px] tracking-[0.06em] transition-colors duration-150 " +
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
