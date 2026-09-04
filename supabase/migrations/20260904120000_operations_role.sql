-- ============================================================================
-- The `operations` role: My Work, and nothing else.
--
-- hitul's decision, 2026-09-04, stated twice: the operations consultants get
-- ONE page. No Overview, no People, no Projects, no Timesheets, no
-- TrackingTime Dashboard, no Leave. It is a deliberate, temporary trial with
-- live users; the other pages come back as those features mature. It removes
-- time logging and leave requests from their navigation and that is intended.
-- The rollback is at the foot of this file so it is one paste away.
--
-- ---------------------------------------------------------------------------
-- WHY THE ROLE HOLDS EXACTLY ONE PERMISSION KEY
-- ---------------------------------------------------------------------------
-- `employee` holds eight keys. Copying them would have been the obvious move
-- and would have been wrong: seven of the eight exist for pages this role does
-- not get. The set below was derived by reading /my-work end to end
-- (src/app/(app)/my-work/page.tsx -> src/lib/queries/my-work.ts) and then
-- checking, against the LIVE policy catalogue rather than against schema.sql,
-- which keys any of its reads actually consult. Measured on production
-- 2026-09-04 with `select ... from pg_policies where qual like
-- '%app_user_has_permission%'`:
--
--   public.projects                 SELECT  can_view_project(id)
--   public.person_assignments       SELECT  can_view_person(person_id)
--   public.project_responsibility   SELECT  can_view_project(project_id)
--   public.project_link             SELECT  can_view_project(project_id)
--   public.people                   SELECT  can_view_person(id)
--   public.app_user_profile         SELECT  user_id = auth.uid()
--   time.project                    SELECT  true
--   time.service                    SELECT  true
--
-- NOT ONE of them names a permission key. Both helpers resolve a NON-exec,
-- non-dept_head caller purely through `app_user_person_id()` -- ownership,
-- assignment, or "this row is you" -- so they return the identical row set for
-- `operations` that they return for `employee` today. The role string is not
-- an input to My Work's scoping at all, which is why every one of employee's
-- read keys can go without costing the page a single row.
--
--   my_work:read_own   KEPT. The one key. It is NOT an RLS gate (no policy
--                      references it, verified above); it is load-bearing for
--                      two other things. app_user_modules() joins
--                      app_permission.module_key -> app_module.module_key, so
--                      without a permission in the `my_work` module the /portal
--                      tile chooser renders its "no modules are available to
--                      you yet" empty state for all six people -- their only
--                      entry point, gone. And /admin/roles renders the matrix
--                      from this table, so a role holding nothing at all reads
--                      as broken rather than as deliberately minimal.
--
--   people:read_own    DROPPED. /my-work reads `people(name)` for the signed-in
--                      person through app_user_profile's own SELECT policy plus
--                      can_view_person(id); neither consults this key. Its only
--                      live effect is /people, which calls
--                      requirePermission(PEOPLE_READ_OWN) -- so dropping it
--                      makes that page refuse server-side for free.
--
--   projects:read_own  DROPPED. Referenced by no policy and by no page gate
--                      (/projects gates on projects:read_all). Project rows
--                      reach My Work through can_view_project(), untouched.
--
--   timesheets:read_own DROPPED. Only consumer is /time's
--                      requirePermission(TIMESHEETS_READ_OWN), which now
--                      refuses.
--
--   timesheets:write   DROPPED. This one has real teeth: time.entry's INSERT
--                      policy is
--                      `member_id = time.current_member_id() AND
--                       app_user_has_permission('timesheets:write')`,
--                      so the role loses the ability to log time in the table
--                      that actually holds hours -- not merely the button.
--
--   hr:leave:write     DROPPED, per the decision. See the RESIDUAL note below:
--   hr:clocking:write  the key is gone but public.leave_requests' INSERT policy
--                      does not consult it, so this removal is a UI/permission
--                      change, not a database boundary.
--
--   sync:read          DROPPED. Drives <SyncBar/>, which /my-work does not
--                      render (it is on Overview, Projects, Timesheets and the
--                      admin screens -- all pages this role no longer has).
--
-- ---------------------------------------------------------------------------
-- RESIDUAL, STATED RATHER THAN PAPERED OVER
-- ---------------------------------------------------------------------------
-- Two self-service INSERT policies scope on the person, not on a permission:
--
--   public.leave_requests     INSERT  CHECK person_id = app_user_person_id()
--                                           AND status = 'pending'
--   public.timesheet_entries  INSERT  CHECK person_id = app_user_person_id()
--
-- So an operations user who talks to PostgREST directly can still file a
-- pending leave request or a Hub timesheet row for themselves, even with the
-- keys revoked and the pages guarded. That is pre-existing behaviour for every
-- authenticated person with a linked person row, it is not introduced here, and
-- closing it means editing two policies that today grant no role anything it
-- would lose -- a separate decision, deliberately NOT taken in this migration.
-- The hours that matter (time.entry, 5k+ synced rows) ARE closed, because that
-- policy does name timesheets:write.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The role
-- ---------------------------------------------------------------------------
-- seniority is a sort value and not a privilege -- every gate in the system
-- reads app_role_permission, nothing reads seniority (see schema.sql's note on
-- the `sales` role). 1 puts Operations beside Employee at the foot of the
-- /admin/roles column order.
insert into app_role (role_key, display_name, seniority)
values ('operations', 'Operations', 1)
on conflict (role_key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. The one grant
-- ---------------------------------------------------------------------------
-- app_role_permission.permission_key is a real foreign key into app_permission,
-- so this INSERT refuses rather than silently registering a key that does not
-- exist. That is the desired failure: a grant naming a missing permission
-- inserts happily in a system without the FK and then does nothing forever.
insert into app_role_permission (role_key, permission_key)
values ('operations', 'my_work:read_own')
on conflict (role_key, permission_key) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Move the six
-- ---------------------------------------------------------------------------
-- `and role_key = 'employee'` is the re-run guard, and it is the important part
-- of this statement. Without it, a second execution months from now would drag
-- somebody back onto operations after an administrator had deliberately moved
-- them off it. With it, this statement is a no-op on every run after the first.
--
-- md-thorsten is NOT in this list and must never be: he is dept_head and the
-- operations team lead. The role_key guard would exclude him even if his id
-- were added by accident; the assertion in section 4 fails loudly if his role
-- has moved for any reason at all.
--
-- md-serhii IS in this list. He has left the company. Operations is strictly
-- less access than employee, so moving him reduces his reach today -- but his
-- app_user_profile.is_active is still true and he can still sign in.
-- Deactivating or deleting that account is a separate decision and is
-- deliberately NOT done here.
update app_user_profile
   set role_key = 'operations'
 where role_key = 'employee'
   and person_id in (
     'md-stephan',
     'md-mathias',
     'md-hendryk',
     'md-ousmane',
     'md-mustafa',
     'md-serhii'
   );

-- ---------------------------------------------------------------------------
-- 4. Assert the postconditions, out loud
-- ---------------------------------------------------------------------------
-- A migration that silently half-applies is worse than one that fails. RAISE
-- EXCEPTION for the two invariants that must hold, RAISE NOTICE for the
-- bookkeeping a human should read.
do $$
declare
  v_targets constant text[] := array[
    'md-stephan', 'md-mathias', 'md-hendryk', 'md-ousmane', 'md-mustafa', 'md-serhii'
  ];
  v_on_ops    int;
  v_elsewhere text;
  v_thorsten  text;
  v_extra     text;
  v_perms     int;
begin
  select count(*) into v_on_ops
    from app_user_profile
   where person_id = any (v_targets) and role_key = 'operations';

  select string_agg(person_id || '=' || role_key, ', ' order by person_id) into v_elsewhere
    from app_user_profile
   where person_id = any (v_targets) and role_key <> 'operations';

  select role_key into v_thorsten
    from app_user_profile where person_id = 'md-thorsten';

  select string_agg(person_id, ', ' order by person_id) into v_extra
    from app_user_profile
   where role_key = 'operations' and not (person_id = any (v_targets));

  select count(*) into v_perms
    from app_role_permission where role_key = 'operations';

  -- INVARIANT 1: the operations team lead is untouched.
  if v_thorsten is distinct from 'dept_head' then
    raise exception
      'md-thorsten must still be dept_head after this migration, found %', coalesce(v_thorsten, '(no profile)');
  end if;

  -- INVARIANT 2: exactly one permission. A second key here means somebody
  -- widened the role without reading the argument above it.
  if v_perms <> 1 then
    raise exception 'operations must hold exactly one permission, found %', v_perms;
  end if;

  raise notice 'operations: % of % target profiles moved', v_on_ops, array_length(v_targets, 1);
  if v_elsewhere is not null then
    -- Not an error. A person already moved to another role by hand is left
    -- alone on purpose; this migration refuses to guess that operations is
    -- where they should be. It reports them for a human instead.
    raise notice 'operations: LEFT ALONE (not on employee): %', v_elsewhere;
  end if;
  if v_extra is not null then
    raise notice 'operations: also on this role, outside the six: %', v_extra;
  end if;
  raise notice 'operations: md-serhii has left the company and his account is still is_active -- offboarding is a separate action';
end $$;

-- ============================================================================
-- ROLLBACK -- this is a trial, so here is the exact way back.
--
-- Paste the block below into the SQL Editor to put all six back on `employee`
-- and remove the role entirely. Order matters: app_user_profile.role_key and
-- app_role_permission.role_key are both foreign keys into app_role, so the role
-- row cannot go until nothing references it.
--
--   update app_user_profile
--      set role_key = 'employee'
--    where role_key = 'operations'
--      and person_id in (
--        'md-stephan', 'md-mathias', 'md-hendryk',
--        'md-ousmane', 'md-mustafa', 'md-serhii'
--      );
--
--   -- Refuse to drop the role while anyone else is still on it: dropping it
--   -- out from under a profile would violate the foreign key anyway, but this
--   -- says so in a sentence rather than in a constraint name.
--   do $rollback$
--   declare v_left text;
--   begin
--     select string_agg(coalesce(person_id, user_id::text), ', ')
--       into v_left
--       from app_user_profile where role_key = 'operations';
--     if v_left is not null then
--       raise exception 'still on operations, move them first: %', v_left;
--     end if;
--   end $rollback$;
--
--   delete from app_role_permission where role_key = 'operations';
--   delete from app_role            where role_key = 'operations';
--
-- The application side needs no rollback deploy: src/components/nav-access.ts
-- keys its allow-list on the role string, so with no profile on `operations`
-- the entry is inert. Removing the entry is tidying, not a revert.
-- ============================================================================
