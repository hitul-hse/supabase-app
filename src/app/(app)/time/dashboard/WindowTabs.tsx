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
    <div className="flex flex-col gap-3 border border-[var(--border)] bg-[var(--surface)] p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex overflow-hidden border border-[var(--border)]">
        {OPTIONS.map((o) => {
          const active = o.key === current;
          return (
            <Link
              key={o.key}
              href={`/time/dashboard?window=${o.key}`}
              // Colour alone does not convey selection to a screen reader.
              aria-current={active ? "page" : undefined}
              className={`px-3 py-1.5 text-[12px] transition-colors ${
                active
                  ? "bg-[var(--surface-hover)] font-medium text-[var(--text-primary)]"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              {o.label}
            </Link>
          );
        })}
      </div>

      <Link
        href="/time"
        className="self-start border border-[var(--border)] px-2.5 py-1.5 text-[12px] text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] sm:self-auto"
      >
        Week view →
      </Link>
    </div>
  );
}
