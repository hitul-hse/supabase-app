import type { TimeEntryRow } from "@/lib/queries/time";
import { formatSeconds } from "@/lib/time-transform";
import { Card } from "@/components/ui/Card";

/**
 * The tracked-interval list — TrackingTime's day view, one section per day.
 *
 * A Server Component on purpose: this is read-only text, so making it a client
 * component would ship the whole week to the browser a second time for no
 * interaction.
 */

/** "07:30" from an ISO timestamp, read in UTC to match how entries are stored. */
function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

function formatDayHeading(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

function Pill({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "billable" | "billed" | "calendar" | "running";
}) {
  const tones: Record<string, string> = {
    billable: "border-[var(--accent)] text-[var(--accent)]",
    billed: "border-[var(--border-strong)] text-[var(--text-muted)]",
    calendar: "border-[var(--border-strong)] text-[var(--text-muted)]",
    running: "border-[#4ade80] text-[#4ade80]",
  };
  return (
    <span
      className={`border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

function EntryRow({ e, showMember }: { e: TimeEntryRow; showMember: boolean }) {
  // `isRunning` is resolved once in the query layer rather than re-derived from
  // ended_at in each component, so the list and the totals cannot disagree
  // about whether a timer is still going.
  const isRunning = e.isRunning;

  return (
    <li className="flex flex-col gap-2 px-4 py-3 transition-colors hover:bg-[var(--surface-hover)] sm:flex-row sm:items-center sm:gap-4">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-[12px] text-[var(--text-primary)]">
            {/* A calendar placeholder legitimately has no task name. "Untitled"
                is honest; a blank cell reads as a rendering failure. */}
            {e.taskName ?? "Untitled entry"}
          </span>
          {isRunning && <Pill tone="running">running</Pill>}
          {e.isBillable && <Pill tone="billable">billable</Pill>}
          {e.isBilled && <Pill tone="billed">invoiced</Pill>}
          {e.isCalendar && <Pill tone="calendar">calendar</Pill>}
        </div>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] text-[var(--text-muted)]">
          {showMember && <span>{e.memberName}</span>}
          {/* Untagged time is structural, not a tagging failure: every entry
              with no customer and no project is a calendar placeholder
              (docs/architecture/DISCOVERY-trackingtime.md). Say so. */}
          <span>{e.customerName ?? "No customer"}</span>
          <span>/</span>
          <span>{e.projectName ?? "No project"}</span>
          {e.serviceName && (
            <>
              <span>/</span>
              <span>{e.serviceName}</span>
            </>
          )}
        </div>

        {e.notes && (
          <p className="line-clamp-2 text-[11px] leading-relaxed text-[var(--text-muted)]">
            {e.notes}
          </p>
        )}
      </div>

      <div className="flex items-center gap-4 font-mono text-[11px] tabular-nums text-[var(--text-secondary)]">
        <span>
          {clock(e.startedAt)}
          {" – "}
          {e.endedAt ? clock(e.endedAt) : "…"}
        </span>
        <span className="min-w-[5ch] text-right text-[13px] font-semibold text-[var(--text-primary)]">
          {/* Already formatted in the query layer, where "—" is chosen for a
              running timer: "0:00" would read as "you logged nothing". */}
          {e.duration}
        </span>
      </div>
    </li>
  );
}

export function TimeEntryList({
  days,
  showMember = false,
}: {
  days: { date: string; entries: TimeEntryRow[]; totalSeconds: number }[];
  /** Only meaningful in team scope; a column of your own name is noise. */
  showMember?: boolean;
}) {
  // groupByDay returns all seven days so the week keeps its shape. Days with
  // nothing tracked are dropped from the list rather than rendered as seven
  // empty cards, which would bury the days that have work in them.
  const populated = days.filter((d) => d.entries.length > 0);

  return (
    <div className="flex flex-col gap-[var(--card-gap)]">
      {populated.map((day) => {
        // A day whose only entry is a running timer has a total of zero finished
        // seconds. Rendering "0:00" there says "you logged nothing today" while
        // the clock is actually running, so it gets the same dash the entry row
        // uses. Zero with no timer running really is zero and stays "0:00".
        const onlyRunning = day.totalSeconds === 0 && day.entries.some((e) => e.isRunning);

        return (
          // A day is an aggregate with its own heading and its own total, so
          // each day is its own card. The rows inside are rows, not cards --
          // nesting is banned and would double every border.
          <Card key={day.date}>
            <div className="flex items-center justify-between border-b border-[var(--divider)] px-4 py-2">
              <span className="text-[12px] font-medium text-[var(--text-primary)]">
                {formatDayHeading(day.date)}
              </span>
              <span className="font-mono text-[11px] tabular-nums text-[var(--text-secondary)]">
                {onlyRunning ? "—" : formatSeconds(day.totalSeconds)}
              </span>
            </div>

            <ul className="divide-y divide-[var(--divider)]">
              {day.entries.map((e) => (
                <EntryRow key={e.id} e={e} showMember={showMember} />
              ))}
            </ul>
          </Card>
        );
      })}
    </div>
  );
}
