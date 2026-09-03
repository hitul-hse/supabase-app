import Link from "next/link";
import { getTranslations } from "next-intl/server";

/**
 * Time-window switch for the organisation dashboard.
 *
 * A Server Component built from links, matching TimeViewTabs: the window *is*
 * the URL, so the view stays shareable, the back button works, and no
 * JavaScript ships for what is navigation.
 *
 * The option KEYS are the URL values and stay English; only the words move into
 * the catalogue, so a German reader gets German labels on the same links.
 */

const OPTIONS = [
  { key: "4", messageKey: "window.w4" },
  { key: "12", messageKey: "window.w12" },
  { key: "26", messageKey: "window.w26" },
  { key: "52", messageKey: "window.w52" },
] as const;

export async function WindowTabs({ current }: { current: string }) {
  const t = await getTranslations("timeDashboard");
  return (
    <div className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-3 card-elev sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-0.5 rounded-full border border-[var(--border)] bg-[var(--surface-2)] p-0.5">
        {OPTIONS.map((o) => {
          const active = o.key === current;
          return (
            <Link
              key={o.key}
              href={`/time/dashboard?window=${o.key}`}
              // Colour alone does not convey selection to a screen reader.
              aria-current={active ? "page" : undefined}
              className={`rounded-full px-3 py-1 text-[12px] transition-colors pointer-coarse:min-h-[36px] pointer-coarse:px-3.5 ${
                active
                  ? "bg-[var(--accent)] font-medium text-[var(--accent-contrast)]"
                  : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
              }`}
            >
              {t(o.messageKey)}
            </Link>
          );
        })}
      </div>

      <Link
        href="/time"
        className="self-start rounded-full border border-[var(--border)] px-3 py-1.5 text-[12px] text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text-primary)] sm:self-auto"
      >
        {t("window.weekView")}
      </Link>
    </div>
  );
}
