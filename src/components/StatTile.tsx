type Tone = "default" | "good" | "critical" | "warning";

const TONE_COLOR: Record<Tone, string> = {
  default: "var(--text-primary)",
  good: "var(--good)",
  critical: "var(--critical)",
  warning: "var(--warning)",
};

export function StatTile({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: Tone;
}) {
  return (
    <div className="flex flex-col gap-1.5 border-r border-[var(--viz-border)] p-3.5 last:border-r-0">
      <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--viz-text-secondary)]">
        {label.toUpperCase()}
      </span>
      <span
        className="font-mono text-[25px] font-semibold leading-none tracking-tight"
        style={{ color: TONE_COLOR[tone] }}
      >
        {value}
      </span>
      {sub && (
        <span className="font-mono text-[11px] text-[var(--viz-text-secondary)]">{sub}</span>
      )}
    </div>
  );
}
