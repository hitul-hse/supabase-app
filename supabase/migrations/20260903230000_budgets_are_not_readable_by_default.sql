-- Budgets are not readable by default: close the column grant on
-- time.project.estimated_hours, and stop the overbooking alert persisting the
-- figure where its own actor can read it back.
--
-- WHAT WAS MEASURED, 2026-09-03, on production
-- --------------------------------------------
-- 1. PRIMARY. time.project's SELECT policy is literally `using (true)` and the
--    table grant to `authenticated` covers every column. Any signed-in JWT --
--    including one with no app_user_profile row at all -- read all 340 rows,
--    256 of them carrying a real estimate, max 1200.00 h, byte-identical to
--    the service-role ground truth. `time` is in pgrst.db_schemas, so this was
--    reachable from a browser with the app's own publishable key, not just
--    from psql.
-- 2. SELF-ACTOR ALERT. public.overbooking_alert's SELECT policy is
--    `app_user_has_permission('projects:alerts:read') OR actor_user_id =
--    auth.uid()`. The second branch requires no permission at all, and
--    src/lib/overbooking-notify.ts writes the row with the SERVICE ROLE
--    carrying budget_hours and the un-redacted `reason` sentence that names
--    the figure, stamped with the actor's own uid. The 2026-09-03 redaction
--    fixed the message shown to the user and left the persisted row untouched.
--    It also fires for ALLOWED levels (approaching >= 80%, exhausted,
--    outside_contract), so an employee logging ordinary time on a busy project
--    minted a row containing that project's exact budget, addressed to
--    themselves.
--
-- TWO THINGS ABOUT POSTGRES THAT DECIDE THE SHAPE OF THIS MIGRATION
-- ------------------------------------------------------------------
-- Both were verified in PGlite before this file was written, because the
-- obvious form of this fix is a no-op and would have shipped looking correct.
--
-- (a) `REVOKE SELECT (col) ON t FROM role` DOES NOTHING against a table-level
--     `GRANT SELECT ON t TO role`. Table-level SELECT covers every column and
--     a column-level revoke does not subtract from it. Measured: after the
--     revoke, the role still read the column. The only form that works is to
--     drop the table grant and re-grant the permitted columns explicitly,
--     which is what this migration does.
--
-- (b) Every logged-in Supabase user is the SAME Postgres role, `authenticated`.
--     exec and employee are rows in app_user_profile, not database roles. So
--     removing a column from the `authenticated` grant removes it from exec
--     too, and any security_invoker view that reads that column then fails for
--     everybody -- measured: `permission denied for table project`.
--
-- (b) is why the column is served back through a SECURITY DEFINER function
-- rather than by relaxing the view. time.project_summary STAYS
-- security_invoker: it also joins time.entry, whose read policy is genuinely
-- caller-scoped, and making the view owner-rights to solve the budget problem
-- would silently expose every member's logged hours org-wide -- the exact
-- bypass 20260825141000 and 20260903090000 were written to remove. The definer
-- function is aggregate-free, single-column, and checks the permission itself,
-- which is the "designed definer" 20260903090000 said was filed rather than
-- smuggled in.
--
-- NOT IN SCOPE, AND WHY -- public.projects
-- ----------------------------------------
-- public.projects.contract_hours (and budget_hours, budget_fee_eur,
-- contract_value_eur, invoiced_eur, billable_rate_eur) leak the same way, to
-- any employee whose can_view_project() row policy admits them: measured, one
-- employee read 64 rows with contract_hours populated, max 800 h. They are NOT
-- closed here. Applying the same treatment needs every privileged read path
-- moved onto definer accessors first -- projects-live.ts, reassignment-
-- candidates.ts, management-*.ts and the security_invoker view
-- public.project_budget_status all select those columns directly, and would
-- break for exec the moment the grant narrows, because of (b) above. That is a
-- larger change than this one and needs its own gate. Stated, not smuggled.

-- ---------------------------------------------------------------- 1. the definer

-- Returns a project's estimated hours to a caller who holds
-- projects:contracts:read, and NULL to everyone else.
--
-- SECURITY DEFINER because the caller no longer holds the column grant (see
-- (b) above). Deliberately minimal: one column, one row, no aggregate, no join,
-- and the permission check is the first thing it does. A definer that returned
-- rows would be a bypass; one that returns a single gated scalar is the gate.
create or replace function time.project_estimated_hours(p_project_id bigint)
returns numeric
language sql
stable
security definer
set search_path = time, public, pg_temp
as $$
  select case
    when public.app_user_has_permission('projects:contracts:read')
    then p.estimated_hours
  end
  from time.project p
  where p.id = p_project_id;
$$;

revoke all on function time.project_estimated_hours(bigint) from public, anon;
grant execute on function time.project_estimated_hours(bigint) to authenticated;

-- ------------------------------------------------- 2. narrow the column grant

-- Drop the table-wide SELECT and re-grant every column EXCEPT estimated_hours.
-- Enumerated rather than computed: a new column on time.project should be an
-- explicit decision here, not silently inherited.
revoke select on time.project from authenticated;
grant select (
  id, source_id, customer_id, name, code, hub_project_id,
  service_id, is_billable, is_archived, custom, created_at
) on time.project to authenticated;

-- anon never had a reason to read this table and must not acquire one.
revoke all on time.project from anon;

-- --------------------------------------------- 3. the view reads the definer

-- Unchanged in shape from the 2026-09-03 version except that estimated_hours
-- and burn_percent now come from the definer instead of p.estimated_hours,
-- which the caller may no longer read. STILL security_invoker: the time.entry
-- join below must keep obeying the caller's own read policy.
create or replace view time.project_summary
with (security_invoker = true) as
select
  p.id                                                          as project_id,
  p.name                                                        as project_name,
  p.is_billable,
  p.is_archived,
  c.id                                                          as customer_id,
  c.name                                                        as customer_name,
  time.project_estimated_hours(p.id)::numeric(10,2)             as estimated_hours,
  coalesce(sum(e.duration_seconds), 0)                          as total_seconds,
  coalesce(sum(e.duration_seconds) filter (where e.is_billable), 0) as billable_seconds,
  coalesce(sum(e.duration_seconds) filter (where e.is_calendar), 0) as calendar_seconds,
  count(e.id)                                                   as entry_count,
  count(distinct e.member_id)                                   as member_count,
  max(e.started_at)                                             as last_activity_at,
  case
    when time.project_estimated_hours(p.id) > 0
    then round((coalesce(sum(e.duration_seconds), 0) / 3600.0)
               / nullif(time.project_estimated_hours(p.id), 0) * 100, 1)
  end                                                           as burn_percent
from time.project p
left join time.customer c on c.id = p.customer_id
left join time.entry e    on e.project_id = p.id
                        and e.duration_seconds is not null
                        and e.started_at <= now()          -- planned time is not logged time
group by p.id, p.name, p.is_billable, p.is_archived, c.id, c.name;

revoke all on time.project_summary from anon;
grant select on time.project_summary to authenticated;

-- ----------------------------- 4. the self-actor alert leak is NOT closed here
--
-- public.overbooking_alert's SELECT policy admits the actor unconditionally
-- (`... or actor_user_id = auth.uid()`), and the row carries budget_hours,
-- over_by_hours and the un-redacted `reason`. The obvious fix -- narrowing the
-- column grant the way section 2 does -- was written, tested, and REMOVED,
-- because public.budget_alert_feed is `security_invoker = true` and selects
-- a.budget_hours and a.reason. Narrowing the grant therefore breaks the feed
-- for dept_head and exec as well, by the same role-wide mechanic described in
-- (b) above: there is no Postgres role that distinguishes them.
--
-- Closing it properly means giving the feed the same definer treatment
-- time.project_summary just received, which is a second migration with its own
-- gate. What IS done in this change is the app-layer half, in
-- src/lib/overbooking-notify.ts: an actor who may not read budgets no longer
-- has the figure written into `reason` in the first place, so the sentence that
-- named it in words is gone. budget_hours and over_by_hours remain readable by
-- the actor on their own row until that second migration lands.
--
-- Stated here rather than left for someone to discover.
