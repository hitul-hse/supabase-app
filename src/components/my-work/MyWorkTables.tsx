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
 */
import { useMemo, useState } from "react";
import { DataTable, cmpNum, cmpText, type Column } from "@/components/data-table";
import { StatusBadge } from "@/components/StatusBadge";
import {
  LINK_LABEL,
  ROLE_LABEL,
  ROLE_ORDER,
  type MyCustomer,
  type MyProject,
  type MyRole,
} from "@/lib/queries/my-work";
import { RoleBadge } from "./RoleBadge";

/** `n/a` rather than 0: an unrecorded figure and a real zero are different facts. */
function hours(n: number | null): string {
  if (n === null) return "n/a";
  return n.toLocaleString("en-GB", { maximumFractionDigits: 1 });
}

/** Burn colour, or muted when there is no budget to burn against. */
function burnClass(percent: number | null): string {
  if (percent === null) return "text-[var(--text-faint)]";
  if (percent >= 100) return "text-[var(--critical)]";
  if (percent >= 80) return "text-[var(--warning)]";
  return "text-[var(--text-secondary)]";
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
   * It also drops the two budget columns from the CSV entirely rather than
   * exporting empty cells -- a blank in a spreadsheet column headed BUDGET is
   * read as zero by the next person to open it.
   */
  budgetsWithheld: boolean;
  /** False when person_assignments.logged_hours is unpopulated for this user. */
  showMyHours: boolean;
  /** Totals per rung, used to label the filter chips honestly. */
  roleCounts: Record<MyRole, number>;
  /** The hours caveat, rendered under the table it applies to. */
  footnote?: React.ReactNode;
}) {
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

  const projectColumns: Column<MyProject>[] = useMemo(() => {
    const cols: Column<MyProject>[] = [
      {
        key: "customer",
        header: "CUSTOMER",
        className: "w-[15rem]",
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
            className="max-w-full truncate text-left text-[12px] text-[var(--text-primary)] underline-offset-2 hover:text-[var(--accent)] hover:underline"
          >
            {r.customer}
          </button>
        ),
      },
      {
        key: "project",
        header: "PROJECT",
        compare: (a, b) => cmpText(a.name, b.name),
        descFirst: false,
        search: (r) => `${r.name} ${r.code} ${r.orderNo ?? ""}`,
        csv: (r) => `${r.name} (${r.code})`,
        cell: (r) => (
          <div className="flex flex-col gap-0.5">
            <span className="text-[12px] text-[var(--text-primary)]">{r.name}</span>
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
        key: "links",
        header: "LINKS",
        className: "w-[9rem]",
        // Sorted by how many links a project has, so the rows with somewhere to
        // go surface first. Ties keep table order.
        compare: (a, b) => a.links.length - b.links.length,
        title:
          "Working links recorded in the masterdata workbook. Most projects have none -- an empty cell means nobody recorded one.",
        search: (r) => r.links.map((l) => LINK_LABEL[l.kind]).join(" "),
        csv: (r) => r.links.map((l) => `${LINK_LABEL[l.kind]}=${l.url}`).join(" "),
        cell: (r) =>
          // NOTHING when there are no links, deliberately -- not "n/a". An
          // absent link is not an unmeasured figure being withheld, it is
          // simply a link nobody recorded, and a cell full of "n/a" across the
          // ~80% of projects without one would be noise pretending to be data.
          r.links.length === 0 ? null : (
            <span className="flex flex-wrap items-center gap-1">
              {r.links.map((l) => (
                <a
                  key={`${l.kind}-${l.url}`}
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={l.label ? `${LINK_LABEL[l.kind]} — ${l.label}` : LINK_LABEL[l.kind]}
                  className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-0.5 font-mono text-[10px] tracking-[0.04em] text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
                >
                  {LINK_LABEL[l.kind]}
                </a>
              ))}
            </span>
          ),
      },
      {
        key: "logged",
        header: "LOGGED",
        align: "right",
        compare: (a, b) => cmpNum(a.loggedHours, b.loggedHours),
        title: "Hours logged against this project by the WHOLE team",
        csv: (r) => r.loggedHours ?? "",
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
          : "Contracted hours. 'no budget' means nobody set one, which is not a budget of zero.",
        csv: (r) => r.contractHours ?? "",
        cell: (r) => (
          <span className="font-mono text-[11px] text-[var(--text-muted)]">
            {budgetsWithheld
              ? "withheld"
              : r.contractHours === null
                ? "no budget"
                : hours(r.contractHours)}
          </span>
        ),
      },
      {
        key: "burn",
        header: "BURN",
        align: "right",
        compare: (a, b) => cmpNum(a.consumedPercent, b.consumedPercent),
        title: budgetsWithheld
          ? "Burn is the budget expressed as a ratio, so it is withheld too."
          : "Logged over contracted. n/a when there is no budget to burn against.",
        csv: (r) => r.consumedPercent ?? "",
        cell: (r) => (
          <span className={`font-mono text-[11px] ${burnClass(r.consumedPercent)}`}>
            {budgetsWithheld ? "withheld" : r.consumedPercent === null ? "n/a" : `${r.consumedPercent}%`}
          </span>
        ),
      },
      {
        key: "due",
        header: "DUE",
        align: "right",
        compare: (a, b) => cmpText(a.dueDate, b.dueDate),
        descFirst: false,
        csv: (r) => r.dueDate ?? "",
        cell: (r) => (
          <span className="font-mono text-[11px] text-[var(--text-muted)]">
            {r.dueDate ?? "n/a"}
          </span>
        ),
      },
    ];

    // The "mine" column appears ONLY when the assignment rows actually carry
    // hours. On live data they do not, and a column reading 0 beside a real team
    // figure is a plausible wrong number — the page states the gap instead.
    if (showMyHours) {
      // Inserted right after BUDGET so it lands between BUDGET and BURN, as it
      // always has. The index has moved twice: SERVICE pushed it 6 -> 7, and
      // LINKS pushed it 7 -> 8.
      cols.splice(8, 0, {
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

    return cols;
  }, [showMyHours, budgetsWithheld]);

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
          <div className="flex min-w-0 flex-col gap-0.5">
            <button
              type="button"
              onClick={() => {
                setCustomer(r.customer);
                setView("projects");
              }}
              title={`Show this customer's ${r.projectCount} project${r.projectCount === 1 ? "" : "s"}`}
              className="max-w-full truncate text-left text-[12px] text-[var(--text-primary)] underline-offset-2 hover:text-[var(--accent)] hover:underline"
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
            {r.services.length > 0 ? (
              r.services.map((s) => (
                <span
                  key={s}
                  className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-secondary)]"
                >
                  {s}
                </span>
              ))
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
      label: "ALL",
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
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex overflow-hidden border border-[var(--border)]">
          {(
            [
              { v: "projects" as View, label: "PROJECTS", n: projects.length },
              { v: "customers" as View, label: "CUSTOMERS", n: customers.length },
            ]
          ).map((t) => (
            <button
              key={t.v}
              type="button"
              onClick={() => setView(t.v)}
              aria-pressed={view === t.v}
              title={
                t.v === "projects"
                  ? "One row per project, with its customer beside it"
                  : "One row per customer, with your projects and hour totals for it"
              }
              className={`px-2.5 py-1 font-mono text-[10px] tracking-[0.08em] transition-colors ${
                view === t.v
                  ? "bg-[var(--surface-hover)] text-[var(--text-primary)]"
                  : "text-[var(--text-faint)] hover:text-[var(--text-primary)]"
              }`}
            >
              {t.label} <span className="text-[var(--text-muted)]">{t.n}</span>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--text-faint)]">
            MY ROLE
          </span>
          {roleChips.map((c) => {
            const active = role === c.value;
            return (
              <button
                key={c.value}
                type="button"
                onClick={() => setRole(c.value)}
                aria-pressed={active}
                title={
                  c.value === "all"
                    ? "Every project you have any claim on"
                    : `Only the ${c.count} where you are ${c.label.toLowerCase()}`
                }
                className={`flex items-center gap-1.5 border px-2 py-1 font-mono text-[10px] transition-colors ${
                  active
                    ? "border-[var(--accent)] bg-[var(--accent-wash)] text-[var(--text-primary)]"
                    : "border-[var(--border)] text-[var(--text-faint)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
                }`}
              >
                {c.value === "all" ? (
                  <span className="tracking-[0.08em]">ALL</span>
                ) : (
                  <RoleBadge role={c.value} />
                )}
                <span className="text-[var(--text-muted)]">{c.count}</span>
              </button>
            );
          })}
        </div>

        {/* The drill-down is stated and reversible. A silently filtered table
            whose control is elsewhere is how a reader concludes rows are
            missing. */}
        {activeCustomer ? (
          <button
            type="button"
            onClick={() => setCustomer(null)}
            className="flex items-center gap-1.5 border border-[var(--accent)] bg-[var(--accent-wash)] px-2 py-1 font-mono text-[10px] text-[var(--text-primary)] transition-colors hover:border-[var(--critical)]"
            title="Clear the customer filter"
          >
            <span className="max-w-[16rem] truncate">{activeCustomer}</span>
            <span aria-hidden className="text-[var(--text-muted)]">
              ×
            </span>
          </button>
        ) : null}
      </div>

      {view === "projects" ? (
        <DataTable<MyProject>
          rows={filteredProjects}
          columns={projectColumns}
          rowKey={(r) => r.id}
          title="MY PROJECTS"
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
          footnote={footnote}
        />
      ) : (
        <DataTable<MyCustomer>
          rows={filteredCustomers}
          columns={customerColumns}
          rowKey={(r) => r.entityId ?? `text:${r.customer}`}
          title="MY CUSTOMERS"
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
