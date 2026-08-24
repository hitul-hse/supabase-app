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
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
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

  const firstName = profile.personName?.split(" ")[0] ?? null;

  return (
    <PageTransition>
      <div className="flex flex-col">
        <PageHeader
          title={firstName ? `${firstName}'s work` : "My work"}
          meta={
            work.unlinked
              ? "NO PERSON RECORD LINKED"
              : `${work.totals.customers} CUSTOMERS · ${work.totals.customersLed} LED · ${work.totals.projects} PROJECTS`
          }
        />

        <div className="flex flex-col gap-5 page-shell">
          {/*
            The unlinked case is the DEFAULT for most accounts, not an edge:
            11 of the 20 provisioned users have no person_id, so this branch is
            what the majority currently sees. It says which account it is
            describing and exactly what an administrator must do, rather than
            rendering an empty table that reads as "you have no work".
          */}
          {work.unlinked ? (
            <EmptyState
              title="Your account isn't linked to a person record yet"
              description={`Signed in as ${profile.email ?? "this account"} with the ${profile.roleDisplayName} role. My Work is driven by project ownership and assignments, both of which hang off a person record — and this account has none, so there is nothing to attribute to you. An administrator can link it under Users & Roles. This is not an error and no data is missing.`}
              action={
                <Link
                  href="/projects"
                  className="text-[12px] font-medium text-[var(--accent)] hover:underline"
                >
                  Browse all projects instead →
                </Link>
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
              title="Your work couldn't be loaded"
              description={`Signed in as ${work.personName ?? work.personId}. The projects and assignments query failed, so this page is showing nothing rather than showing a partial list as if it were complete. This is a fault on our side, not an empty book of work — try reloading, and if it persists an administrator can check the server logs.`}
              action={
                <Link
                  href="/my-work"
                  className="text-[12px] font-medium text-[var(--accent)] hover:underline"
                >
                  Reload →
                </Link>
              }
            />
          ) : work.totals.projects === 0 ? (
            <EmptyState
              title="No projects are assigned to you"
              description={`Your account is linked to ${work.personName ?? work.personId}, but no project names you as responsible, owner, replacement or assignee. When a project lead assigns you, it appears here automatically.`}
            />
          ) : (
            <>
              <MyWorkSummary
                customers={work.totals.customers}
                customersLed={work.totals.customersLed}
                projects={work.totals.projects}
                roleCounts={work.totals.roleCounts}
                loggedHours={work.totals.loggedHours}
              />

              {/*
                THE LADDER IN WORDS — kept, but folded.

                This paragraph is what makes the strip above mean something:
                "responsible for 4, cover on 36" is the sentence a reader needs
                ONCE, and never again on the same visit. Rendered open it cost
                ~90px of the first screen on every load, which is why it now
                sits behind a `<details>` whose summary states the shape of the
                answer ("4 responsible · 2 owner · 36 replacement · 12
                assigned") rather than hiding it. Nothing is lost: the counts
                are in the summary line, the strip, the filter chips and the
                badges, and the reasoning is one click away.

                A `<details>`, not React state, because the page is a server
                component and one disclosure triangle is not worth a client
                boundary.
              */}
              <details className="group border-l-2 border-[var(--accent)] bg-[var(--accent-wash)]">
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2 text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                  <span
                    aria-hidden
                    className="flex-none font-mono text-[10px] text-[var(--text-faint)] transition-transform duration-150 group-open:rotate-90"
                  >
                    ▶
                  </span>
                  <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--text-faint)]">
                    HOW YOUR {work.totals.projects} PROJECTS SPLIT
                  </span>
                  <span className="font-mono text-[11px] text-[var(--text-muted)]">
                    {work.totals.roleCounts.responsible} responsible ·{" "}
                    {work.totals.roleCounts.owner} owner ·{" "}
                    {work.totals.roleCounts.replacement} replacement ·{" "}
                    {work.totals.roleCounts.assigned} assigned
                  </span>
                </summary>

                <div className="flex flex-col gap-2 px-4 pb-3 pt-0.5">
                  <p className="text-[12px] leading-relaxed text-[var(--text-secondary)]">
                    You are the{" "}
                    <strong className="text-[var(--text-primary)]">responsible lead</strong>{" "}
                    on {work.totals.roleCounts.responsible} of these{" "}
                    {work.totals.projects} projects and the recorded owner of{" "}
                    {work.totals.roleCounts.owner} more — those are yours to answer
                    for. You are the named{" "}
                    <strong className="text-[var(--text-primary)]">replacement</strong> on{" "}
                    {work.totals.roleCounts.replacement}, which is cover rather than
                    accountability, and on the assignment list only for{" "}
                    {work.totals.roleCounts.assigned}. Every project sits on exactly
                    one of those four rungs, so the counts add up to{" "}
                    {work.totals.projects}. Use the{" "}
                    <strong className="text-[var(--text-primary)]">MY ROLE</strong>{" "}
                    filter below to see one rung at a time, and the{" "}
                    <strong className="text-[var(--text-primary)]">CUSTOMERS</strong>{" "}
                    view for per-customer totals.
                  </p>

                  {/*
                    Stated, not hidden. person_assignments.logged_hours was never
                    backfilled — Mathias's 54 rows sum to ONE hour against
                    thousands of team hours on the same projects. Printing that
                    beside the team figure without comment invites the reader to
                    conclude he did nothing all year. The column is suppressed
                    and the reason given instead.
                  */}
                  {work.myHoursUnpopulated ? (
                    <p className="text-[12px] leading-relaxed text-[var(--text-muted)]">
                      Per-person hours are not shown: your assignment records carry no
                      logged time (they were never backfilled from the time data), so a
                      &ldquo;mine&rdquo; column here would report near-zero against real
                      team hours. The hours in these tables are the{" "}
                      <strong>whole team&rsquo;s</strong> time on each project. Your own
                      tracked time is under{" "}
                      <Link href="/time" className="text-[var(--accent)] hover:underline">
                        Time
                      </Link>
                      .
                    </p>
                  ) : null}
                </div>
              </details>

              {/* A truncated read stays OUTSIDE the disclosure: it says the
                  numbers on screen may be wrong, and that cannot be one click
                  away. */}
              {work.truncated ? (
                <p className="border border-[var(--critical)] bg-[var(--surface)] px-4 py-2.5 text-[12px] text-[var(--critical)]">
                  This list hit the reporting ceiling, so it may be incomplete and the
                  totals above may understate.
                </p>
              ) : null}

              <MyWorkTables
                projects={work.projects}
                customers={work.customers}
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
