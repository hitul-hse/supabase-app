-- Does hoisting the caller-scoped part of the entry policy fix the 2.5s?
--
-- MEASURED SO FAR: fetching 4,194 entries takes 311ms as service_role (RLS
-- bypassed) and 2,870ms as a real exec. Policy evaluation is ~2.6s of it -- 9x
-- the query. That is the dashboard's whole latency problem, and it is SQL, not
-- React.
--
-- THE SUSPECTED CAUSE: the policy is `using (time.can_view_member(member_id))`.
-- The function is STABLE, but it takes a per-ROW argument, so Postgres must call
-- it once per candidate row -- 4,194 calls, each running app_user_role() (which
-- reads app_user_profile) and possibly current_member_id(). The caller-scoped
-- part of that answer is identical for every row.
--
-- THE STANDARD FIX (Supabase's own RLS performance guidance): wrap the
-- caller-scoped expression in a scalar subquery, `(select app_user_role())`, so
-- the planner hoists it into an InitPlan and evaluates it ONCE per statement
-- rather than once per row.
--
-- This script only MEASURES. It changes no policy. Run it with psql against the
-- live project, or paste into the SQL editor.

\timing on

-- The caller: an exec, so the first branch of can_view_member is the one that
-- decides every row. Substitute a real exec's auth uid.
-- set local request.jwt.claim.sub = '...';

-- 1. The predicate as it is written today: one function call per row.
explain (analyze, buffers, timing)
select count(*)
from time.entry e
where time.can_view_member(e.member_id);

-- 2. The same logic with the caller-scoped branch hoisted into a subquery, which
--    the planner can evaluate once. If this is dramatically faster, the policy
--    should be rewritten the same way.
explain (analyze, buffers, timing)
select count(*)
from time.entry e
where (select app_user_role()) = 'exec'
   or time.can_view_member(e.member_id);

-- 3. And the ceiling: no policy predicate at all, for reference.
explain (analyze, buffers, timing)
select count(*) from time.entry;
