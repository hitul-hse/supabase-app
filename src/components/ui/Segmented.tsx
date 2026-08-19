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
export function Segmented({
  options,
  current,
  ariaLabel,
  className = "",
}: {
  options: { href: string; label: string }[];
  /** Matched against `option.href`, not by index -- the caller owns the URL. */
  current: string;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      data-segmented
      className={`inline-flex items-center gap-0.5 rounded-full border border-[var(--border)] bg-[var(--surface-2)] p-0.5 ${className}`}
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
            className={`rounded-full px-2.5 py-1 font-mono text-[10px] font-medium tracking-[0.04em] transition-colors duration-150 pointer-coarse:min-h-[36px] pointer-coarse:px-3.5 ${
              active
                ? "bg-[var(--accent)] text-[var(--accent-contrast)]"
                : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
            }`}
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
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] font-medium tracking-[0.02em] ${TONES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

