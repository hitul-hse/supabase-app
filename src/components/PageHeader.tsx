import React from "react";

interface PageHeaderProps {
  title: string;
  meta?: string;
  category?: string;
  actions?: React.ReactNode;
}

/**
 * PageHeader — top bar for every app page.
 * On mobile: title block full-width, actions wrap below on a second row.
 * On desktop (sm+): title + actions side-by-side.
 */
export function PageHeader({ title, meta, category, actions }: PageHeaderProps) {
  return (
    <header className="flex flex-col gap-3 border-b border-[var(--border)] px-4 py-3.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-4 sm:px-6">
      <div className="flex flex-col gap-0.5 min-w-0">
        {category && (
          <span className="font-mono text-[10px] tracking-[0.12em] text-[var(--text-faint)]">
            {category}
          </span>
        )}
        <h1 className="text-[16px] font-semibold text-[var(--text-primary)] sm:text-[17px]">{title}</h1>
        {meta && (
          <span className="font-mono text-[10.5px] text-[var(--text-muted)] sm:text-[11px]">{meta}</span>
        )}
      </div>

      {actions && (
        <div className="flex flex-wrap items-center gap-2">
          {actions}
        </div>
      )}
    </header>
  );
}
