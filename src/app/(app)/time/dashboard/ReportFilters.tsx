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
import { useEffect, useRef, useState, useTransition } from "react";
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
 * The option list is capped at 200 rendered rows while searching. The projects
 * list is 334 entries and every one carries a customer name; rendering all of
 * them inside a popover on each keystroke is the difference between instant and
 * visibly laggy. Anything past the cap is reachable by typing.
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
  const ref = useRef<HTMLDivElement>(null);

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
  const filtered = (
    q
      ? options.filter(
          (o) =>
            o.name.toLowerCase().includes(q) ||
            (o.hint ? o.hint.toLowerCase().includes(q) : false),
        )
      : options
  ).slice(0, 200);

  const toggle = (id: number) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  const summary =
    selected.length === 0
      ? "All"
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
          role="listbox"
          aria-label={label}
          className="absolute left-0 z-30 mt-1 flex max-h-[19rem] w-[19rem] flex-col border border-[var(--border)] bg-[var(--surface)] shadow-lg"
        >
          <div className="border-b border-[var(--border)] p-2">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${label.toLowerCase()}…`}
              className="w-full border border-[var(--border)] bg-[var(--page)] px-2 py-1 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
            />
          </div>

          <div className="flex-1 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-3 py-4 text-center text-[11.5px] text-[var(--text-faint)]">
                No match
              </p>
            ) : (
              filtered.map((o) => {
                const on = selected.includes(o.id);
                return (
                  <button
                    key={o.id}
                    type="button"
                    role="option"
                    aria-selected={on}
                    onClick={() => toggle(o.id)}
                    className={`flex w-full items-start gap-2 px-3 py-1.5 text-left text-[12px] transition-colors hover:bg-[var(--surface-hover)] ${
                      on ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]"
                    }`}
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

          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="border-t border-[var(--border)] px-3 py-1.5 text-left text-[11.5px] text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
            >
              Clear {selected.length}
            </button>
          )}
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
      // Dim while the server re-renders, so it is visible that the numbers on
      // screen are the previous ones rather than the new result.
      className={`flex flex-col gap-3 border border-[var(--border)] bg-[var(--surface)] p-3 transition-opacity ${
        pending ? "opacity-60" : "opacity-100"
      }`}
    >
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
