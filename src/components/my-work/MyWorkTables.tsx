"use client";
/**
 * MyWorkTables — the two real tables that replace 44 accordion cards.
 *
 * WHAT THIS REPLACES, AND WHY
 * ---------------------------
 * The previous shape was one `<details>` card per customer, each holding its own
 * `<table>`. Measured for Mathias at 1440×900 that was 44 tables and 3,149px —
 * 3.5 screens — and 37 of those cards were a single collapsed row carrying one
 * badge. The grouping was right about the domain (a customer is the unit of
 * accountability) and wrong about the shape: 44 tables of 1–4 rows is a list of
 * lists, and "which customers am I responsible for" meant scrolling past 37
 * cards that are only cover work.
 *
 * So the projects become ONE table of 54 rows with a Customer column, and the
 * customer grouping survives as a SECOND table of one row per customer rather
 * than as 43 disclosure triangles. Both render through the house
 * `DataTable` primitive, so they inherit sort with explicit null placement,
 * search, 25/50/100/ALL paging, CSV, a sticky header and a bounded body — the
 * six things the hand-rolled version re-decided per card.
 *
 * WHY PROJECTS IS THE DEFAULT VIEW
 * --------------------------------
 * The user asked for "proper page like tables", and the projects table is the
 * one that answers a question without a second click: 54 rows, sorted strongest
 * claim first, with the customer beside each. The customers view answers "what
 * is the state of play at Hochtief" — a real question, but a lookup, and a
 * lookup is what the ROLE filter plus the search box already serve.
 *
 * WHY THE ROLE FILTER IS OUTSIDE DataTable
 * ----------------------------------------
 * "Show me only what I lead" is the page's central question and must be one
 * click, not a typed search term that would also match a project NAMED
 * "responsible". So the filter is applied here, above the primitive, and the
 * primitive keeps its single responsibility. The chips use the same RoleBadge as
 * the rows, so the control and the data it selects look like each other.
 *
 * WHY A CLIENT COMPONENT AT ALL
 * -----------------------------
 * The page stays a server component and hands over the assembled rows (54 of
 * them, already aggregated). Only this presentation shell is client-side, which
 * is the same split DataTable was built for: no round trip to re-sort a column
 * or flip a filter.
 *
 * WHAT THE PROJECTS TABLE NO LONGER CARRIES
 * -----------------------------------------
 * LOGGED, BUDGET and BURN are gone from this view, on the owner's instruction
 * and for a reason the live page made obvious: /my-work is an employee's
 * surface, employees do not hold `projects:contracts:read`, and BUDGET and BURN
 * therefore printed the literal word "withheld" on all 54 rows. Two columns of
 * a constant are not a measurement, they are furniture that reports the
 * reader's permissions once per row. LOGGED went with them because the summary
 * strip above already states the team hours total and nothing on this page acts
 * on the per-project figure.
 *
 * They are removed HERE ONLY. /projects still carries all three in full for
 * whoever may see them, and the customers view below still carries BUDGET,
 * where it is one row per customer rather than 54 rows of "withheld" and is the
 * only per-customer roll-up on the page.
 *
 * The width those three freed is what pays for five link columns instead of
 * one -- see the block that builds them.
 */
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { DataTable, cmpNum, cmpText, type Column } from "@/components/data-table";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/Button";
import { FilterChip } from "@/components/ui/Field";
import { Pill, segmentedItemClass, segmentedTrackClass } from "@/components/ui/Segmented";
import { IconCross } from "@/components/nav-icons";
import {
  LINK_DESTINATION,
  LINK_LABEL,
  LINK_ORDER,
  ROLE_LABEL,
  ROLE_ORDER,
  type MyCustomer,
  type MyProject,
  type MyRole,
} from "@/lib/queries/my-work";
import { LINK_ICON } from "./link-icons";
import { RoleBadge } from "./RoleBadge";

/** `n/a` rather than 0: an unrecorded figure and a real zero are different facts. */
function hours(n: number | null): string {
  if (n === null) return "n/a";
  return n.toLocaleString("en-GB", { maximumFractionDigits: 1 });
}

function statusTone(status: string): "critical" | "warning" | "neutral" {
  if (status === "CRITICAL") return "critical";
  if (status === "WARNING") return "warning";
  return "neutral";
}

const rank = (r: MyRole) => ROLE_ORDER.indexOf(r);

type View = "projects" | "customers";

export function MyWorkTables({
  projects,
  customers,
  showMyHours,
  budgetsWithheld,
  roleCounts,
  footnote,
}: {
  projects: MyProject[];
  customers: MyCustomer[];
  /**
   * True when the caller does not hold projects:contracts:read.
   *
   * Changes what a null budget MEANS, so it changes what the cell says: "no
   * budget" is a fact about the project, "withheld" is a fact about the reader.
   *
   * Now consumed by the CUSTOMERS view only. The projects table no longer has a
   * budget column to qualify -- see the note at the top of this file.
   */
  budgetsWithheld: boolean;
  /** False when person_assignments.logged_hours is unpopulated for this user. */
  showMyHours: boolean;
  /** Totals per rung, used to label the filter chips honestly. */
  roleCounts: Record<MyRole, number>;
  /** The hours caveat, rendered under the table it applies to. */
  footnote?: React.ReactNode;
}) {
  // The chrome this component adds around the two tables -- the view switch,
  // the role filter, the clear control and the table titles -- reads from the
  // catalogue. Column headers and hints keep their English literals: several
  // are pinned by check-my-work-services.mjs, and moving the rest is its own
  // change with that gate.
  const t = useTranslations("myWork");
  const [view, setView] = useState<View>("projects");
  const [role, setRole] = useState<MyRole | "all">("all");
  /**
   * Drill-down from the customers table into the projects table. Held here
   * rather than inside DataTable's search box because it is an exact match on a
   * customer name, not a substring: "Techspace EIS GmbH" must not also select
   * "Techspace BER GmbH".
   */
  const [customer, setCustomer] = useState<string | null>(null);

  const filteredProjects = useMemo(
    () =>
      projects.filter(
        (p) =>
          (role === "all" || p.role === role) &&
          (customer === null || p.customer === customer),
      ),
    [projects, role, customer],
  );

  const filteredCustomers = useMemo(
    () => (role === "all" ? customers : customers.filter((c) => c.roleCounts[role] > 0)),
    [customers, role],
  );

  /**
   * How many of the rows on screen carry each kind of link.
   *
   * This exists to answer one specific question the five columns raise and
   * cannot answer themselves: Mathias has 32 TrackingTime links and ZERO Asana
   * boards, so his ASANA column is empty top to bottom. Empty is the correct
   * rendering, but an empty column is also what a broken column looks like, and
   * the reader has no way to tell those apart by looking. Stating the count
   * settles it -- "ASANA none" is a measurement, not a missing one.
   *
   * Counted in LINK_ORDER, i.e. left-to-right column order, so the line reads
   * as a legend for the block above it rather than as a separate statistic.
   */
  const linkInventory = useMemo(
    () =>
      LINK_ORDER.map((kind) => ({
        kind,
        count: filteredProjects.filter((p) => p.links.some((l) => l.kind === kind)).length,
      })),
    [filteredProjects],
  );

  const projectColumns: Column<MyProject>[] = useMemo(() => {
    const cols: Column<MyProject>[] = [
      {
        key: "customer",
        header: "CUSTOMER",
        // 12rem, matching the cap on the button below. The two must agree: a
        // wider cell than the button can fill would truncate a name early and
        // leave the gap beside it. 12 rather than 13 buys the PROJECT column
        // 16px at 1280, which is the difference between "Brandschutzkonzept"
        // fitting on one line and breaking mid-word.
        className: "w-[12rem]",
        compare: (a, b) => cmpText(a.customer, b.customer),
        descFirst: false,
        title: "The canonical legal entity this project is booked under",
        search: (r) => `${r.customer} ${r.customerText}`,
        csv: (r) => r.customer,
        cell: (r) => (
          <button
            type="button"
            onClick={() => {
              setCustomer(r.customer);
              setView("projects");
            }}
            title={`Show only ${r.customer}`}
            /*
             * max-w-[12rem], NOT max-w-full, and this single class is worth 94px
             * of table width.
             *
             * `truncate` sets white-space: nowrap, and in an auto-layout table a
             * nowrap cell contributes its FULL string to the column's
             * min-content width. max-w-full then resolves against a cell whose
             * width is itself being computed from that contribution, so it
             * constrains nothing and the ellipsis never fires: a 38-character
             * customer name claimed 318px of column and the browser had no way
             * to refuse. A real length caps the contribution.
             *
             * Measured in Chromium against the compiled stylesheet, with this
             * class removed and restored, everything else held constant:
             *   with    min-content 975px, CUSTOMER 224px, fits 1280
             *   without min-content 1069px, CUSTOMER 318px, scrolls at 1280
             * `block` beside it is idiom, not mechanism -- removing it moves
             * neither number. Do not "simplify" by keeping block and dropping
             * the cap.
             *
             * The cap relaxes to 18rem at 2xl, where there is width to spare, so
             * a big monitor shows more of the name instead of an ellipsis beside
             * empty space. It stays a cap: at 1920 min-content is 1069 against
             * 1550 available. The full name is in the tooltip either way.
             */
            className="block max-w-[12rem] truncate text-left text-[12px] text-[var(--text-primary)] underline-offset-2 hover:text-[var(--accent)] hover:underline 2xl:max-w-[18rem]"
          >
            {r.customer}
          </button>
        ),
      },
      {
        key: "project",
        header: "PROJECT",
        /*
         * A PREFERENCE, not a floor: an auto-layout table treats a specified
         * width as where the column would like to land, and min-content still
         * wins when space is short -- verified, the table's min-content is 975px
         * with this class and 975px without it.
         *
         * It is here because the name is the row's subject and should get the
         * slack before anything else does. Without it the leftover width fell to
         * whichever column had no width of its own, which at 1920 meant a 449px
         * DUE column holding ten characters. DUE now carries a width for the
         * same reason.
         */
        className: "w-[15rem]",
        compare: (a, b) => cmpText(a.name, b.name),
        descFirst: false,
        search: (r) => `${r.name} ${r.code} ${r.orderNo ?? ""}`,
        csv: (r) => `${r.name} (${r.code})`,
        cell: (r) => (
          <div className="flex flex-col gap-0.5">
            {/*
              overflow-wrap: anywhere, not break-word -- only `anywhere` lowers
              the element's min-content contribution, and that contribution is
              the whole problem here. A 23-character German compound
              ("Gefaehrdungsbeurteilung") is one unbreakable word to the layout
              engine, so it set a 191px floor under this column and the table
              could not fit 1280 however much else was cut. Allowing it to break
              costs a mid-word split on a narrow screen and buys 45px; the
              alternative was scrolling the whole table sideways.
            */}
            <span className="[overflow-wrap:anywhere] text-[12px] text-[var(--text-primary)]">
              {r.name}
            </span>
            <span className="font-mono text-[10px] text-[var(--text-faint)]">
              {r.code}
              {/* The masterdata order number ONLY when it differs from the code:
                  the live import set order_no to the project id itself, so
                  printing it unconditionally repeated the same string twice. */}
              {r.orderNo && r.orderNo !== r.code ? ` · order ${r.orderNo}` : ""}
            </span>
          </div>
        ),
      },
      {
        key: "role",
        header: "MY ROLE",
        compact: true,
        className: "w-[8.5rem]",
        // Strongest claim first, so the default sort puts the four projects he
        // answers for at the top rather than in alphabetical order.
        compare: (a, b) => rank(b.role) - rank(a.role),
        title: "Responsible > owner > replacement > assigned. Every project sits on exactly one rung.",
        search: (r) => ROLE_LABEL[r.role],
        csv: (r) => ROLE_LABEL[r.role],
        cell: (r) => <RoleBadge role={r.role} />,
      },
      {
        key: "status",
        header: "STATUS",
        compact: true,
        className: "w-[6.5rem]",
        compare: (a, b) => cmpText(a.status, b.status),
        descFirst: false,
        search: (r) => r.status,
        csv: (r) => r.status,
        cell: (r) => <StatusBadge status={r.status} tone={statusTone(r.status)} />,
      },
      {
        key: "service",
        header: "SERVICE",
        compact: true,
        className: "w-[10rem]",
        compare: (a, b) => cmpText(a.services.join(", "), b.services.join(", ")),
        descFirst: false,
        title:
          "TrackingTime service tag, not a contractual agreement -- the framework-agreement table is not populated yet.",
        search: (r) => r.services.join(" "),
        csv: (r) => r.services.join(" / "),
        cell: (r) => (
          <span className="font-mono text-[11px] text-[var(--text-secondary)]">
            {/* No time.project row at all for this project (9 of 54 on live
                data) -- honest n/a, never a blank cell or a guessed service. */}
            {r.services.length > 0 ? r.services.join(" · ") : "n/a"}
          </span>
        ),
      },
      {
        key: "due",
        header: "DUE",
        compact: true,
        // Stated so this column stops being the sink for whatever width the
        // others do not claim -- unwidthed, it took 449px at 1920 to hold a
        // ten-character date.
        className: "w-[7rem]",
        align: "right",
        compare: (a, b) => cmpText(a.dueDate, b.dueDate),
        descFirst: false,
        csv: (r) => r.dueDate ?? "",
        cell: (r) => (
          // whitespace-nowrap because an ISO date offers the layout engine two
          // break opportunities at its hyphens, and it takes them: at 1280 this
          // column was rendering "2026-04-" over "19", which reads as two
          // fields. Its min-content rises from 52px to 82px, which the width
          // budget can afford; a date split across two lines it cannot.
          <span className="whitespace-nowrap font-mono text-[11px] text-[var(--text-muted)]">
            {r.dueDate ?? "n/a"}
          </span>
        ),
      },
    ];

    // The "mine" column appears ONLY when the assignment rows actually carry
    // hours. On live data they do not, and a column reading 0 beside a real team
    // figure is a plausible wrong number — the page states the gap instead.
    if (showMyHours) {
      // Before DUE, so the one remaining measure sits with the attributes
      // rather than inside the destination block that follows. BUDGET and BURN,
      // which it used to sit between, are gone.
      cols.splice(5, 0, {
        key: "mine",
        header: "MINE",
        align: "right",
        compare: (a, b) => cmpNum(a.myLoggedHours, b.myLoggedHours),
        title: "Hours your own assignment row carries for this project",
        csv: (r) => r.myLoggedHours ?? "",
        cell: (r) => (
          <span className="font-mono text-[11px] text-[var(--text-faint)]">
            {hours(r.myLoggedHours)}
          </span>
        ),
      });
    }

    /*
     * ONE COLUMN PER DESTINATION, and they go LAST.
     *
     * The single mixed LINKS column could be read across a row ("what does this
     * project have?") but never down ("which of my projects has an Asana
     * board?") -- answering that meant reading 54 cells and decoding the glyph
     * in each. A column per kind turns it into a glance: the marks in the ASANA
     * column ARE the answer, and their absence is equally readable.
     *
     * Rightmost because they are the row's exits rather than its facts.
     * Everything left of the fence describes the project; everything right of
     * it takes you somewhere else.
     *
     * The header does the naming, so the glyph in the cell is not a label -- it
     * is the affordance and the 24px target. It is kept anyway because the
     * row-wise read must survive the change: a person looking at ONE project
     * still sees which destinations exist without mapping cell positions back
     * to a sticky header. It costs nothing in width either way, since the
     * header string is wider than the target beneath it.
     */
    for (const [i, kind] of LINK_ORDER.entries()) {
      const Icon = LINK_ICON[kind];
      const destination = LINK_DESTINATION[kind];
      const of = (r: MyProject) => r.links.filter((l) => l.kind === kind);
      cols.push({
        key: `link:${kind}`,
        header: LINK_LABEL[kind],
        // Narrow gutters: 32px of padding around a 24px target, five times
        // over, is 80px of table width spent on air.
        compact: true,
        /*
         * `w-px` is not one pixel -- a table cell can never render narrower
         * than its content, so it means "take min-content and give the slack to
         * the columns that can use it". Here min-content is the header string,
         * because the cell under it is one 24px mark.
         *
         * The fence on the first of them is the only thing that says these five
         * are one group. Without it a row whose five cells are all empty -- 216
         * of Mathias's 270 link cells are -- reads as the table having run out
         * rather than as five honest noes.
         */
        className: i === 0 ? "w-px border-l border-[var(--divider)]" : "w-px",
        /*
         * DELIBERATELY UNSORTABLE, and it is the search box that replaces it.
         *
         * A presence column can only sort one way -- "the ones that have it
         * first" -- and that is the question this design already answers by
         * looking. What it cost was real: DataTable draws a sort caret in every
         * sortable header, and a caret plus its gap is ~8px on a column whose
         * entire content is a 24px mark. Five of them came to 40px, which was
         * the difference between clearing 1280 by 6px and clearing it by 46.
         *
         * Nothing is lost, because filtering beats sorting for this question:
         * typing "asana" in the search box shows ONLY the projects with a
         * board, where sorting merely floated them. The tooltip says so, since
         * a reader cannot guess it.
         */
        title: `${destination}, when one was recorded in the masterdata workbook. An empty cell means nobody recorded one -- there is no figure being withheld. Type "${LINK_LABEL[kind].toLowerCase()}" in the search box to see only the projects that have one.`,
        // Both the short code and the full name, so that search is exact.
        search: (r) => (of(r).length > 0 ? `${LINK_LABEL[kind]} ${destination}` : ""),
        /*
         * One CSV column per kind too, holding the URL. A spreadsheet built
         * from this file can then be sorted and filtered on a destination the
         * same way the table can, which a single "CHAT=... TT=..." cell made
         * impossible. Empty means no link, consistent with the screen.
         */
        csv: (r) =>
          of(r)
            .map((l) => l.url)
            .join(" "),
        cell: (r) => {
          const mine = of(r);
          // NOTHING when there is no link of this kind, deliberately -- not
          // "n/a". An absent link is not an unmeasured figure being withheld,
          // it is a link nobody recorded, and 216 of the 270 cells in this
          // block are empty: a placeholder repeated that often is noise
          // pretending to be data. The row borders and the group fence keep an
          // all-empty row readable without one.
          if (mine.length === 0) return null;
          return (
            <span className="flex flex-wrap items-center gap-0.5">
              {/*
                Usually exactly one. `project_link` is unique on
                (project_id, kind, url), NOT on (project_id, kind), so a project
                may legitimately carry two Asana boards -- rendering only the
                first would silently drop a working link.
              */}
              {mine.map((l) => (
                <a
                  key={l.url}
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={l.label ? `${destination} — ${l.label}` : destination}
                  // The row's project is named too: a screen reader running the
                  // page's link list would otherwise meet the same
                  // "TrackingTime project" 32 times with nothing to tell them
                  // apart.
                  aria-label={
                    l.label
                      ? `${destination} for ${r.name} — ${l.label}`
                      : `${destination} for ${r.name}`
                  }
                  className="flex h-6 w-6 flex-none items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-muted)] transition-colors duration-150 hover:bg-[var(--accent-wash)] hover:text-[var(--accent)] focus-visible:bg-[var(--accent-wash)] focus-visible:text-[var(--accent)] pointer-coarse:h-8 pointer-coarse:w-8"
                >
                  <Icon className="h-4 w-4" />
                </a>
              ))}
            </span>
          );
        },
      });
    }

    return cols;
  }, [showMyHours]);

  const customerColumns: Column<MyCustomer>[] = useMemo(() => {
    const cols: Column<MyCustomer>[] = [
      {
        key: "customer",
        header: "CUSTOMER",
        className: "w-[18rem]",
        compare: (a, b) => cmpText(a.customer, b.customer),
        descFirst: false,
        search: (r) => `${r.customer} ${r.aliases.join(" ")}`,
        csv: (r) => r.customer,
        cell: (r) => (
          // The cap sits on the wrapper, not the button: the alias line under it
          // is `truncate` too, and would otherwise hold the column open on its
          // own for exactly the reason described on the projects table above --
          // and an alias line ("booked as X - Y") is the longer of the two.
          //
          // 18rem to MATCH this column's own w-[18rem]. A cap narrower than the
          // cell it sits in buys nothing and truncates a name while the space
          // to show it sits empty alongside.
          <div className="flex min-w-0 max-w-[18rem] flex-col gap-0.5">
            <button
              type="button"
              onClick={() => {
                setCustomer(r.customer);
                setView("projects");
              }}
              title={`Show this customer's ${r.projectCount} project${r.projectCount === 1 ? "" : "s"}`}
              className="block truncate text-left text-[12px] text-[var(--text-primary)] underline-offset-2 hover:text-[var(--accent)] hover:underline"
            >
              {r.customer}
            </button>
            {/* The merge, shown rather than assumed: "GEPLAHN-T" and
                "GEPLAHN-T GmbH" are one legal entity, and folding them silently
                leaves a customer count nobody can reconcile. */}
            {r.aliases.length > 0 ? (
              <span className="truncate font-mono text-[10px] text-[var(--text-faint)]">
                booked as {r.aliases.join(" · ")}
              </span>
            ) : null}
            {r.entityId === null ? (
              <span
                title="Not linked to a canonical legal entity, so this row is keyed on the free-text name"
                className="font-mono text-[10px] text-[var(--text-faint)]"
              >
                UNLINKED
              </span>
            ) : null}
          </div>
        ),
      },
      {
        key: "topRole",
        header: "MY STRONGEST ROLE",
        className: "w-[11rem]",
        compare: (a, b) => rank(b.topRole) - rank(a.topRole),
        title: "The strongest claim you hold on any project for this customer",
        search: (r) => ROLE_LABEL[r.topRole],
        csv: (r) => ROLE_LABEL[r.topRole],
        cell: (r) => <RoleBadge role={r.topRole} />,
      },
      {
        key: "breakdown",
        header: "MY PROJECTS",
        className: "w-[16rem]",
        compare: (a, b) => a.projectCount - b.projectCount,
        title: "Every project of yours for this customer, split by rung",
        csv: (r) =>
          ROLE_ORDER.filter((x) => r.roleCounts[x] > 0)
            .map((x) => `${r.roleCounts[x]} ${ROLE_LABEL[x]}`)
            .join(" / "),
        cell: (r) => (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-[11px] text-[var(--text-secondary)]">
              {r.projectCount}
            </span>
            {ROLE_ORDER.filter((x) => r.roleCounts[x] > 0).map((x) => (
              <span key={x} className="flex flex-none items-center gap-1">
                <span className="font-mono text-[10px] text-[var(--text-muted)]">
                  {r.roleCounts[x]}
                </span>
                <RoleBadge role={x} />
              </span>
            ))}
          </div>
        ),
      },
      {
        key: "services",
        header: "SERVICES",
        className: "w-[12rem]",
        compare: (a, b) => cmpText(a.services.join(", "), b.services.join(", ")),
        descFirst: false,
        title:
          "TrackingTime service tags across this customer's projects, not a contractual agreement.",
        search: (r) => r.services.join(" "),
        csv: (r) => r.services.join(" / "),
        cell: (r) => (
          <div className="flex flex-wrap items-center gap-1">
            {/* A service tag is a status-shaped token, so it wears the Pill:
                rounded-full is "a choice or a status" in the radius vocabulary. */}
            {r.services.length > 0 ? (
              r.services.map((s) => <Pill key={s}>{s}</Pill>)
            ) : (
              <span className="font-mono text-[11px] text-[var(--text-faint)]">n/a</span>
            )}
          </div>
        ),
      },
      {
        key: "logged",
        header: "LOGGED",
        align: "right",
        compare: (a, b) => a.loggedHours - b.loggedHours,
        title: "Team hours logged across your projects for this customer",
        csv: (r) => r.loggedHours,
        cell: (r) => (
          <span className="font-mono text-[11px] text-[var(--text-secondary)]">
            {hours(r.loggedHours)}
          </span>
        ),
      },
      {
        key: "budget",
        header: "BUDGET",
        align: "right",
        compare: (a, b) => cmpNum(a.contractHours, b.contractHours),
        title: budgetsWithheld
          ? "Project budgets are not visible to your role."
          : "Contracted hours summed across your projects for this customer",
        csv: (r) => r.contractHours ?? "",
        cell: (r) => (
          <span className="font-mono text-[11px] text-[var(--text-muted)]">
            {/* 0 summed contract hours across the group means no budget was set
                on any of them, which is not a budget of zero -- and null means
                the reader may not see it, which is neither. */}
            {budgetsWithheld
              ? "withheld"
              : (r.contractHours ?? 0) > 0
                ? hours(r.contractHours)
                : "no budget"}
          </span>
        ),
      },
    ];

    if (showMyHours) {
      cols.push({
        key: "mine",
        header: "MINE",
        align: "right",
        compare: (a, b) => a.myLoggedHours - b.myLoggedHours,
        title: "Hours your own assignment rows carry for this customer",
        csv: (r) => r.myLoggedHours,
        cell: (r) => (
          <span className="font-mono text-[11px] text-[var(--text-faint)]">
            {hours(r.myLoggedHours)}
          </span>
        ),
      });
    }

    return cols;
  }, [showMyHours, budgetsWithheld]);

  const roleChips: { value: MyRole | "all"; label: string; count: number }[] = [
    {
      value: "all",
      label: t("filters.all"),
      count: ROLE_ORDER.reduce((s, r) => s + roleCounts[r], 0),
    },
    ...ROLE_ORDER.map((r) => ({ value: r, label: ROLE_LABEL[r], count: roleCounts[r] })),
  ];

  const activeCustomer = customer;

  return (
    <div className="flex flex-col gap-2">
      {/*
        One row of controls, above both tables because both obey them. The role
        filter is the page's central question ("what do I lead?") reduced to one
        click; the view switch decides whether the answer is counted per project
        or per customer.
      */}
      <div className="flex flex-wrap items-center gap-2">
        {/*
          The view switch wears the segmented skin: a choice among a few, with
          the chosen one an accent pill on a recessed track -- the same control
          the /projects billable trough and every Segmented in the app draw.
          It is buttons, not Segmented's links, because the view is in-memory
          state and a URL round trip per click would be a regression.
        */}
        <div role="group" aria-label={t("views.label")} className={segmentedTrackClass}>
          {(
            [
              { v: "projects" as View, label: t("views.projects"), n: projects.length },
              { v: "customers" as View, label: t("views.customers"), n: customers.length },
            ]
          ).map((option) => (
            <button
              key={option.v}
              type="button"
              onClick={() => setView(option.v)}
              aria-pressed={view === option.v}
              title={
                option.v === "projects"
                  ? "One row per project, with its customer beside it"
                  : "One row per customer, with your projects and hour totals for it"
              }
              className={segmentedItemClass(view === option.v)}
            >
              {option.label}{" "}
              <span className={view === option.v ? "opacity-70" : "text-[var(--text-faint)]"}>
                {option.n}
              </span>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--text-faint)]">
            {t("filters.role")}
          </span>
          {/*
            FilterChip, the house filter: one chip per rung with its count, the
            same control the /projects and /people filter rows use. The chip
            used to wrap a RoleBadge -- a pill inside a square chip -- so the
            filter and the row badge were the same token at two sizes. The
            badge stays in the rows, where it IS the information; the chip is
            a filter and looks like one.
          */}
          {roleChips.map((c) => (
            <FilterChip
              key={c.value}
              active={role === c.value}
              onToggle={() => setRole(c.value)}
              count={c.count}
              title={
                c.value === "all"
                  ? "Every project you have any claim on"
                  : `Only the ${c.count} where you are ${c.label.toLowerCase()}`
              }
            >
              {c.label}
            </FilterChip>
          ))}
        </div>

        {/* The drill-down is stated and reversible. A silently filtered table
            whose control is elsewhere is how a reader concludes rows are
            missing. A ghost button with the icon-set cross, not a chip with a
            typographic ×. */}
        {activeCustomer ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCustomer(null)}
            title={t("filters.clearCustomer")}
          >
            <IconCross className="h-3.5 w-3.5" />
            <span className="max-w-[16rem] truncate">{activeCustomer}</span>
          </Button>
        ) : null}
      </div>

      {view === "projects" ? (
        <DataTable<MyProject>
          rows={filteredProjects}
          columns={projectColumns}
          rowKey={(r) => r.id}
          title={t("tables.projects")}
          hint={
            role === "all" && activeCustomer === null
              ? "strongest claim first"
              : `filtered${role === "all" ? "" : ` to ${ROLE_LABEL[role]}`}${
                  activeCustomer ? ` · ${activeCustomer}` : ""
                } of ${projects.length}`
          }
          initialSort="role"
          initialDesc
          exportName="my-work-projects"
          searchPlaceholder="Search projects…"
          emptyText="No projects are assigned to you."
          // Bounded body: the rows scroll inside the card so the filter above
          // and the footnote below stay reachable, and the page does not grow.
          maxBodyHeight
          freezeFirstColumn
          footnote={
            <>
              {footnote ? <>{footnote} </> : null}
              Recorded links across these {filteredProjects.length} projects —{" "}
              {linkInventory.map((x, i) => (
                <span key={x.kind}>
                  {i > 0 ? " · " : ""}
                  {LINK_LABEL[x.kind]}{" "}
                  {/* "none", not "0": a column that is empty end to end should
                      say so in words, because a bare zero under an empty column
                      is exactly what a broken column would also print. */}
                  {x.count === 0 ? "none" : x.count}
                </span>
              ))}
              . An empty cell means nobody recorded that link, not a withheld figure.
            </>
          }
        />
      ) : (
        <DataTable<MyCustomer>
          rows={filteredCustomers}
          columns={customerColumns}
          rowKey={(r) => r.entityId ?? `text:${r.customer}`}
          title={t("tables.customers")}
          hint={
            role === "all"
              ? "customers you lead first"
              : `with at least one ${ROLE_LABEL[role]} project, of ${customers.length}`
          }
          initialSort="topRole"
          initialDesc
          exportName="my-work-customers"
          searchPlaceholder="Search customers…"
          emptyText="No customers are assigned to you."
          maxBodyHeight
          freezeFirstColumn
          footnote={footnote}
        />
      )}
    </div>
  );
}
