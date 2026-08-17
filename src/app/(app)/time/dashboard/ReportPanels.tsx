/**
 * Presentation for the TrackingTime Dashboard.
 *
 * Server Components throughout — every panel is pure formatting over data the
 * page already fetched, so there is nothing to hydrate and none of this ships
 * to the browser.
 *
 * The rule inherited from DashboardPanels.tsx and kept here: **a missing number
 * is drawn as "—", never as zero.** "No budget set" and "0% of budget consumed"
 * are different statements, and rendering the first as the second is a quiet
 * lie. Every nullable figure is checked explicitly rather than defaulted.
 */
import type {
  BudgetRow,
  GroupRow,
  Totals,
  TrendPoint,
} from "@/lib/queries/trackingtime-report";

/* ------------------------------------------------------------------ shared */

function hrs(h: number): string {
  return `${h.toLocaleString("en-GB", { maximumFractionDigits: 1 })}h`;
}

/** "12 Aug" — the year is implied by the selected period. */
function shortDate(isoDay: string): string {
  const d = new Date(`${isoDay}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return isoDay;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

function relativeDays(isoTs: string | null): string {
  if (!isoTs) return "—";
  const then = new Date(isoTs).getTime();
  if (Number.isNaN(then)) return "—";
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function Panel({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border border-[var(--border)] bg-[var(--surface)]">
      <header className="flex items-baseline justify-between gap-3 border-b border-[var(--border)] px-4 py-2.5">
        <h2 className="font-mono text-[10px] font-semibold tracking-[0.14em] text-[var(--text-primary)]">
          {title}
        </h2>
        {hint && (
          <span className="text-right text-[10.5px] leading-tight text-[var(--text-faint)]">
            {hint}
          </span>
        )}
      </header>
      {children}
    </section>
  );
}

/**
 * A horizontal magnitude bar.
 *
 * `Number.isFinite` is checked first because clamping does not survive NaN:
 * `Math.min(100, NaN)` is NaN, which renders as `width: NaN%` — invalid CSS the
 * browser drops silently, leaving a FULL-width bar that reads as 100%. A bad
 * number must render as empty, not as maximal.
 */
function Bar({ percent, tone = "accent" }: { percent: number; tone?: "accent" | "over" | "muted" }) {
  const w = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0;
  const bg =
    tone === "over" ? "var(--critical)" : tone === "muted" ? "var(--border)" : "var(--accent)";
  return (
    <div className="h-1 w-full bg-[var(--bg)]" aria-hidden>
      <div className="h-full" style={{ width: `${w}%`, background: bg }} />
    </div>
  );
}

function Th({ children, right = false }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th
      scope="col"
      className={`whitespace-nowrap px-4 py-2 font-mono text-[9.5px] font-medium tracking-[0.1em] text-[var(--text-faint)] ${
        right ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  right = false,
  mono = false,
  dim = false,
}: {
  children: React.ReactNode;
  right?: boolean;
  mono?: boolean;
  dim?: boolean;
}) {
  return (
    <td
      className={`px-4 py-2 text-[12px] ${right ? "text-right" : "text-left"} ${
        mono ? "font-mono tabular-nums" : ""
      } ${dim ? "text-[var(--text-faint)]" : "text-[var(--text-secondary)]"}`}
    >
      {children}
    </td>
  );
}

/* --------------------------------------------------------------- KPI strip */

function Kpi({
  label,
  value,
  sub,
  strong = false,
}: {
  label: string;
  value: string;
  sub?: string;
  strong?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5 border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
      <span className="font-mono text-[9px] tracking-[0.12em] text-[var(--text-faint)]">
        {label}
      </span>
      <span
        className={`font-mono tabular-nums ${
          strong ? "text-[22px] text-[var(--accent)]" : "text-[19px] text-[var(--text-primary)]"
        }`}
      >
        {value}
      </span>
      {sub && <span className="text-[10.5px] text-[var(--text-faint)]">{sub}</span>}
    </div>
  );
}

export function TotalsStrip({ totals }: { totals: Totals }) {
  // Average over ACTIVE days, not calendar days in the range. Dividing by the
  // full span would report a part-time consultant who works Tuesdays as though
  // they were idle four days a week, which is a different claim entirely.
  const perDay = totals.activeDays > 0 ? totals.totalHours / totals.activeDays : null;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <Kpi
        label="TOTAL HOURS"
        value={hrs(totals.totalHours)}
        sub={`${totals.entryCount.toLocaleString("en-GB")} entries`}
        strong
      />
      <Kpi
        label="BILLABLE"
        value={hrs(totals.billableHours)}
        sub={totals.billablePercent === null ? "—" : `${totals.billablePercent}% of logged`}
      />
      <Kpi
        label="NON-BILLABLE"
        value={hrs(Math.round((totals.nonBillableSeconds / 3600) * 10) / 10)}
        sub={
          totals.billablePercent === null ? "—" : `${100 - totals.billablePercent}% of logged`
        }
      />
      <Kpi
        label="PEOPLE"
        value={String(totals.memberCount)}
        sub={`over ${totals.activeDays} active ${totals.activeDays === 1 ? "day" : "days"}`}
      />
      <Kpi
        label="PROJECTS"
        value={String(totals.projectCount)}
        sub={`${totals.customerCount} customers`}
      />
      <Kpi
        label="AVG / ACTIVE DAY"
        value={perDay === null ? "—" : hrs(Math.round(perDay * 10) / 10)}
        sub="hours per day worked"
      />
    </div>
  );
}

/* ------------------------------------------------------------------ trend */

export function TrendChart({
  points,
  bucket,
}: {
  points: TrendPoint[];
  bucket: string;
}) {
  if (points.length === 0) return null;

  // `${bucket}LY` would render "DAYLY". Spelled out rather than derived.
  const bucketLabel =
    bucket === "day" ? "DAILY" : bucket === "month" ? "MONTHLY" : "WEEKLY";

  const max = Math.max(...points.map((p) => p.totalSeconds), 1);
  // Beyond ~60 bars the labels collide and each bar is a sliver; showing the
  // most RECENT slice is the honest truncation, since that is what a reader
  // scanning a trend cares about.
  const shown = points.slice(-60);

  return (
    <Panel
      title={`${bucketLabel} TREND`}
      hint={`${shown.length} of ${points.length} buckets · bar = total, solid = billable`}
    >
      <div className="flex items-end gap-[3px] overflow-x-auto px-4 py-4" style={{ height: 150 }}>
        {shown.map((p) => {
          const h = (p.totalSeconds / max) * 100;
          const billShare = p.totalSeconds > 0 ? (p.billableSeconds / p.totalSeconds) * 100 : 0;
          return (
            <div
              key={p.bucket}
              className="group relative flex min-w-[8px] flex-1 flex-col justify-end"
              style={{ height: "100%" }}
              // A bar chart is unreadable to a screen reader; the label carries
              // the same facts the hover tooltip shows.
              title={`${shortDate(p.bucket)} — ${hrs(p.totalHours)} total, ${hrs(p.billableHours)} billable, ${p.entryCount} entries`}
            >
              <div
                className="relative w-full bg-[var(--border)] transition-opacity group-hover:opacity-80"
                style={{ height: `${Math.max(h, 1)}%` }}
              >
                <div
                  className="absolute bottom-0 left-0 w-full bg-[var(--accent)]"
                  style={{ height: `${billShare}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between border-t border-[var(--border)] px-4 py-1.5 font-mono text-[9.5px] text-[var(--text-faint)]">
        <span>{shortDate(shown[0].bucket)}</span>
        <span>peak {hrs(Math.round((max / 3600) * 10) / 10)}</span>
        <span>{shortDate(shown[shown.length - 1].bucket)}</span>
      </div>
    </Panel>
  );
}

/* -------------------------------------------------------------- breakdown */

export function BreakdownTable({
  rows,
  dimension,
}: {
  rows: GroupRow[];
  dimension: string;
}) {
  if (rows.length === 0) return null;

  const shown = rows.slice(0, 40);

  return (
    <Panel
      title={`BY ${dimension.toUpperCase()}`}
      hint={
        rows.length > shown.length
          ? `top ${shown.length} of ${rows.length} · ranked by hours`
          : `${rows.length} ${rows.length === 1 ? "row" : "rows"} · ranked by hours`
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead className="border-b border-[var(--border)]">
            <tr>
              <Th>{dimension}</Th>
              <Th right>Hours</Th>
              <Th right>Billable</Th>
              <Th right>Bill %</Th>
              <Th right>Entries</Th>
              <Th right>Last</Th>
              <Th right>Share</Th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr
                key={r.key}
                className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-hover)]"
              >
                <td className="max-w-[26rem] px-4 py-2">
                  <div className="truncate text-[12px] text-[var(--text-primary)]">{r.label}</div>
                  {r.secondary && (
                    <div className="truncate text-[10.5px] text-[var(--text-faint)]">
                      {r.secondary}
                    </div>
                  )}
                </td>
                <Td right mono>
                  {hrs(r.totalHours)}
                </Td>
                <Td right mono>
                  {hrs(r.billableHours)}
                </Td>
                <Td right mono dim={r.billablePercent === null}>
                  {r.billablePercent === null ? "—" : `${r.billablePercent}%`}
                </Td>
                <Td right mono dim>
                  {r.entryCount}
                </Td>
                <Td right dim>
                  {relativeDays(r.lastActivityAt)}
                </Td>
                <td className="w-[9rem] px-4 py-2">
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <Bar percent={r.sharePercent} />
                    </div>
                    <span className="w-[3.2rem] text-right font-mono text-[10.5px] tabular-nums text-[var(--text-faint)]">
                      {r.sharePercent.toFixed(1)}%
                    </span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

/* ---------------------------------------------------------------- budgets */

export function BudgetTable({ rows }: { rows: BudgetRow[] }) {
  if (rows.length === 0) return null;

  const over = rows.filter((r) => r.isOver).length;
  const shown = rows.slice(0, 25);

  return (
    <Panel
      title="BUDGET BURN"
      hint={`${rows.length} projects with an estimate · ${over} over budget · projects without an estimate are omitted, not shown at 0%`}
    >
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead className="border-b border-[var(--border)]">
            <tr>
              <Th>Project</Th>
              <Th right>Budget</Th>
              <Th right>Actual</Th>
              <Th right>Remaining</Th>
              <Th right>Burn</Th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr
                key={r.projectId}
                className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-hover)]"
              >
                <td className="max-w-[24rem] px-4 py-2">
                  <div className="truncate text-[12px] text-[var(--text-primary)]">
                    {r.projectName}
                  </div>
                  {r.customerName && (
                    <div className="truncate text-[10.5px] text-[var(--text-faint)]">
                      {r.customerName}
                    </div>
                  )}
                </td>
                <Td right mono>
                  {hrs(r.estimatedHours)}
                </Td>
                <Td right mono>
                  {hrs(r.actualHours)}
                </Td>
                <td
                  className={`px-4 py-2 text-right font-mono text-[12px] tabular-nums ${
                    r.remainingHours < 0
                      ? "text-[var(--critical)]"
                      : "text-[var(--text-secondary)]"
                  }`}
                >
                  {hrs(r.remainingHours)}
                </td>
                <td className="w-[11rem] px-4 py-2">
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <Bar percent={r.burnPercent} tone={r.isOver ? "over" : "accent"} />
                    </div>
                    <span
                      className={`w-[3.8rem] text-right font-mono text-[10.5px] tabular-nums ${
                        r.isOver ? "text-[var(--critical)]" : "text-[var(--text-faint)]"
                      }`}
                    >
                      {r.burnPercent.toFixed(0)}%
                    </span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

/* ----------------------------------------------------------- entry sample */

export function RecentEntries({
  rows,
}: {
  rows: {
    id: number;
    startedAt: string;
    memberName: string;
    projectName: string | null;
    taskName: string | null;
    durationSeconds: number;
    isBillable: boolean;
  }[];
}) {
  if (rows.length === 0) return null;

  return (
    <Panel title="LATEST ENTRIES" hint={`${rows.length} most recent in this selection`}>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead className="border-b border-[var(--border)]">
            <tr>
              <Th>Date</Th>
              <Th>Member</Th>
              <Th>Project / task</Th>
              <Th right>Duration</Th>
              <Th right>Billable</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-hover)]"
              >
                <Td mono dim>
                  {shortDate(r.startedAt.slice(0, 10))}
                </Td>
                <Td>{r.memberName}</Td>
                <td className="max-w-[26rem] px-4 py-2">
                  <div className="truncate text-[12px] text-[var(--text-secondary)]">
                    {r.projectName ?? "—"}
                  </div>
                  {r.taskName && (
                    <div className="truncate text-[10.5px] text-[var(--text-faint)]">
                      {r.taskName}
                    </div>
                  )}
                </td>
                <Td right mono>
                  {hrs(Math.round((r.durationSeconds / 3600) * 10) / 10)}
                </Td>
                <td className="px-4 py-2 text-right">
                  <span
                    className={`font-mono text-[10px] ${
                      r.isBillable ? "text-[var(--accent)]" : "text-[var(--text-faint)]"
                    }`}
                  >
                    {r.isBillable ? "BILLABLE" : "—"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
