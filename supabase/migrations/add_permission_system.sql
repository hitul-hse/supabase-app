-- ---------------------------------------------------------------------------
-- Permission system migration
-- Run this in the Supabase SQL Editor AFTER schema.sql has been applied.
--
-- Adds fine-grained, admin-configurable RBAC on top of the four coarse roles.
-- Design: each permission is a (resource, action) pair with a human-readable
-- key and name. Roles receive permission sets via app_role_permission. The
-- app_user_has_permission() helper is the single function all middleware and
-- server components call — it resolves from the user's role, caches nothing
-- (SQL planner handles that), and respects is_active on the profile.
-- ---------------------------------------------------------------------------

-- 1. Permission catalogue — one row per discrete capability
create table if not exists app_permission (
  permission_key text primary key,          -- e.g. 'overview:read'
  display_name   text not null,             -- e.g. 'View Business Overview'
  resource       text not null,             -- e.g. 'overview'
  action         text not null,             -- e.g. 'read'
  description    text,
  sort_order     int  not null default 0
);

alter table app_permission enable row level security;

-- 2. Role ↔ permission assignments (m:n)
create table if not exists app_role_permission (
  role_key       text not null references app_role(role_key) on delete cascade,
  permission_key text not null references app_permission(permission_key) on delete cascade,
  granted_at     timestamptz not null default now(),
  primary key (role_key, permission_key)
);

alter table app_role_permission enable row level security;

-- 3. RLS policies
-- Permissions and role-permission maps are readable by every authenticated
-- user (needed to render the admin UI and drive permission checks).
-- Only execs may write them.

create policy "authenticated can read app_permission"
  on app_permission for select to authenticated using (true);

create policy "exec can manage app_permission"
  on app_permission for all to authenticated
  using (app_user_role() = 'exec')
  with check (app_user_role() = 'exec');

create policy "authenticated can read app_role_permission"
  on app_role_permission for select to authenticated using (true);

create policy "exec can manage app_role_permission"
  on app_role_permission for all to authenticated
  using (app_user_role() = 'exec')
  with check (app_user_role() = 'exec');

-- 4. Helper function — single entry point for all permission checks in app code
-- Returns true when the calling user's active role has the given permission.
-- security definer so it can query app_user_profile without recursion,
-- matching the pattern of the five existing helpers.

create or replace function app_user_has_permission(p_key text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from app_role_permission rp
    where rp.role_key = app_user_role()
      and rp.permission_key = p_key
  );
$$;

revoke execute on function app_user_has_permission(text) from public, anon;
grant  execute on function app_user_has_permission(text) to authenticated;

-- 5. Seed — canonical permission catalogue
insert into app_permission (permission_key, display_name, resource, action, description, sort_order) values
  -- Overview / analytics
  ('overview:read',           'View Business Overview',     'overview',    'read',        'Access the executive KPI overview page',          10),
  ('overview:export',         'Export Overview Data',       'overview',    'export',      'Download CSV/PDF exports from the overview',       11),

  -- People
  ('people:read_own',         'View Own Profile',           'people',      'read_own',    'See your own person record',                       20),
  ('people:read_dept',        'View Department People',     'people',      'read_dept',   'See all people in your department',                21),
  ('people:read_all',         'View All People',            'people',      'read_all',    'See every person record company-wide',             22),
  ('people:write',            'Edit People Records',        'people',      'write',       'Create and update person records',                 23),

  -- Projects
  ('projects:read_own',       'View Own Projects',          'projects',    'read_own',    'See projects you are assigned to',                 30),
  ('projects:read_dept',      'View Department Projects',   'projects',    'read_dept',   'See all projects in your department',              31),
  ('projects:read_all',       'View All Projects',          'projects',    'read_all',    'See every project company-wide',                   32),
  ('projects:write',          'Edit Project Records',       'projects',    'write',       'Create and update project records',                33),

  -- Timesheets
  ('timesheets:read_own',     'View Own Timesheets',        'timesheets',  'read_own',    'See your own time entries',                        40),
  ('timesheets:read_dept',    'View Department Timesheets', 'timesheets',  'read_dept',   'See all timesheets in your department',            41),
  ('timesheets:read_all',     'View All Timesheets',        'timesheets',  'read_all',    'See every timesheet company-wide',                 42),
  ('timesheets:write',        'Submit Timesheets',          'timesheets',  'write',       'Create and submit your own time entries',          43),

  -- Team Lead / Workload
  ('workload:read',           'View Workload Board',        'workload',    'read',        'Access the team lead booking board',               50),
  ('workload:approve',        'Approve Bookings',           'workload',    'approve',     'Approve or reject booking requests',               51),

  -- Admin
  ('admin:users:read',        'View User Accounts',         'admin',       'users:read',  'List all provisioned user accounts',               60),
  ('admin:users:write',       'Manage User Accounts',       'admin',       'users:write', 'Invite, edit, deactivate user accounts',           61),
  ('admin:roles:read',        'View Role Permissions',      'admin',       'roles:read',  'See which permissions each role has',              62),
  ('admin:roles:write',       'Edit Role Permissions',      'admin',       'roles:write', 'Grant or revoke permissions per role',             63),

  -- Sync / integrations
  ('sync:read',               'View Sync Status',           'sync',        'read',        'See data freshness indicators in the sync bar',    70),
  ('sync:trigger',            'Trigger Manual Sync',        'sync',        'trigger',     'Force a data refresh from external systems',       71)
on conflict (permission_key) do nothing;

-- 6. Seed — default permission sets per role
-- exec    → everything
-- dept_head → all reads + workload approval, no admin:roles:write
-- project_manager → own + dept reads, workload read, timesheet write
-- employee → own reads + timesheet write

insert into app_role_permission (role_key, permission_key) values
  -- exec (all)
  ('exec', 'overview:read'), ('exec', 'overview:export'),
  ('exec', 'people:read_own'), ('exec', 'people:read_dept'), ('exec', 'people:read_all'), ('exec', 'people:write'),
  ('exec', 'projects:read_own'), ('exec', 'projects:read_dept'), ('exec', 'projects:read_all'), ('exec', 'projects:write'),
  ('exec', 'timesheets:read_own'), ('exec', 'timesheets:read_dept'), ('exec', 'timesheets:read_all'), ('exec', 'timesheets:write'),
  ('exec', 'workload:read'), ('exec', 'workload:approve'),
  ('exec', 'admin:users:read'), ('exec', 'admin:users:write'), ('exec', 'admin:roles:read'), ('exec', 'admin:roles:write'),
  ('exec', 'sync:read'), ('exec', 'sync:trigger'),

  -- dept_head
  ('dept_head', 'overview:read'),
  ('dept_head', 'people:read_own'), ('dept_head', 'people:read_dept'),
  ('dept_head', 'projects:read_own'), ('dept_head', 'projects:read_dept'),
  ('dept_head', 'timesheets:read_own'), ('dept_head', 'timesheets:read_dept'), ('dept_head', 'timesheets:write'),
  ('dept_head', 'workload:read'), ('dept_head', 'workload:approve'),
  ('dept_head', 'admin:users:read'), ('dept_head', 'admin:roles:read'),
  ('dept_head', 'sync:read'),

  -- project_manager
  ('project_manager', 'overview:read'),
  ('project_manager', 'people:read_own'), ('project_manager', 'people:read_dept'),
  ('project_manager', 'projects:read_own'), ('project_manager', 'projects:read_dept'),
  ('project_manager', 'timesheets:read_own'), ('project_manager', 'timesheets:read_dept'), ('project_manager', 'timesheets:write'),
  ('project_manager', 'workload:read'),
  ('project_manager', 'sync:read'),

  -- employee
  ('employee', 'people:read_own'),
  ('employee', 'projects:read_own'),
  ('employee', 'timesheets:read_own'), ('employee', 'timesheets:write'),
  ('employee', 'sync:read')
on conflict (role_key, permission_key) do nothing;
