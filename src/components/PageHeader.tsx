import type { ReactNode } from "react";

export function PageHeader({
  title,
  meta,
  actions,
}: {
  title: string;
  meta?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-4 border-b border-[var(--border)] px-6 py-4">
      <div className="flex flex-col gap-0.5">
        <span className="text-[16.5px] font-semibold text-[var(--text-primary)]">{title}</span>
        {meta && (
          <span className="font-mono text-[11px] text-[var(--text-muted)]">{meta.toUpperCase()}</span>
        )}
      </div>
      {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
    </div>
  );
}
