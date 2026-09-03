-- ============================================================================
-- Project budgets are commercial terms, not general staff data
-- ============================================================================
--
-- WHAT WAS WRONG
-- --------------
-- `projects:contracts:read` -- "See contract periods: agreed budgets, contract
-- dates and renewal history" -- was granted to ALL FIVE roles. Measured on
-- production, read-only, on 2026-09-03:
--
--     select permission_key, string_agg(role_key, ', ' order by role_key)
--       from app_role_permission
--      where permission_key like 'projects:contracts%' group by 1;
--
--     projects:contracts:read   -> dept_head, employee, exec, hr, project_manager
--     projects:contracts:write  -> dept_head, exec
--
-- Every signed-in person could read what every customer agreed to pay for, in
-- hours. hitul's decision on 2026-09-03: budgets are for Executive, Department
-- Head and a new Sales role. Employee, Project Manager and HR lose them.
--
-- WHY IT SURVIVED
-- ---------------
-- The permission was written as the gate on a single table
-- (`time.project_contract_period`) and then never asked to hold anything back,
-- because every role held it. Nothing in the application reads the key at all:
--
--     grep -rn "PROJECTS_CONTRACTS_READ\|contracts:read" src/
--     -> src/lib/permissions.ts:43   (the declaration, and nothing else)
--
-- So the key had exactly one enforcement point, in RLS, and that point was
-- never load-bearing. The budgets people actually look at -- the projects
-- ledger, the Overview budget tile, the Management matrix, /my-work -- do not
-- come from that table at all. They come from `time.project.estimated_hours`
-- and `public.projects.contract_hours`, neither of which this permission has
-- ever governed.
--
-- A SECOND, LIVE DEFECT FOUND WHILE MEASURING FOR THIS ONE
-- --------------------------------------------------------
-- 20260903090000_contract_status_view_must_not_bypass_rls.sql is MERGED BUT
-- NOT APPLIED. Measured on production today:
--
--     select reloptions from pg_class where relname = 'contract_period_status';
--     -> null
--
-- and behaviourally, inside a read-only transaction with
-- `request.jwt.claim.sub` set to a uuid that has no profile at all:
--
--     select count(*) from time.contract_period_status;   -> 4
--     select count(*) from time.project_contract_period;  -> 0
--
-- The view is still running on its postgres owner's rights and still serving
-- every contract period to callers RLS refuses. That matters directly here:
-- until it is invoker, revoking `projects:contracts:read` below changes
-- nothing whatsoever through that view. The `alter view` is repeated in this
-- migration so that pasting THIS file is sufficient, whether or not the
-- previous one was ever pasted. It is idempotent.
--
-- WHAT THIS MIGRATION DOES
-- ------------------------
-- 1. Adds a `sales` role. Its permission set is EXACTLY what `employee` holds
--    today -- the nine keys that let a person use the app at all -- which
--    already includes `projects:contracts:read`. After step 2 removes that key
--    from `employee`, the difference between the two roles is precisely the
--    one budget key, and nothing else. Deliberately no write permissions: a
--    salesperson reads the agreed budget, they do not set it
--    (`projects:contracts:write` stays with dept_head and exec, untouched).
--
--    NOBODY HOLDS `sales` WHEN THIS RUNS. There are no sales profiles and no
--    sales department; the role is inert until hitul assigns it in Users &
--    Roles. So this step changes no living person's access.
--
-- 2. Revokes `projects:contracts:read` from `employee`, `project_manager` and
--    `hr`. Live profile counts on 2026-09-03: employee 14, project_manager 1,
--    hr 0 -- all active. Fifteen people lose sight of project budgets.
--
-- 3. Re-asserts `security_invoker` on `time.contract_period_status` (see
--    above), so that step 2 actually reaches the view.
--
-- 4. Redacts `time.project_summary.estimated_hours` and `.burn_percent` to
--    NULL for callers without the permission. This is the view every "budget"
--    figure outside the contract panel is derived from -- the Overview budget
--    tile, the team-lead budget-risk list, the Time dashboard project table --
--    and it was ungoverned. `time.project`'s own SELECT policy is literally
--    `true` (verified in pg_policies), so before this change a caller with no
--    profile at all read 256 real budgets, up to 1200 h, through this view.
--
-- WHAT THIS DELIBERATELY DOES NOT DO, AND WHY
-- -------------------------------------------
-- It does NOT touch `hr:contract:read` (exec, hr). That key is EMPLOYMENT
-- contracts -- `public.people.contract_hours`, a person's contracted weekly
-- hours -- which is a different thing from a customer's agreed project budget
-- that happens to share the word "contract". hitul did not ask to move it and
-- HR needs it. `public.people.contract_hours` is therefore untouched here;
-- only `public.projects.contract_hours` is in scope, and they are different
-- tables.
--
-- It does NOT touch `projects:contracts:write` (dept_head, exec) or
-- `projects:alerts:read` (dept_head, exec, hr, project_manager). Budget alerts
-- carry `budget_hours` and so are arguably in scope, but they are a separate
-- key with a separate decision behind them and hitul did not ask. Flagged in
-- the PR rather than changed here.
--
-- It does NOT revoke the column grants on `time.project.estimated_hours` or
-- `public.projects.contract_hours`, which remain readable over PostgREST by
-- any caller whose ROW policy admits them (`true` and `can_view_project()`
-- respectively). Removing a column grant means serving the column through an
-- owner-rights view instead, and for `public.projects` such a view would have
-- to re-implement `can_view_project()` in its own WHERE clause -- which is
-- exactly the bypass-shaped construct that 20260825141000 and 20260903090000
-- were written to remove. That needs its own design and its own gate, so the
-- application enforces it server-side in the query layer for now
-- (src/lib/budget-visibility.ts) and the residual is stated in the PR rather
-- than papered over. Filed, not smuggled in.
--
-- HONEST ABSENCE
-- --------------
-- A withheld budget is NULL here, and NULL already means "nobody set one" in
-- this schema (DESIGN.md rule 6: no budget is stored as 0, unknown is null).
-- Two different absences cannot be told apart in the data, so the application
-- does not try: it asks whether the CALLER holds the permission and renders
-- "withheld" or "no budget" from that, never inferring one from a null. The
-- derived counts (over-budget, no-budget) are returned as absent rather than
-- recomputed from redacted nulls -- a redacted null would otherwise count as
-- "no budget set" and quietly report 0 projects over budget to everyone who
-- cannot see budgets. See scripts/check-budget-permission-enforced.mjs.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The sales role
-- ---------------------------------------------------------------------------
-- seniority 2, the same rung as project_manager: sales is a peer discipline,
-- not a step in the delivery reporting line. Nothing in the app orders access
-- by seniority today (every gate reads app_role_permission), so this is a
-- display/sort value, not a privilege.
insert into app_role (role_key, display_name, seniority) values
  ('sales', 'Sales', 2)
on conflict (role_key) do nothing;

-- Exactly the nine keys `employee` holds on 2026-09-03, no more. Listed one
-- per line rather than copied with a select-from-employee, so that reading
-- this file tells you what sales can do without querying anything, and so a
-- later change to `employee` cannot silently change `sales`.
insert into app_role_permission (role_key, permission_key) values
  ('sales', 'my_work:read_own'),
  ('sales', 'people:read_own'),
  ('sales', 'projects:read_own'),
  ('sales', 'timesheets:read_own'),
  ('sales', 'timesheets:write'),
  ('sales', 'hr:leave:write'),
  ('sales', 'hr:clocking:write'),
  ('sales', 'sync:read'),
  -- The point of the role.
  ('sales', 'projects:contracts:read')
on conflict (role_key, permission_key) do nothing;

-- NOTE FOR WHOEVER ASSIGNS THIS ROLE. `sales` inherits `projects:read_own`,
-- not `projects:read_dept` or `:read_all`. A salesperson therefore sees
-- budgets only on the projects they own or are assigned to. If the intent is
-- "sales can see the budget on any project", that is a PROJECT SCOPE decision,
-- not a budget decision, and it wants `projects:read_dept` or
-- `projects:read_all` added deliberately in a follow-up. It is not assumed
-- here because guessing a broader scope than asked for is how permissions rot.

-- ---------------------------------------------------------------------------
-- 2. Revoke the budget key from the three roles that lose it
-- ---------------------------------------------------------------------------
delete from app_role_permission
 where permission_key = 'projects:contracts:read'
   and role_key in ('employee', 'project_manager', 'hr');

-- ---------------------------------------------------------------------------
-- 3. Make the revoke reach the contract-period view
-- ---------------------------------------------------------------------------
-- Idempotent, and repeated from 20260903090000 because that migration is
-- merged but not applied on production (measured above). Without it, step 2
-- is decorative for every consumer of this view.
alter view time.contract_period_status set (security_invoker = true);
revoke all on time.contract_period_status from anon;

-- ---------------------------------------------------------------------------
-- 4. Redact budgets in time.project_summary
-- ---------------------------------------------------------------------------
-- `security_invoker = true` is stated inline rather than left to the existing
-- reloptions: `create or replace view` with no WITH clause RESETS reloptions
-- to null, which is how public.budget_alert_feed silently lost its fix once
-- already. Every re-creation of this view must carry the clause.
--
-- Only the two budget columns change. Hours worked, entry counts, member
-- counts and last activity are timesheet facts, not commercial terms, and stay
-- visible to everyone who could see them before -- a person who may not see
-- the budget may still see how much time went into the work they did.
create or replace view time.project_summary
with (security_invoker = true) as
select
  p.id                                                  as project_id,
  p.name                                                as project_name,
  p.is_billable,
  p.is_archived,
  c.id                                                  as customer_id,
  c.name                                                as customer_name,
  -- The cast back to numeric(10,2) is NOT cosmetic. `create or replace view`
  -- cannot change a column's data type, the live view's estimated_hours is
  -- numeric(10,2) (inherited from time.project.estimated_hours), and a bare
  -- CASE drops the typmod and yields plain `numeric`. Without this cast the
  -- statement fails on production with "cannot change data type of view column
  -- estimated_hours from numeric(10,2) to numeric" -- caught by
  -- scripts/check-budget-visibility-migration.mjs before it reached the paste.
  (case
    when (select public.app_user_has_permission('projects:contracts:read'))
      then p.estimated_hours
  end)::numeric(10,2)                                   as estimated_hours,
  coalesce(sum(e.duration_seconds), 0::bigint)          as total_seconds,
  coalesce(sum(e.duration_seconds) filter (where e.is_billable), 0::bigint)  as billable_seconds,
  coalesce(sum(e.duration_seconds) filter (where e.is_calendar), 0::bigint)  as calendar_seconds,
  count(e.id)                                           as entry_count,
  count(distinct e.member_id)                           as member_count,
  max(e.started_at)                                     as last_activity_at,
  case
    when not (select public.app_user_has_permission('projects:contracts:read'))
      then null::numeric
    when coalesce(p.estimated_hours, 0::numeric) > 0::numeric
      then round(coalesce(sum(e.duration_seconds), 0::bigint)::numeric / 3600.0
                 / nullif(p.estimated_hours, 0::numeric) * 100::numeric, 1)
    else null::numeric
  end                                                   as burn_percent
from "time".project p
  left join "time".customer c on c.id = p.customer_id
  left join "time".entry e
    on e.project_id = p.id
   and e.duration_seconds is not null
   and e.started_at <= now()
group by p.id, p.name, p.is_billable, p.is_archived, c.id, c.name, p.estimated_hours;

revoke all on time.project_summary from anon;
grant select on time.project_summary to authenticated;

comment on view time.project_summary is
  'Per-project totals. estimated_hours and burn_percent are NULL unless the caller holds '
  'projects:contracts:read -- a project budget is a commercial term, and time.project''s own '
  'SELECT policy is `true`, so without this redaction any signed-in caller (including one with '
  'no profile at all) read every budget in the portfolio through this view. NULL here is '
  'ambiguous between "withheld" and "nobody set one"; callers must resolve it from the '
  'permission, never from the null. security_invoker=true stated inline because create or '
  'replace view resets reloptions.';
