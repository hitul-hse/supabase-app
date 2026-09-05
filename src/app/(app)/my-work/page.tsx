/**
 * My Work — the operations person's landing surface: the customers and
 * projects that are theirs, and nothing else's.
 *
 * WHOSE WORK, IN FOUR DEGREES
 * ---------------------------
 * The page's whole argument is that "mine" is not one thing. It reads the
 * masterdata responsibility table alongside project ownership and the
 * assignment list, and ranks every project on one of four rungs — responsible,
 * owner, replacement, assigned. For Mathias that is 4 / 2 / 36 / 12 rather than
 * an undifferentiated 54, and the difference between "responsible for 4" and
 * "named cover on 36" is the difference between a page he can act on and a
 * list he has to re-derive by hand.
 *
 * Customers are grouped on `crm.legal_entity` rather than the free-text
 * `projects.customer`, per PRODUCT.md's requirement to join through the
 * canonical identity map. That fold is load-bearing, not cosmetic: it merges
 * three pairs of spellings and turns 43 apparent customers into the 40 real
 * ones.
 *
 * WHY THIS ROUTE AND NOT /portal
 * ------------------------------
 * The brief offered `/portal/page.tsx` as a home for this. It is the wrong
 * place, for three reasons that are structural rather than stylistic:
 *
 *   1. /portal is OUTSIDE the (app) route group, so it has no sidebar, no
 *      collapse state, no timer bar and no onboarding tour. Building here means
 *      nav, auth chrome and layout come free and stay consistent; building in
 *      /portal means re-implementing the shell and then maintaining two of them.
 *   2. /portal is the MODULE CHOOSER. Its tile list is not defined in its own
 *      file — it comes from `app_user_modules()`, so adding a module or changing
 *      who sees it is a data change rather than a deploy. Hard-coding an
 *      operations view into that page would put one module's content inside the
 *      switchboard for all of them, and quietly break that property.
 *   3. /portal is shared ground. This view is a Records surface and belongs
 *      beside People, Projects and Timesheets, where somebody looking for their
 *      work will actually go.
 *
 * So: a new route inside the existing (app) shell. /portal is left exactly as
 * it was.
 *
 * ACCESS
 * ------
 * `requireProfile()` for the session, and NOTHING beyond it. This page shows a
 * person only their own book of work, so there is no wider scope to gate: every
 * row it can render is a row RLS already decided they may see, and the query
 * narrows further to rows where they are responsible, owner, replacement or
 * assignee. Adding a permission check here would lock people out of their OWN
 * work, which is the opposite of the point.
 *
 * RLS, NOT A SERVICE KEY
 * ----------------------
 * `createClient()` — the ordinary cookie-bound server client. `can_view_project()`
 * runs for every row, including on `project_responsibility`, whose policy is the
 * same predicate. Nothing on this path uses the service role, and nothing
 * should: the whole page is an argument about who a row belongs to, and a
 * key that sees everything would make that argument unfalsifiable.
 */
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { ButtonLink } from "@/components/ui/Button";
import { IconArrowRight } from "@/components/nav-icons";
import PageTransition from "@/components/animations/PageTransition";
import { createClient } from "@/utils/supabase/server";
import { requireProfile } from "@/utils/supabase/require-profile";
import { getMyWork } from "@/lib/queries/my-work";
import { MyWorkSummary } from "@/components/my-work/MyWorkSummary";
import { MyWorkTables } from "@/components/my-work/MyWorkTables";

export const metadata = {
  title: "My Work",
  description: "The customers and projects assigned to you",
};

export default async function MyWorkPage() {
  const profile = await requireProfile("/my-work");
  const supabase = await createClient();
  const work = await getMyWork(supabase);
  const t = await getTranslations("myWork");

  const firstName = profile.personName?.split(" ")[0] ?? null;

  return (
    <PageTransition>
      <div className="flex flex-col">
        <PageHeader
          title={firstName ? `${firstName}'s work` : "My work"}
          /*
            The meta states the page's PREMISE -- which person record this
            account is read through -- rather than repeating the three counts
            that sit in the tiles 60px below it. A header line that restates
            the first row of content is a header line nobody reads twice.
          */
          meta={
            work.unlinked
              ? "NO PERSON RECORD LINKED"
              : t("header.linkedTo", { name: work.personName ?? profile.personName ?? work.personId ?? "" })
          }
        />

        <div className="flex flex-col gap-4 page-shell">
          {/*
            The unlinked case is the DEFAULT for most accounts, not an edge:
            11 of the 20 provisioned users have no person_id, so this branch is
            what the majority currently sees. It says which account it is
            describing and exactly what an administrator must do, rather than
            rendering an empty table that reads as "you have no work".
          */}
          {/*
            Three distinct empty states (APPLE_REF §5.9: "nothing yet",
            "not permitted"/unlinked, "load failed"), each capped at a
            one-line title, ≤ 140 characters of description and one action
            (§8 #28). The "who am I" that used to open each paragraph is gone
            from the copy: the top bar's user menu now states the account on
            every page, and the header meta says which person record it reads.
          */}
          {work.unlinked ? (
            <EmptyState
              title={t("empty.unlinked.title")}
              description={t("empty.unlinked.description")}
              action={
                <ButtonLink href="/projects" variant="secondary" size="sm">
                  {t("empty.browseProjects")}
                  <IconArrowRight className="h-3.5 w-3.5" />
                </ButtonLink>
              }
            />
          ) : work.loadFailed ? (
            /*
              A FAILED READ IS NOT AN EMPTY LIST. This branch exists because the
              two were conflated once: a project query that errored rendered
              "no projects are assigned to you" to a person with 54 of them,
              with no error anywhere. Saying "we could not load this" is worth
              more than a confident wrong answer.
            */
            <EmptyState
              title={t("empty.loadFailed.title")}
              description={t("empty.loadFailed.description")}
              action={
                <ButtonLink href="/my-work" variant="secondary" size="sm">
                  {t("empty.reload")}
                  <IconArrowRight className="h-3.5 w-3.5" />
                </ButtonLink>
              }
            />
          ) : work.totals.projects === 0 ? (
            <EmptyState
              title={t("empty.none.title")}
              description={t("empty.none.description", {
                name: work.personName ?? profile.personName ?? work.personId ?? "",
              })}
            />
          ) : (
            <>
              <MyWorkSummary
                customers={work.totals.customers}
                customersLed={work.totals.customersLed}
                projects={work.totals.projects}
                loggedHours={work.totals.loggedHours}
                serviceCoverage={work.totals.serviceCoverage}
              />

              {/*
                THE LADDER IN WORDS is gone. It was the third copy of the four
                role counts on one screen (the tiles, the chips, and an
                accent-wash callout with a left bar restating them in a
                sentence). The definitions it carried live where they are
                needed: RoleBadge's title on every badge, the MY ROLE chips'
                titles, and the table footnote that already states the hours
                caveat. A full-width tinted callout also spent the accent on
                prose, and the accent is reserved for selection and the one
                primary action.
              */}

              {/* A truncated read is a warning STRIP, not a card: the 6px
                  radius says so, and it stays outside any disclosure because
                  it says the numbers on screen may be wrong. */}
              {work.truncated ? (
                <p className="rounded-[var(--radius)] border border-[var(--critical)] bg-[var(--surface)] px-4 py-2.5 t-callout text-[var(--critical)]">
                  This list hit the reporting ceiling, so it may be incomplete and the
                  totals above may understate.
                </p>
              ) : null}

              <MyWorkTables
                projects={work.projects}
                customers={work.customers}
                budgetsWithheld={work.budgetsWithheld}
                showMyHours={!work.myHoursUnpopulated}
                roleCounts={work.totals.roleCounts}
                footnote={
                  work.myHoursUnpopulated
                    ? "Hours are the whole team's time on each project, not yours alone."
                    : undefined
                }
              />
            </>
          )}
        </div>
      </div>
    </PageTransition>
  );
}
