"use client";
/**
 * The dashboard's three tables, each a full view of its data.
 *
 * WHAT CHANGED AND WHY
 * --------------------
 * These were `rows.slice(0, 40)` / `.slice(0, 25)` server components. The slice
 * was the whole problem the page had: with 334 live projects, grouping by project
 * showed 40 and silently discarded 294, and NOTHING on the page could reach them.
 * The hint said "top 40 of 334", so it was honest — but a report you cannot ask a
 * question of is not a report, and "which of our projects logged the least time"
 * was simply unanswerable.
 *
 * Now every row is handed to DataTable, which owns sorting, in-table search,
 * paging and CSV. The cost is that these three panels became Client Components.
 * That is a real trade and worth stating: the rows are already AGGREGATED
 * (hundreds of grouped rows, not the thousands of raw entries behind them), so
 * the payload is small, and in exchange re-sorting a column costs nothing instead
 * of a server round trip.
 *
 * The inherited rule still holds throughout: a missing number renders as "—",
 * never as 0, and the sort comparators put nulls last in both directions rather
 * than letting them pose as the smallest value.
 */
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import type { BudgetRow, GroupBy, GroupRow } from "@/lib/queries/trackingtime-report";
import type { ProjectEconomicsRow } from "@/lib/queries/time-dashboard";
import { fmtDate, fmtHours, fmtInt, fmtPct, tagFor } from "@/lib/locale-format";
import { cmpNum, cmpText, DataTable, type Column } from "@/components/data-table/DataTable";

/* ------------------------------------------------------------------ shared */

/** What a table needs from the catalogue, without importing next-intl's types. */
type Tr = (key: string, values?: Record<string, string | number>) => string;

/**
 * A share to EXACTLY one decimal: "3.0%" in en, "3,0 %" in de.
 *
 * fmtPct() is not enough here because it trims a trailing zero, and this column
 * is read as a ranking -- "3%" beside "3.3%" reads as two different precisions
 * rather than two comparable shares. The German percent spacing is fmtPct's own
 * rule, repeated here rather than reimplemented differently.
 */
function sharePct(n: number, locale: string): string {
  const v = n.toLocaleString(tagFor(locale), {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  return locale === "de" ? `${v} %` : `${v}%`;
}

function shortDate(isoDay: string, locale: string): string {
  const d = new Date(`${isoDay}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return isoDay;
  return fmtDate(d, locale, { day: "numeric", month: "short", timeZone: "UTC" });
}

/**
 * "3mo ago" / "—", in the reader's language.
 *
 * The DASH IS KEPT for a missing timestamp rather than turned into a date or a
 * zero: "never logged anything" and "logged something on the epoch" are
 * different statements, and this column has always said so.
 */
function relativeDays(isoTs: string | null, t: Tr): string {
  if (!isoTs) return "—";
  const then = new Date(isoTs).getTime();
  if (Number.isNaN(then)) return "—";
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return t("relative.today");
  if (days === 1) return t("relative.yesterday");
  if (days < 30) return t("relative.days", { count: days });
  if (days < 365) return t("relative.months", { count: Math.floor(days / 30) });
  return t("relative.years", { count: Math.floor(days / 365) });
}

/**
 * A horizontal magnitude bar.
 *
 * `Number.isFinite` is checked FIRST because clamping does not survive NaN:
 * `Math.min(100, NaN)` is NaN, which renders as `width: NaN%` — invalid CSS the
 * browser drops silently, leaving a FULL-width bar that reads as 100%. A bad
 * number must render as empty, not as maximal.
 */
function Bar({ percent, tone = "accent" }: { percent: number; tone?: "accent" | "over" | "muted" }) {
  const w = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0;
  const bg =
    tone === "over" ? "var(--critical)" : tone === "muted" ? "var(--border)" : "var(--accent)";
  return (
    // h-1.5 rather than h-1: at one pixel on a dark track the fill was hard to
    // see at all, which made the column decoration rather than information.
    <span className="block h-1.5 w-full bg-[var(--page)]" aria-hidden>
      <span className="block h-full transition-[width] duration-300" style={{ width: `${w}%`, background: bg }} />
    </span>
  );
}

const mono = "font-mono tabular-nums text-[var(--text-secondary)]";

/* -------------------------------------------------------------- breakdown */

/**
 * Breakdown by one dimension, with each named row acting as a drill-down.
 *
 * WHY DRILL-DOWN IS A LINK AND NOT A DETAIL PAGE: every number a customer or
 * project page would show — hours, billable split, trend, budget, entries — is
 * already computed here from the same filtered entry set. A separate route would
 * be a second implementation of the same arithmetic over the same rows, and the
 * two would eventually disagree; the version people trust would then be whichever
 * they opened last. Narrowing the existing filter keeps one code path and one set
 * of totals, and it composes: customer → project → member is three clicks with no
 * extra query written.
 */
export function BreakdownTable({
  rows,
  dimension,
  hrefFor,
  period,
}: {
  rows: GroupRow[];
  /**
   * The grouping key, NOT a display label. It selects the catalogue entry and
   * the export filename, both of which must stay stable across languages.
   */
  dimension: GroupBy;
  /** Serialisable drill-down targets, keyed by row. Precomputed on the server. */
  hrefFor?: Record<string, string>;
  period: string;
}) {
  const t = useTranslations("timeDashboard.tables");
  const dim = useTranslations("timeDashboard.dimensions");
  const locale = useLocale();
  const hrs = (h: number) => fmtHours(h, locale);
  const linked = hrefFor ?? {};
  const anyLinked = rows.some((r) => linked[r.key]);

  /**
   * The largest row's share, used to scale the magnitude bars.
   *
   * WHY NOT SCALE TO 100%: with 60 projects the biggest share is 3.3%, so every
   * bar rendered as a 3-pixel sliver and the column was decoration -- you could
   * not tell the top row from the twentieth, which is the one thing a bar is for.
   * Scaling to the largest row makes the column a comparison BETWEEN rows, which
   * is how a bar in a data table is read.
   *
   * The number beside it is still the true share of the grand total, and the
   * column header says so, so nothing here overstates a row's size -- the bar is
   * relative, the figure is absolute.
   */
  const maxShare = rows.reduce((m, r) => Math.max(m, r.sharePercent), 0);

  const columns: Column<GroupRow>[] = [
    {
      key: "label",
      header: dim(`${dimension}.lower`),
      className: "max-w-[26rem]",
      compare: (a, b) => cmpText(a.label, b.label),
      descFirst: false,
      search: (r) => `${r.label} ${r.secondary ?? ""}`,
      csv: (r) => r.label,
      cell: (r) => {
        const href = linked[r.key];
        const body = (
          <>
            <span className="block truncate text-[12px] text-[var(--text-primary)]">{r.label}</span>
            {r.secondary && (
              <span className="block truncate text-[10px] text-[var(--text-faint)]">
                {r.secondary}
              </span>
            )}
          </>
        );
        // Rows with no id (the deliberate "(no project)" bucket, and every task
        // row since tasks group by name) get no link: there is nothing to filter
        // on, and a link that silently does nothing is worse than plain text.
        return href ? (
          <Link
            href={href}
            scroll={false}
            title={t("breakdown.narrowTo", { name: r.label })}
            className="block hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
          >
            {body}
          </Link>
        ) : (
          body
        );
      },
    },
    {
      key: "hours",
      header: t("breakdown.hours"),
      align: "right",
      compare: (a, b) => a.totalSeconds - b.totalSeconds,
      csv: (r) => r.totalHours,
      cell: (r) => <span className={mono}>{hrs(r.totalHours)}</span>,
    },
    {
      key: "billable",
      header: t("breakdown.billable"),
      align: "right",
      compare: (a, b) => a.billableSeconds - b.billableSeconds,
      csv: (r) => r.billableHours,
      cell: (r) => <span className={mono}>{hrs(r.billableHours)}</span>,
    },
    {
      key: "billpct",
      header: t("breakdown.billPct"),
      align: "right",
      compare: (a, b) => cmpNum(a.billablePercent, b.billablePercent),
      title: t("breakdown.billPctTitle"),
      csv: (r) => (r.billablePercent === null ? "" : r.billablePercent),
      cell: (r) => (
        <span
          className={`font-mono tabular-nums ${
            r.billablePercent === null ? "text-[var(--text-faint)]" : "text-[var(--text-secondary)]"
          }`}
        >
          {r.billablePercent === null ? "—" : fmtPct(r.billablePercent, locale)}
        </span>
      ),
    },
    {
      key: "entries",
      header: t("breakdown.entries"),
      align: "right",
      compare: (a, b) => a.entryCount - b.entryCount,
      csv: (r) => r.entryCount,
      cell: (r) => (
        <span className="font-mono tabular-nums text-[var(--text-faint)]">
          {fmtInt(r.entryCount, locale)}
        </span>
      ),
    },
    {
      key: "last",
      header: t("breakdown.last"),
      align: "right",
      // Sorted on the raw timestamp, not the rendered "3mo ago" string, which
      // would order lexically and put "9d" after "3mo".
      compare: (a, b) =>
        cmpNum(
          a.lastActivityAt ? Date.parse(a.lastActivityAt) : null,
          b.lastActivityAt ? Date.parse(b.lastActivityAt) : null,
        ),
      title: t("breakdown.lastTitle"),
      csv: (r) => r.lastActivityAt ?? "",
      cell: (r) => (
        <span
          className="text-[var(--text-faint)]"
          title={r.lastActivityAt ? shortDate(r.lastActivityAt.slice(0, 10), locale) : undefined}
        >
          {relativeDays(r.lastActivityAt, t)}
        </span>
      ),
    },
    {
      key: "share",
      header: t("breakdown.share"),
      align: "right",
      className: "w-[9rem]",
      compare: (a, b) => a.sharePercent - b.sharePercent,
      title: t("breakdown.shareTitle"),
      csv: (r) => Math.round(r.sharePercent * 10) / 10,
      cell: (r) => (
        <span className="flex items-center gap-2">
          <span className="flex-1">
            <Bar percent={maxShare > 0 ? (r.sharePercent / maxShare) * 100 : 0} />
          </span>
          <span className="w-[3.2rem] text-right font-mono text-[10px] tabular-nums text-[var(--text-faint)]">
            {sharePct(r.sharePercent, locale)}
          </span>
        </span>
      ),
    },
  ];

  return (
    <DataTable
      title={t("breakdown.title", { dimension: dim(`${dimension}.label`).toUpperCase() })}
      hint={anyLinked ? t("breakdown.hint") : undefined}
      rows={rows}
      columns={columns}
      rowKey={(r) => r.key}
      initialSort="hours"
      // The export FILENAME keeps the grouping key, not the translated word: a
      // German reader's CSV must still land beside an English one in the same
      // folder and sort next to it.
      exportName={`trackingtime-by-${dimension}-${period}`}
      searchPlaceholder={t("breakdown.search", { dimension: dim(`${dimension}.lower`) })}
      emptyText={t("breakdown.empty", { dimension: dim(`${dimension}.lower`) })}
      // Collapsible for consistency with the panels below, but OPEN: this is
      // the answer to the question the group-by control just asked, so hiding
      // it would leave the page with no visible result at all.
      collapsible
      summary={t("breakdown.summary", {
        items: dim(`${dimension}.count`, { count: rows.length }),
      })}
    />
  );
}

/* ---------------------------------------------------------------- budgets */

export function BudgetTable({ rows, period }: { rows: BudgetRow[]; period: string }) {
  const t = useTranslations("timeDashboard.tables");
  const d = useTranslations("drill");
  const locale = useLocale();
  const hrs = (h: number) => fmtHours(h, locale);
  const over = rows.filter((r) => r.isOver).length;

  const columns: Column<BudgetRow>[] = [
    {
      key: "project",
      header: t("budget.project"),
      className: "max-w-[24rem]",
      compare: (a, b) => cmpText(a.projectName, b.projectName),
      descFirst: false,
      search: (r) => `${r.projectName} ${r.customerName ?? ""}`,
      csv: (r) => r.projectName,
      cell: (r) => (
        <>
          {/* Links to the project RECORD, not to a narrowed report. From a
              budget row the next question is "why is this one at 140%", which
              is the record's contributor and task breakdown — not this same
              table filtered to one row. */}
          <Link
            href={`/projects/${r.projectId}`}
            className="block truncate text-[12px] text-[var(--text-primary)] hover:text-[var(--accent)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
          >
            {r.projectName}
          </Link>
          {r.customerName && (
            <span className="block truncate text-[10px] text-[var(--text-faint)]">
              {r.customerName}
            </span>
          )}
        </>
      ),
    },
    {
      key: "budget",
      header: t("budget.budget"),
      align: "right",
      compare: (a, b) => a.estimatedHours - b.estimatedHours,
      csv: (r) => r.estimatedHours,
      cell: (r) => <span className={mono}>{hrs(r.estimatedHours)}</span>,
    },
    {
      key: "actual",
      header: t("budget.actual"),
      align: "right",
      compare: (a, b) => a.actualHours - b.actualHours,
      title: t("budget.actualTitle"),
      csv: (r) => r.actualHours,
      cell: (r) => <span className={mono}>{hrs(r.actualHours)}</span>,
    },
    {
      key: "remaining",
      header: t("budget.remaining"),
      align: "right",
      compare: (a, b) => a.remainingHours - b.remainingHours,
      descFirst: false,
      title: t("budget.remainingTitle"),
      csv: (r) => r.remainingHours,
      cell: (r) => (
        <span
          className={`font-mono tabular-nums ${
            r.remainingHours < 0 ? "text-[var(--critical)]" : "text-[var(--text-secondary)]"
          }`}
        >
          {hrs(r.remainingHours)}
        </span>
      ),
    },
    {
      key: "burn",
      header: t("budget.burn"),
      align: "right",
      className: "w-[11rem]",
      compare: (a, b) => a.burnPercent - b.burnPercent,
      csv: (r) => r.burnPercent,
      cell: (r) => (
        <span className="flex items-center gap-2">
          <span className="flex-1">
            <Bar percent={r.burnPercent} tone={r.isOver ? "over" : "accent"} />
          </span>
          <span
            className={`w-[3.8rem] text-right font-mono text-[10px] tabular-nums ${
              r.isOver ? "text-[var(--critical)]" : "text-[var(--text-faint)]"
            }`}
          >
            {fmtPct(Math.round(r.burnPercent), locale)}
          </span>
        </span>
      ),
    },
  ];

  return (
    <DataTable
      title={t("budget.title")}
      hint={t("budget.hint", { count: over })}
      rows={rows}
      columns={columns}
      rowKey={(r) => r.projectId}
      initialSort="burn"
      exportName={`trackingtime-budget-${period}`}
      searchPlaceholder={t("budget.search")}
      footnote={t("budget.footnote")}
      emptyText={t("budget.empty")}
      // Collapsed by default. Four full tables stacked made the page ~6,500px
      // tall, which is its own kind of unusable: the breakdown you came for
      // scrolls away and nothing below it is ever seen. The breakdown stays
      // open because it answers the question the group-by control just asked;
      // this one is a follow-up, and its headline (how many are over budget)
      // is in the collapsed summary, so opening it is a choice rather than a
      // hunt.
      collapsible
      defaultOpen={false}
      summary={t("budget.summary", {
        projects: d("projectCount", { count: rows.length }),
        over,
      })}
    />
  );
}

/* ------------------------------------------------------------- economics */

/** Euro, no decimals — cents are noise at organisation scale. */
const euroIn = (locale: string) => (v: number) => `€${fmtInt(v, locale)}`;

/**
 * Revenue, cost and margin per project.
 *
 * The page renders this only when the rows are non-null. `null` means the caller
 * holds no money permission and the whole section is ABSENT — deliberately not a
 * disabled panel or a row of dashes, because either of those confirms the figures
 * exist and merely says the reader is being kept out.
 *
 * The summary tiles sum the rows PRESENT, so with the table filtered or the
 * period narrowed they answer "what does this selection earn", which is the
 * question someone who just set a filter is asking.
 */
export function EconomicsTable({
  rows,
  period,
  perMemberFilterActive = false,
}: {
  rows: ProjectEconomicsRow[];
  period: string;
  /**
   * True when a member, service or billable filter is narrowing the report.
   *
   * These figures come from a security-definer RPC that accepts only a date
   * range, so those filters cannot reach it: each row still carries the
   * project's FULL revenue for the period. That is worth one line of text --
   * without it, revenue silently means something different from every other
   * number on the page while looking exactly as authoritative.
   */
  perMemberFilterActive?: boolean;
}) {
  const t = useTranslations("timeDashboard.tables");
  const d = useTranslations("drill");
  const locale = useLocale();
  const hrs = (h: number) => fmtHours(h, locale);
  const eur = euroIn(locale);
  const revenue = rows.reduce((a, r) => a + r.revenue, 0);
  const cost = rows.reduce((a, r) => a + r.cost, 0);
  const margin = revenue - cost;
  const marginPct = revenue > 0 ? Math.round((margin / revenue) * 1000) / 10 : null;

  const columns: Column<ProjectEconomicsRow>[] = [
    {
      key: "project",
      header: t("economics.colProject"),
      className: "max-w-[22rem]",
      compare: (a, b) => cmpText(a.projectName, b.projectName),
      descFirst: false,
      search: (r) => `${r.projectName} ${r.customerName ?? ""}`,
      csv: (r) => r.projectName,
      cell: (r) => (
        <>
          {/* The "(no project)" row aggregates entries with no project_id.
              There is no record to open, so it is plain text — a link that
              looks live and 404s is worse than no link. */}
          {r.projectId === null ? (
            <span className="block truncate text-[12px] italic text-[var(--text-secondary)]">
              {r.projectName}
            </span>
          ) : (
            <Link
              href={`/projects/${r.projectId}`}
              className="block truncate text-[12px] text-[var(--text-primary)] hover:text-[var(--accent)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
            >
              {r.projectName}
            </Link>
          )}
          {r.customerName && (
            <span className="block truncate text-[10px] text-[var(--text-faint)]">
              {r.customerName}
            </span>
          )}
        </>
      ),
    },
    {
      key: "hours",
      header: t("economics.colHours"),
      align: "right",
      compare: (a, b) => a.totalSeconds - b.totalSeconds,
      csv: (r) => Math.round((r.totalSeconds / 3600) * 100) / 100,
      cell: (r) => (
        <span className={mono}>{hrs(Math.round((r.totalSeconds / 3600) * 10) / 10)}</span>
      ),
    },
    {
      key: "revenue",
      header: t("economics.colRevenue"),
      align: "right",
      compare: (a, b) => a.revenue - b.revenue,
      csv: (r) => r.revenue,
      cell: (r) => (
        <span className="font-mono tabular-nums text-[var(--text-primary)]">{eur(r.revenue)}</span>
      ),
    },
    {
      key: "cost",
      header: t("economics.colCost"),
      align: "right",
      compare: (a, b) => a.cost - b.cost,
      csv: (r) => r.cost,
      cell: (r) => <span className="font-mono tabular-nums text-[var(--text-muted)]">{eur(r.cost)}</span>,
    },
    {
      key: "margin",
      header: t("economics.colMargin"),
      align: "right",
      compare: (a, b) => a.margin - b.margin,
      csv: (r) => r.margin,
      cell: (r) => (
        <span
          className={`font-mono tabular-nums ${
            r.margin < 0 ? "text-[var(--critical)]" : "text-[var(--accent)]"
          }`}
        >
          {eur(r.margin)}
        </span>
      ),
    },
    {
      key: "marginpct",
      header: t("economics.colMarginPct"),
      align: "right",
      compare: (a, b) => cmpNum(a.marginPercent, b.marginPercent),
      title: t("economics.marginPctTitle"),
      csv: (r) => (r.marginPercent === null ? "" : r.marginPercent),
      cell: (r) => (
        <span
          className={`font-mono tabular-nums ${
            r.marginPercent === null ? "text-[var(--text-faint)]" : "text-[var(--text-secondary)]"
          }`}
        >
          {r.marginPercent === null ? "—" : fmtPct(r.marginPercent, locale, 1)}
        </span>
      ),
    },
  ];

  return (
    // The money tiles and the per-project table are two discrete cards on a gap,
    // not one fused box. The strip used to share a hairline with the table below
    // (border-b-0), which read as a single flat panel; separating them onto the
    // page's card gap matches the card language used everywhere else.
    <div className="flex flex-col gap-[var(--card-gap)]">
      <div className="grid grid-cols-3 overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] card-elev">
        {[
          { key: "revenue", label: t("economics.revenue"), value: eur(revenue), accent: false },
          { key: "cost", label: t("economics.cost"), value: eur(cost), accent: false },
          {
            key: "margin",
            label: t("economics.margin"),
            value:
              marginPct === null
                ? eur(margin)
                : t("economics.marginValue", {
                    margin: eur(margin),
                    percent: fmtPct(marginPct, locale, 1),
                  }),
            accent: true,
          },
        ].map((tile) => (
          <div key={tile.key} className="border-r border-[var(--border)] px-4 py-3 last:border-r-0">
            <div className="font-mono text-[10px] tracking-[0.12em] text-[var(--text-faint)]">
              {tile.label}
            </div>
            <div
              className={`font-mono text-[17px] font-semibold tabular-nums ${
                tile.accent ? "text-[var(--accent)]" : "text-[var(--text-primary)]"
              }`}
            >
              {tile.value}
            </div>
          </div>
        ))}
      </div>

      <DataTable
        title={t("economics.title")}
        hint={t("economics.hint")}
        rows={rows}
        columns={columns}
        rowKey={(r) => r.projectId ?? "unattributed"}
        initialSort="revenue"
        exportName={`trackingtime-economics-${period}`}
        searchPlaceholder={t("economics.search")}
        emptyText={t("economics.empty")}
        footnote={
          perMemberFilterActive ? t("economics.footnoteFiltered") : t("economics.footnote")
        }
        // The three money tiles above stay visible while this is shut, so the
        // figure an executive opens the page for is never behind a click; the
        // per-project detail is.
        collapsible
        defaultOpen={false}
        summary={t("economics.summary", { projects: d("projectCount", { count: rows.length }) })}
      />
    </div>
  );
}


/* --------------------------------------------------------------- entries */

export type EntryRow = {
  id: number;
  startedAt: string;
  memberName: string;
  projectName: string | null;
  customerName: string | null;
  taskName: string | null;
  serviceName: string | null;
  durationSeconds: number;
  isBillable: boolean;
  isCalendar: boolean;
  notes: string | null;
};

/**
 * The entry-level table.
 *
 * Previously `entries.slice(0, 25)` under the heading "LATEST ENTRIES", which
 * made the raw data — the thing every aggregate above is derived from, and the
 * only place to check a suspicious total — visible 25 rows at a time with no way
 * forward. It is now the full selection, searchable and pageable, so a
 * disagreement between a total and reality is actually diagnosable.
 */
export function EntriesTable({ rows, period }: { rows: EntryRow[]; period: string }) {
  const t = useTranslations("timeDashboard.tables");
  const d = useTranslations("drill");
  const locale = useLocale();
  const hrs = (h: number) => fmtHours(h, locale);
  const columns: Column<EntryRow>[] = [
    {
      key: "date",
      header: t("entries.date"),
      compare: (a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt),
      csv: (r) => r.startedAt,
      cell: (r) => (
        <span className="whitespace-nowrap font-mono text-[11px] text-[var(--text-faint)]">
          {shortDate(r.startedAt.slice(0, 10), locale)}
          {/* The clock time matters for an entry-level check: two 2h entries on
              one day are ambiguous without it. */}
          <span className="ml-1.5 opacity-70">{r.startedAt.slice(11, 16)}</span>
        </span>
      ),
    },
    {
      key: "member",
      header: t("entries.member"),
      compare: (a, b) => cmpText(a.memberName, b.memberName),
      descFirst: false,
      search: (r) => r.memberName,
      csv: (r) => r.memberName,
      cell: (r) => <span className="whitespace-nowrap text-[var(--text-secondary)]">{r.memberName}</span>,
    },
    {
      key: "project",
      header: t("entries.projectTask"),
      className: "max-w-[24rem]",
      compare: (a, b) => cmpText(a.projectName, b.projectName),
      descFirst: false,
      search: (r) =>
        `${r.projectName ?? ""} ${r.taskName ?? ""} ${r.customerName ?? ""} ${r.notes ?? ""}`,
      csv: (r) => r.projectName ?? "",
      cell: (r) => (
        <>
          <span className="block truncate text-[12px] text-[var(--text-secondary)]">
            {r.projectName ?? "—"}
          </span>
          {(r.taskName || r.notes) && (
            <span className="block truncate text-[10px] text-[var(--text-faint)]" title={r.notes ?? undefined}>
              {r.taskName ?? r.notes}
            </span>
          )}
        </>
      ),
    },
    {
      key: "customer",
      header: t("entries.customer"),
      className: "max-w-[12rem]",
      compare: (a, b) => cmpText(a.customerName, b.customerName),
      descFirst: false,
      search: (r) => r.customerName ?? "",
      csv: (r) => r.customerName ?? "",
      cell: (r) => (
        <span className="block truncate text-[11px] text-[var(--text-faint)]">
          {r.customerName ?? "—"}
        </span>
      ),
    },
    {
      key: "duration",
      header: t("entries.duration"),
      align: "right",
      compare: (a, b) => a.durationSeconds - b.durationSeconds,
      csv: (r) => Math.round((r.durationSeconds / 3600) * 100) / 100,
      cell: (r) => (
        <span className={mono}>{hrs(Math.round((r.durationSeconds / 3600) * 10) / 10)}</span>
      ),
    },
    {
      key: "flags",
      header: t("entries.type"),
      align: "right",
      // Billable sorts above non-billable, and calendar placeholders below both.
      compare: (a, b) =>
        (a.isBillable ? 2 : a.isCalendar ? 0 : 1) - (b.isBillable ? 2 : b.isCalendar ? 0 : 1),
      csv: (r) => (r.isBillable ? "billable" : r.isCalendar ? "calendar" : "non-billable"),
      cell: (r) => (
        <span className="whitespace-nowrap font-mono text-[10px]">
          {r.isBillable ? (
            <span className="text-[var(--accent)]">{t("entries.billable")}</span>
          ) : r.isCalendar ? (
            <span className="text-[var(--text-faint)]">{t("entries.calendar")}</span>
          ) : (
            <span className="text-[var(--text-faint)]">—</span>
          )}
        </span>
      ),
    },
  ];

  return (
    <DataTable
      title={t("entries.title")}
      hint={t("entries.hint")}
      rows={rows}
      columns={columns}
      rowKey={(r) => r.id}
      initialSort="date"
      exportName={`trackingtime-entries-${period}`}
      searchPlaceholder={t("entries.search")}
      emptyText={t("entries.empty")}
      // The raw rows are for checking a total that looks wrong, which is a
      // deliberate act. Open by default they were simply a very long tail on
      // every page view.
      collapsible
      defaultOpen={false}
      summary={t("entries.summary", { entries: d("entries", { count: rows.length }) })}
    />
  );
}
