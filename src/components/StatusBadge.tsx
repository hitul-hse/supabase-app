/**
 * StatusBadge — the single source of truth for status pills.
 *
 * Task status, timesheet status and leave status each had their own inline
 * colour map (four near-identical copies), which meant "approved" rendered
 * in a different green depending on which screen you were looking at.
 * Everything routes through one tone scale here instead.
 */

export type Tone = "neutral" | "info" | "positive" | "warning" | "critical";

const TONE_CLASS: Record<Tone, string> = {
  neutral: "bg-[var(--surface-2)] text-[var(--text-muted)]",
  info: "bg-[var(--accent-wash)] text-[var(--accent)]",
  positive: "bg-[var(--good-wash)] text-[var(--good)]",
  warning: "bg-[var(--warning-wash)] text-[var(--warning)]",
  critical: "bg-[var(--critical-wash)] text-[var(--critical)]",
};

/**
 * Maps the status strings the database actually stores onto tones. Unknown
 * values fall back to neutral rather than throwing -- a status we haven't
 * seen yet should render plainly, not crash the row.
 */
const STATUS_TONE: Record<string, Tone> = {
  // leave_requests / timesheet_entries
  draft: "neutral",
  pending: "neutral",
  submitted: "warning",
  approved: "positive",
  rejected: "critical",
  // project_tasks
  "NOT STARTED": "neutral",
  "IN PROGRESS": "warning",
  "OVER 33%": "critical",
  DONE: "positive",
};

export function toneForStatus(status: string): Tone {
  return STATUS_TONE[status] ?? "neutral";
}

export function StatusBadge({
  status,
  tone,
  className = "",
}: {
  status: string;
  /** Override the derived tone when context changes the meaning. */
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.06em] ${
        TONE_CLASS[tone ?? toneForStatus(status)]
      } ${className}`}
    >
      {status}
    </span>
  );
}
