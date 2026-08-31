import Link from "next/link";

import { IconArrowRight, IconCheck } from "@/components/nav-icons";
import { MobileDisclosure } from "@/components/MobileDisclosure";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardHeader, StatTile } from "@/components/ui/Card";
import { Segmented } from "@/components/ui/Segmented";
import {
  hrefFor,
  parseKind,
  parsePages,
  type HygienePages,
  type KindFilter,
} from "@/lib/data-hygiene-url";
import {
  getDataHygiene,
  type HygieneFinding,
  type SubjectKind,
} from "@/lib/queries/data-hygiene";
import { requireProfile } from "@/utils/supabase/require-profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Data hygiene — where the company's records disagree with themselves.
 *
 * WHY THIS PAGE EXISTS
 * --------------------
 * Asked for after a specific symptom: "we have the same customers but with
 * different customer numbers, or vice versa". Both directions turned out to be
 * real, and measuring for them turned up twelve more
 * (scripts/audit-data-inefficiencies.mjs).
 *
 * WHAT IT DELIBERATELY IS NOT
 * ---------------------------
 * It is not a fix-it console. Every finding here is fixed somewhere else — in
 * Lexware, in the source workbook, or in the customer-master review queue — and
 * the panels say so. A "resolve" button on this page would either write a value
 * the next import reverts, or silently merge two records on name similarity,
 * which is the exact error ADR-001 exists to prevent.
 *
 * EXACT vs HEURISTIC
 * ------------------
 * Two badges, because they demand different responses. An `exact` finding is two
 * rows that must be one, proven by a key — actionable as stated. A `heuristic`
 * finding is a suspicion with its reasoning shown, and the page says outright
 * that some of them will be legitimate. A page that presents guesses as facts
 * gets ignored after the first false positive.
 *
 * EMPTY PANELS
 * ------------
 * There are none. The probes that found nothing are listed by name in a "checks
 * that passed" line instead of getting a panel each. A page of empty panels
 * trains the reader to stop reading.
 *
 * PAGING, NOT SAMPLING
 * --------------------
 * Each panel used to render the first 8 rows and disclose "showing 8 of 55".
 * Honest, and still a dead end: the other 47 orders were nowhere. Every panel is
 * now a paged table — 10 rows, page number in the URL per docs/UI-CONVENTIONS.md
 * rule 2 — so the reader can work THROUGH a finding rather than only be told how
 * big it is. Each finding pages on its own `?p_<key>=` param, because advancing
 * the unowned orders must not reset your place in the duplicate account numbers.
 *
 * The panels stay in a two-column grid from `lg` up. That is not decoration: at
 * 10 rows plus a header and a pager, eight stacked panels measure past DESIGN.md
 * rule 8's three-screen desktop ceiling, and two columns is the arrangement that
 * fixes the height without hiding a single row.
 *
 * ACCESS
 * ------
 * exec only. Not because the findings are sensitive in themselves, but because
 * the probes need to see the whole order book, and a dept_head reading a
 * department-scoped slice would see a partial report that looks complete —
 * which is worse than no report. The reader gets told when that happens rather
 * than being shown zero findings.
 */

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * One message per fault.
 *
 * The page used to render a single card for all three, and it named the one
 * cause that essentially cannot apply: the route is exec-only, so anybody able
 * to read the card already has the grants it told them to go and ask an exec
 * for. A truncated read and a failed read are operational faults and now read as
 * such; only the genuine permissions case keeps the reassuring wording.
 */
const UNAVAILABLE: Record<string, { qualifier: string; body: string }> = {
  denied: {
    qualifier: "NOT ENOUGH ACCESS",
    body:
      "These checks compare the whole order book against itself, so they need to "
      + "read every order. This session cannot, which means any report shown here "
      + "would be a partial one that looks complete. Nothing is wrong with your "
      + "account — ask an exec to run it.",
  },
  failed: {
    qualifier: "THE READ FAILED",
    body:
      "The probes could not read the order book. This is a fault rather than a "
      + "permissions problem, it is not something your account can fix, and the "
      + "error has been logged server-side. Nothing is known about the data either "
      + "way, so treat this as no report rather than as a clean one.",
  },
  truncated: {
    qualifier: "TOO MANY ROWS TO REASON ABOUT",
    body:
      "The order book came back larger than these checks are willing to compare "
      + "against itself, so they stopped rather than report on part of it. A partial "
      + "hygiene report is worse than none, because it reads as \u201cnothing more to "
      + "fix\u201d. Clearing this needs the probes\u2019 ceiling raised, not a retry.",
  },
};

const KIND_STYLE: Record<HygieneFinding["kind"], { label: string; className: string; title: string }> = {
  exact: {
    label: "PROVEN",
    className: "border-[var(--critical)] text-[var(--critical)]",
    title: "Established by an exact key: these rows must be one and are not.",
  },
  heuristic: {
    label: "WORTH A LOOK",
    className: "border-[var(--warning)] text-[var(--warning)]",
    title: "A suspicion, not a fact. Some of these will be legitimate — check each one.",
  },
};

/**
 * What a finding counts, and what its first column is called.
 *
 * The panels used to count everything in "cases", which reads as one uniform
 * unit of work. It is not: a row of `no_owner` is one order somebody can fix in
 * a minute, and a row of `name_many_numbers` is a company whose whole billing
 * history has to be merged. Naming the noun is the cheapest way to stop those
 * two counts being read as comparable.
 */
/**
 * When a `secondary` column is on screen, and when the prose sentence stands in
 * for the columns instead.
 *
 * THE RULE: from `sm` up, every column is shown. Below `sm` there is only room
 * for the subject, so the row's whole sentence is rendered under it instead.
 * That is the entire contract, and it is deliberately not clever.
 *
 * THREE VERSIONS WERE MEASURED AT 1440 / 1152 / 820 / 390 BEFORE THIS ONE.
 *
 *  1. `xl:table-cell` against a `max-sm:block` sentence left a dead band from
 *     640px to 1279px where the column was hidden AND its prose substitute was
 *     hidden: every 1024- and 1152-wide laptop saw neither. What vanished was
 *     not garnish — the Lexware numbers to merge, and the COMPARED column that
 *     the method text explicitly tells the reader to look at.
 *
 *  2. Closing that by showing the sentence between `lg` and `xl` made it far
 *     worse. At 1152px the grid was already two columns, so rows carried the
 *     sentence AND were half-width: rows went from 37px to 76px and the page
 *     measured 5,624px, 7.03 screens against a budget of three.
 *
 *  3. Splitting the grid at `xl` instead fixed the columns but not the height —
 *     one full-width column of eight panels is 4,396px at 1152px, 5.5 screens.
 *
 * What actually worked was to stop hiding anything: keep every column from `sm`
 * up and leave the grid splitting at `lg`. Cells truncate in a 435px panel at
 * 1152px, which is the same treatment they already get at 1440px, and the page
 * measures 2,744px there instead of 4,396. Truncated-with-a-title beats absent.
 *
 * Neither gate could have found any of this: the scroll budget measures 1440 and
 * 390 only, and the whole problem lived between them.
 */
const SECONDARY_AT = "sm:table-cell";
/** Below `sm`, where the columns cannot fit, the sentence carries their content. */
const SENTENCE_AT = "max-sm:block";

const SUBJECT: Record<SubjectKind, { one: string; many: string; column: string }> = {
  order: { one: "order", many: "orders", column: "ORDER ID" },
  customer: { one: "customer", many: "customers", column: "CUSTOMER" },
  account: { one: "account", many: "accounts", column: "ACCOUNT NO." },
  group: { one: "duplicate name", many: "duplicate names", column: "ORDER NAME" },
};

export default async function DataHygienePage({ searchParams }: { searchParams: SearchParams }) {
  await requireProfile("/data-hygiene", ["exec"]);

  const params = await searchParams;
  const kind = parseKind(params);
  const pages = parsePages(params);

  const { createClient } = await import("@/utils/supabase/server");
  const supabase = await createClient();
  const hygiene = await getDataHygiene(supabase, { pages });

  /*
   * The page numbers the query module actually SERVED, not the ones the URL
   * asked for. Every link on the page is built from these, so `?p_x=9999`
   * rewrites itself to the last page, a param for a finding that no longer
   * exists drops out instead of being carried for ever, and one view has one
   * URL.
   */
  /* One resolution of the fault, so the card's title and its wording can never
     disagree about which of the three happened. */
  const unavailableReason = hygiene.unavailableReason ?? "denied";

  const canonicalPages: HygienePages = Object.fromEntries(
    hygiene.findings.map((f) => [f.key, f.page]),
  );

  const exactCount = hygiene.findings
    .filter((f) => f.kind === "exact")
    .reduce((sum, f) => sum + f.count, 0);
  const suspectCount = hygiene.findings
    .filter((f) => f.kind === "heuristic")
    .reduce((sum, f) => sum + f.count, 0);

  const visible = hygiene.findings.filter((f) => kind === "all" || f.kind === kind);

  /*
   * The filter is a lens on the report, not a query: it hides panels that are
   * already loaded. Written as links rather than buttons so the view survives a
   * reload and can be pasted to somebody else, which is the whole reason page
   * state lives in the URL here.
   */
  // All three carry a count, or none should: one labelled option beside two
  // bare ones reads as a total rather than as "how many panels this shows".
  const exactPanels = hygiene.findings.filter((f) => f.kind === "exact").length;
  const kindLinks: { href: string; label: string }[] = [
    { href: hrefFor("all", {}), label: `ALL ${hygiene.findings.length}` },
    { href: hrefFor("exact", {}), label: `PROVEN ${exactPanels}` },
    { href: hrefFor("heuristic", {}), label: `WORTH A LOOK ${hygiene.findings.length - exactPanels}` },
  ];

  return (
    <>
      <PageHeader
        title="Data hygiene"
        meta="WHERE THE RECORDS DISAGREE WITH THEMSELVES · READ-ONLY · EXEC"
      />

      <div className="flex flex-col gap-[var(--card-gap)] px-4 py-4 sm:px-6">
        {hygiene.unavailable ? (
          <Card>
            <CardHeader
              title="Report unavailable"
              qualifier={UNAVAILABLE[unavailableReason].qualifier}
            />
            {/*
              TWO elements with FIXED roles, not one with `role={cond ? ...}`.
              Assistive tech classifies a node when it mounts, so a role computed
              at render time is announced as whatever it was first, or not at
              all — the house rule check-design-system enforces on the admin
              files, and it applies here for the same reason. The faults get
              `alert` because a reader who came for a report needs to be told it
              did not run; the permissions case is not an emergency and does not.
            */}
            {unavailableReason === "denied" ? (
              <div className="px-4 pb-4 text-[13px] leading-relaxed text-[var(--text-secondary)]">
                {UNAVAILABLE.denied.body}
              </div>
            ) : (
              <div role="alert" className="px-4 pb-4 text-[13px] leading-relaxed text-[var(--text-secondary)]">
                {UNAVAILABLE[unavailableReason].body}
              </div>
            )}
          </Card>
        ) : (
          <>
            {/*
              Two totals, kept apart on purpose. Summing proven and suspected
              findings into one number would let a reader treat a guess as a
              defect, and the whole point of the split is that they act differently.
            */}
            <div className="grid grid-cols-2 gap-[var(--card-gap)] sm:grid-cols-4">
              <StatTile
                label="PROVEN ISSUES"
                value={exactCount}
                hint="established by an exact key"
                tone={exactCount > 0 ? "critical" : "good"}
                data-metric="hygiene-exact"
              />
              <StatTile
                label="WORTH A LOOK"
                value={suspectCount}
                hint="suspicions, some will be fine"
                tone={suspectCount > 0 ? "warning" : "good"}
                data-metric="hygiene-heuristic"
              />
              {/*
                The figure the page was missing. Seven findings totalling 300 may
                be 300 broken orders or 60 orders each failing five checks, and
                those are different problems with different amounts of work in
                them. Counted once per order, from the full row sets rather than
                the rendered page, so it does not move as the reader pages.

                PROVEN findings only. Folding the heuristic in would put
                suspected orders inside a warning-toned tile with a progress bar
                across the order book, which is the same merge of fact and
                suspicion the two tiles above are kept apart to avoid.
              */}
              <StatTile
                label="ORDERS AFFECTED"
                value={hygiene.scope.affectedOrders}
                hint={
                  hygiene.scope.orders > 0
                    ? `of ${hygiene.scope.orders} read · proven only, counted once each`
                    : "no orders were read"
                }
                tone={hygiene.scope.affectedOrders > 0 ? "warning" : "good"}
                progressPercent={
                  hygiene.scope.orders > 0
                    ? (hygiene.scope.affectedOrders / hygiene.scope.orders) * 100
                    : null
                }
                data-metric="hygiene-affected-orders"
              />
              <StatTile
                label="CHECKS CLEAN"
                value={hygiene.clean.length}
                /* "listed below" is only true when there IS a list below. When
                   every probe fires the clean panel does not render, and an
                   unconditional hint would point at nothing. */
                hint={
                  hygiene.clean.length > 0
                    ? `of ${hygiene.scope.probes} run, listed below`
                    : `all ${hygiene.scope.probes} checks found something`
                }
                tone={hygiene.clean.length > 0 ? "good" : "neutral"}
                data-metric="hygiene-clean"
              />
            </div>

            {/*
              What was actually looked at. Without a denominator no finding on
              this page can be sized: "55 orders with no owner" is a rounding
              error against 40,000 and a crisis against 300, and the page used to
              print the numerator alone.
            */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-y border-[var(--divider)] py-2 font-mono text-[10px] tracking-[0.04em] text-[var(--text-faint)]">
              <span data-metric="hygiene-scope">
                SCANNED {hygiene.scope.orders.toLocaleString("en-GB")} ORDERS
              </span>
              <span>{hygiene.scope.customers.toLocaleString("en-GB")} CUSTOMER SPELLINGS</span>
              <span>{hygiene.scope.accountNumbers.toLocaleString("en-GB")} LEXWARE ACCOUNTS</span>
              <span>{hygiene.scope.probes} CHECKS RUN</span>
            </div>

            {hygiene.findings.length > 0 && (
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-mono text-[10px] tracking-[0.08em] text-[var(--text-faint)]">
                  SHOW
                </span>
                <Segmented
                  options={kindLinks}
                  current={hrefFor(kind, {})}
                  ariaLabel="Show findings"
                />
                {kind !== "all" && (
                  <span className="font-mono text-[10px] text-[var(--text-faint)]">
                    {visible.length} of {hygiene.findings.length} panels shown
                  </span>
                )}
              </div>
            )}

            {hygiene.findings.length === 0 ? (
              <Card>
                <CardHeader title="Nothing to report" qualifier="EVERY CHECK PASSED" />
                <div className="px-4 pb-4 text-[13px] text-[var(--text-secondary)]">
                  All {hygiene.clean.length} checks found nothing.
                </div>
              </Card>
            ) : (
              /*
                Two columns from `lg`. Eight panels of 10 rows stacked in one
                column measure past the three-screen desktop ceiling; side by
                side they fit, and no row had to be hidden to get there.

                Measured at four widths, because the two the gate checks turned
                out to be the two where nothing went wrong: 1440px is 2,546px
                (2.83 screens), 1152px is 2,744px (3.43), 820px is 4,554px
                (3.86, one column), 390px is 2,068px (2.45, panels collapsed).
                Splitting at `xl` instead was tried and measured worse — 1152px
                became a single 4,396px column — so the split stays at `lg` and
                the narrower panels truncate rather than hide. See SECONDARY_AT.

                Below `lg` it is one column, which is the only arrangement a
                390px viewport has.
              */
              <div className="grid grid-cols-1 items-start gap-[var(--card-gap)] lg:grid-cols-2">
                {visible.map((finding, index) => {
                  const style = KIND_STYLE[finding.kind];
                  const shown = finding.rows.length;
                  const hidden = finding.count - shown;

                  const panel = (
                    <FindingPanel
                      finding={finding}
                      shown={shown}
                      hidden={hidden}
                      kind={kind}
                      pages={canonicalPages}
                      /* The one hero card per page, on the worst finding.
                         Findings sort worst-first, so this is the "start here"
                         the card language asks every page to have exactly once. */
                      hero={index === 0}
                    />
                  );

                  /*
                   * At 390px every row stacks its subject above its detail, so
                   * the panels below the first are collapsed on a phone.
                   * MobileDisclosure is a plain wrapper from `sm:` up, so the
                   * desktop tree is untouched by this.
                   *
                   * The FIRST panel stays open: findings are sorted worst-first,
                   * and collapsing everything equally would turn the report into
                   * a menu rather than an answer. The rest state their count
                   * while shut, so a collapsed panel never reads as an absent one.
                   */
                  if (index === 0) return <div key={finding.key}>{panel}</div>;
                  return (
                    <MobileDisclosure
                      key={finding.key}
                      title={finding.title}
                      /* "cases", not the finding's own noun. The generic word is
                         load-bearing here: check-data-hygiene-disclosure asserts
                         the collapsed trigger matches /\d+\s+cases?/, which is
                         how it proves a shut panel still states its size. The
                         specific noun is on the panel itself, one tap away. */
                      summary={`${finding.count} ${finding.count === 1 ? "case" : "cases"} · ${style.label}`}
                    >
                      {panel}
                    </MobileDisclosure>
                  );
                })}
              </div>
            )}

            {/* Naming the clean checks is what makes the report trustworthy: it
                shows what was looked for and not found, so a missing panel reads
                as "checked" rather than "forgotten". */}
            {hygiene.clean.length > 0 && (
              <Card>
                <CardHeader title="Checks that found nothing" qualifier={`${hygiene.clean.length} CLEAN`} />
                <ul className="flex flex-col gap-1 px-4 pb-4">
                  {hygiene.clean.map((title) => (
                    <li key={title} className="flex items-center gap-1.5 text-[12px] text-[var(--text-faint)]">
                      {/* IconCheck, not a tick glyph: DESIGN.md craft floor bans
                          Unicode standing in for the icon system, and
                          test:design-system enforces it. */}
                      <IconCheck className="h-3 w-3 flex-none text-[var(--good)]" />
                      {title}
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            <p className="font-mono text-[10px] text-[var(--text-faint)]">
              read live at {hygiene.checkedAt.slice(0, 16).replace("T", " ")} UTC · no
              value on this page is cached, and nothing here writes to the database
            </p>
          </>
        )}
      </div>
    </>
  );
}

/**
 * One finding: what it is, what it costs, how it was measured, and one page of
 * its rows.
 *
 * The order is deliberate. Impact first, because it decides whether the reader
 * should care at all; the remedy next, because a list of problems with no stated
 * fix is a complaint; the method behind a disclosure, because it is what turns a
 * disputed finding into a settled one but is not needed on every read; and the
 * rows last.
 */
function FindingPanel({
  finding,
  shown,
  hidden,
  kind,
  pages,
  hero,
}: {
  finding: HygieneFinding;
  shown: number;
  hidden: number;
  kind: KindFilter;
  pages: HygienePages;
  hero: boolean;
}) {
  const style = KIND_STYLE[finding.kind];
  const noun = SUBJECT[finding.subjectKind];
  // Both are properties of the WHOLE finding, not of the page on screen. Read
  // off the slice, the severe count reads as zero on every page after the first
  // (rows sort severe-first), and the FIX column would appear and disappear as
  // the reader pages -- shifting every other column under `table-fixed`.
  const severeCount = finding.severeTotal;
  const anyHref = finding.hasLinks;

  return (
    /* No `h-full`: the grid item is an untracked wrapper div, so the percentage
       resolved against nothing and the declaration was dead. Stretching it for
       real would only open a void between the header block and the table on the
       shorter of two paired panels — `items-start` on the grid instead. */
    <Card as="section" tone={hero ? "hero" : "default"} className="flex flex-col">
      <CardHeader
        title={finding.title}
        qualifier={`${finding.count} ${finding.count === 1 ? noun.one : noun.many}`}
        actions={
          <span
            title={style.title}
            className={`flex-none border px-1.5 py-0.5 font-mono text-[9px] font-semibold tracking-[0.08em] ${style.className}`}
          >
            {style.label}
          </span>
        }
      />

      {/* What it costs, measured against the population actually scanned. This
          is the line that decides whether the reader cares at all, so it is set
          in --text-secondary with tabular figures rather than being the faintest
          string in a panel whose other two numbers are already faint. */}
      <p className="px-4 pb-2 font-mono text-[10px] leading-relaxed tracking-[0.02em] tabular-nums text-[var(--text-secondary)]">
        {finding.impact}
      </p>

      {/* What to do about it, before the rows. A list of problems with no stated
          remedy is a complaint, not a report. Set at 11px/snug rather than
          12px/relaxed: in a 575px column the looser setting ran to four lines on
          every panel, and four lines times eight panels is most of a screen
          spent on text nobody re-reads after the first visit. */}
      <p className="px-4 pb-3 text-[11px] leading-snug text-[var(--text-secondary)]">
        {finding.action}
      </p>

      {/*
        The method is collapsed rather than dropped. A reader who accepts the
        finding never needs it; a reader who disputes one needs it immediately,
        and "which words did it actually compare?" is the difference between
        dismissing a heuristic and arguing with it. Native <details>, so it costs
        no client JavaScript on a page that otherwise ships none.
      */}
      <details className="border-t border-[var(--divider)] px-4 py-2">
        <summary className="cursor-pointer font-mono text-[9px] font-semibold tracking-[0.1em] text-[var(--text-faint)] hover:text-[var(--text-secondary)]">
          HOW THIS WAS MEASURED
        </summary>
        <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--text-secondary)]">
          {finding.method}
        </p>
      </details>

      {/*
        A real <table>, not a list of divs: these are records with the same
        fields, and a screen reader should be able to say which column a value is
        in.

        WHY NOT DataTable, which DESIGN.md rule 1 asks for. The primitive is a
        client component that keeps its page in `useState`, and the whole point
        of this rewrite is that the page number lives in the URL — so back,
        refresh and a pasted link all work on a report somebody is meant to work
        through over a morning. It also carries sorting, search, CSV export and a
        column model that eight small heterogeneous tables do not want. The
        deviation costs this page rules 3 and 6, which are therefore honoured by
        hand: a sticky opaque header below, and an em dash for a missing number
        rather than a plausible zero.

        Below `sm` the table collapses to its subject column alone, with each
        row's sentence underneath it — the same shape the page had before, and
        the reason a phone gets no horizontal scrollbar. Nothing is duplicated
        into a second tree to achieve that; the extra columns are simply not
        displayed. See SECONDARY_AT for the widths.

        `table-fixed`, and every cell truncates to one line. Measured: with cells
        free to wrap, a customer name in a 575px column made rows 61px tall, the
        eight panels came to 3,754px, and the page opened at 4.17 screens against
        DESIGN.md rule 8's ceiling of three. One-line rows are 30px and the same
        page is 2.8.

        There is deliberately NO `overflow-x-auto` wrapper. One was here, and it
        did the opposite of what its own comment claimed: `table-fixed` cannot
        overflow horizontally in the first place, while setting `overflow-x`
        makes the div a scroll container on `overflow-y` too — which turned it
        into the nearest scrollport for the `sticky top-0` headers below. Having
        no height of its own, it never scrolled, so the headers never stuck to
        anything. Removing it is what makes DESIGN.md rule 3 true rather than
        merely typed.
      */}
      <div className="border-t border-[var(--divider)]">
        <table className="w-full table-fixed border-collapse text-left">
          {/* Eight tables on one document, none of which announced a name:
              screen-reader table navigation listed eight anonymous tables. */}
          <caption className="sr-only">{finding.title}</caption>
          <thead>
            <tr>
              {/* A width from `sm` only. Below it this is the ONLY column with a
                  layout box, and a fixed width there would leave the rest of the
                  table blank. */}
              <th
                scope="col"
                className="sticky top-0 z-10 bg-[var(--surface-2)] px-4 py-1.5 font-mono text-[9px] font-semibold tracking-[0.08em] text-[var(--text-faint)] sm:w-[10.5rem]"
              >
                {noun.column}
              </th>
              {finding.columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  title={column.hint}
                  className={`sticky top-0 z-10 hidden truncate bg-[var(--surface-2)] px-3 py-1.5 font-mono text-[9px] font-semibold tracking-[0.08em] text-[var(--text-faint)] ${
                    // Counts get a narrow fixed column so the prose columns keep
                    // the width; under table-fixed the rest share what is left.
                    column.align === "right" ? "text-right sm:w-[5rem]" : "text-left"
                  } ${column.secondary ? SECONDARY_AT : "sm:table-cell"}`}
                >
                  {column.label}
                </th>
              ))}
              {anyHref && (
                <th
                  scope="col"
                  className="sticky top-0 z-10 w-[5.75rem] whitespace-nowrap bg-[var(--surface-2)] px-3 py-1.5 text-right font-mono text-[9px] font-semibold tracking-[0.08em] text-[var(--text-faint)]"
                >
                  FIX
                </th>
              )}
            </tr>
          </thead>
          {/*
            `align-top`, not `align-baseline`. Truncating a cell gives it
            `overflow: hidden`, and a block container whose overflow is not
            visible has no baseline of its own — CSS synthesises one from its
            bottom edge. Under `vertical-align: baseline` the cells then align
            against inconsistent synthetic baselines and the row inflates:
            measured 61px per row against the 28px the same markup produces with
            top alignment, which on an eight-panel page was 343px of document
            height and nothing a reader could see the cause of.
          */}
          <tbody className="divide-y divide-[var(--divider)]">
            {finding.rows.map((row) => (
              <tr key={row.id} data-hygiene-row className="align-top">
                {/* `th scope="row"`, not a td: this cell IS the row's identity,
                    and marking it makes every other cell announce with it. */}
                <th
                  scope="row"
                  className={`px-4 py-1.5 text-left font-mono text-[11px] font-semibold text-[var(--text-primary)] ${
                    // The bar marks the rows that are worse than their
                    // neighbours. It is explained in the pager footer rather
                    // than in a legend of its own, which would cost a line on
                    // every panel to say something that applies to three.
                    row.severe ? "border-l-2 border-[var(--critical)]" : "border-l-2 border-transparent"
                  }`}
                >
                  {/*
                    Truncation is unconditional, not `sm:truncate`. The
                    responsive form measured 61px rows against 28px everywhere
                    else on the same page -- one variant quietly losing to the
                    base utility is invisible in the markup and cost 343px of
                    document height. An id or a name that does not fit is
                    recoverable from the cell's `title` and, on a phone, from the
                    sentence directly below it.
                  */}
                  <span className="block truncate" title={row.subject}>
                    {row.subject}
                  </span>
                  {/* The severity bar is a 2px border and nothing else — no
                      text, no glyph, nothing in the accessibility tree. The
                      footnote under the table referred to something a screen
                      reader could not perceive at all. */}
                  {row.severe && <span className="sr-only">flagged as one of the serious rows</span>}
                  {/*
                    The one-line sentence, shown only where the columns are not.
                    It carries the same facts the cells do, in prose, which is
                    also what a heuristic row needs in order to be judged.

                    `hidden max-sm:block`, not `block sm:hidden`: both spell the
                    same intent, but this one never asks which of two display
                    utilities wins.
                  */}
                  <span
                    className={`mt-0.5 hidden font-sans text-[11px] font-normal leading-snug text-[var(--text-secondary)] ${SENTENCE_AT}`}
                  >
                    {row.detail}
                  </span>
                </th>
                {finding.columns.map((column) => (
                  <td
                    key={column.key}
                    /* Only where the value can actually be cut off.
                       Unconditionally, a tooltip fired over two-character
                       numeric cells that were never truncated. */
                    title={(row.cells[column.key] ?? "").length > 12 ? row.cells[column.key] : undefined}
                    className={`hidden truncate px-3 py-1.5 text-[11px] leading-snug text-[var(--text-secondary)] ${
                      column.align === "right" ? "text-right" : "text-left"
                    } ${column.mono ? "font-mono tabular-nums" : ""} ${
                      column.secondary ? SECONDARY_AT : "sm:table-cell"
                    }`}
                  >
                    {row.cells[column.key] || "—"}
                  </td>
                ))}
                {anyHref && (
                  <td className="whitespace-nowrap px-3 py-1.5 text-right">
                    {row.href && (
                      <Link
                        href={row.href}
                        className="inline-flex items-center gap-1 font-mono text-[10px] tracking-[0.06em] text-[var(--accent)]"
                      >
                        REVIEW
                        <IconArrowRight className="h-2.5 w-2.5" />
                      </Link>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pager finding={finding} shown={shown} hidden={hidden} kind={kind} pages={pages} severeCount={severeCount} />
    </Card>
  );
}

/**
 * The pager for one finding.
 *
 * Boring on purpose, per docs/UI-CONVENTIONS.md rule 3: previous, a one-step
 * window around the current page with the middle elided, next. Server-rendered
 * `<Link>`s, so back/forward and a pasted URL all work — a client-state pager
 * would break every one of those and is the reason this page does not use
 * `src/components/Pager.tsx`, which is client-side by design.
 *
 * `scroll={false}` because the reader is already looking at the panel they are
 * paging; jumping to the top of the document on every click would be the app
 * taking the page away from them.
 */
function Pager({
  finding,
  shown,
  hidden,
  kind,
  pages,
  severeCount,
}: {
  finding: HygieneFinding;
  shown: number;
  hidden: number;
  kind: KindFilter;
  pages: HygienePages;
  severeCount: number;
}) {
  const noun = SUBJECT[finding.subjectKind];
  const rowEnd = finding.rowStart + shown - 1;

  const linkTo = (n: number) => hrefFor(kind, { ...pages, [finding.key]: n });

  // First, last, and a one-step window around the current page; everything else
  // elides. A pager listing 40 page numbers is a second list to read.
  const windowed: (number | "gap")[] = [];
  for (let n = 1; n <= finding.pageCount; n += 1) {
    if (n === 1 || n === finding.pageCount || Math.abs(n - finding.page) <= 1) windowed.push(n);
    else if (windowed[windowed.length - 1] !== "gap") windowed.push("gap");
  }

  const pageLink = (n: number, label: string, disabled: boolean, current = false) =>
    disabled ? (
      /* `aria-disabled`, not `aria-hidden`: hidden, a screen-reader user is
         never told the control exists, so there is no way to tell "no next
         page" from "this pager has no next button". */
      <span
        key={`${label}-off`}
        aria-disabled="true"
        className="border border-[var(--border)] px-2 py-0.5 font-mono text-[10px] text-[var(--text-faint)] opacity-40"
      >
        {label}
      </span>
    ) : (
      <Link
        key={`${label}-${n}`}
        href={linkTo(n)}
        scroll={false}
        aria-current={current ? "page" : undefined}
        aria-label={`${finding.title}, page ${n}`}
        className={`border px-2 py-0.5 font-mono text-[10px] tabular-nums transition-colors ${
          current
            ? "border-[var(--accent)] bg-[var(--accent-wash)] text-[var(--accent)]"
            : "border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--text-primary)]"
        }`}
      >
        {label}
      </Link>
    );

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-[var(--divider)] px-4 py-2">
      {/*
        A stacked column, not a wrapping row. Wrapping was tried and measured
        WORSE (2,533px to 2,575px): at 575px these three strings wrap onto three
        lines anyway and add the row gap on top of it.
      */}
      <div className="flex min-w-0 flex-col gap-0.5">
        {/*
          The range, in the form the scroll-budget gate reads out of the rendered
          text: a paged table that does not state its total is indistinguishable
          from a complete one (DESIGN.md rule 7).
        */}
        <span className="font-mono text-[10px] tracking-[0.04em] text-[var(--text-faint)]">
          {finding.rowStart}–{rowEnd} OF {finding.count} {noun.many.toUpperCase()}
          {finding.pageCount > 1 && ` · PAGE ${finding.page} OF ${finding.pageCount}`}
        </span>
        {/* Only while there IS a rest. On the last page `hidden` is still large
            -- it is the whole finding minus this page -- so the unguarded form
            told a reader at the end of the queue to keep paging. */}
        {hidden > 0 && finding.page < finding.pageCount && (
          <span className="font-mono text-[9px] text-[var(--text-faint)]">
            showing {shown} of {finding.count} here — page through for the rest
          </span>
        )}
        {severeCount > 0 && (
          <span className="font-mono text-[9px] text-[var(--critical)]">
            {severeCount} barred {severeCount === 1 ? "row is" : "rows are"} the serious ones
          </span>
        )}
      </div>

      {finding.pageCount > 1 && (
        <nav aria-label={`${finding.title} pages`} className="flex flex-wrap items-center gap-1">
          {pageLink(finding.page - 1, "PREV", finding.page === 1)}
          {windowed.map((n, i) =>
            n === "gap" ? (
              <span key={`gap-${i}`} aria-hidden className="px-0.5 font-mono text-[10px] text-[var(--text-faint)]">
                …
              </span>
            ) : (
              pageLink(n, String(n), false, n === finding.page)
            ),
          )}
          {pageLink(finding.page + 1, "NEXT", finding.page === finding.pageCount)}
        </nav>
      )}
    </div>
  );
}
