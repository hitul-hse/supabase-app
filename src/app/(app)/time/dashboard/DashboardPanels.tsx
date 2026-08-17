/**
 * Presentation for the organisation Time dashboard.
 *
 * Server components throughout — every panel is pure formatting over data the
 * page already fetched, so there is nothing to hydrate and no reason to ship
 * this to the browser.
 *
 * One rule runs through all of it: **a missing number is drawn as "—", never as
 * zero.** "No budget set" and "0% of budget burned" are different statements,
 * and a dashboard that renders the first as the second is lying quietly. Every
 * nullable figure below is checked explicitly rather than defaulted.
 */
import type {
  CustomerSummaryRow,
  MemberUtilisationRow,
  OrgTotals,
  OrgWeekRow,
  ProjectEconomicsRow,
  ProjectSummaryRow,
  ServiceSummaryRow,
} from "@/lib/queries/time-dashboard";

/* ------------------------------------------------------------------ shared */

/** Hours, one decimal, with a thin space before the unit. */
function hrs(h: number): string {
  return `${h.toLocaleString("en-GB", { maximumFractionDigits: 1 })}h`;
}

/** Euro, no decimals — cents are noise at organisation scale. */
function eur(v: number): string {
  return `€${Math.round(v).toLocaleString("en-GB")}`;
}

/** "12 Aug" for a week label; the year is implied by the axis. */
function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

/** "3 days ago" / "—". Relative beats absolute for a staleness signal. */
function relativeDays(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
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
 * A horizontal magnitude bar. Width is a share of the row's own maximum.
 *
 * `Number.isFinite` first, because clamping does not survive NaN:
 * `Math.min(100, NaN)` is NaN, which renders as `width: NaN%` — invalid CSS
 * that the browser drops silently, leaving a full-width bar that looks like
 * 100%. A bad number must read as empty, not as maximal.
 */
function Bar({ percent, muted = false }: { percent: number; muted?: boolean }) {
  const w = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0;
  return (
    <div className="h-1 w-full bg-[var(--border)]">
      <div
        className={muted ? "h-full bg-[var(--text-faint)]" : "h-full bg-[var(--accent)]"}
        style={{ width: `${w}%` }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ totals */

export function OrgTotalsStrip({ totals }: { totals: OrgTotals }) {
  const tiles: { label: string; value: string; sub: string; accent?: boolean }[] = [
    {
      label: "LOGGED",
      value: hrs(totals.totalHours),
      sub: `${totals.entryCount.toLocaleString("en-GB")} entries`,
    },
    {
      label: "BILLABLE",
      value: hrs(totals.billableHours),
      // Denominator is ALL logged time, including calendar placeholders. Some
      // calendar entries are also flagged billable, so dividing by tracked-only
      // produced >100%. See summariseOrgWeeks.
      sub: totals.billablePercent === null ? "—" : `${totals.billablePercent}% of logged`,
      accent: true,
    },
    {
      label: "CALENDAR",
      value: hrs(Math.round((totals.calendarSeconds / 3600) * 10) / 10),
      sub: "placeholders, excluded",
    },
    {
      label: "PEOPLE",
      value: String(totals.activeMembers),
      sub: "peak active in a week",
    },
    {
      label: "PROJECTS",
      value: String(totals.activeProjects),
      sub: "peak active in a week",
    },
    {
      label: "WINDOW",
      value: `${totals.weeksCovered}w`,
      sub: "weeks with activity",
    },
  ];

  return (
    <div className="grid grid-cols-2 border border-[var(--border)] bg-[var(--surface)] sm:grid-cols-3 lg:grid-cols-6">
      {tiles.map((t) => (
        <div
          key={t.label}
          className="flex flex-col gap-1 border-b border-r border-[var(--border)] px-4 py-3 last:border-r-0 lg:border-b-0"
        >
          <span className="font-mono text-[9.5px] tracking-[0.12em] text-[var(--text-faint)]">
            {t.label}
          </span>
          <span
            className={`font-mono text-[19px] font-semibold tabular-nums ${
              t.accent ? "text-[var(--accent)]" : "text-[var(--text-primary)]"
            }`}
          >
            {t.value}
          </span>
          <span className="text-[11px] text-[var(--text-muted)]">{t.sub}</span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------- trend */

/**
 * Weekly trend as stacked columns: billable filled, the rest outlined.
 *
 * Deliberately CSS rather than a chart library — six dependencies to draw
 * twelve rectangles is a poor trade, and this renders on the server with no
 * hydration cost. Heights are a share of the tallest week, so the shape is
 * honest even though the axis is unlabelled.
 *
 * A div-based chart is *invisible data* to a screen reader: the shape carries
 * the whole message and none of it is text. The same figures are therefore also
 * emitted as a visually-hidden table, which costs nothing to render and makes
 * the panel readable rather than merely decorative.
 */
export function WeeklyTrend({ weeks }: { weeks: OrgWeekRow[] }) {
  if (weeks.length === 0) return null;

  const peak = Math.max(...weeks.map((w) => w.totalSeconds), 1);

  return (
    <Panel
      title="WEEKLY TREND"
      hint={`${weeks.length} weeks · billable filled, non-billable outlined`}
    >
      <table className="sr-only">
        <caption>Weekly logged and billable hours</caption>
        <thead>
          <tr>
            <th scope="col">Week starting</th>
            <th scope="col">Logged hours</th>
            <th scope="col">Billable hours</th>
            <th scope="col">People active</th>
          </tr>
        </thead>
        <tbody>
          {weeks.map((w) => (
            <tr key={w.weekStart}>
              <td>{w.weekStart}</td>
              <td>{hrs(w.totalHours)}</td>
              <td>{hrs(w.billableHours)}</td>
              <td>{w.activeMembers}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div aria-hidden className="flex items-end gap-1.5 overflow-x-auto px-4 pb-3 pt-5 sm:gap-2">
        {weeks.map((w) => {
          const totalPct = (w.totalSeconds / peak) * 100;
          const billablePct = w.totalSeconds > 0 ? (w.billableSeconds / w.totalSeconds) * 100 : 0;
          return (
            <div key={w.weekStart} className="flex min-w-[34px] flex-1 flex-col items-center gap-1.5">
              <span className="font-mono text-[9px] tabular-nums text-[var(--text-faint)]">
                {Math.round(w.totalHours)}
              </span>
              <div
                className="flex w-full flex-col justify-end border border-[var(--border)] bg-[var(--page)]"
                style={{ height: 96 }}
                title={`${w.weekStart}: ${hrs(w.totalHours)} logged, ${hrs(w.billableHours)} billable, ${w.activeMembers} people`}
              >
                <div
                  className="flex w-full flex-col justify-end"
                  style={{ height: `${Math.max(totalPct, 2)}%` }}
                >
                  <div
                    className="w-full bg-[var(--accent)]"
                    style={{ height: `${billablePct}%` }}
                  />
                </div>
              </div>
              <span className="font-mono text-[8.5px] tracking-tight text-[var(--text-faint)]">
                {shortDate(w.weekStart)}
              </span>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

/* ---------------------------------------------------------------- projects */

export function ProjectTable({ rows }: { rows: ProjectSummaryRow[] }) {
  if (rows.length === 0) return null;
  const peak = Math.max(...rows.map((r) => r.totalSeconds), 1);

  return (
    <Panel title="PROJECTS BY HOURS" hint={`top ${rows.length} · burn = logged ÷ budget`}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-[12px]">
          <thead>
            <tr className="border-b border-[var(--border)] text-left font-mono text-[9.5px] tracking-[0.1em] text-[var(--text-faint)]">
              <th scope="col" className="px-4 py-2 font-medium">PROJECT</th>
              <th scope="col" className="px-3 py-2 font-medium">CUSTOMER</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">LOGGED</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">BILLABLE</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">BUDGET</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">BURN</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">PEOPLE</th>
              <th scope="col" className="px-4 py-2 text-right font-medium">LAST</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              // Over budget is the one state worth colouring: it is actionable
              // and it is the reason anyone opens this table.
              const over = r.burnPercent !== null && r.burnPercent > 100;
              return (
                <tr
                  key={r.projectId}
                  className="border-b border-[var(--border)] last:border-b-0 hover:bg-[var(--surface-hover)]"
                >
                  <td className="max-w-[220px] px-4 py-2">
                    <div className="truncate text-[var(--text-primary)]" title={r.projectName}>
                      {r.projectName}
                    </div>
                    <div className="mt-1 w-24">
                      <Bar percent={(r.totalSeconds / peak) * 100} />
                    </div>
                  </td>
                  <td className="max-w-[160px] truncate px-3 py-2 text-[var(--text-muted)]">
                    {r.customerName ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--text-primary)]">
                    {hrs(r.totalHours)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--accent)]">
                    {hrs(r.billableHours)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--text-muted)]">
                    {r.estimatedHours === null ? "—" : hrs(r.estimatedHours)}
                  </td>
                  <td
                    className={`px-3 py-2 text-right font-mono tabular-nums ${
                      over ? "font-semibold text-[var(--critical)]" : "text-[var(--text-muted)]"
                    }`}
                  >
                    {r.burnPercent === null ? (
                      "—"
                    ) : (
                      <>
                        {r.burnPercent}%
                        {/* Colour alone does not reach a screen reader, or
                            anyone with a red-green deficiency. The marker
                            carries the same signal in text. */}
                        {over && (
                          <span className="ml-1" title="Over budget">
                            ⚠<span className="sr-only"> over budget</span>
                          </span>
                        )}
                      </>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--text-muted)]">
                    {r.memberCount}
                  </td>
                  <td className="px-4 py-2 text-right text-[11px] text-[var(--text-faint)]">
                    {relativeDays(r.lastActivityAt)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

/* --------------------------------------------------------------- customers */

export function CustomerTable({ rows }: { rows: CustomerSummaryRow[] }) {
  if (rows.length === 0) return null;
  const peak = Math.max(...rows.map((r) => r.totalSeconds), 1);

  return (
    <Panel title="CUSTOMERS BY HOURS" hint={`top ${rows.length}`}>
      <ul className="divide-y divide-[var(--border)]">
        {rows.map((r) => (
          <li key={r.customerId} className="flex flex-col gap-1.5 px-4 py-2.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate text-[12px] text-[var(--text-primary)]" title={r.customerName}>
                {r.customerName}
              </span>
              <span className="shrink-0 font-mono text-[12px] tabular-nums text-[var(--text-primary)]">
                {hrs(r.totalHours)}
              </span>
            </div>
            <Bar percent={(r.totalSeconds / peak) * 100} />
            <div className="flex justify-between text-[10.5px] text-[var(--text-faint)]">
              <span>
                {r.projectCount} {r.projectCount === 1 ? "project" : "projects"} ·{" "}
                {r.entryCount} entries
              </span>
              <span>{relativeDays(r.lastActivityAt)}</span>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/* ---------------------------------------------------------------- services */

export function ServiceBreakdown({ rows }: { rows: ServiceSummaryRow[] }) {
  if (rows.length === 0) return null;

  return (
    <Panel title="SERVICE MIX" hint="share of all logged time">
      <ul className="divide-y divide-[var(--border)]">
        {rows.map((r) => (
          <li key={r.serviceId} className="flex flex-col gap-1.5 px-4 py-2.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate text-[12px] text-[var(--text-primary)]" title={r.serviceName}>
                {r.serviceName}
              </span>
              <span className="shrink-0 font-mono text-[12px] tabular-nums text-[var(--text-primary)]">
                {r.sharePercent}%
              </span>
            </div>
            {/* Travel and internal time are drawn muted: both are real cost but
                neither is client-facing delivery, and the distinction is the
                point of having the service catalogue at all. */}
            <Bar percent={r.sharePercent} muted={r.isTravel || r.isInternal} />
            <div className="flex justify-between text-[10.5px] text-[var(--text-faint)]">
              <span>{hrs(r.totalHours)}</span>
              <span>
                {r.isTravel ? (r.isPaidTravel ? "travel · paid" : "travel · unpaid") : null}
                {r.isInternal ? "internal" : null}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/* ------------------------------------------------------------------ people */

export function MemberTable({ rows }: { rows: MemberUtilisationRow[] }) {
  if (rows.length === 0) return null;

  return (
    <Panel
      title="PEOPLE"
      hint="utilisation = tracked ÷ contracted, over weeks active"
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-[12px]">
          <thead>
            <tr className="border-b border-[var(--border)] text-left font-mono text-[9.5px] tracking-[0.1em] text-[var(--text-faint)]">
              <th scope="col" className="px-4 py-2 font-medium">PERSON</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">TRACKED</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">CALENDAR</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">WEEKS</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">UTIL.</th>
              <th scope="col" className="px-4 py-2 text-right font-medium">LAST</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const u = r.utilisationPercent;
              // Only flag sustained overload, not a single busy week — one week
              // over 100% is normal and colouring it trains people to ignore it.
              const strained = u !== null && u > 110 && r.weeksActive >= 2;
              return (
                <tr
                  key={r.memberId}
                  className="border-b border-[var(--border)] last:border-b-0 hover:bg-[var(--surface-hover)]"
                >
                  <td className="max-w-[200px] truncate px-4 py-2 text-[var(--text-primary)]">
                    {r.displayName}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--text-primary)]">
                    {hrs(Math.round((r.trackedSeconds / 3600) * 10) / 10)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--text-faint)]">
                    {hrs(Math.round((r.calendarSeconds / 3600) * 10) / 10)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--text-muted)]">
                    {r.weeksActive}
                  </td>
                  <td
                    className={`px-3 py-2 text-right font-mono tabular-nums ${
                      strained
                        ? "font-semibold text-[var(--critical)]"
                        : "text-[var(--accent)]"
                    }`}
                  >
                    {u === null ? (
                      "—"
                    ) : (
                      <>
                        {u}%
                        {strained && (
                          <span className="ml-1" title="Sustained over-allocation">
                            ⚠<span className="sr-only"> sustained over-allocation</span>
                          </span>
                        )}
                      </>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right text-[11px] text-[var(--text-faint)]">
                    {relativeDays(r.lastActivityAt)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

/* --------------------------------------------------------------- economics */

/**
 * Revenue, cost and margin.
 *
 * The page only renders this when `rows` is non-null. `null` means the caller
 * has no money permission and the whole section is absent — deliberately not a
 * disabled panel or a row of dashes, because either of those confirms the
 * figures exist and merely tells the reader they are being kept out.
 */
export function EconomicsTable({ rows }: { rows: ProjectEconomicsRow[] }) {
  if (rows.length === 0) return null;

  const revenue = rows.reduce((a, r) => a + r.revenue, 0);
  const cost = rows.reduce((a, r) => a + r.cost, 0);
  const margin = revenue - cost;
  const marginPct = revenue > 0 ? Math.round((margin / revenue) * 1000) / 10 : null;

  return (
    <Panel
      title="PROJECT ECONOMICS"
      hint="rates are effective-dated to each entry · exec only"
    >
      <div className="grid grid-cols-3 border-b border-[var(--border)]">
        {[
          { label: "REVENUE", value: eur(revenue), accent: false },
          { label: "COST", value: eur(cost), accent: false },
          {
            label: "MARGIN",
            value: marginPct === null ? eur(margin) : `${eur(margin)} · ${marginPct}%`,
            accent: true,
          },
        ].map((t) => (
          <div key={t.label} className="border-r border-[var(--border)] px-4 py-3 last:border-r-0">
            <div className="font-mono text-[9.5px] tracking-[0.12em] text-[var(--text-faint)]">
              {t.label}
            </div>
            <div
              className={`font-mono text-[17px] font-semibold tabular-nums ${
                t.accent ? "text-[var(--accent)]" : "text-[var(--text-primary)]"
              }`}
            >
              {t.value}
            </div>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-[12px]">
          <thead>
            <tr className="border-b border-[var(--border)] text-left font-mono text-[9.5px] tracking-[0.1em] text-[var(--text-faint)]">
              <th scope="col" className="px-4 py-2 font-medium">PROJECT</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">REVENUE</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">COST</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">MARGIN</th>
              <th scope="col" className="px-4 py-2 text-right font-medium">%</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.projectId}
                className="border-b border-[var(--border)] last:border-b-0 hover:bg-[var(--surface-hover)]"
              >
                <td className="max-w-[240px] px-4 py-2">
                  <div className="truncate text-[var(--text-primary)]">{r.projectName}</div>
                  {r.customerName && (
                    <div className="truncate text-[10.5px] text-[var(--text-faint)]">
                      {r.customerName}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--text-primary)]">
                  {eur(r.revenue)}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--text-muted)]">
                  {eur(r.cost)}
                </td>
                <td
                  className={`px-3 py-2 text-right font-mono tabular-nums ${
                    r.margin < 0
                      ? "font-semibold text-[var(--critical)]"
                      : "text-[var(--text-primary)]"
                  }`}
                >
                  {eur(r.margin)}
                  {r.margin < 0 && <span className="sr-only"> (loss)</span>}
                </td>
                <td className="px-4 py-2 text-right font-mono tabular-nums text-[var(--text-muted)]">
                  {r.marginPercent === null ? "—" : `${r.marginPercent}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
