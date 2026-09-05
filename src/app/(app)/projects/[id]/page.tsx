/**
 * One project — its budget, its observed hours curve, who worked on it, and
 * what they worked on.
 *
 * This is where the old /projects page's single-project view went, except every
 * number is now read from `time.project` and `time.entry` rather than from the
 * five-row `public.projects` demo table. The burn-down in particular is real:
 * the previous version's SVG polyline coordinates were literals in the markup.
 *
 * THE id IS VALIDATED BEFORE IT REACHES A QUERY
 * ---------------------------------------------
 * `time.project.id` is a bigint. A route param is a string, and `/projects/abc`
 * would otherwise reach PostgREST as `id=eq.abc` and return a 400 that surfaces
 * as an empty page rather than a 404. Anything non-integer is notFound() here.
 *
 * ACCESS mirrors the list page: `projects:read_all`, hand-rolled, with an
 * explanatory panel instead of a bare redirect to "/". See the note in
 * ../page.tsx for why requirePermission() is wrong for a module tile target.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import PageTransition from "@/components/animations/PageTransition";
import { createClient } from "@/utils/supabase/server";
import {
  enforceRoleRouteAccess,
  requireProfile,
  userHasPermission,
} from "@/utils/supabase/require-profile";
import { PERMISSIONS } from "@/lib/permissions";
import { getProjectOverview } from "@/lib/queries/projects-live";
import { BurnChart, ContributorTable, TaskTable, burnTone } from "../ProjectPanels";
import { TasksSection } from "../TasksSection";
import { getTimeProjectBoard } from "@/lib/queries/hse";
import { getProjectContractPeriods } from "@/lib/queries/contract-periods";
import { permissionKeyExists } from "@/lib/queries/budget-alerts";
import { ContractPanel } from "../ContractPanel";
import { StatTile } from "@/components/ui/Card";
import { ButtonLink } from "@/components/ui/Button";
import { IconArrowRight } from "@/components/nav-icons";
import { Pill } from "@/components/ui/Segmented";
import { fmtInt, fmtNum } from "@/lib/locale-format";

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const profile = await requireProfile("/projects");
  // Same route root as the ledger, same reason -- see ../page.tsx. A detail page
  // is not less reachable than its list: /projects/41 is a URL somebody can be
  // sent in a message.
  await enforceRoleRouteAccess("/projects");

  const t = await getTranslations("projects");
  const locale = await getLocale();
  const h = (n: number) => fmtNum(n, locale, 1);

  const { id: rawId } = await params;
  // Number("") is 0 and Number(" 12 ") is 12, so test the STRING shape rather
  // than trusting the coercion.
  if (!/^\d+$/.test(rawId)) notFound();
  const id = Number(rawId);
  if (!Number.isSafeInteger(id)) notFound();

  if (!(await userHasPermission(PERMISSIONS.PROJECTS_READ_ALL))) {
    return (
      <PageTransition>
        <div className="flex flex-col">
          <PageHeader title={t("detail.title")} />
          <div className="p-6">
            <EmptyState
              title={t("detail.noAccess.title")}
              description={t("detail.noAccess.description")}
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
  const overview = await getProjectOverview(supabase, id);

  // null covers both "no such project" and "RLS hides it". They are
  // deliberately indistinguishable to the caller: telling an unauthorised user
  // that project 412 exists but is not theirs leaks the portfolio's shape.
  if (!overview) notFound();

  const { project, totals, burn, contributors, tasks, truncated } = overview;

  // The editable board, which until now had no mount point anywhere in the app.
  // It is a SEPARATE read from the overview above: that one aggregates
  // time.entry (hours actually logged against this project), while this is the
  // Hub's own planning layer -- tasks somebody typed, their sections, their
  // comments. They answer different questions and neither derives from the other.
  const board = await getTimeProjectBoard(supabase, id);
  const canWrite = await userHasPermission(PERMISSIONS.PROJECTS_WRITE);

  /*
   * Contract periods, and the separate permission to change them.
   *
   * Read unconditionally: "how many hours did we agree, and until when" is
   * context for every other number on this page, so anybody who can see the
   * project sees the terms. Only the FORMS are permission-gated, and by a
   * capability of their own -- editing a project record is not the same act as
   * changing a commercial budget.
   *
   * Returns [] while the migration is unapplied, which the panel renders as
   * "no contract recorded" -- literally true in that window rather than an error.
   */
  const contractPeriods = await getProjectContractPeriods(supabase, id);
  const canWriteContracts = await userHasPermission(PERMISSIONS.PROJECTS_CONTRACTS_WRITE);
  /*
   * Whether the feature exists in the database at all. An unapplied migration
   * makes canWriteContracts false for EVERY role, and without this the panel
   * would blame the reader's permissions for a setup step.
   */
  const contractsInstalled = await permissionKeyExists(
    supabase,
    PERMISSIONS.PROJECTS_CONTRACTS_WRITE,
  );
  const hasBudget = project.estimatedHours !== null && project.estimatedHours > 0;

  /*
   * Value and unit are SEPARATE fields, not one glued string. StatTile sets the
   * unit smaller and on the figure's baseline; "12.5 h" as a single string sets
   * the unit as loud as the number it qualifies.
   *
   * `value: null` is how an unknown is stated -- StatTile renders "n/a" in the
   * faint colour and suppresses the unit, because "n/a h" is nonsense. Never a
   * plausible substitute like 0.
   */
  const stats: {
    label: string;
    value: string | null;
    unit?: string;
    hint: string;
    tone?: "neutral" | "good" | "warning" | "critical";
  }[] = [
    {
      label: t("detail.stats.budget.label"),
      value: hasBudget ? h(project.estimatedHours!) : null,
      unit: "h",
      hint: hasBudget ? t("detail.stats.budget.agreed") : t("detail.stats.budget.notSet"),
    },
    {
      label: t("detail.stats.logged.label"),
      value: h(totals.actualHours),
      unit: "h",
      hint: t("detail.stats.logged.hint"),
    },
    {
      label: t("detail.stats.remaining.label"),
      value: totals.remainingHours === null ? null : h(totals.remainingHours),
      unit: "h",
      hint: totals.isOver
        ? t("detail.stats.remaining.over")
        : hasBudget
          ? t("detail.stats.remaining.left")
          : t("detail.stats.remaining.noBudget"),
      tone: totals.isOver ? "critical" : "neutral",
    },
    {
      label: t("detail.stats.consumed.label"),
      value: totals.burnPercent === null ? null : String(totals.burnPercent),
      unit: "%",
      hint:
        totals.burnPercent === null
          ? t("detail.stats.consumed.unknown")
          : t("detail.stats.consumed.ofBudget"),
      tone: burnTone(totals.burnPercent),
    },
    {
      label: t("detail.stats.billable.label"),
      value: h(totals.billableHours),
      unit: "h",
      hint: t("detail.stats.billable.hint"),
    },
  ];

  return (
    <PageTransition>
      <div className="flex flex-col">
        <PageHeader
          title={project.name}
          meta={t("detail.meta", {
            customer: project.customerName ?? t("detail.noCustomer"),
            // A project code is a proper noun and never translated; it is
            // interpolated whole so the separator does not strand when absent.
            code: project.code ? ` · ${project.code}` : "",
            entries: fmtInt(totals.entryCount, locale),
          })}
          actions={
            <ButtonLink href="/projects" variant="secondary" size="sm">
              <IconArrowRight className="h-3.5 w-3.5 rotate-180" />
              {t("detail.allProjects")}
            </ButtonLink>
          }
        />

        <div className="flex flex-col gap-4 page-shell">
          <div className="flex flex-wrap gap-2">
            {project.isArchived && <Pill>{t("detail.pills.archived")}</Pill>}
            <Pill>
              {project.isBillable ? t("detail.pills.billable") : t("detail.pills.nonBillable")}
            </Pill>
            {project.serviceName && <Pill>{project.serviceName.toUpperCase()}</Pill>}
            {totals.firstEntry && (
              <Pill>
                {totals.firstEntry}
                <IconArrowRight className="h-3 w-3" />
                {totals.lastEntry}
              </Pill>
            )}
          </div>

          {/*
           * Five separate cards on the gap token. The fused version computed its
           * separators from the index -- `i < length - 1 ? border-b lg:border-r`
           * -- which is wrong at the 2- and 3-column breakpoints, where the last
           * cell of a ROW is not the last cell of the ARRAY: interior cells lost
           * their rule and row-ending cells kept a trailing one.
           */}
          <div className="grid grid-cols-2 gap-[var(--card-gap)] sm:grid-cols-3 lg:grid-cols-5">
            {stats.map((s) => (
              <StatTile
                key={s.label}
                label={s.label}
                value={s.value}
                unit={s.unit}
                hint={s.hint}
                tone={s.tone ?? "neutral"}
              />
            ))}
          </div>

          {truncated && (
            <p className="rounded-[var(--radius)] border border-[var(--critical)] bg-[var(--surface)] px-4 py-2.5 text-[12px] text-[var(--critical)]">
              {t("detail.truncated")}
            </p>
          )}

          {/* Above the burn chart deliberately: the burn only means something
              measured against the agreed budget, so the terms are read first. */}
          <ContractPanel
            projectId={id}
            periods={contractPeriods}
            canWrite={canWriteContracts}
            featureInstalled={contractsInstalled}
            fallbackEstimateHours={project.estimatedHours}
            locale={locale}
          />

          <BurnChart
            points={burn}
            estimatedHours={project.estimatedHours}
            wording={{
              title: t("burnChart.title"),
              empty: t("burnChart.empty"),
              qualifier: t("burnChart.qualifier"),
              logged: t("burnChart.logged"),
              budget: t("burnChart.budget"),
            }}
          />

          <div className="grid grid-cols-1 gap-[var(--card-gap)] lg:grid-cols-2">
            <ContributorTable
              rows={contributors}
              locale={locale}
              wording={{
                title: t("contributors.title"),
                empty: t("contributors.empty"),
                billableUnit: t("contributors.billableUnit"),
                hoursUnit: t("contributors.hoursUnit"),
              }}
            />
            <TaskTable
              rows={tasks}
              locale={locale}
              wording={{
                title: t("taskTable.title"),
                empty: t("taskTable.empty"),
                hoursUnit: t("contributors.hoursUnit"),
                topOf: (shown, total) =>
                  t("taskTable.topOf", {
                    shown: fmtInt(shown, locale),
                    total: fmtInt(total, locale),
                  }),
              }}
            />
          </div>

          {/* Read-only for anyone without projects:write. The forms are the
              only thing hidden -- the board itself stays visible, because
              "you may not edit this" and "there is nothing here" are different
              statements and rendering the second for the first is a lie. */}
          <div className="grid grid-cols-1 gap-[var(--card-gap)] lg:grid-cols-12">
            <TasksSection
              parent={{ field: "time_project_id", id: project.id }}
              tasks={board.tasks}
              sections={board.sections}
              commentsByTask={board.commentsByTask}
              currentUserId={canWrite ? profile.userId : null}
              locale={locale}
            />
          </div>

          {/* The bridge back to the filtered report. Everything here is
              all-time and unfiltered on purpose; the dashboard is where you
              narrow by date, member or billability. */}
          <p className="text-[11px] text-[var(--text-faint)]">
            {t.rich("detail.footnote", {
              link: (chunks) => (
                <Link
                  href={`/time/dashboard?projects=${project.id}&preset=all&group=member`}
                  className="text-[var(--accent)] underline-offset-2 hover:underline"
                >
                  {chunks}
                </Link>
              ),
            })}
          </p>
        </div>
      </div>
    </PageTransition>
  );
}
