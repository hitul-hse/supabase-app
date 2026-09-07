"use client";
/**
 * The Overview's two WORKED QUEUES: over-budget projects, and utilisation per
 * person. Both are 10-row lists ordered worst first, paged in the URL.
 *
 * WHY THEY ARE TABLES AND NOT PANELS
 * ----------------------------------
 * "Which projects are overrunning" had no answer anywhere on this page — the
 * PROJECTS OVER BUDGET tile stated a count and linked to the full ledger, so
 * reading the actual names meant leaving the page and re-filtering it. And
 * "Utilisation by person" was `utilisationRows.slice(0, 6)` sorted by hours
 * descending: a name, a bar and a percentage for the six people who logged the
 * MOST, which is the opposite end of the list from the one the figure exists to
 * surface. Eleven of the seventeen were unreachable from anywhere.
 *
 * Both are now the shape docs/UI-CONVENTIONS rule 1 describes for a list people
 * work THROUGH: ten rows, the honest count in the card header (APPLE_REF §8
 * #11), worst first (rule 5), and the page in the URL (rule 2) so a shared link
 * lands on the same rows.
 *
 * WHY DataTable RATHER THAN A HAND-ROLLED TABLE
 * ---------------------------------------------
 * The primitive already owns the four things these lists must not re-decide:
 * null placement in a sort, the opaque sticky header material (§8 #4), the
 * current-row treatment, and the page/size contract with the URL. Null
 * placement needed the primitive extended, not merely used: `cmpNum` puts
 * nulls last ascending, but `DataTable` reversed the whole array for a
 * descending sort and floated them back to the top, so clicking UTILISATION
 * twice put the four people with no measurable ratio above the 94 % row. Every
 * column here with absent values declares `nullish`, which pins them last in
 * both directions. The only thing it lacked
 * was the worked-queue MODE — a fixed 10 rows with the 25/50/100/ALL control
 * taken away — so that was added to the primitive (`fixedPageSize`) rather than
 * worked around here.
 *
 * WHY A CLIENT COMPONENT
 * ----------------------
 * `DataTable`'s columns carry `cell` render functions, which cannot cross the
 * server boundary. The page stays a server component and hands over the rows
 * already assembled; only this presentation shell is client-side. Every string
 * arrives already translated, and every SCOPE word ("ALL TIME") is composed in
 * page.tsx beside the scope note that justifies it, so the label and the fact
 * cannot drift apart.
 */
import Link from "next/link";
import { useTranslations } from "next-intl";
import { DataTable, cmpNum, cmpText, type Column } from "@/components/data-table";
import { StatusDot, type StatusTone } from "@/components/ui/StatusDot";
import { fmtNum } from "@/lib/locale-format";

/**
 * The Overview's percentage dialect: the page's number locale, and the sign
 * tight against the figure, exactly as the five StatTiles above these cards
 * have always written it. See the note beside `NUMBER_LOCALE` in page.tsx —
 * `fmtPct` would put a German space in and make one card disagree with four.
 */
const pct = (n: number, locale: string, dp = 0) => `${fmtNum(n, locale, dp)}%`;
import type { OverBudgetProject, TeamUtilisation } from "@/lib/queries/overview-live";

/**
 * A missing LABEL: "—".
 *
 * Distinct from a missing FIGURE, which says "n/a" (`common.notAvailable`) --
 * the split /projects already keeps and check-projects-module.mjs already
 * counts: an em dash in a numeric column reads as a dash-shaped zero and sorts
 * like one in the reader's head, where "n/a" cannot be mistaken for a
 * measurement. A missing team name is not a number and has nothing to be
 * mistaken for.
 *
 * APPLE_REF §8 #26 rules "—" for a missing NUMBER and is not cited here on
 * purpose: it is the one place the band departs from the reference, and the
 * departure is declared rather than dressed up as compliance. Its stated
 * reason -- "the gate reads them" -- is out of date, because the gate that
 * reads this (check-projects-module.mjs:487) counts "n/a".
 */
function noLabel() {
  return <span className="text-[var(--text-muted)]">—</span>;
}

/* ------------------------------------------------------------- over budget */

export function OverBudgetQueue({
  rows,
  hint,
  footnote,
  emptyText,
  locale,
}: {
  rows: OverBudgetProject[];
  hint: string;
  footnote: string;
  emptyText: string;
  locale: string;
}) {
  const t = useTranslations("overview.overBudget");

  const columns: Column<OverBudgetProject>[] = [
    {
      key: "project",
      header: t("columns.project"),
      /*
        A CAP, not a preference. Two of these cards sit side by side at 1440, so
        each is ~576px and the four columns have to fit inside it: without a
        maximum the customer name ("Dokumentationszentrum NS-Zwangsarbeit") took
        the whole card and pushed BURN and OVER out through the horizontal
        scroller, which is a table that hides the two figures it exists to show.
        A `max-width` on the cell plus `block truncate` on the span inside it is
        what makes this bite: an element with `overflow: hidden` contributes a
        min-content width of zero, so the cap actually holds instead of being
        overruled by an unbreakable German compound.
      */
      className: "w-[13rem] max-w-[13rem]",
      compare: (a, b) => cmpText(a.name, b.name),
      descFirst: false,
      cell: (r) => (
        /* The row's subject is the link, not the whole row: this list has no
           detail panel, so the row navigates AWAY and only the name should
           (APPLE_REF §5.7 "Links"). */
        <Link
          href={`/projects/${r.id}`}
          title={r.name}
          className="block truncate text-[var(--text-primary)] underline-offset-2 hover:text-[var(--accent)] hover:underline"
        >
          {r.name}
        </Link>
      ),
    },
    {
      key: "customer",
      header: t("columns.customer"),
      className: "w-[11rem] max-w-[11rem]",
      compare: (a, b) => cmpText(a.customerName, b.customerName),
      descFirst: false,
      cell: (r) =>
        r.customerName === null ? (
          noLabel()
        ) : (
          <span className="block truncate text-[var(--text-secondary)]" title={r.customerName}>
            {r.customerName}
          </span>
        ),
    },
    {
      key: "burn",
      header: t("columns.burn"),
      align: "right",
      compact: true,
      compare: (a, b) => cmpNum(a.burnPercent, b.burnPercent),
      cell: (r) => (
        /* --critical, never --accent: every row in this list is past its
           estimate, and teal means interactive or current (APPLE_REF §8 #5). */
        <span className="fig text-[var(--critical)]">{pct(r.burnPercent, locale)}</span>
      ),
    },
    {
      key: "over",
      header: t("columns.over"),
      align: "right",
      compact: true,
      compare: (a, b) => cmpNum(a.overHours, b.overHours),
      cell: (r) => (
        <span className="fig text-[var(--text-primary)]">
          {/*
            An overrun smaller than 0.05 h is written "< 0.1 h", not "0 h".
            Live, "10190_Topographie des Terrors" is 2.02 h against a 2 h
            estimate: at one decimal that renders as a bare 0 in a list whose
            whole claim is that these projects went PAST their budget, which is
            the plausible zero the house rules forbid. The row is real and
            belongs here -- only the rounding was lying about it.
          */}
          {r.overHours < 0.05
            ? t("underTenth")
            : t("hours", { hours: fmtNum(r.overHours, locale, 1) })}
        </span>
      ),
    },
  ];

  return (
    <DataTable
      rows={rows}
      columns={columns}
      rowKey={(r) => r.id}
      title={t("title")}
      hint={hint}
      /* Burn descending: the project furthest past its estimate first. */
      initialSort="burn"
      initialDesc
      fixedPageSize={10}
      pagerStyle="numbered"
      urlKeys={{ page: "obpage", size: "obsize" }}
      footnote={footnote}
      emptyText={emptyText}
    />
  );
}

/* ------------------------------------------------------------- utilisation */

/**
 * The tone and the WORD for one person's utilisation.
 *
 * The word is the point. The card used to carry this entirely in the colour of
 * a bar, which APPLE_REF §8 #5 and UI-CONVENTIONS both forbid outright, and
 * which is simply unreadable to a red-green reader or in a printed board pack.
 *
 * Null splits into two different sentences rather than one vague one. "No
 * activity" is a fact about the person's TrackingTime record; "Not measured" is
 * a fact about ours — they logged time but hold no contracted hours, so the
 * ratio has no denominator. Collapsing both into one label would let a reader
 * conclude somebody is idle when the truth is that we cannot compute it.
 */
/* `tStatus`, not `t`: the translator arrives as a PARAMETER here, so its
   namespace belongs to the caller, and a key-reference sweep reading this file
   cannot resolve it against any `useTranslations` line above. Naming it apart
   from the file's own bindings keeps those verifiable
   (scripts/check-i18n-key-references.mjs). */
function utilisationStatus(
  row: TeamUtilisation,
  tStatus: (k: string) => string,
): { tone: StatusTone; word: string } {
  if (row.percent === null) {
    return row.entryCount === 0
      ? { tone: "unknown", word: tStatus("status.noActivity") }
      : { tone: "unknown", word: tStatus("status.notMeasured") };
  }
  if (row.tone === "critical") return { tone: "critical", word: tStatus("status.overCapacity") };
  if (row.tone === "warning") return { tone: "warning", word: tStatus("status.low") };
  return { tone: "good", word: tStatus("status.onTrack") };
}

export function UtilisationQueue({
  rows,
  hint,
  footnote,
  emptyText,
  locale,
}: {
  rows: TeamUtilisation[];
  hint: string;
  footnote: React.ReactNode;
  emptyText: string;
  locale: string;
}) {
  const t = useTranslations("overview.utilisationByPerson");
  const tc = useTranslations("common");

  const columns: Column<TeamUtilisation>[] = [
    {
      key: "person",
      header: t("columns.person"),
      className: "w-[11rem] max-w-[11rem]",
      compare: (a, b) => cmpText(a.name, b.name),
      descFirst: false,
      cell: (r) => (
        /*
          Each row names a real person who has a record on /people — so it links
          there. A list of colleagues where nothing is clickable makes the reader
          go find the search box and retype a name they are already looking at.
        */
        <Link
          href={`/people?q=${encodeURIComponent(r.name)}`}
          title={r.name}
          className="block truncate text-[var(--text-primary)] underline-offset-2 hover:text-[var(--accent)] hover:underline"
        >
          {r.name}
        </Link>
      ),
    },
    {
      key: "team",
      header: t("columns.team"),
      compact: true,
      compare: (a, b) => cmpText(a.team, b.team),
      descFirst: false,
      /* "—", not "No team": nobody recorded one, which is an absence, and the
         footnote says so once rather than eleven times down the column. */
      cell: (r) =>
        r.team === null ? noLabel() : <span className="text-[var(--text-secondary)]">{r.team}</span>,
    },
    {
      key: "hours",
      header: t("columns.hours"),
      align: "right",
      compact: true,
      compare: (a, b) => cmpNum(a.entryCount === 0 ? null : a.hours, b.entryCount === 0 ? null : b.hours),
      nullish: (r) => r.entryCount === 0,
      cell: (r) =>
        /*
          A person with NO entries has 0 because nothing was summed, not because
          somebody measured zero. Rendering that as "0.0" in the same figure
          style as a colleague's 442.8 is the plausible zero the house rules
          forbid, so it renders "n/a" beside its already-absent utilisation --
          the same word the utilisation cell uses, and the same word the
          footnote promises.
        */
        r.entryCount === 0 ? (
          <span className="fig text-[var(--text-faint)]">{tc("notAvailable")}</span>
        ) : (
          <span className="fig text-[var(--text-primary)]">{fmtNum(r.hours, locale, 1)}</span>
        ),
    },
    {
      key: "utilisation",
      header: t("columns.utilisation"),
      align: "right",
      compact: true,
      compare: (a, b) => cmpNum(a.percent, b.percent),
      nullish: (r) => r.percent === null,
      cell: (r) =>
        r.percent === null ? (
          <span className="fig text-[var(--text-faint)]">{tc("notAvailable")}</span>
        ) : (
          <span
            className="fig"
            /*
              The figure takes the SAME tone as the dot beside it. Painting both
              "low" and "over capacity" the one red would say the two are the
              same problem, and `--warning` exists precisely so they do not have
              to be. Healthy stays in the text ladder: a figure is not decorated
              with teal (§8 #5).
            */
            style={{
              color:
                r.tone === "critical"
                  ? "var(--critical)"
                  : r.tone === "warning"
                    ? "var(--warning)"
                    : "var(--text-primary)",
            }}
          >
            {pct(r.percent, locale)}
          </span>
        ),
    },
    {
      key: "status",
      header: t("columns.status"),
      compact: true,
      compare: (a, b) => cmpNum(a.percent, b.percent),
      /* Sorted by the same figure as UTILISATION, so it pins the same rows. */
      nullish: (r) => r.percent === null,
      cell: (r) => {
        const { tone, word } = utilisationStatus(r, t);
        return <StatusDot tone={tone}>{word}</StatusDot>;
      },
    },
  ];

  return (
    <DataTable
      rows={rows}
      columns={columns}
      rowKey={(r) => r.name}
      title={t("title")}
      hint={hint}
      /* Lowest first: an attention list is ordered by severity, and the people
         barely tracking anything are the ones this figure exists to find. */
      initialSort="utilisation"
      initialDesc={false}
      fixedPageSize={10}
      pagerStyle="numbered"
      urlKeys={{ page: "upage", size: "usize" }}
      footnote={footnote}
      emptyText={emptyText}
    />
  );
}
