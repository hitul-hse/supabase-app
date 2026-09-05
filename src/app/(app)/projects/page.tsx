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
import { getLocale, getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { ButtonLink } from "@/components/ui/Button";
import { IconArrowRight } from "@/components/nav-icons";
import PageTransition from "@/components/animations/PageTransition";
import { createClient } from "@/utils/supabase/server";
import {
  enforceRoleRouteAccess,
  requireProfile,
  userHasPermission,
} from "@/utils/supabase/require-profile";
import { PERMISSIONS } from "@/lib/permissions";
import { getProjectList, type ProjectSort } from "@/lib/queries/projects-live";
import { getSyncFreshness } from "@/lib/queries/time-dashboard";
import { FreshnessBanner } from "../time/dashboard/ReportPanels";
import { type LedgerSort } from "./ProjectsLedger";
import { ProjectsExplorer } from "./ProjectsExplorer";
import { fmtInt, fmtNum } from "@/lib/locale-format";

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
  /*
    Without this, `operations` gets the "you don't have access" EmptyState below
    rather than a refusal -- the page shell, the header and a paragraph naming a
    permission, on a route that is supposed not to exist for this role. A
    soft-landing is right for a role that MIGHT be granted projects:read_all;
    it is the wrong answer for one whose whole definition is that it has one
    page. Redirect first, EmptyState for everyone else.
  */
  await enforceRoleRouteAccess("/projects");

  const t = await getTranslations("projects");
  const locale = await getLocale();

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
          <PageHeader title={t("title")} />
          <div className="p-6">
            <EmptyState
              title={t("noAccess.title")}
              description={t("noAccess.description")}
              action={
                <ButtonLink href="/time" variant="secondary" size="sm">
                  {t("noAccess.action")}
                  <IconArrowRight className="h-3.5 w-3.5" />
                </ButtonLink>
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

  // The header totals describe the WHOLE portfolio; the explorer below recomputes
  // its own totals strip against whatever the filter narrows to, so the two are
  // deliberately different scopes (page = everything, strip = current filter).
  const totalHours = rows.reduce((s, p) => s + p.actualHours, 0);

  return (
    <PageTransition>
      <div className="flex flex-col">
        <PageHeader
          title={t("title")}
          meta={t("header.meta", {
            projects: fmtInt(rows.length, locale),
            hours: fmtNum(totalHours, locale, 0),
          })}
        />

        <div className="flex flex-col gap-4 page-shell">
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
            <p className="rounded-[var(--radius)] border border-[var(--critical)] bg-[var(--surface)] px-4 py-2.5 text-[12px] text-[var(--critical)]">
              {t("truncated")}
            </p>
          )}

          {rows.length === 0 ? (
            <EmptyState title={t("empty.title")} description={t("empty.description")} />
          ) : (
            <>
              {/* ONE filter bar drives the totals strip, both chart blocks and
                  the ledger together: pick a customer or a status here and every
                  figure on the page re-derives to match, instead of the charts
                  showing the whole portfolio while only the table filters. */}
              <ProjectsExplorer rows={rows} initialSort={initialSort} locale={locale} />
            </>
          )}
        </div>
      </div>
    </PageTransition>
  );
}
