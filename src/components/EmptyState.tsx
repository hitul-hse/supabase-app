import type { ReactNode } from "react";

/**
 * EmptyState — a composed "nothing here yet" panel.
 *
 * Every list in the app previously rendered a bare grey sentence ("No
 * comments yet."), which reads as a dead end rather than an invitation. This
 * gives an empty list a title, a line explaining what would put something
 * here, and somewhere to put the primary action.
 *
 * THE COPY IS CAPPED (APPLE_REF §5.9, §8 #28): title one line, description
 * ≤ 2 lines and ≤ 140 characters, one action. The measure is 70ch so that two
 * lines hold the full 140 -- at the previous 46ch a capped description still
 * wrapped to three. Callers own the length; the frame stays because it holds
 * the slot's geometry the way a skeleton does.
 */
export function EmptyState({
  title,
  description,
  action,
  className = "",
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col items-center gap-2 rounded-[var(--radius-card)] border border-dashed border-[var(--border-strong)] px-6 py-10 text-center ${className}`}
    >
      <p className="t-headline text-[var(--text-primary)]">{title}</p>
      {description && (
        <p className="max-w-[70ch] t-callout t-loose text-[var(--text-muted)]">
          {description}
        </p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
