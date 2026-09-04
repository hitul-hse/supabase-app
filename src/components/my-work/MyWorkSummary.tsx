/**
 * MyWorkSummary — the totals strip at the top of My Work.
 *
 * FIVE CELLS, NOT NINE — and the four that went are the point of this comment,
 * because an earlier version of this file argued hard for keeping them.
 *
 * It used to carry RESPONSIBLE / OWNER / REPLACEMENT / ASSIGNED beside these,
 * on the argument that the role ladder is the headline: 4 / 2 / 36 / 12 is a
 * different page from an undifferentiated 54, and that is still true. What
 * changed is that the ladder acquired two better homes underneath. The MY ROLE
 * filter chips carry the same four counts AND select on them, and the
 * disclosure above the table states them in a sentence. Three copies of one
 * fact, of which the tiles were the only copy you could not act on and the
 * furthest from the rows they describe.
 *
 * Nine cells in an eight-wide grid also left SERVICES KNOWN alone on a second
 * row, so the strip looked broken as well as repetitive.
 *
 * So the strip keeps only what appears nowhere else on the page, and the ladder
 * is read one row lower where it is also a control. Nothing is lost: every
 * number that left is still on screen, twice.
 *
 * "Customers I lead" leads because it is the number an operations person means
 * when they say "my customers"; the raw total sits beside it rather than
 * replacing it.
 *
 * Hours are labelled "team" because `projects.logged_hours` is what EVERYONE
 * booked. The per-person figure is omitted here: `person_assignments`
 * .logged_hours is unpopulated on live data, and a "mine" cell reading 1
 * beside a team figure of 827 is a plausible wrong number. The page states the
 * gap in words instead. This strip is also now the ONLY place the hours total
 * appears, since the per-project LOGGED column has gone from the table.
 */
export function MyWorkSummary({
  customers,
  customersLed,
  projects,
  loggedHours,
  serviceCoverage,
}: {
  customers: number;
  customersLed: number;
  projects: number;
  loggedHours: number;
  /** How many of `projects` resolve a TrackingTime service tag. */
  serviceCoverage: { known: number; total: number };
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
    { label: "MY PROJECTS", value: projects.toLocaleString("en-GB"), hint: "on any rung" },
    {
      label: "HOURS · TEAM",
      value: loggedHours.toLocaleString("en-GB", { maximumFractionDigits: 0 }),
      hint: "all people",
    },
    {
      // TrackingTime tag, not a contractual "agreed services" figure --
      // crm.framework_agreement, the table shaped for that, is empty.
      label: "SERVICES KNOWN",
      value: serviceCoverage.known.toLocaleString("en-GB"),
      hint:
        serviceCoverage.known === serviceCoverage.total
          ? "of your projects (TrackingTime)"
          : `of ${serviceCoverage.total.toLocaleString("en-GB")} projects (TrackingTime)`,
    },
  ];

  return (
    // Five across on a wide screen, so the strip fills exactly one row. The
    // 3-then-2 break at sm is deliberate: five cells cannot divide evenly, and a
    // trailing pair reads better than a single orphan.
    <div className="grid grid-cols-2 gap-px border border-[var(--border)] bg-[var(--border)] sm:grid-cols-3 lg:grid-cols-5">
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
