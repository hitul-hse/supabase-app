-- Make a consultant able to load their own projects at all.
--
-- THE FAILURE
-- -----------
-- Measured against live on 2026-08-24, reading public.projects through RLS as a
-- real signed-in employee:
--
--     service role (no RLS)          60ms    231 rows
--     stephan   (30 assignments)   3 093ms     30 rows
--     rency    (130 assignments)   5 789ms     65 rows
--     mathias   (54 assignments)   7 731ms     54 rows, then TIMEOUT on a repeat
--     hendryk   (67 assignments)     TIMEOUT on both attempts
--
-- EXPLAIN ANALYZE as Mathias:
--
--     Index Only Scan using projects_pkey  (actual time=33.5..1692.1 rows=54)
--       Filter: can_view_project(id)
--       Rows Removed by Filter: 177
--       Buffers: shared hit=82128          <-- 82k buffers to return 54 rows
--
-- So this is a PERFORMANCE failure, not an authorization one: the rows that come
-- back are correct. But intermittent is worse than broken -- the page loads for
-- one person and 500s for the next, which reads as "the Hub is flaky" rather
-- than as a bug anybody can locate.
--
-- WHY IT IS SLOW
-- --------------
-- The policy is `using (can_view_project(id))` and can_view_project() calls
-- app_user_role(), app_user_department() and app_user_person_id() -- each a
-- separate query against app_user_profile -- plus an EXISTS over
-- person_assignments. None of that depends on the row being tested, yet
-- Postgres re-evaluates all of it for every one of the 231 candidate rows,
-- because a `stable` function called with a row argument sits in the per-row
-- filter and cannot be hoisted.
--
-- TWO CHANGES, BOTH NARROW
-- ------------------------
-- 1. Wrap the three session lookups in scalar subqueries: `(select app_user_role())`.
--    That is the standard Supabase RLS fix -- the planner recognises an
--    uncorrelated subquery and evaluates it ONCE as an InitPlan, rather than
--    once per row. The predicate is otherwise character-for-character the same.
--
-- 2. Index person_assignments(person_id, project_id). The table has ONLY a
--    primary key today, so the EXISTS inside the policy was a sequential scan
--    over 352 rows for each of the 231 projects tested -- ~81k row visits, which
--    is exactly the 82k buffers EXPLAIN reported. The same index serves
--    my-work.ts's `.eq("person_id", ...)` read.
--
-- WHAT IS DELIBERATELY NOT CHANGED
-- --------------------------------
-- The predicate's MEANING. exec sees everything; dept_head sees their
-- department; everyone sees what they own or are assigned to. A rewrite that
-- made this faster by widening access would be a security regression wearing a
-- performance win's clothes, so scripts/check-project-scoping.mjs asserts the
-- new predicate returns the SAME row set as the old one on a fixture, and the
-- apply script re-counts live rows per person before and after.
--
-- can_view_person() gets the same treatment: it is the policy on public.people
-- and person_assignments, has the identical shape, and person_assignments is
-- read on every My Work page load.

-- ── 1. index the assignment lookup ──────────────────────────────────────────
-- (person_id, project_id) rather than person_id alone: the EXISTS filters on
-- both, so the composite answers it index-only, without touching the heap.
create index if not exists person_assignments_person_project_idx
  on public.person_assignments (person_id, project_id);

-- Ownership is the other half of the same predicate and is filtered directly.
create index if not exists projects_owner_person_idx
  on public.projects (owner_person_id);

-- ── 2. hoist the session lookups out of the per-row filter ──────────────────
create or replace function can_view_project(target_project_id text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select
    (select app_user_role()) = 'exec'
    or exists (
      select 1 from projects pr
      where pr.id = target_project_id
      and (
        ((select app_user_role()) = 'dept_head' and pr.department = (select app_user_department()))
        or pr.owner_person_id = (select app_user_person_id())
        or exists (
          select 1 from person_assignments pa
          where pa.project_id = pr.id and pa.person_id = (select app_user_person_id())
        )
      )
    );
$$;

create or replace function can_view_person(target_person_id text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select
    (select app_user_role()) = 'exec'
    or (
      (select app_user_role()) = 'dept_head'
      and exists (
        select 1 from people p
        where p.id = target_person_id and p.department = (select app_user_department())
      )
    )
    or target_person_id = (select app_user_person_id());
$$;

-- Verify after applying, as a real employee session:
--   node scripts/apply-project-policy-hoisting.mjs
-- which measures before/after AND asserts the visible row count per person is
-- unchanged. If the count moves, roll back immediately: a policy that got fast
-- by showing more is the worst possible outcome here.
