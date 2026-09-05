import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

/**
 * A segmented control: two to five mutually exclusive options, one visible as
 * chosen.
 *
 * WHY A PRIMITIVE AND NOT A ROW OF BUTTONS
 * ----------------------------------------
 * The app already had this shape in three places, hand-rolled three ways -- the
 * dashboard's range picker, the projects facets, and the people tabs -- with
 * different paddings, different active treatments, and in two cases no
 * `aria-current` at all. A row of anchors where the current one is merely a
 * lighter grey is invisible to a screen reader: it announces four identical
 * links and nothing about which is in effect.
 *
 * These are LINKS, not buttons. Every use in this app changes a URL search
 * param, so the state must survive a reload, be shareable, and work with the
 * back button. A button that mutates client state and leaves the URL alone
 * silently breaks all three.
 *
 * WHY THE TRACK IS INSET
 * ----------------------
 * The chosen segment is a filled pill on a recessed track. The alternative --
 * outlining the chosen one -- reads as "this option is disabled" against a dark
 * UI, because an outline with no fill is what every disabled control here uses.
 */

/**
 * The SKIN, exported separately from the component.
 *
 * The page-size choice in DataTable and in the Pager is segmented by shape
 * but is a `<button aria-pressed>` group: without a URL binding it is pure
 * component state, and `Segmented` is links by design (the design-system gate
 * holds it to that). It wears these classes instead, so a reader meets ONE
 * segmented dialect whether the control navigates or filters. The /my-work
 * view switch and the /projects billable trough, whose state is in the URL
 * since 2026-09-05, are real `Segmented`s with `onSelect` (below).
 *
 * `active:scale-[0.97]` is the press: feedback on pointer-down, not on release,
 * and CSS `:active` needs no JavaScript to fire on the down event.
 */
/*
 * 28px overall (APPLE_REF §5.2 "Segmented 28 px"): a 24px segment -- the
 * WCAG 2.2 / house floor for a pointer target (§8 #19) -- inside a 1px inset
 * and the track's own hairline. The segment used to be 21px tall, under the
 * floor, and the track 27.
 */
export const segmentedTrackClass =
  "inline-flex items-center gap-0.5 rounded-full border border-[var(--border)] bg-[var(--surface-2)] p-px";

export function segmentedItemClass(active: boolean): string {
  return (
    "inline-flex min-h-6 items-center rounded-full px-2.5 py-1 t-label " +
    "transition-[color,background-color,transform] duration-150 active:scale-[0.97] " +
    "pointer-coarse:min-h-[36px] pointer-coarse:px-3.5 " +
    (active
      ? "bg-[var(--accent)] text-[var(--accent-contrast)]"
      : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]")
  );
}

export function Segmented({
  options,
  current,
  ariaLabel,
  className = "",
  onSelect,
}: {
  options: { href: string; label: string }[];
  /** Matched against `option.href`, not by index -- the caller owns the URL. */
  current: string;
  ariaLabel: string;
  className?: string;
  /**
   * Handle a plain left-click IN PLACE instead of navigating.
   *
   * For a view that is a re-projection of rows already in the browser (the
   * /my-work Projects · Customers switch), a router navigation costs a full
   * server render of the page for nothing. With this set, a plain click is
   * prevented and handed to the caller, who updates its state and writes the
   * URL through url-state.ts (no round-trip, back button intact). Everything
   * else about the anchor stays real: the href is right for copy-link and
   * open-in-new-tab, modifier clicks and the middle button fall through to
   * the browser, and Enter fires the same click.
   */
  onSelect?: (href: string) => void;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      data-segmented
      className={`${segmentedTrackClass} ${className}`}
    >
      {options.map((option) => {
        const active = option.href === current;
        return (
          <Link
            key={option.href}
            href={option.href}
            scroll={false}
            aria-current={active ? "true" : undefined}
            data-active={active || undefined}
            className={segmentedItemClass(active)}
            onClick={
              onSelect
                ? (e) => {
                    // The same modifier test next/link applies before it
                    // navigates: a new-tab gesture must stay a new tab.
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                    e.preventDefault();
                    onSelect(option.href);
                  }
                : undefined
            }
          >
            {option.label}
          </Link>
        );
      })}
    </div>
  );
}

/**
 * A circular icon-only control, for the top bar.
 *
 * `label` is REQUIRED and becomes the accessible name. An icon-only button with
 * no label announces as "button" and nothing else -- which is the single most
 * common accessibility defect in a dashboard chrome, and the reference layout
 * puts three of them in a row.
 *
 * The label also renders as a native `title`, so a mouse user gets the same
 * information without a bespoke tooltip.
 */
export function IconButton({
  label,
  children,
  className = "",
  ...rest
}: {
  label: string;
  children: ReactNode;
  className?: string;
} & Omit<ComponentProps<"button">, "children" | "aria-label" | "title">) {
  return (
    <button
      {...rest}
      type={rest.type ?? "button"}
      aria-label={label}
      title={label}
      className={`inline-flex h-8 w-8 flex-none items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] transition-colors duration-150 hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] active:translate-y-px pointer-coarse:h-11 pointer-coarse:w-11 ${className}`}
    >
      {children}
    </button>
  );
}

/** The same circle as a link. A control that navigates must be an anchor. */
export function IconButtonLink({
  label,
  children,
  className = "",
  ...rest
}: {
  label: string;
  children: ReactNode;
  className?: string;
} & Omit<ComponentProps<typeof Link>, "children" | "aria-label" | "title">) {
  return (
    <Link
      {...rest}
      aria-label={label}
      title={label}
      className={`inline-flex h-8 w-8 flex-none items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] transition-colors duration-150 hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] active:translate-y-px pointer-coarse:h-11 pointer-coarse:w-11 ${className}`}
    >
      {children}
    </Link>
  );
}

/**
 * A small status pill: a delta, a score, a state.
 *
 * Tone is chosen by MEANING, never for decoration -- `good` on a figure that is
 * merely large trains people to stop reading the colour, which costs you the
 * one moment it needs to work.
 *
 * `neutral` is the default on purpose: a zero delta or an unremarkable state
 * gets no colour at all.
 */
export function Pill({
  children,
  tone = "neutral",
  className = "",
}: {
  children: ReactNode;
  tone?: "neutral" | "good" | "warning" | "critical" | "accent";
  className?: string;
}) {
  const TONES = {
    neutral:
      "border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-muted)]",
    good: "border-transparent bg-[var(--good-wash)] text-[var(--good)]",
    warning: "border-transparent bg-[var(--warning-wash)] text-[var(--warning)]",
    critical:
      "border-transparent bg-[var(--critical-wash)] text-[var(--critical)]",
    accent: "border-transparent bg-[var(--accent-wash)] text-[var(--accent)]",
  } as const;

  return (
    <span
      data-pill={tone}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 t-label ${TONES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

