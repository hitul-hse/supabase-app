import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

/**
 * The single button vocabulary for the app shell — use this instead of hand-
 * rolling `border border-[var(--border-strong)] px-3 py-1.5 ...` again.
 *
 * WHY THIS EXISTS
 * ---------------
 * An audit of every TSX file in `src/app` and `src/components` found **99
 * distinct button-ish class signatures** and no shared primitive. That is the
 * exact failure Operate mode names: "if the save button looks different in two
 * places, one is wrong". Concretely, three different paddings and four
 * different font sizes were all in use for the same "secondary action" job.
 *
 * WHAT IT GUARANTEES THAT AD-HOC CLASSES DID NOT
 * ----------------------------------------------
 * Every interactive control needs default / hover / focus / active / disabled,
 * and the hand-rolled ones shipped roughly half of that set each. This ships
 * all of them once:
 *   - `disabled:` styling AND `aria-disabled`, so assistive tech agrees with
 *     the pixels.
 *   - `active:` translate, so a click is acknowledged on touch where there is
 *     no hover to feel.
 *   - focus is left to the global `:focus-visible` ring in globals.css. Do NOT
 *     add `focus:outline-none` here; that is what silently removes the ring.
 *
 * A note on `busy`: it renders a spinner AND sets `aria-busy`, but deliberately
 * keeps the label mounted at `opacity-0` rather than swapping the text out. A
 * button that changes width mid-submit shifts everything beside it, and on a
 * dense toolbar that reflow is more disorienting than the wait.
 */

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  // The one accent-filled control. Reserved for the single primary action on a
  // surface — Operate mode: accent means "primary action / current selection",
  // never decoration.
  primary:
    "bg-[var(--accent)] text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)] " +
    "disabled:bg-[var(--surface-2)] disabled:text-[var(--text-faint)]",
  secondary:
    "border border-[var(--border-strong)] bg-transparent text-[var(--text-primary)] " +
    "hover:bg-[var(--surface-hover)] hover:border-[var(--accent)] " +
    "disabled:border-[var(--border)] disabled:text-[var(--text-faint)] disabled:hover:bg-transparent",
  ghost:
    "bg-transparent text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] " +
    "hover:text-[var(--text-primary)] disabled:text-[var(--text-faint)] disabled:hover:bg-transparent",
  // Destructive actions get --critical-wash rather than a solid fill: a solid
  // red block reads as an error that has already happened, not an action.
  danger:
    "border border-[var(--critical)] bg-[var(--critical-wash)] text-[var(--critical)] " +
    "hover:bg-[var(--critical)] hover:text-[var(--accent-contrast)] " +
    "disabled:border-[var(--border)] disabled:bg-transparent disabled:text-[var(--text-faint)]",
};

const SIZES: Record<Size, string> = {
  // 24px: `t-subhead` 14 plus py-1 is 22, under the WCAG 2.2 / house floor
  // for a pointer target (APPLE_REF §3.2 "Control heights": "decision raises
  // `sm` from ~22 to 24"; §5.4 pager controls 24 min). The floor, not more
  // padding, so the label keeps its optical centre.
  sm: "px-2.5 py-1 t-subhead gap-1.5 min-h-6",
  // 32px min-height. Not a full 44px: this is a dense desktop tool with tables
  // of hundreds of rows, and the pointer-coarse bump below covers touch.
  md: "px-3 py-1.5 t-callout gap-2 min-h-[32px]",
};

const BASE =
  "inline-flex items-center justify-center rounded-[var(--radius-sm)] font-medium " +
  "transition-colors duration-150 " +
  "active:translate-y-px " +
  "disabled:cursor-not-allowed disabled:active:translate-y-0 " +
  // Coarse pointers get a real 44px target without inflating the desktop UI.
  "pointer-coarse:min-h-[44px] pointer-coarse:px-4";

export function buttonClass(variant: Variant = "secondary", size: Size = "md", extra = "") {
  return `${BASE} ${SIZES[size]} ${VARIANTS[variant]} ${extra}`.trim();
}

export function Button({
  variant = "secondary",
  size = "md",
  busy = false,
  className = "",
  children,
  disabled,
  ...rest
}: {
  variant?: Variant;
  size?: Size;
  busy?: boolean;
  children: ReactNode;
} & Omit<ComponentProps<"button">, "children">) {
  const isDisabled = disabled || busy;
  return (
    <button
      {...rest}
      disabled={isDisabled}
      // Both, on purpose: `disabled` removes it from the tab order, and
      // `aria-disabled` is what a screen reader announces if a wrapper ever
      // re-enables focus.
      aria-disabled={isDisabled || undefined}
      aria-busy={busy || undefined}
      className={`relative ${buttonClass(variant, size, className)}`}
    >
      {busy && (
        <span
          aria-hidden="true"
          className="absolute inset-0 flex items-center justify-center"
        >
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
        </span>
      )}
      {/* Kept mounted so the button cannot change width mid-submit. */}
      <span className={busy ? "invisible" : "contents"}>{children}</span>
    </button>
  );
}

/** The same vocabulary for navigation. A link that looks like a button must BE a link. */
export function ButtonLink({
  variant = "secondary",
  size = "md",
  className = "",
  children,
  ...rest
}: {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
} & Omit<ComponentProps<typeof Link>, "children">) {
  return (
    <Link {...rest} className={buttonClass(variant, size, className)}>
      {children}
    </Link>
  );
}
