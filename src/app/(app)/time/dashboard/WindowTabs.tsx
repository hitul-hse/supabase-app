import Link from "next/link";

/**
 * Time-window switch for the organisation dashboard.
 *
 * A Server Component built from links, matching TimeViewTabs: the window *is*
 * the URL, so the view stays shareable, the back button works, and no
 * JavaScript ships for what is navigation.
 */

const OPTIONS = [
  { key: "4", label: "4 weeks" },
  { key: "12", label: "12 weeks" },
  { key: "26", label: "6 months" },
  { key: "52", label: "12 months" },
] as const;

export function WindowTabs({ current }: { current: string }) {
  return (
    <div className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-3 card-elev sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-0.5 rounded-full border border-[var(--border)] bg-[var(--surface-2)] p-0.5">
        {OPTIONS.map((o) => {
          const active = o.key === current;
          return (
            <Link
              key={o.key}
              href={`/time/dashboard?window=${o.key}`}
              // Colour alone does not convey selection to a screen reader.
              aria-current={active ? "page" : undefined}
              className={`rounded-full px-3 py-1 text-[12px] transition-colors ${
                active
                  ? "bg-[var(--accent)] font-medium text-[var(--accent-contrast)]"
                  : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
              }`}
            >
              {o.label}
            </Link>
          );
        })}
      </div>

      <Link
        href="/time"
        className="self-start rounded-full border border-[var(--border)] px-3 py-1.5 text-[12px] text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text-primary)] sm:self-auto"
      >
        Week view →
      </Link>
    </div>
  );
}
