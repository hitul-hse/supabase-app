-- Speed up the TrackingTime dashboard by letting Postgres hoist the
-- caller-scoped half of the entry read policy.
--
-- WHY, with the numbers that justify it. Measured on the live project via
-- scripts/check-rls-hoisting.mjs, fetching the same 4,194 rows the dashboard
-- reads:
--
--     as service_role, RLS bypassed      311ms
--     as a real exec, RLS applied      2,870ms
--
-- 2.5s of that is policy evaluation, and it SCALES with the number of rows
-- scanned (~55ms for one month, ~170ms per 1000 rows) which is the signature of
-- a per-row predicate rather than a fixed overhead. Four other explanations were
-- measured and ruled out first: the queries themselves total ~220ms, the
-- TypeScript aggregation 15ms, halving the RSC payload changed nothing, and warm
-- requests match cold ones.
--
-- THE CAUSE: `using (time.can_view_member(member_id))` passes a per-ROW argument.
-- The function is STABLE, but a stable function whose input varies per row must
-- still be called per row -- 4,194 times, each one invoking app_user_role(),
-- which reads app_user_profile.
--
-- THE FIX: the first two disjuncts of can_view_member do not depend on the row.
-- Wrapping each in a scalar subquery lets the planner evaluate it once per
-- statement as an InitPlan (Supabase's documented RLS performance pattern), and
-- because `or` short-circuits, an exec never reaches the per-row branch.
--
-- SEMANTICS ARE UNCHANGED, and this is checkable rather than asserted.
-- time.can_view_member(t) is defined as:
--
--     app_user_role() = 'exec'
--     or t = time.current_member_id()
--     or exists (department check via can_view_person)
--
-- The new predicate is `A or B or can_view_member(row)`, where can_view_member is
-- itself `A or B or C`. Since `A or B or (A or B or C)` is equivalent to
-- `A or B or C`, every caller sees exactly the rows they saw before. The
-- department rule is deliberately still delegated to the function, so it keeps a
-- single implementation.
--
-- SAFETY: this DROPs and RECREATEs one SELECT policy. Between the two statements
-- the table has no SELECT policy, and RLS defaults to DENY -- so the failure mode
-- of an interrupted run is "nobody can read entries", never "anybody can". Run
-- inside the transaction below so it is atomic.
--
-- Apply: paste into the Supabase SQL Editor, or psql -f this file.
-- Then verify: npm run test:time-rls && npm run test:rls && npm run test:rls-control

begin;

drop policy if exists "scoped read of entry" on time.entry;

create policy "scoped read of entry" on time.entry
  for select to authenticated using (
    -- Hoisted: evaluated once per statement, not once per row.
    (select app_user_role()) = 'exec'
    or member_id = (select time.current_member_id())
    -- Only reached for a non-exec looking at somebody else's row, which is the
    -- one case that genuinely needs a per-row department check.
    or time.can_view_member(member_id)
  );

commit;

-- Confirm the policy is the new one and that an exec still reads everything.
-- Expect the qual to contain two InitPlan subqueries.
select policyname, qual
from pg_policies
where schemaname = 'time' and tablename = 'entry' and policyname = 'scoped read of entry';
