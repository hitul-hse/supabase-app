import type { ReactNode } from "react";

/**
 * EmptyState — a composed "nothing here yet" panel.
 *
 * Every list in the app previously rendered a bare grey sentence ("No
 * comments yet."), which reads as a dead end rather than an invitation. This
 * gives an empty list a title, a line explaining what would put something
 * here, and somewhere to put the primary action.
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
        <p className="max-w-[46ch] t-callout t-loose text-[var(--text-muted)]">
          {description}
        </p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
