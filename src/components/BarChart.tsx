"use client";

import { useId, useState } from "react";

type Bar = { label: string; value: number };

function formatValue(n: number) {
  return n.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

export function BarChart({ title, bars }: { title: string; bars: Bar[] }) {
  const [active, setActive] = useState<number | null>(null);
  const tableId = useId();
  const max = Math.max(...bars.map((b) => b.value), 1);

  return (
    <figure className="rounded-[var(--radius)] border border-[var(--viz-border)] bg-[var(--viz-surface)] p-4">
      <div className="mb-3 flex items-center justify-between">
        <figcaption className="text-sm font-medium text-[var(--viz-text-primary)]">{title}</figcaption>
        <details className="relative">
          <summary className="cursor-pointer list-none text-xs text-[var(--viz-text-secondary)] underline">
            Table view
          </summary>
          <table id={tableId} className="mt-2 w-full text-left text-xs">
            <thead>
              <tr className="text-[var(--viz-text-secondary)]">
                <th className="py-1 pr-4">Category</th>
                <th className="py-1">Value</th>
              </tr>
            </thead>
            <tbody>
              {bars.map((b) => (
                <tr key={b.label} className="border-t border-[var(--viz-border)]">
                  <td className="py-1 pr-4 text-[var(--viz-text-primary)]">{b.label}</td>
                  <td className="py-1 text-[var(--viz-text-primary)]">{formatValue(b.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </div>

      <div className="flex flex-col gap-[2px]">
        {bars.map((b, i) => {
          const widthPct = (b.value / max) * 100;
          const isActive = active === i;
          return (
            <div
              key={b.label}
              className="relative flex items-center gap-3 rounded px-1 py-[3px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--viz-series-1)]"
              tabIndex={0}
              onPointerEnter={() => setActive(i)}
              onPointerLeave={() => setActive(null)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
            >
              <span className="w-28 shrink-0 truncate text-xs text-[var(--viz-text-secondary)]">{b.label}</span>
              <span className="relative flex-1">
                <span
                  className="block h-[16px] rounded-r-[4px] transition-opacity"
                  style={{
                    width: `${widthPct}%`,
                    minWidth: "2px",
                    backgroundColor: "var(--viz-series-1)",
                    opacity: isActive ? 0.85 : 1,
                    outline: isActive ? "2px solid var(--viz-surface)" : "none",
                    outlineOffset: "-2px",
                  }}
                />
              </span>
              <span className="w-16 shrink-0 text-right text-xs tabular-nums text-[var(--viz-text-primary)]">
                {formatValue(b.value)}
              </span>

              {isActive && (
                <div
                  role="tooltip"
                  className="absolute left-28 top-full z-10 mt-1 rounded border border-[var(--viz-border)] bg-[var(--viz-surface)] px-2 py-1 text-xs shadow-md"
                >
                  <span className="font-semibold text-[var(--viz-text-primary)]">{formatValue(b.value)}</span>
                  <span className="ml-1 text-[var(--viz-text-secondary)]">{b.label}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </figure>
  );
}
