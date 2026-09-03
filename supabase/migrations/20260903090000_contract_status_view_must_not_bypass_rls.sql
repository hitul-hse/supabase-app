-- ============================================================================
-- A view was handing every contract period to callers RLS had already refused
-- ============================================================================
--
-- WHAT WAS WRONG
-- --------------
-- `time.contract_period_status` was created without `security_invoker`, so it
-- ran with its `postgres` owner's rights, which are exempt from row-level
-- security. Measured on production, read-only:
--
--     select reloptions from pg_class where relname = 'contract_period_status';
--     -> null
--
-- The table underneath is protected properly. `time.project_contract_period`
-- has RLS enabled and four policies, and its read policy is
-- `app_user_has_permission('projects:contracts:read')`, which resolves through
-- `app_user_role()` -- a security definer helper that returns NULL for an
-- account with `is_active = false`. None of that was evaluated through the
-- view. Demonstrated on production by setting `request.jwt.claim.sub` to a
-- uuid with no active profile, inside a read-only transaction:
--
--     select count(*) from time.contract_period_status;   -> 4
--     select count(*) from time.project_contract_period;  -> 0
--
-- Four is every contract period in the database. The row carries project_name,
-- customer_id, budget_hours, starts_on, ends_on, contract_reference and the
-- renewal chain -- the commercial terms of a customer engagement. The table
-- said no and the view said yes, and the view is the one PostgREST answers:
-- `time` is an exposed schema (src/lib/queries/*.ts call `.schema("time")`),
-- and `authenticated` holds SELECT on the view.
--
-- WHAT THE FIX IS AND IS NOT WORTH, HONESTLY
-- ------------------------------------------
-- All five roles hold `projects:contracts:read` today (exec, dept_head, hr,
-- project_manager, employee), so an ACTIVE user sees the same four rows before
-- and after this migration. The exposure that closes today is the caller the
-- policy was written to stop: a deactivated account, an account whose profile
-- has not been provisioned, and any role from which the permission is removed
-- later. That last one is the point. Right now the permission model is the
-- only thing standing between a role and this data, and through this view the
-- permission model was decorative -- revoking `projects:contracts:read` from
-- `employee` tomorrow would have changed nothing at all.
--
-- WHY MAKING IT INVOKER GENUINELY FIXES IT
-- ----------------------------------------
-- The view calls `time.contract_period_logged_hours(cp.id)`. Checked before
-- relying on it: `prosecdef = false`, so it is not SECURITY DEFINER and the
-- bypass does not simply move one level down into the function. EXECUTE on it
-- is held by `authenticated` (and by PUBLIC), so an invoker-rights view can
-- still call it -- checked, because a missing EXECUTE grant would turn this
-- migration into a "permission denied for function" on the Contracts panel.
--
-- WHAT THIS DOES NOT FIX, AND IT IS A SEPARATE BUG
-- ------------------------------------------------
-- `logged_hours` was ALREADY caller-scoped and stays wrong. A plain SQL
-- function invoked from an owner-rights view still executes as the caller, so
-- its scan of `time.entry` was always filtered by that table's per-member read
-- policy. Measured on production for period 7: exec reads 0.25 h, dept_head,
-- project_manager and employee all read 0.00 h for the same period. So
-- burn_percent and remaining_hours understate for everyone who is not exec,
-- and have done since the view was created. This migration deliberately does
-- not touch it: the obvious repair -- making the function SECURITY DEFINER --
-- is exactly the bypass-one-level-down that was checked for above, and it
-- needs its own design (a definer function that returns only the aggregate and
-- checks `projects:contracts:read` itself). Filed, not smuggled in here.
--
-- WHY IT SURVIVED
-- ---------------
-- The same reason `budget_alert_feed` survived until 20260825141000: nothing
-- was broken. RLS was on, the policies were sensible, every RLS gate passed,
-- and the page rendered. The checks that existed inspected views BY NAME, and
-- this view was created after they were written, so it was never on anyone's
-- list. scripts/check-views-are-invoker.mjs, added with this migration, ends
-- that by enumerating views instead of naming them.
--
-- THE SECOND DEFECT THIS CLOSES: THE FIX WAS RE-PASTEABLE AWAY
-- ------------------------------------------------------------
-- `create or replace view` with no WITH clause RESETS reloptions to null.
-- Verified in PGlite, both directions. Both `supabase/APPLY-IN-SQL-EDITOR.sql`
-- and `supabase/migrations/add_budget_alert_visibility.sql` re-create
-- `public.budget_alert_feed` with no WITH clause, and that file's own header
-- says "SAFE TO RE-RUN". Re-running it would have silently un-done the August
-- fix and put the alert feed -- customer names, staff names, overruns,
-- notification addresses -- back on owner rights, with no error and nothing to
-- see. The four `create or replace view` statements for these two views now
-- carry the clause inline, so replaying any of those files lands in the fixed
-- state rather than the vulnerable one. The `alter view` below re-asserts it
-- for `budget_alert_feed` in case a re-paste already happened.
--
-- WHAT IS DELIBERATELY LEFT ON OWNER RIGHTS
-- -----------------------------------------
-- Three views stay non-invoker on purpose, and each is now allow-listed with
-- its reason in scripts/check-views-are-invoker.mjs:
--
--   public.org_chart_nodes  - identity and reporting line only (id, name, role,
--                             department, manager_id). An org chart that shows
--                             you only yourself is not an org chart. Reverted
--                             once already in August: invoker rights dropped
--                             every non-exec from 26 nodes to 1.
--   public.user_display_names - user_id and a display name, nothing else. A
--                             comment thread where every author reads "Team
--                             member" is worse than no names.
--   time.org_chart          - the same judgement over the real 49-member
--                             roster; see add_org_chart_view.sql, which argues
--                             it at length and lists what it omits (no user_id,
--                             no hours, no rates).
--
-- Their anon grants were already revoked in August; the revokes are repeated
-- below because they are no-ops when there is nothing to revoke, and because
-- Supabase's default privileges are the reason this class of defect exists.
-- Measured before writing them: none of the four views carries an anon grant
-- today, so every REVOKE here is defensive, not corrective.
-- ============================================================================

-- The fix.
alter view time.contract_period_status set (security_invoker = true);

-- Re-assert the August fix. Idempotent, and it repairs the database if
-- APPLY-IN-SQL-EDITOR.sql was ever re-pasted after 2026-08-25.
alter view public.budget_alert_feed set (security_invoker = true);

-- PostgREST checks role grants before it evaluates policies. With
-- security_invoker alone an anonymous caller receives an empty set rather than
-- a refusal, which is safe but still advertises that the endpoint exists.
revoke all on time.contract_period_status from anon;
revoke all on public.budget_alert_feed from anon;

-- The deliberate bypasses keep their owner rights and stay closed to anon.
revoke all on public.org_chart_nodes from anon;
revoke all on public.user_display_names from anon;
revoke all on time.org_chart from anon;

comment on view time.contract_period_status is
  'Every contract period with its burn, remaining hours and days left. is_current uses the date '
  'window, so a renewed project shows the new period as current while the old one remains visible '
  'with its own budget and hours intact. security_invoker=true so the caller''s own '
  'projects:contracts:read policy on time.project_contract_period decides which periods come back. '
  'Without it this view ran as its postgres owner and served every project''s budget, dates and '
  'contract reference to any signed-in caller, including deactivated accounts the policy refuses. '
  'NOTE: logged_hours is scoped by the caller''s own read policy on time.entry and understates for '
  'anyone who is not exec -- a separate defect, not fixed here.';

comment on view public.org_chart_nodes is
  'Identity and reporting line only. DELIBERATELY not security_invoker: an org chart needs every '
  'employee to see the whole line, not just their own row. Safe because only id, name, role, '
  'department and manager_id are projected -- no rates, holiday balances or certificates. '
  'Allow-listed in scripts/check-views-are-invoker.mjs.';

comment on view public.user_display_names is
  'user_id -> display name, so comment authors resolve to a name instead of "Team member". '
  'DELIBERATELY not security_invoker: app_user_profile''s own policy only lets you read your own '
  'row unless you are exec. Nothing but the name is exposed. Allow-listed in '
  'scripts/check-views-are-invoker.mjs.';
