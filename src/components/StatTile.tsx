export function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius)] border border-[var(--viz-border)] bg-[var(--viz-surface)] p-4">
      <div className="text-sm text-[var(--viz-text-secondary)]">{label}</div>
      <div className="mt-1 text-3xl font-semibold text-[var(--viz-text-primary)]">{value}</div>
    </div>
  );
}
