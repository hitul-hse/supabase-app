"use client";

/**
 * A searchable multi-select over customer names, for the Projects filter bar.
 *
 * Modelled on the TrackingTime dashboard's MultiSelect (ReportFilters.tsx): a
 * pill trigger that opens a searchable popover, selected options hoisted to the
 * top, keyboard-navigable, Escape/outside-click to close. Customers key by NAME
 * here rather than id because the project ledger row carries the customer name,
 * not its id, and "(no customer)" is a real, selectable bucket.
 */

import { useEffect, useMemo, useRef, useState } from "react";

const h = (n: number) => n.toLocaleString("en-GB", { maximumFractionDigits: 0 });

export function CustomerMultiSelect({
  options,
  selected,
  onChange,
}: {
  /** Customer names with their delivered hours, biggest-first. */
  options: { name: string; hours: number }[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

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
    const matched = q ? options.filter((o) => o.name.toLowerCase().includes(q)) : options;
    // Selected first, then source (hours) order; stable, so ticking a box only
    // ever promotes — the list does not reshuffle under the cursor.
    return [
      ...matched.filter((o) => selected.has(o.name)),
      ...matched.filter((o) => !selected.has(o.name)),
    ];
  }, [options, q, selected]);

  const toggle = (name: string) => {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    onChange(next);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = Math.max(
        0,
        Math.min(filtered.length - 1, cursor + (e.key === "ArrowDown" ? 1 : -1)),
      );
      setCursor(next);
      listRef.current?.querySelectorAll("[data-option]")[next]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      const opt = filtered[cursor];
      if (opt) toggle(opt.name);
    }
  };

  const summary =
    selected.size === 0
      ? `All${options.length ? ` (${options.length})` : ""}`
      : selected.size === 1
        ? [...selected][0]
        : `${selected.size} selected`;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={`flex min-w-[9rem] max-w-[15rem] items-center justify-between gap-2 rounded-full border px-3 py-1.5 text-left text-[12px] transition-colors ${
          selected.size
            ? "border-[var(--accent)] text-[var(--text-primary)]"
            : "border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        }`}
      >
        <span className="flex flex-col leading-tight">
          <span className="font-mono text-[9px] tracking-[0.12em] text-[var(--text-faint)]">
            CUSTOMER
          </span>
          <span className="truncate">{summary}</span>
        </span>
        <span aria-hidden className="text-[9px] text-[var(--text-faint)]">
          ▼
        </span>
      </button>

      {open && (
        <div className="absolute left-0 z-30 mt-1 flex max-h-[19rem] w-[19rem] flex-col overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] card-elev-raised">
          <div className="border-b border-[var(--border)] p-2">
            <input
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setCursor(0);
              }}
              onKeyDown={onKeyDown}
              role="combobox"
              aria-expanded
              aria-controls="customer-options"
              aria-autocomplete="list"
              placeholder="Search customers…"
              className="w-full rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
            />
            <p className="mt-1 flex items-center justify-between text-[10px] text-[var(--text-faint)]">
              <span>
                {filtered.length.toLocaleString("en-GB")}
                {filtered.length !== options.length ? ` of ${options.length}` : ""}{" "}
                {options.length === 1 ? "customer" : "customers"}
                {selected.size > 0 ? ` · ${selected.size} selected` : ""}
              </span>
              <span aria-hidden>↑↓ ⏎ esc</span>
            </p>
          </div>

          <div
            ref={listRef}
            id="customer-options"
            role="listbox"
            aria-label="Customer"
            aria-multiselectable
            className="flex-1 overflow-y-auto"
          >
            {filtered.length === 0 ? (
              <p className="px-3 py-4 text-center text-[11px] text-[var(--text-faint)]">
                No customer matches “{query.trim()}”
              </p>
            ) : (
              filtered.map((o, i) => {
                const on = selected.has(o.name);
                const hot = i === cursor;
                return (
                  <button
                    key={o.name}
                    type="button"
                    role="option"
                    data-option
                    aria-selected={on}
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => toggle(o.name)}
                    className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-[12px] transition-colors ${
                      hot ? "bg-[var(--surface-hover)]" : ""
                    } ${on ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]"}`}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        aria-hidden
                        className={`flex h-3 w-3 flex-none items-center justify-center border ${
                          on
                            ? "border-[var(--accent)] bg-[var(--accent)]"
                            : "border-[var(--border)]"
                        }`}
                      >
                        {on && (
                          <svg width="8" height="8" viewBox="0 0 10 10" fill="none" stroke="var(--accent-contrast)" strokeWidth="2">
                            <path d="M1.5 5.5 4 8l4.5-6" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </span>
                      <span className="truncate">{o.name}</span>
                    </span>
                    <span className="flex-none font-mono text-[10px] tabular-nums text-[var(--text-faint)]">
                      {h(o.hours)}h
                    </span>
                  </button>
                );
              })
            )}
          </div>

          {selected.size > 0 && (
            <div className="flex items-center justify-end border-t border-[var(--border)] px-3 py-1.5">
              <button
                type="button"
                onClick={() => onChange(new Set())}
                className="text-[11px] text-[var(--text-secondary)] transition-colors hover:text-[var(--critical)]"
              >
                Clear {selected.size}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
