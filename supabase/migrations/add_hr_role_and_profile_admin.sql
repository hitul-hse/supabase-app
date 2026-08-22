-- Add the HR role, and let exec + HR administer other people's records.
--
-- WHY A NEW ROLE RATHER THAN REUSING dept_head. The request was "executive and
-- HR team". dept_head was the only existing role with any admin reach, but it
-- is a LINE-MANAGEMENT role scoped to a department (people:read_dept), and HR
-- work is cross-departmental by nature: HR must see and edit everyone, while a
-- department head must not. Overloading dept_head would have silently given
-- every head of department company-wide profile edit rights, which is a
-- privilege escalation dressed up as a convenience.
--
-- The hr:* permission keys already existed in src/lib/permissions.ts, declared
-- ahead of their module on purpose. This is where they finally get an owner.
--
-- SENIORITY 3, alongside dept_head rather than above it: HR outranks a
-- department head on people matters and outranks nobody on delivery. Seniority
-- is only used for display ordering, so this is a labelling decision, not an
-- access one -- access is decided entirely by the permission grants below.
--
-- Apply: paste into the Supabase SQL Editor, or psql -f this file.
-- Then verify: npm run test:permissions-rls && npm run test:rls

begin;

-- ---------------------------------------------------------------------------
-- 1. The role
-- ---------------------------------------------------------------------------

insert into app_role (role_key, display_name, seniority) values
  ('hr', 'HR', 3)
on conflict (role_key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. New permission keys for administering another person's record
-- ---------------------------------------------------------------------------
-- These are NEW capabilities, so they get their own keys rather than riding on
-- an existing one. "May I edit my own profile" and "may I edit a colleague's"
-- are different questions and must be separately grantable in /admin/roles.

insert into app_permission (permission_key, display_name, description, module_key) values
  ('admin:profiles:read',
   'View Any Profile',
   'Open another person''s profile record: their name, role, department and linked accounts.',
   'hub'),
  ('admin:profiles:write',
   'Edit Any Profile',
   'Change another person''s profile: display name, job title, department and contracted hours.',
   'hub'),
  ('admin:entries:write',
   'Edit Any Time Entry',
   'Correct or remove another person''s time entries, including invoiced ones. The most dangerous key in the system: it rewrites the hours invoices are based on.',
   'time')
on conflict (permission_key) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Grants
-- ---------------------------------------------------------------------------

-- HR: the people side of the business, company-wide.
insert into app_role_permission (role_key, permission_key) values
  ('hr', 'overview:read'),
  -- read_all, not read_dept: HR is cross-departmental by definition.
  ('hr', 'people:read_own'), ('hr', 'people:read_dept'), ('hr', 'people:read_all'), ('hr', 'people:write'),
  ('hr', 'timesheets:read_own'), ('hr', 'timesheets:read_dept'), ('hr', 'timesheets:read_all'), ('hr', 'timesheets:write'),
  ('hr', 'workload:read'),
  -- Leave and contracts are HR's own module; the keys existed unused until now.
  ('hr', 'hr:leave:read'), ('hr', 'hr:leave:write'), ('hr', 'hr:leave:approve'),
  ('hr', 'hr:contract:read'), ('hr', 'hr:clocking:write'),
  -- User administration: HR onboards and offboards people.
  ('hr', 'admin:users:read'), ('hr', 'admin:users:write'),
  ('hr', 'admin:profiles:read'), ('hr', 'admin:profiles:write'),
  ('hr', 'admin:entries:write'),
  ('hr', 'sync:read'),
  -- DELIBERATELY NOT GRANTED to HR:
  --   projects:* / overview:export -> commercial data and margins are not HR's remit
  --   admin:roles:write            -> HR must not be able to grant itself exec
  --   workload:approve             -> approving delivery work is a line-management act

  -- exec keeps everything it had; these are the new keys.
  ('exec', 'admin:profiles:read'), ('exec', 'admin:profiles:write'),
  ('exec', 'admin:entries:write')
on conflict (role_key, permission_key) do nothing;

-- ---------------------------------------------------------------------------
-- 4. RLS: widen profile administration from exec-only to the new keys
-- ---------------------------------------------------------------------------
-- The existing policies hardcode app_user_role() = 'exec'. Rather than add
-- 'hr' as a second magic string (which would need editing again for the next
-- role), these are rewritten to ask the PERMISSION -- so /admin/roles can grant
-- profile administration to any role without another migration.
--
-- SAFETY: each policy is dropped and recreated inside this transaction. RLS
-- defaults to DENY, so an interrupted run locks profile access down rather than
-- opening it up.

drop policy if exists "exec can read all profiles" on app_user_profile;
create policy "profile admins can read all profiles"
  on app_user_profile for select to authenticated
  using ((select app_user_has_permission('admin:profiles:read')));

drop policy if exists "exec can update profiles" on app_user_profile;
create policy "profile admins can update profiles"
  on app_user_profile for update to authenticated
  using ((select app_user_has_permission('admin:profiles:write')))
  with check ((select app_user_has_permission('admin:profiles:write')));

-- INSERT and DELETE stay EXEC-ONLY on purpose. Creating and destroying an
-- account's profile row is what decides whether somebody can sign in at all,
-- and it is the step that assigns a role -- so it must not be reachable by a
-- role that cannot grant roles. HR onboards through the invite flow
-- (admin:users:write), which creates the profile for them with a chosen role.

commit;

-- Verify:
--   select role_key, count(*) from app_role_permission group by role_key order by role_key;
--   select policyname, cmd from pg_policies where tablename = 'app_user_profile';
