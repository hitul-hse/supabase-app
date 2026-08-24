/**
 * MyWorkSummary — the totals strip at the top of My Work.
 *
 * THE ROLE LADDER IS THE HEADLINE. The four role cells are adjacent and
 * deliberately different numbers: for Mathias, 4 responsible / 2 owner /
 * 36 replacement / 12 assigned. Collapsing them into one "my projects: 54"
 * would describe a person accountable for four customers as one juggling 43.
 *
 * They PARTITION the project count — every project sits on exactly one rung —
 * so the four cells sum to MY PROJECTS and the strip cannot quietly double
 * count.
 *
 * "Customers I lead" leads because it is the number an operations person means
 * when they say "my customers"; the raw total sits beside it rather than
 * replacing it.
 *
 * Hours are labelled "team" because `projects.logged_hours` is what EVERYONE
 * booked. The per-person figure is omitted here: `person_assignments`
 * .logged_hours is unpopulated on live data, and a "mine" cell reading 1
 * beside a team figure of 827 is a plausible wrong number. The page states the
 * gap in words instead.
 */
import type { MyRole } from "@/lib/queries/my-work";

export function MyWorkSummary({
  customers,
  customersLed,
  projects,
  roleCounts,
  loggedHours,
}: {
  customers: number;
  customersLed: number;
  projects: number;
  roleCounts: Record<MyRole, number>;
  loggedHours: number;
}) {
  const cells: { label: string; value: string; hint?: string; accent?: boolean }[] = [
    {
      label: "CUSTOMERS I LEAD",
      value: customersLed.toLocaleString("en-GB"),
      hint: "responsible or owner",
      accent: true,
    },
    {
      label: "CUSTOMERS TOTAL",
      value: customers.toLocaleString("en-GB"),
      hint: "canonical entities",
    },
    { label: "MY PROJECTS", value: projects.toLocaleString("en-GB") },
    {
      label: "RESPONSIBLE",
      value: roleCounts.responsible.toLocaleString("en-GB"),
      hint: "named lead",
      accent: true,
    },
    {
      label: "OWNER",
      value: roleCounts.owner.toLocaleString("en-GB"),
      hint: "owner only",
    },
    {
      label: "REPLACEMENT",
      value: roleCounts.replacement.toLocaleString("en-GB"),
      hint: "named cover",
    },
    {
      label: "ASSIGNED",
      value: roleCounts.assigned.toLocaleString("en-GB"),
      hint: "list only",
    },
    {
      label: "HOURS · TEAM",
      value: loggedHours.toLocaleString("en-GB", { maximumFractionDigits: 0 }),
      hint: "all people",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-px border border-[var(--border)] bg-[var(--border)] sm:grid-cols-4 lg:grid-cols-8">
      {cells.map((c) => (
        <div key={c.label} className="flex flex-col gap-1 bg-[var(--surface)] px-4 py-3">
          <span className="font-mono text-[10px] tracking-[0.12em] text-[var(--text-faint)]">
            {c.label}
          </span>
          <span
            className={`font-mono text-[22px] leading-none tracking-[-0.02em] ${
              c.accent ? "text-[var(--accent)]" : "text-[var(--text-primary)]"
            }`}
          >
            {c.value}
          </span>
          {c.hint ? (
            <span className="text-[11px] text-[var(--text-muted)]">{c.hint}</span>
          ) : null}
        </div>
      ))}
    </div>
  );
}
