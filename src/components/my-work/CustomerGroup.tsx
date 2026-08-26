/**
 * CustomerGroup — one customer, its totals, and the projects of mine under it.
 *
 * WHY GROUPED RATHER THAN A FLAT LEDGER
 * -------------------------------------
 * A flat 54-row table sorted by hours answers "what is hot". An operations
 * person's actual question is "what is the state of play at Hochtief", because
 * that is who calls them. 54 projects across 43 customers means most customers
 * hold exactly one project, so the grouping costs almost no vertical space and
 * turns a scan into a lookup.
 *
 * A `<details>` element, not React state. The whole page is a server component;
 * making this interactive would drag the entire list across the client boundary
 * for one disclosure triangle. Native `<details>` also stays expandable with
 * JavaScript disabled and is announced correctly by screen readers for free.
 *
 * Groups this person LEADS start OPEN. Those are the rows with their name on
 * them, and for Mathias that is 4 of 40 rather than all 40.
 */
import { StatusBadge } from "@/components/StatusBadge";
import type { MyCustomer, MyRole } from "@/lib/queries/my-work";
import { RoleBadge } from "./RoleBadge";

function hours(n: number | null): string {
  // `n/a` rather than 0: an unrecorded figure and a genuine zero are different
  // facts, and the house rule is never to render the second in place of the first.
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

export function CustomerGroup({
  customer,
  showMyHours,
}: {
  customer: MyCustomer;
  /** False when person_assignments.logged_hours is unpopulated for this user. */
  showMyHours: boolean;
}) {
  // Open the groups this person LEADS. Those are the ones with their name on
  // them; the 35 they merely cover stay folded so the leads are not buried.
  const leads = customer.topRole === "responsible" || customer.topRole === "owner";

  // Role chips on the header, strongest first, zero counts omitted. This is
  // what makes "4 customers I lead" legible one row at a time.
  const chips: { role: MyRole; count: number }[] = (
    ["responsible", "owner", "replacement", "assigned"] as MyRole[]
  )
    .map((role) => ({ role, count: customer.roleCounts[role] }))
    .filter((c) => c.count > 0);

  return (
    <details
      open={leads}
      className="group border border-[var(--border)] bg-[var(--surface)] open:bg-[var(--surface)]"
    >
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 hover:bg-[var(--surface-hover)]">
        <span
          aria-hidden
          className="flex-none font-mono text-[10px] text-[var(--text-faint)] transition-transform duration-150 group-open:rotate-90"
        >
          ▶
        </span>

        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-[13px] font-medium text-[var(--text-primary)]">
            {customer.customer}
          </span>
          {/*
            The merge, shown rather than assumed. "GEPLAHN-T" and "GEPLAHN-T
            GmbH" are one legal entity, and folding them silently would leave a
            customer count nobody can reconcile against the project list. The
            query only populates this when the fold actually collapsed distinct
            spellings, so a non-empty list always means something happened.
          */}
          {customer.aliases.length > 0 ? (
            <span className="truncate font-mono text-[10px] text-[var(--text-faint)]">
              booked as {customer.aliases.join(" · ")}
            </span>
          ) : null}
        </span>

        {chips.map((c) => (
          <span key={c.role} className="flex flex-none items-center gap-1">
            <span className="font-mono text-[11px] text-[var(--text-muted)]">{c.count}</span>
            <RoleBadge role={c.role} />
          </span>
        ))}

        <span className="flex-none font-mono text-[11px] text-[var(--text-muted)]">
          {hours(customer.loggedHours)} / {hours(customer.contractHours)}h
        </span>

        {/*
          DESIGN.md rule 7: a total that omits rows states its coverage.

          loggedHours sums with `?? 0`, so once migration 20260826120000 nulls the
          unmeasured orders this figure becomes a FLOOR. Shown bare, a reader
          divides it by the full contract and reads a burn nobody measured.

          Rendered ONLY when rows are actually being omitted, so a fully-measured
          customer keeps the clean two-number display. Same restraint as
          `aliases` above, which appears only when a merge really collapsed
          distinct spellings.
        */}
        {customer.measuredProjectCount < customer.projectCount ? (
          <span
            className="flex-none font-mono text-[10px] text-[var(--warning)]"
            title={`${customer.projectCount - customer.measuredProjectCount} of ${customer.projectCount} projects have no measured hours, so the figure to the left is a floor rather than a total.`}
          >
            {customer.measuredProjectCount}/{customer.projectCount} measured
          </span>
        ) : null}

        {showMyHours ? (
          <span className="flex-none font-mono text-[11px] text-[var(--text-faint)]">
            mine {hours(customer.myLoggedHours)}h
          </span>
        ) : null}

        {/* No canonical entity behind this group — stated, because it means the
            grouping fell back to a free-text string and could split. */}
        {customer.entityId === null ? (
          <span
            title="This customer is not linked to a canonical legal entity, so this group is keyed on the free-text name"
            className="flex-none font-mono text-[10px] text-[var(--text-faint)]"
          >
            UNLINKED
          </span>
        ) : null}
      </summary>

      <div className="overflow-x-auto border-t border-[var(--border)]">
        <table className="w-full min-w-[720px] border-collapse text-[12px]">
          <thead>
            <tr className="border-b border-[var(--border)] text-left">
              <th className="px-4 py-2 font-mono text-[10px] font-normal tracking-[0.1em] text-[var(--text-faint)]">
                PROJECT
              </th>
              <th className="px-3 py-2 font-mono text-[10px] font-normal tracking-[0.1em] text-[var(--text-faint)]">
                MY ROLE
              </th>
              <th className="px-3 py-2 font-mono text-[10px] font-normal tracking-[0.1em] text-[var(--text-faint)]">
                STATUS
              </th>
              <th className="px-3 py-2 text-right font-mono text-[10px] font-normal tracking-[0.1em] text-[var(--text-faint)]">
                LOGGED
              </th>
              <th className="px-3 py-2 text-right font-mono text-[10px] font-normal tracking-[0.1em] text-[var(--text-faint)]">
                BUDGET
              </th>
              <th className="px-3 py-2 text-right font-mono text-[10px] font-normal tracking-[0.1em] text-[var(--text-faint)]">
                BURN
              </th>
              <th className="px-4 py-2 text-right font-mono text-[10px] font-normal tracking-[0.1em] text-[var(--text-faint)]">
                DUE
              </th>
            </tr>
          </thead>
          <tbody>
            {customer.projects.map((p) => (
              <tr
                key={p.id}
                className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-hover)]"
              >
                <td className="px-4 py-2">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[12px] text-[var(--text-primary)]">{p.name}</span>
                    <span className="font-mono text-[10px] text-[var(--text-faint)]">
                      {p.code}
                      {/*
                        The masterdata order number, ONLY when it differs from
                        the code. On live data the import set order_no to the
                        project id itself, so rendering it unconditionally
                        printed "10764_00368_601_01 · order 10764_00368_601_01"
                        — the same string twice, which is noise in the densest
                        column on the page.
                      */}
                      {p.orderNo && p.orderNo !== p.code ? ` · order ${p.orderNo}` : ""}
                    </span>
                  </div>
                </td>
                <td className="px-3 py-2">
                  <RoleBadge role={p.role} />
                </td>
                <td className="px-3 py-2">
                  <StatusBadge
                    status={p.status}
                    tone={
                      p.status === "CRITICAL"
                        ? "critical"
                        : p.status === "WARNING"
                          ? "warning"
                          : "neutral"
                    }
                  />
                </td>
                <td className="px-3 py-2 text-right font-mono text-[11px] text-[var(--text-secondary)]">
                  {hours(p.loggedHours)}
                </td>
                <td className="px-3 py-2 text-right font-mono text-[11px] text-[var(--text-muted)]">
                  {/* "no budget" is a real state — 0 contract hours means nobody
                      set one, and printing "0" would read as a zero budget. */}
                  {p.contractHours === null ? "no budget" : hours(p.contractHours)}
                </td>
                <td
                  className={`px-3 py-2 text-right font-mono text-[11px] ${burnClass(p.consumedPercent)}`}
                >
                  {p.consumedPercent === null ? "n/a" : `${p.consumedPercent}%`}
                </td>
                <td className="px-4 py-2 text-right font-mono text-[11px] text-[var(--text-muted)]">
                  {p.dueDate ?? "n/a"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
