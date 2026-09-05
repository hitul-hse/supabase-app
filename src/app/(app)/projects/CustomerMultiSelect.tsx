"use client";

/**
 * A searchable multi-select over customer names, for the Projects filter bar.
 *
 * Modelled on the TrackingTime dashboard's MultiSelect (ReportFilters.tsx): a
 * pill trigger that opens a searchable popover, selected options hoisted to the
 * top, keyboard-navigable, Escape/outside-click to close. Customers key by NAME
 * here rather than id because the project ledger row carries the customer name,
 * not its id, and NO_CUSTOMER is a real, selectable bucket.
 *
 * WORDS AND THE LOCALE ARRIVE AS PROPS, never from a next-intl hook. This
 * component is rendered inside ProjectsExplorer by
 * `scripts/check-projects-module.mjs` with `renderToStaticMarkup`, outside any
 * request: a hook would throw there and take the whole gate down rather than
 * fail one check. The explorer already holds a translator, so it resolves
 * these and hands them over -- the same contract ProjectPanels.tsx uses.
 * `displayName` exists because the customer NAME is the filter key: it stays
 * English for NO_CUSTOMER and only its rendering is translated.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { fmtNum } from "@/lib/locale-format";
import { KeyboardHint } from "@/components/ui/Field";
import { IconCaret, IconCheck } from "@/components/nav-icons";

/** Every word this control draws, resolved by the caller in the request locale. */
export type CustomerSelectLabels = {
  /** The field name above the summary. */
  field: string;
  /** Nothing picked: "All (105)", or "All" when there is nothing to count. */
  summaryAll: (total: number) => string;
  /** Several picked: "3 selected". */
  summarySelected: (count: number) => string;
  searchPlaceholder: string;
  /** "12 of 105 customers · 3 selected". */
  counts: (shown: number, total: number, selected: number) => string;
  noMatch: (query: string) => string;
  clear: (count: number) => string;
  /** The listbox's accessible name. */
  listLabel: string;
  /** How a customer name is drawn -- NO_CUSTOMER becomes "(no customer)". */
  displayName: (name: string) => string;
};

export function CustomerMultiSelect({
  options,
  selected,
  onChange,
  labels,
  locale,
}: {
  /** Customer names with their delivered hours, biggest-first. */
  options: { name: string; hours: number }[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  labels: CustomerSelectLabels;
  /** The request locale; absent means en-GB. */
  locale?: string;
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
      ? labels.summaryAll(options.length)
      : selected.size === 1
        ? labels.displayName([...selected][0])
        : labels.summarySelected(selected.size);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={`flex min-w-[9rem] max-w-[15rem] items-center justify-between gap-2 rounded-full border px-3 py-1.5 text-left text-[12px] transition-[color,border-color,transform] duration-150 active:scale-[0.97] ${
          selected.size
            ? "border-[var(--accent)] text-[var(--text-primary)]"
            : "border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        }`}
      >
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="font-mono text-[10px] tracking-[0.12em] text-[var(--text-faint)]">
            {labels.field}
          </span>
          <span className="truncate">{summary}</span>
        </span>
        <IconCaret
          className={`flex-none text-[var(--text-faint)] transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="absolute left-0 z-30 mt-1 flex max-h-[19rem] w-[19rem] flex-col overflow-hidden rounded-[var(--radius-card)] border border-[var(--border-strong)] bg-[var(--surface-raised)] card-elev-raised">
          <div className="border-b border-[var(--divider)] p-2">
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
              placeholder={labels.searchPlaceholder}
              className="w-full rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--page)] px-2.5 py-1 text-[12px] text-[var(--text-primary)] transition-colors placeholder-[var(--text-muted)] focus:border-[var(--accent)]"
            />
            <p className="mt-1 flex items-center justify-between text-[10px] text-[var(--text-faint)]">
              <span>{labels.counts(filtered.length, options.length, selected.size)}</span>
              <KeyboardHint />
            </p>
          </div>

          <div
            ref={listRef}
            id="customer-options"
            role="listbox"
            aria-label={labels.listLabel}
            aria-multiselectable
            className="flex-1 overflow-y-auto"
          >
            {filtered.length === 0 ? (
              <p className="px-3 py-4 text-center text-[11px] text-[var(--text-faint)]">
                {labels.noMatch(query.trim())}
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
                    className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-[12px] transition-colors active:translate-y-px ${
                      hot ? "bg-[var(--surface-hover)]" : ""
                    } ${on ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]"}`}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        aria-hidden
                        className={`flex h-3.5 w-3.5 flex-none items-center justify-center rounded-[var(--radius-sm)] border transition-colors ${
                          on
                            ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-contrast)]"
                            : "border-[var(--border-strong)]"
                        }`}
                      >
                        {on && <IconCheck className="h-2.5 w-2.5" />}
                      </span>
                      <span className="truncate">{labels.displayName(o.name)}</span>
                    </span>
                    <span className="flex-none font-mono text-[10px] tabular-nums text-[var(--text-faint)]">
                      {fmtNum(o.hours, locale, 0)}h
                    </span>
                  </button>
                );
              })
            )}
          </div>

          {selected.size > 0 && (
            <div className="flex items-center justify-end border-t border-[var(--divider)] px-3 py-1.5">
              <button
                type="button"
                onClick={() => onChange(new Set())}
                className="text-[11px] text-[var(--text-secondary)] transition-[color,transform] duration-150 hover:text-[var(--text-primary)] active:translate-y-px"
              >
                {labels.clear(selected.size)}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
