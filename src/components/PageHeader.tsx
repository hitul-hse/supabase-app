import React from "react";

interface PageHeaderProps {
  title: string;
  meta?: string;
  category?: string;
  actions?: React.ReactNode;
}

export function PageHeader({ title, meta, category, actions }: PageHeaderProps) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--border)] px-6 py-3.5">
      <div className="flex flex-col gap-0.5">
        {category && (
          <span className="font-mono text-[10px] tracking-[0.12em] text-[var(--text-faint)]">
            {category}
          </span>
        )}
        <h1 className="text-[17px] font-semibold text-[var(--text-primary)]">{title}</h1>
        {meta && (
          <span className="font-mono text-[11px] text-[var(--text-muted)]">{meta}</span>
        )}
      </div>

      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}
