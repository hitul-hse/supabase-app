import Link from "next/link";
import { shiftWeek } from "@/lib/queries/time";

/**
 * View switch, scope switch and week stepper.
 *
 * A Server Component built from links rather than a client component holding
 * state. The view *is* the URL, so it stays shareable, the browser back button
 * works, and no JavaScript ships for what is navigation.
 */

function Tab({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      // aria-current is what conveys selection to a screen reader; colour alone
      // does not.
      aria-current={active ? "page" : undefined}
      className={`rounded-full px-3 py-1 text-[12px] transition-colors pointer-coarse:min-h-[36px] pointer-coarse:px-3.5 ${
        active
          ? "bg-[var(--accent)] font-medium text-[var(--accent-contrast)]"
          : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
      }`}
    >
      {label}
    </Link>
  );
}

/** "17 Aug 2026", read in UTC to match how weeks and entries are stored. */
function formatDay(day: string): string {
  return new Date(`${day}T00:00:00.000Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function TimeViewTabs({
  weekStart,
  scope,
  view,
  currentWeek,
}: {
  weekStart: string;
  scope: "mine" | "team";
  /** "track" is the write surface; "records" is the read-only week list. */
  view: "records" | "track";
  /** Monday of the real current week, so "This week" can be disabled when on it. */
  currentWeek: string;
}) {
  // Every link carries the whole state. Omitting a param would reset it to its
  // default, so switching scope would silently jump back to the current week.
  const url = (next: { week?: string; scope?: string; view?: string }) =>
    `/time?${new URLSearchParams({
      week: next.week ?? weekStart,
      scope: next.scope ?? scope,
      view: next.view ?? view,
    }).toString()}`;

  const weekEnd = shiftWeek(weekStart, 1);
  // The displayed range is Monday to Sunday: shiftWeek lands on the *next*
  // Monday, so the last day of this week is six days after the first.
  const lastDay = new Date(`${weekEnd}T00:00:00.000Z`);
  lastDay.setUTCDate(lastDay.getUTCDate() - 1);
  const weekEndDisplay = lastDay.toISOString().slice(0, 10);

  const onCurrentWeek = weekStart === currentWeek;

  return (
    <div className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-3 card-elev sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-3">
        {/* Track first: logging time is the action, reading it is the report. */}
        <div className="flex flex-wrap items-center gap-0.5 rounded-full border border-[var(--border)] bg-[var(--surface-2)] p-0.5">
          <Tab href={url({ view: "track" })} label="Track" active={view === "track"} />
          <Tab href={url({ view: "records" })} label="Records" active={view === "records"} />
        </div>

        {/* Scope only means something for the records list — the tracker is
            always the signed-in member's own time, so offering "Team" there
            would imply you could start a timer for a colleague. */}
        {view === "records" && (
          <div className="flex flex-wrap items-center gap-0.5 rounded-full border border-[var(--border)] bg-[var(--surface-2)] p-0.5">
            <Tab href={url({ scope: "mine" })} label="My time" active={scope === "mine"} />
            <Tab href={url({ scope: "team" })} label="Team" active={scope === "team"} />
          </div>
        )}
      </div>

      {/* flex-wrap plus a responsive min-width on the date span. The span was a
          flat min-w-[22ch] (~220px) which CANNOT shrink, so with two arrows and
          the "This week" link the row demanded ~380px — wider than a 360px
          phone — and the trailing controls were clipped off the right edge with
          no scroll affordance. 22ch is there to stop the label reflowing as the
          date changes, which only matters once the row is on one line, so it is
          now sm:-only. */}
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={url({ week: shiftWeek(weekStart, -1) })}
          aria-label="Previous week"
          className="rounded-full border border-[var(--border)] px-3 py-1.5 font-mono text-[12px] text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text-primary)]"
        >
          ←
        </Link>

        <span className="text-center font-mono text-[11px] tabular-nums text-[var(--text-secondary)] sm:min-w-[22ch]">
          {formatDay(weekStart)} – {formatDay(weekEndDisplay)}
        </span>

        <Link
          href={url({ week: shiftWeek(weekStart, 1) })}
          aria-label="Next week"
          className="rounded-full border border-[var(--border)] px-3 py-1.5 font-mono text-[12px] text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text-primary)]"
        >
          →
        </Link>

        {/* Rendered as inert text when already on this week, rather than a link
            that looks clickable and does nothing. */}
        {onCurrentWeek ? (
          <span className="rounded-full border border-[var(--border)] px-3 py-1.5 text-[12px] text-[var(--text-faint)]">
            This week
          </span>
        ) : (
          <Link
            href={url({ week: currentWeek })}
            className="rounded-full border border-[var(--border)] px-3 py-1.5 text-[12px] text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text-primary)]"
          >
            This week
          </Link>
        )}
      </div>
    </div>
  );
}
