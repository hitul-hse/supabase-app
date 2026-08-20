/**
 * Projects — every project imported from TrackingTime, with real budget burn.
 *
 * WHAT THIS REPLACED, AND WHY
 * ---------------------------
 * This route previously rendered ONE hardcoded project (`getProjectDetail(…,
 * "prj-1")`) out of the five-row `public.projects` demo table, complete with a
 * burn-down chart whose SVG polyline coordinates were literals in the markup and
 * a header reading "SIGNED 12 JAN · PLANNED END 30 SEP". Meanwhile `time.project`
 * holds 334 real projects with real estimates. A page that looks like data but
 * is not is worse than an empty one: nobody thinks to check it.
 *
 * The old single-project view now lives at /projects/[id], driven by whichever
 * project you click.
 *
 * ACCESS
 * ------
 * Gated on `projects:read_all`, hand-rolled rather than via requirePermission()
 * for the same reason the TrackingTime Dashboard is: the portal tile for this
 * module is shown to anyone holding ANY `projects` permission, and all four
 * roles hold `projects:read_own`. requirePermission() redirects a failure to
 * "/", so three of four roles would click their own module's tile and be thrown
 * to the Hub with no explanation. They get an explanatory panel instead.
 *
 * RLS still scopes the rows underneath; this gate only decides whether the
 * org-wide rollup is the right page to show.
 */
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import PageTransition from "@/components/animations/PageTransition";
import { createClient } from "@/utils/supabase/server";
import { requireProfile, userHasPermission } from "@/utils/supabase/require-profile";
import { PERMISSIONS } from "@/lib/permissions";
import { getProjectList, type ProjectSort } from "@/lib/queries/projects-live";
import { getSyncFreshness } from "@/lib/queries/time-dashboard";
import { FreshnessBanner } from "../time/dashboard/ReportPanels";
import { ProjectTotalsStrip } from "./ProjectPanels";
import { ProjectsLedger, type LedgerSort } from "./ProjectsLedger";
import { PortfolioCharts } from "./PortfolioCharts";

/** `?sort=` values the ledger accepts as its initial state. */
const SORT_KEYS: LedgerSort[] = ["burn", "hours", "recent", "name", "budget", "people"];

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireProfile("/projects");

  const canReadAll = await userHasPermission(PERMISSIONS.PROJECTS_READ_ALL);
  const params = await searchParams;

  const rawSort = one(params.sort);
  const initialSort: LedgerSort = SORT_KEYS.includes(rawSort as LedgerSort)
    ? (rawSort as LedgerSort)
    : "burn";

  // Archived projects are hidden by default but never dropped from the query —
  // the toggle has to be able to bring them back, and their hours still count
  // toward any total that reconciles against the entry table.
  const showArchived = one(params.archived) === "1";

  if (!canReadAll) {
    return (
      <PageTransition>
        <div className="flex flex-col">
          <PageHeader category="PROJECTS" title="Projects" />
          <div className="p-6">
            <EmptyState
              title="You don't have access to the project portfolio"
              description="Viewing every project needs the 'View All Projects' permission, which your role doesn't hold. Your own project time is visible under Time. An administrator can grant wider access under Role Permissions."
              action={
                <Link
                  href="/time"
                  className="text-[12px] font-medium text-[var(--accent)] hover:underline"
                >
                  Go to Time →
                </Link>
              }
            />
          </div>
        </div>
      </PageTransition>
    );
  }

  const supabase = await createClient();
  const [{ rows: allRows, truncated }, freshness] = await Promise.all([
    // The server sort is now only a stable starting order — the ledger re-sorts
    // in the browser, where all 334 rows already are.
    getProjectList(supabase, (SORT_KEYS.includes(initialSort) ? initialSort : "burn") as ProjectSort),
    getSyncFreshness(supabase),
  ]);

  const rows = showArchived ? allRows : allRows.filter((p) => !p.isArchived);

  // Totals describe what is ON SCREEN, not the whole table. A strip that says
  // "6,254 h" above a list filtered to 40 projects invites the reader to add up
  // the rows, fail to reach the total, and distrust both numbers.
  const totalHours = rows.reduce((s, p) => s + p.actualHours, 0);
  const billableHours = rows.reduce((s, p) => s + p.billableHours, 0);
  const overBudget = rows.filter((p) => p.isOver).length;
  const noBudget = rows.filter((p) => p.burnPercent === null).length;

  return (
    <PageTransition>
      <div className="flex flex-col">
        <PageHeader
          category="PROJECTS / PORTFOLIO"
          title="Projects"
          meta={`${rows.length.toLocaleString("en-GB")} PROJECTS · ${totalHours.toLocaleString("en-GB", { maximumFractionDigits: 0 })}H TRACKED`}
        />

        <div className="flex flex-col gap-5 p-4 sm:p-6">
          {/* Same reasoning as the dashboard: "no projects match" and "the
              import stopped running three weeks ago" look identical, and the
              second explains the first. */}
          <FreshnessBanner freshness={freshness} />

          {/*
            The old "Show N archived" link is gone: time.project has ZERO
            archived rows on live data, so archivedCount was always 0 and the
            control never rendered. The `?archived=1` param still works and the
            query still returns them, so nothing is lost if the vendor starts
            sending them — but a permanently invisible control is not a feature.
          */}

          {truncated && (
            <p className="border border-[var(--critical)] bg-[var(--surface)] px-4 py-2.5 text-[12px] text-[var(--critical)]">
              This portfolio exceeds the reporting ceiling, so the hours below cover only the most
              recent entries. Totals per project may be understated.
            </p>
          )}

          {rows.length === 0 ? (
            <EmptyState
              title="No projects yet"
              description="Nothing has been imported from TrackingTime yet. The nightly sync populates this list; you can also run it manually with `npm run sync:trackingtime`."
            />
          ) : (
            <>
              <ProjectTotalsStrip
                projectCount={rows.length}
                totalHours={totalHours}
                billableHours={billableHours}
                overBudget={overBudget}
                noBudget={noBudget}
              />
              {/* The figures before the table: state of the portfolio as a donut,
                  and where the hours go as a ranked bar list. The ledger below
                  stays the tool for finding one project; these answer the two
                  questions people previously scrolled the ledger to estimate. */}
              <PortfolioCharts rows={rows} />
              <ProjectsLedger rows={rows} initialSort={initialSort} />
            </>
          )}
        </div>
      </div>
    </PageTransition>
  );
}
