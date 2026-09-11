/**
 * MyWorkSummary — the totals strip at the top of My Work.
 *
 * FIVE CELLS, NOT NINE — and the four that went are the point of this comment,
 * because an earlier version of this file argued hard for keeping them.
 *
 * It used to carry RESPONSIBLE / OWNER / REPLACEMENT / ASSIGNED beside these,
 * on the argument that the role ladder is the headline: 4 / 2 / 36 / 12 is a
 * different page from an undifferentiated 54, and that is still true. What
 * changed is that the ladder acquired a better home underneath. The MY ROLE
 * filter chips carry the same four counts AND select on them -- the one copy
 * you can act on, and the nearest to the rows it describes.
 *
 * Nine cells in an eight-wide grid also left SERVICES KNOWN alone on a second
 * row, so the strip looked broken as well as repetitive.
 *
 * FIVE StatTiles ON A GAP, NOT A FUSED GRID. The previous strip was one grid
 * whose cells shared hairlines -- exactly the shape Card.tsx's header comment
 * bans, because five independent facts read as one table row. StatTile also
 * owns the type (21/600 mono figure, 10px mono label and hint) and the
 * n/a-never-0 rule, so this file no longer re-decides any of them.
 *
 * ALL NEUTRAL. "Customers I lead" used to be painted --accent, the only accent-
 * coloured figure in the app. Colour is by meaning here (critical means act),
 * and a count of customers is not a status; leading the strip is emphasis
 * enough.
 *
 * "Customers I lead" leads because it is the number an operations person means
 * when they say "my customers"; the raw total sits beside it rather than
 * replacing it.
 *
 * Hours are labelled "team" because `projects.logged_hours` is what EVERYONE
 * booked. The per-person figure is omitted here: `person_assignments`
 * .logged_hours is unpopulated on live data, and a "mine" cell reading 1
 * beside a team figure of 827 is a plausible wrong number. The table's
 * footnote states the gap in words instead. This strip is also the ONLY place
 * the hours total appears, since the per-project LOGGED column has gone from
 * the table.
 *
 * Async, because the words come from the `myWork` catalogue and the figures
 * format in the request locale rather than a hard-coded en-GB.
 */
import { getLocale, getTranslations } from "next-intl/server";
import { StatTile } from "@/components/ui/Card";
import { fmtInt, fmtNum } from "@/lib/locale-format";

export async function MyWorkSummary({
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
  const t = await getTranslations("myWork.summary");
  const locale = await getLocale();

  const tiles: { key: string; label: string; value: string; unit?: string; hint: string }[] = [
    {
      key: "led",
      label: t("led.label"),
      value: fmtInt(customersLed, locale),
      hint: t("led.hint"),
    },
    {
      key: "customers",
      label: t("customers.label"),
      value: fmtInt(customers, locale),
      hint: t("customers.hint"),
    },
    { key: "projects", label: t("projects.label"), value: fmtInt(projects, locale), hint: t("projects.hint") },
    {
      key: "hours",
      label: t("hours.label"),
      value: fmtNum(loggedHours, locale, 0),
      unit: "h",
      hint: t("hours.hint"),
    },
    {
      // TrackingTime tag, not a contractual "agreed services" figure --
      // crm.framework_agreement, the table shaped for that, is empty. The
      // source is a proper noun and is interpolated, never translated.
      key: "services",
      label: t("services.label"),
      value: fmtInt(serviceCoverage.known, locale),
      hint:
        serviceCoverage.known === serviceCoverage.total
          ? t("services.hintAll", { source: "TrackingTime" })
          : t("services.hintOf", {
              total: fmtInt(serviceCoverage.total, locale),
              source: "TrackingTime",
            }),
    },
  ];

  return (
    // Five across on a wide screen, so the strip fills exactly one row. The
    // 3-then-2 break at sm is deliberate: five cells cannot divide evenly, and a
    // trailing pair reads better than a single orphan. Every tile carries a
    // hint so the five stay one height.
    <div className="grid grid-cols-2 gap-[var(--card-gap)] sm:grid-cols-3 lg:grid-cols-5">
      {tiles.map((c) => (
        <StatTile
          key={c.key}
          data-metric={`my-work-${c.key}`}
          label={c.label}
          value={c.value}
          unit={c.unit}
          hint={c.hint}
          tone="neutral"
        />
      ))}
    </div>
  );
}
