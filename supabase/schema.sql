-- Canonical schema for this project. Run this once against a fresh Supabase
-- project's SQL Editor to create every table and policy the app expects.
-- See supabase/README.md for how netflix_users was originally populated.
--
-- Ordering matters and is deliberate: this file is grouped into
--   1. legacy netflix_users / files tables and views
--   2. HSE Hub tables (no policies yet) — parents before children so every
--      foreign key target already exists
--   3. the role-resolution helper functions
--   4. every RLS policy, since the role-scoped ones call those functions
--   5. seed rows
-- Creating a policy whose USING clause calls a not-yet-created function is a
-- hard error, as is a foreign key to a not-yet-created table, so tables,
-- functions and policies cannot simply be interleaved per-table.

create table if not exists netflix_users (
  user_id bigint primary key,
  name text,
  age smallint,
  country text,
  subscription_type text,
  watch_time_hours numeric,
  favorite_genre text,
  last_login date
);

alter table netflix_users enable row level security;

create policy "Allow anon read access to netflix_users"
  on netflix_users
  for select
  to anon
  using (true);

create table if not exists files (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  object_path text not null unique,
  original_name text not null,
  content_type text,
  size_bytes bigint,
  uploaded_at timestamptz not null default now()
);

alter table files enable row level security;

create policy "Allow users to read their own files"
  on files
  for select
  to authenticated
  using (auth.uid() = owner_id);

create policy "Allow users to insert their own files"
  on files
  for insert
  to authenticated
  with check (auth.uid() = owner_id);

create policy "Allow users to delete their own files"
  on files
  for delete
  to authenticated
  using (auth.uid() = owner_id);

-- Aggregate views backing the /dashboard page. security_invoker means these
-- run with the querying role's own permissions, so they respect the
-- netflix_users RLS policy above rather than bypassing it as the view owner.

create or replace view netflix_overview
  with (security_invoker = true) as
  select
    count(*) as total_users,
    avg(age) as avg_age,
    avg(watch_time_hours) as avg_watch_time_hours,
    count(distinct country) as country_count
  from netflix_users;

create or replace view netflix_country_stats
  with (security_invoker = true) as
  select country, count(*) as user_count
  from netflix_users
  group by country
  order by user_count desc;

create or replace view netflix_genre_stats
  with (security_invoker = true) as
  select favorite_genre, count(*) as user_count
  from netflix_users
  group by favorite_genre
  order by user_count desc;

create or replace view netflix_subscription_stats
  with (security_invoker = true) as
  select subscription_type, count(*) as user_count, avg(watch_time_hours) as avg_watch_time_hours
  from netflix_users
  group by subscription_type
  order by user_count desc;

grant select on netflix_overview, netflix_country_stats, netflix_genre_stats, netflix_subscription_stats
  to anon, authenticated;


-- ---------------------------------------------------------------------------
-- 2. HSE Hub tables
-- ---------------------------------------------------------------------------
-- These back the Overview / Team Lead / People / Projects / Timesheets pages,
-- replacing what used to be static mock data in src/data/hse-data.ts.
-- Reference data (sync_sources, executive_metrics, weekly_trends,
-- team_utilisations) is company-wide and readable by any authenticated
-- session. Everything keyed by person or project is role-scoped in section 4.

create table if not exists sync_sources (
  source text primary key,
  freshness text not null,
  status text not null,
  message text,
  sort_order int not null
);

alter table sync_sources enable row level security;

create table if not exists executive_metrics (
  id bigint generated always as identity primary key,
  label text not null,
  value text not null,
  subtext text not null,
  subtext_color text,
  progress_percent numeric,
  progress_color text,
  sort_order int not null
);

alter table executive_metrics enable row level security;

create table if not exists weekly_trends (
  id bigint generated always as identity primary key,
  week text not null,
  billable_hours numeric not null,
  non_billable_hours numeric not null,
  is_open boolean not null default false,
  sort_order int not null
);

alter table weekly_trends enable row level security;

create table if not exists team_utilisations (
  id bigint generated always as identity primary key,
  team text not null,
  percent numeric,
  status_color text,
  sort_order int not null
);

alter table team_utilisations enable row level security;

-- people is created before projects because projects.owner_person_id
-- references it.

-- Only identity is required. Everything else is either derived from synced
-- data or comes from a system that is not integrated yet (task counts are
-- Asana; holiday balances are not in the pipeline), so those columns are
-- nullable: "not known yet" has to be representable instead of being filled
-- with a plausible-looking number.
create table if not exists people (
  id text primary key,
  name text not null,
  factorial_employee_id text unique,
  trackingtime_user_id text,
  is_active boolean not null default true,
  -- Distinguishes the demo roster from rows the vendor sync created.
  source text not null default 'seed' check (source in ('seed', 'factorial')),
  role text,
  department text,
  since text,
  contract_hours numeric,
  employee_number text,
  capacity_status text,
  logged_this_month numeric,
  total_monthly_hours numeric,
  billable_share numeric,
  open_tasks int,
  overdue_tasks int,
  holiday_left numeric,
  total_holiday numeric,
  timesheet_status text,
  certificate_status text,
  certificate_text text,
  -- Org chart (FactorialHR-equivalent feature). Nullable/self-referential:
  -- most people report to someone, the top of each branch reports to no one.
  manager_id text references people(id),
  -- Billable rate (TrackingTime-equivalent feature): €/hour used to derive
  -- a person's real billed value from approved timesheet hours, via
  -- billable_value_by_person below. Nullable like the other not-yet-synced
  -- HR columns above.
  billable_rate_eur numeric,
  -- What an hour of this person's time costs us, as opposed to what we charge
  -- for it. Kept separate from billable_rate_eur because the two behave
  -- differently: revenue counts only billable hours, cost counts every hour
  -- worked. Without both, the system can report what a project invoiced but
  -- never whether it made money.
  cost_rate_eur numeric
);

alter table people enable row level security;

-- Org chart view. Deliberately NOT security_invoker: the base `people` table's
-- read policy scopes rows to can_view_person() (self, or your department if
-- you're dept_head, or everyone if exec), but an org chart needs every
-- employee to see the whole reporting line, not just their own row -- the
-- opposite need from the netflix_* views above, which use security_invoker to
-- respect RLS rather than bypass it. Safe because only identity/reporting-line
-- columns are projected here; the sensitive HR fields on `people` (holiday
-- balances, certificates, capacity status) are never exposed through this view.
create or replace view org_chart_nodes as
  select id, name, role, department, manager_id
  from people;

grant select on org_chart_nodes to authenticated;

create table if not exists projects (
  id text primary key,
  code text not null,
  name text not null,
  customer text not null,
  lead text not null,
  status text not null,
  contract_hours numeric not null,
  billable_hours numeric not null,
  consumed_percent numeric not null,
  due text not null,
  contract_type text,
  team_size int,
  logged_hours numeric,
  remaining_hours numeric,
  forecast_overrun numeric,
  contract_value_eur numeric,
  invoiced_eur numeric,
  change_requests text,
  owner_person_id text references people(id) on delete set null,
  department text,
  -- Budgets (TrackingTime/Clockify-equivalent). budget_hours is the effort
  -- ceiling, budget_fee_eur the money ceiling; either can stand alone. Both
  -- nullable, because a project with no agreed ceiling must report "no
  -- budget" rather than a fake 0 that would read as instantly overrun.
  budget_hours numeric,
  budget_fee_eur numeric,
  -- Warn at this share of the budget, so an overrun is visible while there is
  -- still time to act rather than only once it has already happened.
  budget_alert_percent int not null default 80
    check (budget_alert_percent between 1 and 100),
  -- Project-level bill rate. Overrides the person's own rate for work on this
  -- project, which is how "this client is billed at a different rate" is
  -- expressed. Deliberately only two levels (project, then person): the
  -- source tools model five, but project-member and per-task rates buy very
  -- little at this company's size and cost a table and an editor each.
  billable_rate_eur numeric
);

alter table projects enable row level security;

create table if not exists project_timeline (
  id bigint generated always as identity primary key,
  project_id text not null references projects(id) on delete cascade,
  period text not null,
  title text not null,
  progress_percent numeric not null,
  status text not null,
  sort_order int not null
);

alter table project_timeline enable row level security;

/*
 * Sections. In Asana a section and a board column are the *same object* --
 * "a header above a list of tasks in a list view or a column in a board view"
 * -- and flipping the view reinterprets the same rows. Copying that is the
 * point of this table: the board previously had four hard-coded status
 * columns, which cannot express a per-project workflow (intake -> site visit
 * -> report drafted -> client review), and a status enum can't be renamed by
 * the people doing the work.
 *
 * wip_limit is deliberately advisory. Refusing the fourth card would stop
 * real work to satisfy a number; the UI warns instead. Asana has no WIP
 * limits at all, so this is a small place we can simply be better.
 */
create table if not exists project_sections (
  id bigint generated always as identity primary key,
  project_id text not null references projects(id) on delete cascade,
  name text not null,
  position int not null default 0,
  wip_limit int check (wip_limit is null or wip_limit > 0),
  created_at timestamptz not null default now()
);

alter table project_sections enable row level security;

create index if not exists project_sections_project_idx
  on project_sections (project_id, position);

-- security definer for the same reason task_project_id() is: a policy on
-- project_tasks that reads project_sections directly would recurse into that
-- table's own RLS.
create or replace function section_project_id(target_section_id bigint)
returns text
language sql stable security definer set search_path = public
as $$
  select project_id from project_sections where id = target_section_id;
$$;

revoke execute on function section_project_id(bigint) from public, anon;
grant execute on function section_project_id(bigint) to authenticated;

create table if not exists project_tasks (
  id bigint generated always as identity primary key,
  project_id text not null references projects(id) on delete cascade,
  -- on delete set null: removing a column must not destroy the work sitting
  -- in it. The tasks resurface unfiled rather than disappearing.
  section_id bigint references project_sections(id) on delete set null,
  -- Asana models date-only and date-with-time as separate fields. Only the
  -- date is needed here -- consulting deadlines are days, not appointments --
  -- so due_at is deliberately not carried.
  due_on date,
  name text not null,
  estimate_hours numeric not null,
  logged_hours numeric not null,
  status text not null,
  owner text not null,
  sort_order int not null,
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  parent_task_id bigint references project_tasks(id) on delete cascade
);

alter table project_tasks enable row level security;

-- person_assignments.project_id is the real link to projects. The older
-- project_name column is kept for display only: matching assignments to
-- projects by name was ambiguous across same-named projects and broke
-- silently whenever a project was renamed, so access control uses project_id.

create table if not exists person_assignments (
  id bigint generated always as identity primary key,
  person_id text not null references people(id) on delete cascade,
  project_id text references projects(id) on delete cascade,
  project_name text not null,
  logged_hours numeric not null,
  tasks_count int not null,
  share_percent numeric not null,
  sort_order int not null
);

alter table person_assignments enable row level security;

create table if not exists person_qualifications (
  id bigint generated always as identity primary key,
  person_id text not null references people(id) on delete cascade,
  name text not null,
  validity text not null,
  status text not null,
  sort_order int not null
);

alter table person_qualifications enable row level security;

create table if not exists weekly_bookings (
  id bigint generated always as identity primary key,
  person_id text not null references people(id) on delete cascade,
  week text not null,
  hours numeric,
  status text not null,
  unique (person_id, week)
);

alter table weekly_bookings enable row level security;

create table if not exists approval_decisions (
  id text primary key,
  title text not null,
  subtitle text not null,
  type text not null,
  primary_action text not null,
  secondary_action text,
  status text not null default 'pending',
  sort_order int not null
);

alter table approval_decisions enable row level security;

create table if not exists timesheet_entries (
  id bigint generated always as identity primary key,
  entry_group int not null,
  task_name text not null,
  project_name text not null,
  -- The real link to projects. project_name above is display-only and is kept
  -- for existing rows: matching timesheet hours to projects by name is
  -- ambiguous across same-named projects and breaks silently on rename --
  -- exactly the bug already fixed for person_assignments. Budget and margin
  -- figures join on this column, never on the name, so hours logged against
  -- one client's "Bridge" can't be counted against another's.
  -- Nullable because rows predating this column have only a name.
  project_id text references projects(id) on delete set null,
  customer text,
  is_billable boolean not null,
  warning text,
  day_of_week smallint not null,
  hours numeric not null,
  person_id text not null references people(id),
  -- Phase 3 (Timesheet Entry): week_start anchors entries to a real
  -- calendar week -- entry_group alone only distinguishes rows within a
  -- week, not across weeks or people, which is fine for a single seeded
  -- week but not for a real, growing history. status/submitted_at give
  -- the entry somewhere to live once submission is a real action instead
  -- of client-only UI state.
  week_start date not null default date_trunc('week', now())::date,
  status text not null default 'draft',
  submitted_at timestamptz,
  -- Why a week was sent back. Clockify makes this mandatory on rejection, and
  -- the reason is sound: "rejected" with no stated cause just produces another
  -- round of guessing. Cleared automatically on resubmit by the trigger below,
  -- so a stale note can't linger against a corrected week.
  rejection_note text,
  -- Live timer (TrackingTime/Toggl-equivalent). started_at set with
  -- stopped_at still null *is* the running timer -- there's no separate
  -- timer table, so a running entry is already a real timesheet row and
  -- stopping it is an ordinary update rather than a copy between tables.
  -- Both stay null for manually-typed grid entries.
  --
  -- Recording real start/end timestamps (not just a daily hours total) is
  -- also what German working-time recording expects: BAG 1 ABR 22/21 and
  -- § 16 Abs. 2 ArbZG are framed around Beginn, Ende und Dauer.
  started_at timestamptz,
  stopped_at timestamptz,
  -- A stopped timer can't end before it began.
  constraint timesheet_entries_timer_order check (stopped_at is null or started_at is null or stopped_at >= started_at)
);

alter table timesheet_entries enable row level security;

/*
 * Everything that must hold for an update to a timesheet row, in one trigger.
 *
 * Two concerns live here rather than in two triggers, partly because they're
 * both about the (old, new) pair and partly because pglite -- which the test
 * suite runs on -- crashes at teardown with two plpgsql triggers on one table.
 * One function reads better regardless.
 *
 * 1. A submitted week can't be edited in place. RLS can't express this on its
 *    own: permissive policies OR their USING and their WITH CHECK clauses
 *    *independently*, so the withdraw policy's USING (accepts a submitted row)
 *    pairs with the edit policy's WITH CHECK (accepts a submitted result) to
 *    grant something neither intended. Only a trigger sees both old and new.
 *
 * 2. Resubmitting clears the rejection note, so a note can't outlive the
 *    correction it prompted and read as a fresh rejection.
 */
create or replace function timesheet_entry_before_update()
returns trigger language plpgsql as $$
begin
  if old.status = 'submitted'
     and new.status <> 'draft'
     -- Service-role and unprovisioned callers (seeds, backfills) bypass RLS
     -- anyway and are out of scope here.
     and app_user_person_id() is not null
     and app_user_role() not in ('exec', 'dept_head') then
    raise exception 'Withdraw this week before changing it';
  end if;

  if new.status = 'submitted' and old.status is distinct from 'submitted' then
    new.rejection_note := null;
  end if;

  return new;
end;
$$;

drop trigger if exists timesheet_entries_clear_rejection_note on timesheet_entries;
drop trigger if exists timesheet_entries_owner_transitions on timesheet_entries;
create trigger timesheet_entries_before_update
  before update on timesheet_entries
  for each row execute function timesheet_entry_before_update();

-- One running timer per person, enforced by the database rather than by app
-- code: a double-clicked start button would otherwise open two concurrent
-- timers and silently double-count every hour that followed. Partial, so it
-- constrains only running timers -- manual grid entries have started_at null
-- and are unaffected.
create unique index if not exists timesheet_entries_one_running_timer
  on timesheet_entries (person_id)
  where started_at is not null and stopped_at is null;

-- Leave / PTO requests (FactorialHR-equivalent). people.holiday_left is a
-- static seeded number with no real ledger behind it; this table is that
-- ledger. holiday_left becomes derived (people.total_holiday minus approved
-- days) via the leave_balances view further down, rather than a column
-- anyone writes directly, so it can't drift from the approval history.
create table if not exists leave_requests (
  id bigint generated always as identity primary key,
  person_id text not null references people(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  days numeric not null check (days > 0),
  reason text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users(id)
);

alter table leave_requests enable row level security;

create table if not exists app_role (
  role_key text primary key,
  display_name text not null,
  seniority int not null
);

alter table app_role enable row level security;

create table if not exists app_user_profile (
  user_id uuid primary key references auth.users(id) on delete cascade,
  person_id text references people(id) on delete set null,
  role_key text not null references app_role(role_key),
  department text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table app_user_profile enable row level security;


-- ---------------------------------------------------------------------------
-- 3. Role-resolution helper functions
-- ---------------------------------------------------------------------------
-- app_user_role(), app_user_department() and app_user_person_id() are security
-- definer so they can safely read app_user_profile from inside that table's
-- own RLS policies without recursing through RLS; can_view_person() and
-- can_view_project() build on them and are reused across every
-- person/project-scoped policy in section 4. All five are granted to
-- `authenticated` only (required for RLS to evaluate them) and explicitly
-- revoked from `anon` and `public` — Supabase's project defaults grant EXECUTE
-- on new public-schema functions to anon at creation time, so that revoke has
-- to be explicit, not just assumed.
--
-- All three profile lookups filter on is_active: deactivating an account has
-- to actually drop its role, otherwise an inactive user keeps every
-- permission their old role granted.

create or replace function app_user_role()
returns text
language sql stable security definer set search_path = public
as $$
  select role_key from app_user_profile where user_id = auth.uid() and is_active;
$$;

create or replace function app_user_department()
returns text
language sql stable security definer set search_path = public
as $$
  select department from app_user_profile where user_id = auth.uid() and is_active;
$$;

create or replace function app_user_person_id()
returns text
language sql stable security definer set search_path = public
as $$
  select person_id from app_user_profile where user_id = auth.uid() and is_active;
$$;

create or replace function can_view_person(target_person_id text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select
    app_user_role() = 'exec'
    or (
      app_user_role() = 'dept_head'
      and exists (select 1 from people p where p.id = target_person_id and p.department = app_user_department())
    )
    or target_person_id = app_user_person_id();
$$;

create or replace function can_view_project(target_project_id text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select
    app_user_role() = 'exec'
    or exists (
      select 1 from projects pr
      where pr.id = target_project_id
      and (
        (app_user_role() = 'dept_head' and pr.department = app_user_department())
        or pr.owner_person_id = app_user_person_id()
        or exists (
          select 1 from person_assignments pa
          where pa.project_id = pr.id and pa.person_id = app_user_person_id()
        )
      )
    );
$$;

-- security definer (not just can_view_project(project_id)) because it reads
-- project_tasks itself -- a policy on project_tasks querying project_tasks
-- directly inside its own WITH CHECK recurses into RLS unpredictably, the
-- same reason can_view_project()/can_view_person() are security definer.
create or replace function task_project_id(target_task_id bigint)
returns text
language sql stable security definer set search_path = public
as $$
  select project_id from project_tasks where id = target_task_id;
$$;

revoke execute on function
  app_user_role(), app_user_department(), app_user_person_id(),
  can_view_person(text), can_view_project(text), task_project_id(bigint)
from public, anon;

grant execute on function
  app_user_role(), app_user_department(), app_user_person_id(),
  can_view_person(text), can_view_project(text), task_project_id(bigint)
to authenticated;


-- ---------------------------------------------------------------------------
-- 3b. Fine-grained permissions and the module registry
--
-- Folded in from supabase/migrations/add_permission_system.sql. It lived only
-- as a standalone migration, which meant a fresh environment could -- and did
-- -- come up without it: app_permission/app_role_permission/
-- app_user_has_permission() were absent from the live database while every
-- other table was present, so /admin/roles silently redirected everyone home.
-- Anything a fresh environment must have belongs in this file.
--
-- Placement is load-bearing: app_role_permission references app_role (defined
-- above) and app_user_has_permission() calls app_user_role() (granted just
-- above), so this block cannot move earlier.
-- ---------------------------------------------------------------------------

-- Permission catalogue -- one row per discrete capability.
-- permission_key is 'module:resource:action' or the older 'resource:action'.
-- Both shapes coexist deliberately: the pre-module keys (overview:read,
-- people:read_all) are still what the current app checks, and renaming them
-- would be a breaking change for no gain. New module work uses the 3-part form.
create table if not exists app_permission (
  permission_key text primary key,
  display_name   text not null,
  resource       text not null,
  action         text not null,
  description    text,
  -- Which module owns this capability. Drives bridge-portal tile visibility
  -- (see app_module below). 'hub' means the analytics portal itself.
  module_key     text not null default 'hub',
  sort_order     int  not null default 0
);

alter table app_permission enable row level security;

create table if not exists app_role_permission (
  role_key       text not null references app_role(role_key) on delete cascade,
  permission_key text not null references app_permission(permission_key) on delete cascade,
  granted_at     timestamptz not null default now(),
  primary key (role_key, permission_key)
);

alter table app_role_permission enable row level security;

-- Module registry -- the bridge portal's tile list lives in data, not code.
-- A tile is shown when the signed-in user holds ANY permission belonging to
-- that module, so granting a permission is the only step needed to reveal a
-- module. There is deliberately no hardcoded tile array in the app.
create table if not exists app_module (
  module_key   text primary key,
  display_name text not null,
  tagline      text,
  -- Route the tile links to. Null means "built but not routed yet", which is
  -- how a module appears in the registry during development without becoming
  -- a dead link on the portal.
  href         text,
  accent       text not null default '#91C2B7',
  -- false keeps a module in the catalogue but hides its tile from everyone,
  -- regardless of permissions. Used for modules that are planned, not live.
  is_live      boolean not null default false,
  sort_order   int not null default 0
);

alter table app_module enable row level security;

-- Hub's only write surface. Hub is otherwise read-only across every module;
-- managerial acts (approve overtime, approve leave, acknowledge an overrun)
-- land here and the owning module reads and applies them. That keeps every
-- module's own tables written by exactly one module.
--
-- subject_ref is text, not a foreign key, precisely because it points into
-- different modules' tables ('timesheet_entry:412', 'leave_request:88'). A
-- real FK would force this table to depend on every module's schema.
create table if not exists platform_decision (
  id           bigserial primary key,
  kind         text not null,
  subject_ref  text not null,
  outcome      text not null check (outcome in ('approved', 'rejected', 'acknowledged')),
  note         text,
  decided_by   uuid not null references auth.users(id) on delete restrict,
  decided_at   timestamptz not null default now()
);

alter table platform_decision enable row level security;

create index if not exists platform_decision_subject_idx
  on platform_decision (subject_ref);

-- Single entry point for every permission check in app code.
-- security definer so it can read app_user_profile without tripping RLS
-- recursion, matching the five helpers above.
--
-- Inherits the is_active check transitively: app_user_role() filters on
-- is_active, so a deactivated profile resolves to no role and therefore holds
-- no permissions. Verified by the is_active assertions in
-- scripts/check-permissions-rls.mjs rather than assumed.
--
-- Defined BEFORE the policies below because the platform_decision insert policy
-- calls it: Postgres resolves function references in a policy expression at
-- CREATE POLICY time, so a policy cannot reference a function defined later in
-- the same script.
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

-- Which modules should this user see on the bridge portal? Returns the module
-- rows the user holds at least one permission for. Kept in SQL rather than the
-- app so the tile list cannot drift from the permission data.
create or replace function app_user_modules()
returns setof app_module
language sql stable security definer set search_path = public
as $$
  select m.*
  from app_module m
  where m.is_live
    and exists (
      select 1
      from app_role_permission rp
      join app_permission p on p.permission_key = rp.permission_key
      where rp.role_key = app_user_role()
        and p.module_key = m.module_key
    )
  order by m.sort_order, m.display_name;
$$;

revoke execute on function app_user_has_permission(text), app_user_modules()
  from public, anon;
grant  execute on function app_user_has_permission(text), app_user_modules()
  to authenticated;

-- Permissions, role maps and the module registry are readable by every
-- authenticated user: the portal needs them to decide which tiles to render,
-- and requirePermission() needs them on every gated request. Only execs write.

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

create policy "authenticated can read app_module"
  on app_module for select to authenticated using (true);

create policy "exec can manage app_module"
  on app_module for all to authenticated
  using (app_user_role() = 'exec')
  with check (app_user_role() = 'exec');

-- Decisions are visible to whoever may approve in that area, and writable only
-- by someone holding the matching approve permission. decided_by is pinned to
-- the caller so a decision cannot be attributed to someone else.
create policy "approvers can read platform_decision"
  on platform_decision for select to authenticated
  using (app_user_role() in ('exec', 'dept_head') or decided_by = auth.uid());

create policy "approvers can record a platform_decision"
  on platform_decision for insert to authenticated
  with check (
    decided_by = auth.uid()
    and (
      (kind = 'timesheet' and app_user_has_permission('workload:approve'))
      or (kind = 'leave' and app_user_has_permission('hr:leave:approve'))
      or (kind = 'budget' and app_user_has_permission('projects:write'))
    )
  );

-- Decisions are an audit trail: no update, no delete policy, deliberately.
-- Reversing a decision means recording a new one.


-- ---------------------------------------------------------------------------
-- 4. RLS policies
-- ---------------------------------------------------------------------------

-- Company-wide reference data: any authenticated session.

create policy "authenticated can read sync_sources"
  on sync_sources for select to authenticated using (true);

create policy "authenticated can read executive_metrics"
  on executive_metrics for select to authenticated using (true);

create policy "authenticated can read weekly_trends"
  on weekly_trends for select to authenticated using (true);

create policy "authenticated can read team_utilisations"
  on team_utilisations for select to authenticated using (true);

create policy "authenticated can read app_role"
  on app_role for select to authenticated using (true);

-- Person-scoped and project-scoped reads.

create policy "role-scoped read on people"
  on people for select to authenticated using (can_view_person(id));

-- Only exec can set a person's billable rate -- pay-rate-adjacent data,
-- narrower than the general can_view_person() write trust dept_head gets
-- elsewhere. Postgres RLS can't restrict which columns an UPDATE touches,
-- so like every other whole-row-trust policy in this file (e.g. the lead
-- approval policies on timesheet_entries/leave_requests), this trusts exec
-- for the whole row, not just billable_rate_eur.
create policy "exec can set billable rates"
  on people for update to authenticated
  using (app_user_role() = 'exec')
  with check (app_user_role() = 'exec');

create policy "role-scoped read on person_assignments"
  on person_assignments for select to authenticated using (can_view_person(person_id));

create policy "role-scoped read on person_qualifications"
  on person_qualifications for select to authenticated using (can_view_person(person_id));

create policy "role-scoped read on weekly_bookings"
  on weekly_bookings for select to authenticated using (can_view_person(person_id));

create policy "role-scoped read on timesheet_entries"
  on timesheet_entries for select to authenticated using (can_view_person(person_id));

-- Write access to timesheet_entries (Phase 3: Timesheet Entry). Two
-- separate update policies rather than one, mirroring the approval_decisions
-- split further down: the owner can edit/submit their own row while it's
-- still a draft, but WITH CHECK caps what they can set status to (draft or
-- submitted only) so an employee can never self-approve. A lead's approval
-- is a distinct policy scoped by can_view_person(), not a status check --
-- Postgres RLS can't restrict which columns an UPDATE touches, so this
-- trusts the lead role for the whole row, the same trust boundary
-- approval_decisions already relies on.

create policy "owner can insert their own timesheet_entries"
  on timesheet_entries for insert to authenticated
  with check (person_id = app_user_person_id());

-- 'rejected' is included in USING so a week sent back is editable again --
-- otherwise the employee is told to fix something they can't touch. WITH
-- CHECK still caps what they may set it to, so this is not a route to
-- self-approval.
create policy "owner can edit their own draft timesheet_entries"
  on timesheet_entries for update to authenticated
  using (person_id = app_user_person_id() and status in ('draft', 'rejected'))
  -- 'rejected' appears here too because correcting a sent-back week leaves it
  -- rejected until the owner resubmits; without it the very first edit fails
  -- WITH CHECK. 'approved' is still absent, so self-approval stays impossible.
  with check (person_id = app_user_person_id() and status in ('draft', 'submitted', 'rejected'));

-- Withdrawing a submitted week, so a mistake spotted after hitting submit
-- doesn't need a lead to bounce it back. Narrow on both sides: only a
-- submitted row, and only back to draft.
create policy "owner can withdraw their own submitted timesheet_entries"
  on timesheet_entries for update to authenticated
  using (person_id = app_user_person_id() and status = 'submitted')
  with check (person_id = app_user_person_id() and status = 'draft');

create policy "lead can approve or reject visible timesheet_entries"
  on timesheet_entries for update to authenticated
  using (app_user_role() in ('exec', 'dept_head') and can_view_person(person_id))
  with check (app_user_role() in ('exec', 'dept_head') and can_view_person(person_id));

create policy "owner can delete their own draft timesheet_entries"
  on timesheet_entries for delete to authenticated
  using (person_id = app_user_person_id() and status = 'draft');

-- Write access to leave_requests. Same shape as timesheet_entries: the
-- owner can create/cancel their own request while it's pending, and a
-- lead's approve/reject is a separate policy scoped by can_view_person(),
-- not a status check on the row (RLS can't restrict which columns an
-- UPDATE touches). WITH CHECK on insert additionally caps status to
-- 'pending' so nobody can create a request that's already decided.

create policy "role-scoped read on leave_requests"
  on leave_requests for select to authenticated using (can_view_person(person_id));

create policy "owner can request their own leave"
  on leave_requests for insert to authenticated
  with check (person_id = app_user_person_id() and status = 'pending');

create policy "lead can approve or reject visible leave_requests"
  on leave_requests for update to authenticated
  using (app_user_role() in ('exec', 'dept_head') and can_view_person(person_id) and status = 'pending')
  with check (app_user_role() in ('exec', 'dept_head') and can_view_person(person_id) and status in ('approved', 'rejected'));

create policy "owner can cancel their own pending leave request"
  on leave_requests for delete to authenticated
  using (person_id = app_user_person_id() and status = 'pending');

create policy "role-scoped read on projects"
  on projects for select to authenticated using (can_view_project(id));

-- Budgets and bill rates are commercial terms, so writes are exec-only --
-- narrower than the can_view_project() trust a dept_head gets for tasks.
-- Postgres RLS can't restrict which columns an UPDATE touches, so as with
-- every other whole-row-trust policy in this file this trusts exec for the
-- whole projects row, not only the budget columns.
create policy "exec can set project budgets and rates"
  on projects for update to authenticated
  using (app_user_role() = 'exec')
  with check (app_user_role() = 'exec');

create policy "role-scoped read on project_timeline"
  on project_timeline for select to authenticated using (can_view_project(project_id));

create policy "role-scoped read on project_tasks"
  on project_tasks for select to authenticated using (can_view_project(project_id));

-- Sections are scoped exactly like the project they belong to: if you can see
-- the project you can see and shape its columns.
create policy "role-scoped read on project_sections"
  on project_sections for select to authenticated using (can_view_project(project_id));

create policy "role-scoped insert on project_sections"
  on project_sections for insert to authenticated with check (can_view_project(project_id));

create policy "role-scoped update on project_sections"
  on project_sections for update to authenticated
  using (can_view_project(project_id))
  with check (can_view_project(project_id));

create policy "role-scoped delete on project_sections"
  on project_sections for delete to authenticated using (can_view_project(project_id));

-- Write access to project_tasks (Phase 2: Task &amp; Project Management).
-- Scoped identically to who can already VIEW the project -- exec always,
-- dept_head within their department, the project's owner, or anyone
-- assigned to it via person_assignments. WITH CHECK on insert/update
-- prevents creating or reassigning a task into a project the caller can't
-- see (the same "must have both USING and WITH CHECK" rule as every other
-- write policy in this file).

-- Subtasks (Asana-equivalent) are just project_tasks rows with parent_task_id
-- set -- they inherit the read/write policies above for free. The only extra
-- rule: a subtask's project_id must match its parent's project_id, so nobody
-- can smuggle a task into a project they can't see by nesting it under a
-- task in a project they can (can_view_project(project_id) alone wouldn't
-- catch that, since it only checks the new row's own project_id).

create policy "role-scoped insert on project_tasks"
  on project_tasks for insert to authenticated
  with check (
    can_view_project(project_id)
    and (parent_task_id is null or project_id = task_project_id(parent_task_id))
    -- Same class of rule as the parent check above: a task filed into a
    -- section belonging to another project would appear in that project's
    -- board column.
    and (section_id is null or project_id = section_project_id(section_id))
  );

create policy "role-scoped update on project_tasks"
  on project_tasks for update to authenticated
  using (can_view_project(project_id))
  with check (
    can_view_project(project_id)
    and (parent_task_id is null or project_id = task_project_id(parent_task_id))
    -- Same class of rule as the parent check above: a task filed into a
    -- section belonging to another project would appear in that project's
    -- board column.
    and (section_id is null or project_id = section_project_id(section_id))
  );

create policy "role-scoped delete on project_tasks"
  on project_tasks for delete to authenticated
  using (can_view_project(project_id));

-- Task comments (Asana-equivalent: collaboration on a task). Scoped through
-- the parent task's project visibility, same can_view_project() reused
-- everywhere else -- if you can see the task, you can read and add comments
-- on it. WITH CHECK on insert pins author_id to the caller so nobody can
-- post a comment attributed to someone else. Only the author can delete
-- their own comment; there is no edit -- comments are append-only, matching
-- how every other collaboration tool in this space treats them.

create table if not exists task_comments (
  id bigint generated always as identity primary key,
  task_id bigint not null references project_tasks(id) on delete cascade,
  author_id uuid not null references auth.users(id),
  body text not null,
  created_at timestamptz not null default now()
);

alter table task_comments enable row level security;

create policy "role-scoped read on task_comments"
  on task_comments for select to authenticated
  using (exists (
    select 1 from project_tasks pt
    where pt.id = task_id and can_view_project(pt.project_id)
  ));

create policy "role-scoped insert on task_comments"
  on task_comments for insert to authenticated
  with check (
    author_id = auth.uid()
    and exists (
      select 1 from project_tasks pt
      where pt.id = task_id and can_view_project(pt.project_id)
    )
  );

create policy "author can delete their own task_comments"
  on task_comments for delete to authenticated
  using (author_id = auth.uid());

-- Resolves a display name for whoever wrote a comment. Same deliberate
-- RLS-bypass pattern as org_chart_nodes above: app_user_profile's own read
-- policy is self-only (or exec-only for all rows), which would otherwise
-- make it impossible for an employee to see a co-worker's name on a shared
-- comment thread. Only a name is exposed here, nothing from app_user_profile
-- itself (no role_key, no department, no is_active).
create or replace view user_display_names as
  select up.user_id, coalesce(p.name, 'Team member') as display_name
  from app_user_profile up
  left join people p on p.id = up.person_id;

grant select on user_display_names to authenticated;

-- Approvals. The update policy needs both USING (which existing rows may be
-- targeted) and WITH CHECK (what the row is allowed to look like afterwards);
-- USING alone would let an authorised caller rewrite a row into any shape,
-- including a status the app never offers.

create policy "exec and dept_head can read approval_decisions"
  on approval_decisions for select to authenticated using (app_user_role() in ('exec', 'dept_head'));

create policy "exec and dept_head can update approval_decisions"
  on approval_decisions for update to authenticated
  using (app_user_role() in ('exec', 'dept_head'))
  with check (
    app_user_role() in ('exec', 'dept_head')
    and status in ('pending', 'approved', 'rejected')
  );

-- Profiles. Execs administer accounts; everyone else may read only their own.
-- Without the exec write policies below there is no non-service-role path to
-- change a role or deactivate an account, which left the admin console's
-- ACTIVE/INACTIVE state permanently unchangeable.

create policy "user can read own profile"
  on app_user_profile for select to authenticated using (user_id = auth.uid());

create policy "exec can read all profiles"
  on app_user_profile for select to authenticated using (app_user_role() = 'exec');

create policy "exec can insert profiles"
  on app_user_profile for insert to authenticated
  with check (app_user_role() = 'exec');

create policy "exec can update profiles"
  on app_user_profile for update to authenticated
  using (app_user_role() = 'exec')
  with check (app_user_role() = 'exec');

create policy "exec can delete profiles"
  on app_user_profile for delete to authenticated
  using (app_user_role() = 'exec');


-- ---------------------------------------------------------------------------
-- 5. Seed rows
-- ---------------------------------------------------------------------------

insert into app_role (role_key, display_name, seniority) values
  ('exec', 'Executive', 4),
  ('dept_head', 'Department Head', 3),
  ('project_manager', 'Project Manager', 2),
  ('employee', 'Employee', 1)
on conflict (role_key) do nothing;

-- Module registry. is_live=false is the default and the safe one: a module
-- appears here as soon as we start on it, but its tile stays hidden until it
-- is actually usable. Flipping is_live is the launch switch -- no deploy.
insert into app_module (module_key, display_name, tagline, href, accent, is_live, sort_order) values
  ('hub',      'HSE Hub',            'Analytics and approvals for leads',      '/',           '#91C2B7', true,  10),
  ('projects', 'Project Management', 'Projects, tasks, boards, milestones',    '/projects',   '#F0A868', true,  20),
  ('time',     'Time Tracking',      'Tracked intervals, billable hours, services', '/time',  '#7FB5D5', true,  30),
  ('hr',       'HSE HR',             'Leave, absences, contracts, clocking',   null,          '#C08FD0', false, 40),
  ('crm',      'CRM',                'Deals, pipeline, companies',             null,          '#D08F8F', false, 50)
on conflict (module_key) do nothing;

-- The tile's route is the one field that legitimately changes after a module is
-- seeded, and `on conflict do nothing` above cannot deliver it: the `time` tile
-- pointed at /timesheets (the Hub's hours grid) while the module's own page did
-- not exist yet, and a re-run of this file would have left the live database on
-- the stale route forever. Routing is corrected explicitly, and only where it is
-- actually wrong, so a deliberate change made in the admin UI is not clobbered.
update app_module set href = '/time', tagline = 'Tracked intervals, billable hours, services'
 where module_key = 'time' and href = '/timesheets';

-- Second correction, same mechanism and same reason. The tile pointed at /time
-- (one person's own week) while the module's actual destination is the
-- organisation-wide report at /time/dashboard. Anyone arriving through the
-- portal therefore landed on the personal tracker and never saw the company
-- dashboard at all -- the sidebar had been repointed, the tile had not.
--
-- Named "TrackingTime API Dashboard" deliberately: it reports data imported
-- FROM the TrackingTime API, and while that pipeline is the thing being built
-- the name should say so plainly rather than read as a second, competing
-- time-tracking product.
--
-- Narrow, like the repair above: only a tile still on the old route is moved,
-- so a deliberate re-route made in the admin UI survives a re-run.
update app_module
   set href         = '/time/dashboard',
       display_name = 'TrackingTime API Dashboard',
       tagline      = 'Company hours, projects, customers, budgets'
 where module_key = 'time' and href = '/time';

-- Canonical permission catalogue. These 22 keys are the ones src/lib/permissions.ts
-- checks, and check-permissions-rls.mjs asserts the two lists stay in step --
-- adding a key to one without the other fails that gate.
insert into app_permission
  (permission_key, display_name, resource, action, description, module_key, sort_order) values
  ('overview:read',        'View Business Overview',     'overview',   'read',        'Access the executive KPI overview page',       'hub',      10),
  ('overview:export',      'Export Overview Data',       'overview',   'export',      'Download CSV/PDF exports from the overview',  'hub',      11),

  ('people:read_own',      'View Own Profile',           'people',     'read_own',    'See your own person record',                  'hub',      20),
  ('people:read_dept',     'View Department People',     'people',     'read_dept',   'See all people in your department',           'hub',      21),
  ('people:read_all',      'View All People',            'people',     'read_all',    'See every person record company-wide',        'hub',      22),
  ('people:write',         'Edit People Records',        'people',     'write',       'Create and update person records',            'hub',      23),

  ('projects:read_own',    'View Own Projects',          'projects',   'read_own',    'See projects you are assigned to',            'projects', 30),
  ('projects:read_dept',   'View Department Projects',   'projects',   'read_dept',   'See all projects in your department',         'projects', 31),
  ('projects:read_all',    'View All Projects',          'projects',   'read_all',    'See every project company-wide',              'projects', 32),
  ('projects:write',       'Edit Project Records',       'projects',   'write',       'Create and update project records',           'projects', 33),

  ('timesheets:read_own',  'View Own Timesheets',        'timesheets', 'read_own',    'See your own time entries',                   'time',     40),
  ('timesheets:read_dept', 'View Department Timesheets', 'timesheets', 'read_dept',   'See all timesheets in your department',       'time',     41),
  ('timesheets:read_all',  'View All Timesheets',        'timesheets', 'read_all',    'See every timesheet company-wide',            'time',     42),
  ('timesheets:write',     'Submit Timesheets',          'timesheets', 'write',       'Create and submit your own time entries',     'time',     43),

  ('workload:read',        'View Workload Board',        'workload',   'read',        'Access the team lead booking board',          'hub',      50),
  ('workload:approve',     'Approve Bookings',           'workload',   'approve',     'Approve or reject booking requests',          'hub',      51),

  ('admin:users:read',     'View User Accounts',         'admin',      'users:read',  'List all provisioned user accounts',          'hub',      60),
  ('admin:users:write',    'Manage User Accounts',       'admin',      'users:write', 'Invite, edit, deactivate user accounts',      'hub',      61),
  ('admin:roles:read',     'View Role Permissions',      'admin',      'roles:read',  'See which permissions each role has',         'hub',      62),
  ('admin:roles:write',    'Edit Role Permissions',      'admin',      'roles:write', 'Grant or revoke permissions per role',        'hub',      63),

  ('sync:read',            'View Sync Status',           'sync',       'read',        'See data freshness indicators in the sync bar','hub',      70),
  ('sync:trigger',         'Trigger Manual Sync',        'sync',       'trigger',     'Force a data refresh from external systems',  'hub',      71)
on conflict (permission_key) do nothing;

-- Default permission sets per role, matching the model already in the app:
-- exec everything; dept_head all dept reads + approvals but no roles:write;
-- project_manager own+dept reads; employee own reads + own timesheet writes.
insert into app_role_permission (role_key, permission_key) values
  ('exec', 'overview:read'), ('exec', 'overview:export'),
  ('exec', 'people:read_own'), ('exec', 'people:read_dept'), ('exec', 'people:read_all'), ('exec', 'people:write'),
  ('exec', 'projects:read_own'), ('exec', 'projects:read_dept'), ('exec', 'projects:read_all'), ('exec', 'projects:write'),
  ('exec', 'timesheets:read_own'), ('exec', 'timesheets:read_dept'), ('exec', 'timesheets:read_all'), ('exec', 'timesheets:write'),
  ('exec', 'workload:read'), ('exec', 'workload:approve'),
  ('exec', 'admin:users:read'), ('exec', 'admin:users:write'), ('exec', 'admin:roles:read'), ('exec', 'admin:roles:write'),
  ('exec', 'sync:read'), ('exec', 'sync:trigger'),

  ('dept_head', 'overview:read'),
  ('dept_head', 'people:read_own'), ('dept_head', 'people:read_dept'),
  ('dept_head', 'projects:read_own'), ('dept_head', 'projects:read_dept'),
  ('dept_head', 'timesheets:read_own'), ('dept_head', 'timesheets:read_dept'), ('dept_head', 'timesheets:write'),
  ('dept_head', 'workload:read'), ('dept_head', 'workload:approve'),
  ('dept_head', 'admin:users:read'), ('dept_head', 'admin:roles:read'),
  ('dept_head', 'sync:read'),

  ('project_manager', 'overview:read'),
  ('project_manager', 'people:read_own'), ('project_manager', 'people:read_dept'),
  ('project_manager', 'projects:read_own'), ('project_manager', 'projects:read_dept'),
  ('project_manager', 'timesheets:read_own'), ('project_manager', 'timesheets:read_dept'), ('project_manager', 'timesheets:write'),
  ('project_manager', 'workload:read'),
  ('project_manager', 'sync:read'),

  ('employee', 'people:read_own'),
  ('employee', 'projects:read_own'),
  ('employee', 'timesheets:read_own'), ('employee', 'timesheets:write'),
  ('employee', 'sync:read')
on conflict (role_key, permission_key) do nothing;

-- Re-tag module ownership for any environment where add_permission_system.sql
-- was already applied by hand: those rows predate module_key and would all
-- carry the 'hub' default, which would put Projects and Time permissions on the
-- wrong tile. The INSERT above sets it correctly for a fresh database; this
-- UPDATE fixes an existing one. Both paths must end in the same state.
update app_permission set module_key = 'projects' where resource = 'projects';
update app_permission set module_key = 'time'     where resource = 'timesheets';
update app_permission set module_key = 'hub'
  where resource in ('overview', 'people', 'workload', 'admin', 'sync');

-- Module-scoped permissions for the modules that don't exist yet. Seeding them
-- now means the HR module's access model is reviewable before a line of HR code
-- is written, and the tile stays hidden regardless because app_module.is_live
-- is false for 'hr'. Granting these to a role is therefore safe today.
insert into app_permission
  (permission_key, display_name, resource, action, description, module_key, sort_order) values
  ('hr:leave:read',      'View Leave Requests',   'leave',    'read',    'See leave and absence requests',           'hr',   80),
  ('hr:leave:write',     'Request Leave',         'leave',    'write',   'Submit your own leave requests',           'hr',   81),
  ('hr:leave:approve',   'Approve Leave',         'leave',    'approve', 'Approve or reject leave requests',         'hr',   82),
  ('hr:contract:read',   'View Contracts',        'contract', 'read',    'See employment contract details',          'hr',   83),
  ('hr:clocking:write',  'Clock In and Out',      'clocking', 'write',   'Record working-time clock events',         'hr',   84),
  ('crm:deal:read',      'View Deals',            'deal',     'read',    'See CRM deals and pipeline stages',        'crm',  90),
  ('crm:deal:write',     'Edit Deals',            'deal',     'write',   'Create and update CRM deals',              'crm',  91)
on conflict (permission_key) do nothing;

-- Give the new keys to roles consistent with the existing model: everyone may
-- request their own leave, leads may approve within their scope, execs get all.
insert into app_role_permission (role_key, permission_key) values
  ('exec', 'hr:leave:read'), ('exec', 'hr:leave:write'), ('exec', 'hr:leave:approve'),
  ('exec', 'hr:contract:read'), ('exec', 'hr:clocking:write'),
  ('exec', 'crm:deal:read'), ('exec', 'crm:deal:write'),
  ('dept_head', 'hr:leave:read'), ('dept_head', 'hr:leave:write'),
  ('dept_head', 'hr:leave:approve'), ('dept_head', 'hr:clocking:write'),
  ('project_manager', 'hr:leave:read'), ('project_manager', 'hr:leave:write'),
  ('project_manager', 'hr:clocking:write'),
  ('employee', 'hr:leave:write'), ('employee', 'hr:clocking:write')
on conflict (role_key, permission_key) do nothing;

-- ---------------------------------------------------------------------------
-- 6. Vendor-sourced data
-- ---------------------------------------------------------------------------
-- Everything above is seeded demo data. This table is the first fed by a real
-- source: the hs-experts/timesheet-automation service publishes one row per
-- employee per Monday-to-Friday week from Factorial and TrackingTime.
--
-- Units are stored exactly as the upstream aggregator reports them (Factorial
-- in minutes, TrackingTime in seconds). Normalising on write would bake one
-- presentation choice into the only copy and lose precision irreversibly.

create table if not exists weekly_employee_summary (
  id bigint generated always as identity primary key,

  period_start date not null,
  period_end date not null,

  -- Identity as the source systems know it. person_id is the join into this
  -- app's own people table and stays null until an identity mapping exists;
  -- Factorial employee ids do not resemble the ids used here. The sync
  -- deliberately omits this column from its payload so a re-run cannot clear
  -- a mapping made by hand.
  factorial_employee_id text not null,
  trackingtime_user_id text,
  employee_name text not null,
  person_id text references people(id) on delete set null,

  worked_minutes int not null,
  worked_day_count int not null,
  expected_minutes int not null,

  -- Null means the absence duration could not be determined (no duration on
  -- the record, or it straddles the period boundary). That is meaningfully
  -- different from zero absence and must not collapse into it.
  absence_minutes int,
  absence_label text,

  billable_seconds int not null,
  travel_time_seconds int not null,
  internal_project_seconds int not null,
  empty_tasks_seconds int not null,

  review_entry_count int not null default 0,
  synced_at timestamptz not null default now(),

  -- Makes re-running a week idempotent instead of duplicating it.
  unique (period_start, factorial_employee_id)
);

create index if not exists weekly_employee_summary_period_idx
  on weekly_employee_summary (period_start desc);

alter table weekly_employee_summary enable row level security;

-- Individual hours are management data, so this follows approval_decisions
-- rather than the company-wide reference tables. Writes arrive via the service
-- role, which bypasses RLS, so no write policy is granted.
-- Reuse the person scoping so an employee can see their own timesheet:
-- can_view_person already encodes exec-sees-all, dept_head-sees-department and
-- everyone-sees-themselves. The exec branch also covers rows whose employee has
-- no people row yet, which would otherwise be invisible to everyone.
create policy "role-scoped read on weekly_employee_summary"
  on weekly_employee_summary for select to authenticated
  using (
    app_user_role() = 'exec'
    or exists (
      select 1 from people p
      where p.factorial_employee_id = weekly_employee_summary.factorial_employee_id
        and can_view_person(p.id)
    )
  );

-- Real, derived holiday balance (FactorialHR-equivalent): total_holiday
-- minus the sum of *approved* leave days actually taken, instead of the
-- static seeded holiday_left column. security_invoker=true (sensitive HR
-- data, so this must respect can_view_person() scoping on both people and
-- leave_requests, not bypass it -- the opposite need from org_chart_nodes).
create or replace view leave_balances
  with (security_invoker = true) as
  select
    p.id as person_id,
    p.total_holiday,
    coalesce(sum(lr.days) filter (where lr.status = 'approved'), 0) as days_taken,
    p.total_holiday - coalesce(sum(lr.days) filter (where lr.status = 'approved'), 0) as holiday_left
  from people p
  left join leave_requests lr on lr.person_id = p.id
  group by p.id, p.total_holiday;

grant select on leave_balances to authenticated;

-- Real billed value per person (TrackingTime-equivalent): approved,
-- billable timesheet hours times their billable_rate_eur, instead of a
-- static figure. security_invoker=true (sensitive HR + timesheet data, must
-- respect can_view_person() scoping on both tables, the opposite need from
-- org_chart_nodes/user_display_names).
create or replace view billable_value_by_person
  with (security_invoker = true) as
  select
    p.id as person_id,
    p.billable_rate_eur,
    coalesce(sum(te.hours) filter (where te.is_billable and te.status = 'approved'), 0) as billable_hours_logged,
    p.billable_rate_eur
      * coalesce(sum(te.hours) filter (where te.is_billable and te.status = 'approved'), 0) as billable_value_eur
  from people p
  left join timesheet_entries te on te.person_id = p.id
  group by p.id, p.billable_rate_eur;

grant select on billable_value_by_person to authenticated;

-- Project budget burn and margin (TrackingTime/Clockify-equivalent).
--
-- Three asymmetries here are deliberate and load-bearing:
--   * Only *approved* hours count. Draft and submitted time is still being
--     argued about; billing a client off it would be guessing.
--   * Revenue counts only *billable* hours, at the project rate if one is
--     set, otherwise the person's own rate.
--   * Cost counts *every* approved hour, billable or not, because people are
--     paid for internal time too. That asymmetry is the whole point: a
--     project can invoice well and still lose money.
--
-- Joined on te.project_id, never on project_name -- see the column comment on
-- timesheet_entries for why the name is not safe to match on.
--
-- security_invoker=true: budgets and margins are commercial data and must
-- stay behind can_view_project(), the opposite of org_chart_nodes.
create or replace view project_budget_status
  with (security_invoker = true) as
  select
    p.id as project_id,
    p.name,
    p.budget_hours,
    p.budget_fee_eur,
    p.budget_alert_percent,
    coalesce(sum(te.hours) filter (where te.status = 'approved'), 0) as hours_logged,
    coalesce(sum(te.hours) filter (where te.status = 'approved' and te.is_billable), 0)
      as billable_hours_logged,
    coalesce(
      sum(te.hours * coalesce(p.billable_rate_eur, pe.billable_rate_eur, 0))
        filter (where te.status = 'approved' and te.is_billable),
      0) as revenue_eur,
    coalesce(
      sum(te.hours * coalesce(pe.cost_rate_eur, 0)) filter (where te.status = 'approved'),
      0) as cost_eur,
    coalesce(
      sum(te.hours * coalesce(p.billable_rate_eur, pe.billable_rate_eur, 0))
        filter (where te.status = 'approved' and te.is_billable),
      0)
    - coalesce(
      sum(te.hours * coalesce(pe.cost_rate_eur, 0)) filter (where te.status = 'approved'),
      0) as margin_eur,
    -- nullif keeps a project with no budget (or a zero budget) reporting NULL
    -- rather than dividing by zero or claiming an instant overrun.
    round(
      coalesce(sum(te.hours) filter (where te.status = 'approved'), 0)
      * 100.0 / nullif(p.budget_hours, 0), 2) as hours_consumed_percent,
    coalesce(
      coalesce(sum(te.hours) filter (where te.status = 'approved'), 0)
        > nullif(p.budget_hours, 0), false) as is_over_budget,
    coalesce(
      coalesce(sum(te.hours) filter (where te.status = 'approved'), 0)
        * 100.0 / nullif(p.budget_hours, 0) >= p.budget_alert_percent, false)
      as is_past_alert_threshold
  from projects p
  left join timesheet_entries te on te.project_id = p.id
  left join people pe on pe.id = te.person_id
  group by p.id, p.name, p.budget_hours, p.budget_fee_eur, p.budget_alert_percent,
           p.billable_rate_eur;

grant select on project_budget_status to authenticated;

-- Derived reporting views. security_invoker so the caller's RLS on the
-- underlying tables still applies rather than the view owner's.

create or replace view person_week_metrics
  with (security_invoker = true) as
  select
    p.id as person_id,
    p.name,
    p.department,
    s.factorial_employee_id,
    s.period_start,
    s.period_end,
    round(s.worked_minutes / 60.0, 1) as worked_hours,
    round(s.expected_minutes / 60.0, 1) as expected_hours,
    s.worked_day_count,
    round(s.billable_seconds / 3600.0, 1) as billable_hours,
    round((s.travel_time_seconds + s.internal_project_seconds
           + s.empty_tasks_seconds) / 3600.0, 1) as non_billable_hours,
    -- Null rather than a misleading 0% when no time was tracked at all.
    case when (s.billable_seconds + s.travel_time_seconds
               + s.internal_project_seconds + s.empty_tasks_seconds) = 0 then null
         else round(100.0 * s.billable_seconds
              / (s.billable_seconds + s.travel_time_seconds
                 + s.internal_project_seconds + s.empty_tasks_seconds)) end
      as billable_share_percent,
    case when s.absence_minutes is null then null
         else round(s.absence_minutes / 60.0, 1) end as absence_hours,
    s.absence_label,
    case when s.expected_minutes = 0 then null
         when s.worked_minutes > s.expected_minutes then 'over'
         when s.worked_minutes < s.expected_minutes * 0.8 then 'under'
         else 'normal' end as capacity_status,
    s.review_entry_count,
    s.synced_at
  from weekly_employee_summary s
  left join people p on p.factorial_employee_id = s.factorial_employee_id;

create or replace view weekly_billable_trend
  with (security_invoker = true) as
  select
    s.period_start,
    s.period_end,
    round(sum(s.billable_seconds) / 3600.0, 1) as billable_hours,
    round(sum(s.travel_time_seconds + s.internal_project_seconds
              + s.empty_tasks_seconds) / 3600.0, 1) as non_billable_hours,
    count(*) as employee_count
  from weekly_employee_summary s
  group by s.period_start, s.period_end;

grant select on person_week_metrics, weekly_billable_trend to authenticated;

-- ---------------------------------------------------------------------------
-- 7. raw — the connector landing zone
-- ---------------------------------------------------------------------------
-- First piece of the platform architecture (docs/architecture/PLATFORM-ARCHITECTURE.md
-- §1, §5). Deliberately the ONLY module schema created before discovery has run,
-- because it is the only one that cannot be wrong: it stores the vendor payload
-- verbatim as jsonb and makes no assumption about its shape. The typed `time`,
-- `projects` and `hr` schemas are written FROM the field inventories, not before
-- them -- that ordering is the whole point of the three-stage process.
--
-- Why land raw at all rather than transform on the way in:
--
--   * A transform bug is recoverable. If the parse was wrong we re-read from
--     `raw` instead of re-pulling from a vendor that rate-limits us and may no
--     longer hold the old value.
--   * It is the audit trail. "What did TrackingTime actually say on 3 March"
--     is answerable, which matters when a colleague disputes their hours.
--   * Vendors add and remove fields without warning. Verbatim capture means a
--     new field is already recorded by the time we notice it exists.
--
-- Append-only by construction: no update or delete policy is granted to anyone,
-- and writes arrive via the service role, which bypasses RLS entirely.

create schema if not exists raw;

-- Nobody reaches this schema through the API. Connectors use the service role
-- (which bypasses RLS and schema grants), and analysts read the typed layers.
revoke all on schema raw from anon, authenticated;

create table if not exists raw.vendor_record (
  id bigint generated always as identity primary key,

  -- Which system, which endpoint, which logical entity. `source` is
  -- deliberately free text rather than an enum: adding a vendor should not
  -- require a migration to the enum type first.
  source      text  not null check (source in ('trackingtime', 'asana', 'factorial', 'samdock')),
  entity      text  not null,
  endpoint    text  not null,

  -- The vendor's own id for this record, as text regardless of whether they
  -- issue integers or uuids. Never used as a join key across systems -- that is
  -- what platform.person and the identity maps are for. It exists so a re-sync
  -- can recognise the same record.
  source_id   text  not null,

  -- The workspace/account the record came from. TrackingTime and Asana both
  -- support a login belonging to several workspaces, and a payload is
  -- meaningless without knowing which one produced it.
  account_ref text,

  payload     jsonb not null,

  -- When we fetched it, not when the vendor changed it. Vendor timestamps live
  -- inside payload and are read during transform, where their timezone
  -- semantics can be dealt with explicitly.
  fetched_at  timestamptz not null default now(),

  -- A content hash of the payload. Lets a re-sync skip unchanged records
  -- without a deep compare, and makes "did this actually change" answerable.
  payload_hash text not null,

  -- Idempotency: re-running a sync must update-in-place rather than duplicate.
  -- Scoped by account_ref so the same id in two workspaces stays distinct.
  unique (source, entity, source_id, account_ref)
);

-- The two access patterns: "everything from this sync" and "history of this
-- one record".
create index if not exists vendor_record_source_entity_idx
  on raw.vendor_record (source, entity, fetched_at desc);

create index if not exists vendor_record_payload_idx
  on raw.vendor_record using gin (payload);

alter table raw.vendor_record enable row level security;

-- No policy is created on purpose. With RLS enabled and zero policies, every
-- API role is denied outright; only the service role (which bypasses RLS) can
-- read or write. Raw vendor payloads contain personal data and, from Factorial,
-- salary -- so the default is that nothing reaches a browser.

-- A record of each sync run, so "is the data stale" and "did last night's sync
-- actually finish" are answerable without reading the payload table.
create table if not exists raw.sync_run (
  id bigint generated always as identity primary key,
  source        text not null check (source in ('trackingtime', 'asana', 'factorial', 'samdock')),
  entity        text not null,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,

  -- Null finished_at with a non-null started_at means "still running or died".
  -- Distinguishing a crash from an empty result is the point of splitting these.
  status        text not null default 'running'
                check (status in ('running', 'ok', 'failed')),
  record_count  int,
  error_message text,

  -- The vendor's own paging cursor or high-water mark, so the next run can be
  -- incremental instead of re-reading everything.
  cursor_ref    text
);

create index if not exists sync_run_recent_idx
  on raw.sync_run (source, entity, started_at desc);

alter table raw.sync_run enable row level security;

-- Sync health is not sensitive and the Hub sync bar needs it, so this one is
-- readable -- but only the timing and status, never a payload.
--
-- Guarded like the `time` module policies below. Without the guard, applying the
-- module sections to an existing database succeeds the first time and fails the
-- second with 42710 "policy already exists" -- and whoever re-ran it has no way
-- to tell that error apart from a real problem. scripts/check-apply-modules.mjs
-- runs the extract twice and caught exactly this.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='raw' and tablename='sync_run'
                 and policyname='authenticated can read sync_run') then
    create policy "authenticated can read sync_run"
      on raw.sync_run for select to authenticated using (true);
  end if;
end $$;

grant usage on schema raw to authenticated;
grant select on raw.sync_run to authenticated;

-- service_role needs USAGE explicitly. It bypasses RLS but NOT schema
-- permissions, so without this the importer fails with 42501 "permission denied
-- for schema raw" -- which looks identical to the schema not existing. Measured
-- against live: every raw/time table returned 403 while public returned 200.
-- Table-level grants are applied at the end of this file, once every table in
-- both schemas exists.
grant usage on schema raw to service_role;


-- ---------------------------------------------------------------------------
-- 8. time -- the Time Tracking module
-- ---------------------------------------------------------------------------
-- The first typed module schema, written FROM the discovery field inventories
-- (docs/architecture/DISCOVERY-trackingtime.md), not from vendor documentation.
-- Every non-obvious decision below cites the measurement that forced it.
--
-- Why a schema rather than more public tables: PLATFORM-ARCHITECTURE.md §2. A
-- module client is pinned with supabase.schema('time'), so it physically cannot
-- reach another module's tables even by typo, while Hub still joins across all
-- of them in one query because it is one database.

create schema if not exists time;
grant usage on schema time to authenticated;

-- As for raw above: service_role bypasses RLS but not schema permissions, and
-- the TrackingTime importer writes with the service key.
grant usage on schema time to service_role;


-- Services -- the closest thing to HSE's real service catalogue that exists in
-- any vendor system. A small, stable vocabulary (~10 values observed).
--
-- is_travel/is_paid_travel are real columns rather than a string match on the
-- name. The vendor encodes the distinction in the label itself
-- ("Anfahrt & Abfahrt / Travelltime (Payed)" vs "(unpayed)"), which means any
-- report that needs it is one typo away from being wrong.
create table if not exists time.service (
  id             bigint generated always as identity primary key,
  source_id      text unique,                    -- TrackingTime service id, when imported
  name           text not null unique,
  is_travel      boolean not null default false,
  is_paid_travel boolean not null default false,
  is_internal    boolean not null default false,
  is_active      boolean not null default true,
  sort_order     int not null default 0,
  created_at     timestamptz not null default now(),

  -- Unpaid travel is still travel. Paid-but-not-travel is a contradiction.
  constraint paid_travel_is_travel check (not is_paid_travel or is_travel)
);


-- Customers. Deliberately thin: the CRM module owns the commercial record, this
-- is only what time tracking needs to attribute an hour.
create table if not exists time.customer (
  id          bigint generated always as identity primary key,
  source_id   text unique,
  name        text not null,
  is_archived boolean not null default false,
  -- 21 vendor custom fields exist and most are 100% null in the sample, so they
  -- are held verbatim rather than promoted to columns until one earns it.
  custom      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create unique index if not exists time_customer_name_idx on time.customer (lower(name));


create table if not exists time.project (
  id             bigint generated always as identity primary key,
  source_id      text unique,
  customer_id    bigint references time.customer(id) on delete set null,
  name           text not null,
  code           text,
  -- The Hub's own projects table is keyed by text id. Linking here rather than
  -- with an FK keeps the modules decoupled: `time` must not fail to insert
  -- because a Hub row has not been created yet.
  hub_project_id text,
  service_id     bigint references time.service(id) on delete set null,
  is_billable    boolean not null default true,
  is_archived    boolean not null default false,
  -- Observed as fractional HOURS on the vendor's project entity (0.833333),
  -- while events carry SECONDS. Same concept, different unit, different entity
  -- -- which is exactly why the unit is in the column name.
  estimated_hours numeric(10,2),
  custom         jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

create index if not exists time_project_customer_idx on time.project (customer_id);


-- Tasks. Type matters more than it looks:
--
--   PERSONAL -- a real task somebody created. 70% billable.
--   GHOST    -- a calendar placeholder. 96.5% carry CALENDAR_SYNC_*, 98%
--               non-billable, and 1,508 of them collapse onto just 33 ids.
--
-- Measured over 4,189 live events: every one of the 1,427 events with neither a
-- customer nor a project is GHOST, and no PERSONAL event lacks a customer. That
-- is why time.entry.project_id is nullable and there is no "Internal"
-- pseudo-customer -- the absence is structural, not a tagging failure.
create table if not exists time.task (
  id            bigint generated always as identity primary key,
  source_id     text unique,
  project_id    bigint references time.project(id) on delete set null,
  name          text,
  task_type     text not null default 'PERSONAL' check (task_type in ('PERSONAL', 'GHOST')),
  is_archived   boolean not null default false,
  custom        jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists time_task_project_idx on time.task (project_id);


-- A tracked person. Separate from public.people because the module owns its own
-- roster and must not break when Hub's identity map lags.
create table if not exists time.member (
  id             bigint generated always as identity primary key,
  source_id      text unique,
  email          text,
  display_name   text not null,
  hub_person_id  text,                            -- resolved to public.people.id
  user_id        uuid references auth.users(id) on delete set null,
  role           text not null default 'CO_WORKER'
                 check (role in ('ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'CO_WORKER')),
  status         text not null default 'REGISTERED'
                 check (status in ('REGISTERED', 'VERIFIED', 'INVITED')),
  is_archived    boolean not null default false,
  -- Per-weekday contracted hours, observed on every vendor user
  -- (mon..fri: 8, sat/sun: 0). The honest denominator for utilisation.
  weekly_hours   numeric(5,2) not null default 40,
  created_at     timestamptz not null default now()
);

create unique index if not exists time_member_email_idx on time.member (lower(email))
  where email is not null;
create index if not exists time_member_user_idx on time.member (user_id);


-- Rates, effective-dated from day one.
--
-- The vendor carries a single current hourly_rate/hourly_cost per user with no
-- history. Re-costing last year at this year's rate is simply wrong, and the
-- history cannot be reconstructed after the fact -- so the table is dated now
-- even though the first import will write one open-ended row per member.
create table if not exists time.member_rate (
  id           bigint generated always as identity primary key,
  member_id    bigint not null references time.member(id) on delete cascade,
  hourly_rate  numeric(10,2),                     -- what the client is charged
  hourly_cost  numeric(10,2),                     -- what the person costs us
  currency     text not null default 'EUR',
  valid_from   date not null default current_date,
  valid_to     date,                              -- null = currently in force

  constraint rate_dates_ordered check (valid_to is null or valid_to > valid_from)
);

create index if not exists time_member_rate_lookup_idx
  on time.member_rate (member_id, valid_from desc);


-- The entry. One tracked interval -- the table this whole module is about.
create table if not exists time.entry (
  id               bigint generated always as identity primary key,
  source_id        text unique,                   -- vendor event id, null for entries we created

  member_id        bigint not null references time.member(id) on delete restrict,
  task_id          bigint references time.task(id) on delete set null,
  project_id       bigint references time.project(id) on delete set null,
  customer_id      bigint references time.customer(id) on delete set null,
  service_id       bigint references time.service(id) on delete set null,

  started_at       timestamptz not null,
  ended_at         timestamptz,                   -- null while a timer is running

  -- SECONDS. Proved arithmetically, not assumed: across 800 sampled live events
  -- (End - Start) equalled Duration exactly 800/800 times. This repo already
  -- stores Factorial in minutes and TrackingTime in seconds, so the unit is in
  -- the column name deliberately -- never call this column `hours`.
  duration_seconds integer,

  is_billable      boolean not null default true,
  is_billed        boolean not null default false,
  notes            text,
  timezone         text,

  -- Where the row came from. GHOST/calendar time is kept rather than discarded,
  -- but it is distinguishable so utilisation can exclude it deliberately.
  source_system    text not null default 'manual'
                   check (source_system in ('manual', 'timer', 'trackingtime', 'calendar')),
  is_calendar      boolean not null default false,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- A finished entry must have a coherent interval. A running timer (ended_at
  -- null) is exempt -- that is the one legitimate open state.
  constraint entry_interval_ordered check (ended_at is null or ended_at >= started_at),
  constraint entry_duration_nonneg  check (duration_seconds is null or duration_seconds >= 0),
  -- A finished entry must know how long it was.
  constraint entry_finished_has_duration
    check (ended_at is null or duration_seconds is not null)
);

create index if not exists time_entry_member_start_idx on time.entry (member_id, started_at desc);
create index if not exists time_entry_project_idx      on time.entry (project_id, started_at desc);
create index if not exists time_entry_customer_idx     on time.entry (customer_id, started_at desc);
create index if not exists time_entry_started_idx      on time.entry (started_at desc);

-- At most one running timer per member. A partial unique index is the only way
-- to express this that a concurrent second insert cannot slip past.
create unique index if not exists time_entry_one_running_per_member
  on time.entry (member_id) where ended_at is null;


-- Which time.member is the caller. security definer for the same reason as the
-- public helpers: a policy on time.entry that reads time.member inside its own
-- USING clause recurses through RLS unpredictably.
create or replace function time.current_member_id()
returns bigint
language sql stable security definer set search_path = time, public
as $$
  select m.id from time.member m
  where m.user_id = auth.uid()
     or (m.hub_person_id is not null and m.hub_person_id = app_user_person_id())
  limit 1;
$$;

-- Can the caller see this member's time? Mirrors can_view_person(): exec sees
-- all, dept_head sees their department via the Hub person link, everyone sees
-- their own.
create or replace function time.can_view_member(target_member_id bigint)
returns boolean
language sql stable security definer set search_path = time, public
as $$
  select
    app_user_role() = 'exec'
    or target_member_id = time.current_member_id()
    or exists (
      select 1 from time.member m
      where m.id = target_member_id
        and m.hub_person_id is not null
        and can_view_person(m.hub_person_id)
    );
$$;

revoke execute on function time.current_member_id(), time.can_view_member(bigint)
  from public, anon;
grant execute on function time.current_member_id(), time.can_view_member(bigint)
  to authenticated;


alter table time.service     enable row level security;
alter table time.customer    enable row level security;
alter table time.project     enable row level security;
alter table time.task        enable row level security;
alter table time.member      enable row level security;
alter table time.member_rate enable row level security;
alter table time.entry       enable row level security;

-- Guarded so re-running the whole file is silent rather than erroring on a
-- policy that already exists.
do $$
begin
  -- Reference data: any signed-in colleague needs to pick from these to log time.
  if not exists (select 1 from pg_policies where schemaname='time' and tablename='service'
                 and policyname='authenticated can read service') then
    create policy "authenticated can read service" on time.service
      for select to authenticated using (true);
  end if;

  if not exists (select 1 from pg_policies where schemaname='time' and tablename='customer'
                 and policyname='authenticated can read customer') then
    create policy "authenticated can read customer" on time.customer
      for select to authenticated using (true);
  end if;

  if not exists (select 1 from pg_policies where schemaname='time' and tablename='project'
                 and policyname='authenticated can read project') then
    create policy "authenticated can read project" on time.project
      for select to authenticated using (true);
  end if;

  if not exists (select 1 from pg_policies where schemaname='time' and tablename='task'
                 and policyname='authenticated can read task') then
    create policy "authenticated can read task" on time.task
      for select to authenticated using (true);
  end if;

  -- Only someone who can manage projects reshapes the catalogue.
  if not exists (select 1 from pg_policies where schemaname='time' and tablename='project'
                 and policyname='project writers can manage project') then
    create policy "project writers can manage project" on time.project
      for all to authenticated
      using (app_user_has_permission('projects:write'))
      with check (app_user_has_permission('projects:write'));
  end if;

  if not exists (select 1 from pg_policies where schemaname='time' and tablename='customer'
                 and policyname='project writers can manage customer') then
    create policy "project writers can manage customer" on time.customer
      for all to authenticated
      using (app_user_has_permission('projects:write'))
      with check (app_user_has_permission('projects:write'));
  end if;

  if not exists (select 1 from pg_policies where schemaname='time' and tablename='task'
                 and policyname='project writers can manage task') then
    create policy "project writers can manage task" on time.task
      for all to authenticated
      using (app_user_has_permission('projects:write'))
      with check (app_user_has_permission('projects:write'));
  end if;

  if not exists (select 1 from pg_policies where schemaname='time' and tablename='service'
                 and policyname='project writers can manage service') then
    create policy "project writers can manage service" on time.service
      for all to authenticated
      using (app_user_has_permission('projects:write'))
      with check (app_user_has_permission('projects:write'));
  end if;

  -- Roster: visible to whoever may see that person's time.
  if not exists (select 1 from pg_policies where schemaname='time' and tablename='member'
                 and policyname='scoped read of member') then
    create policy "scoped read of member" on time.member
      for select to authenticated using (time.can_view_member(id));
  end if;

  if not exists (select 1 from pg_policies where schemaname='time' and tablename='member'
                 and policyname='user admins can manage member') then
    create policy "user admins can manage member" on time.member
      for all to authenticated
      using (app_user_has_permission('admin:users:write'))
      with check (app_user_has_permission('admin:users:write'));
  end if;

  -- Rates are commercially sensitive: hourly_cost is what a colleague costs the
  -- company. Own rate, or exec. Deliberately NOT visible to dept_head, who can
  -- otherwise see their department's time.
  if not exists (select 1 from pg_policies where schemaname='time' and tablename='member_rate'
                 and policyname='own rate or exec can read member_rate') then
    create policy "own rate or exec can read member_rate" on time.member_rate
      for select to authenticated
      using (app_user_role() = 'exec' or member_id = time.current_member_id());
  end if;

  if not exists (select 1 from pg_policies where schemaname='time' and tablename='member_rate'
                 and policyname='exec can manage member_rate') then
    create policy "exec can manage member_rate" on time.member_rate
      for all to authenticated
      using (app_user_role() = 'exec')
      with check (app_user_role() = 'exec');
  end if;

  -- Entries: read what you are allowed to see.
  --
  -- WHY THIS IS WRITTEN AS THREE OR'D BRANCHES rather than the one call to
  -- time.can_view_member(member_id) it replaces, which read far better:
  --
  -- MEASURED on the live project (scripts/check-rls-hoisting.mjs), fetching the
  -- same 4,194 entries the TrackingTime dashboard reads:
  --
  --     as service_role, RLS bypassed      311ms
  --     as a real exec, RLS applied      2,870ms
  --
  -- 2.5s of policy evaluation, and it SCALED with rows scanned (~55ms for a month,
  -- ~170ms per 1000 rows) which is the signature of a per-row predicate. The cause
  -- is that can_view_member takes a per-ROW argument: it is STABLE, but a stable
  -- function whose input varies per row must be called per row -- 4,194 times, each
  -- invoking app_user_role(), which itself reads app_user_profile.
  --
  -- The first two branches below do not depend on the row at all. Wrapping each in
  -- a scalar subquery lets the planner evaluate it ONCE per statement as an
  -- InitPlan (this is Supabase's documented RLS performance pattern), and because
  -- `or` short-circuits, an exec never reaches the per-row branch at all.
  --
  -- SEMANTICS ARE UNCHANGED, and that is checkable rather than asserted:
  -- can_view_member is literally `app_user_role() = 'exec' OR target = current_member_id()
  -- OR exists(department check)`. Hoisting the first two disjuncts out of the
  -- function and leaving the third to the function computes the same boolean --
  -- `A or B or f(row)` where f = `A or B or C`. The third branch still goes through
  -- can_view_member, so the department rule has exactly one implementation.
  --
  -- The RLS gates (npm run test:time-rls, test:rls, test:rls-control) cover the
  -- access outcomes and must pass unchanged; this is a performance rewrite and any
  -- behaviour difference is a bug, not a trade-off.
  if not exists (select 1 from pg_policies where schemaname='time' and tablename='entry'
                 and policyname='scoped read of entry') then
    create policy "scoped read of entry" on time.entry
      for select to authenticated using (
        (select app_user_role()) = 'exec'
        or member_id = (select time.current_member_id())
        or time.can_view_member(member_id)
      );
  end if;

  -- Write only your OWN time. member_id is pinned to the caller in WITH CHECK,
  -- so an entry cannot be filed under a colleague even by a crafted request.
  if not exists (select 1 from pg_policies where schemaname='time' and tablename='entry'
                 and policyname='own entry insert') then
    create policy "own entry insert" on time.entry
      for insert to authenticated
      with check (
        member_id = time.current_member_id()
        and app_user_has_permission('timesheets:write')
      );
  end if;

  if not exists (select 1 from pg_policies where schemaname='time' and tablename='entry'
                 and policyname='own entry update') then
    create policy "own entry update" on time.entry
      for update to authenticated
      using (member_id = time.current_member_id() and not is_billed)
      with check (member_id = time.current_member_id());
  end if;

  -- An invoiced entry is not deletable by its owner -- that is the point of
  -- is_billed. Exec can still correct a mistake.
  if not exists (select 1 from pg_policies where schemaname='time' and tablename='entry'
                 and policyname='own entry delete') then
    create policy "own entry delete" on time.entry
      for delete to authenticated
      using (
        (member_id = time.current_member_id() and not is_billed)
        or app_user_role() = 'exec'
      );
  end if;
end $$;

grant select on time.service, time.customer, time.project, time.task, time.member, time.member_rate
  to authenticated;
grant select, insert, update, delete on time.entry to authenticated;
grant insert, update, delete on time.service, time.customer, time.project, time.task, time.member,
  time.member_rate to authenticated;
grant usage, select on all sequences in schema time to authenticated;


-- A row per member per ISO week: logged, billable, and the contracted
-- denominator. security_invoker so the caller's RLS still applies -- without it
-- this view would be a hole straight through time.entry's policies.
create or replace view time.week_summary
with (security_invoker = true) as
select
  e.member_id,
  m.display_name,
  m.hub_person_id,
  date_trunc('week', e.started_at)::date                             as week_start,
  sum(e.duration_seconds)                                            as total_seconds,
  sum(e.duration_seconds) filter (where e.is_billable)               as billable_seconds,
  -- GHOST/calendar time is real time but usually not deliberate work, so it is
  -- reported separately rather than silently inflating utilisation.
  sum(e.duration_seconds) filter (where e.is_calendar)               as calendar_seconds,
  count(*)                                                           as entry_count,
  m.weekly_hours * 3600                                              as contracted_seconds
from time.entry e
join time.member m on m.id = e.member_id
where e.duration_seconds is not null
group by e.member_id, m.display_name, m.hub_person_id, date_trunc('week', e.started_at), m.weekly_hours;

grant select on time.week_summary to authenticated;


-- ---------------------------------------------------------------------------
-- 8b. Analytics views for the organisation dashboard
--
-- Two rules govern everything below, and both were established empirically
-- rather than assumed:
--
--   1. MONEY IS NOT A VIEW. A security_invoker view that joins time.member_rate
--      does not fail closed for a caller who cannot see every rate -- it fails
--      PARTIAL. Measured in PGlite: on a project with three members and true
--      revenue of 300.00, a dept_head who could see exactly one rate row got
--      back "90.00". A plausible wrong number is worse than an error, because
--      nothing about it looks broken. Every money figure therefore comes from
--      time.project_economics(), a security definer function gated on a
--      permission, which returns zero rows rather than a partial total.
--
--   2. CALENDAR TIME IS REPORTED, NEVER SILENTLY MIXED IN. 46% of live events
--      (42% of logged hours) are GHOST calendar placeholders, most with no
--      customer and no project -- measured, and higher than the 34% previously
--      recorded here. Folding
--      them into a utilisation or billable figure would make that figure
--      meaningless, so every view carries calendar_seconds as its own column
--      and the deliberate-work total excludes it.
--
-- Unit discipline: time.entry.duration_seconds is SECONDS, while
-- time.project.estimated_hours is HOURS. Every crossing of that boundary below
-- is written as `seconds / 3600.0` with a float divisor -- integer division
-- would truncate 3599 seconds to 0 hours.
-- ---------------------------------------------------------------------------

-- Organisation-wide weekly totals. The dashboard's trend line.
--
-- count(distinct member_id) rather than count(*) so a week where one person
-- logged forty entries does not read as forty active people.
create or replace view time.org_week
with (security_invoker = true) as
select
  date_trunc('week', e.started_at)::date                        as week_start,
  coalesce(sum(e.duration_seconds), 0)                          as total_seconds,
  coalesce(sum(e.duration_seconds) filter (where e.is_billable), 0)  as billable_seconds,
  coalesce(sum(e.duration_seconds) filter (where e.is_calendar), 0)  as calendar_seconds,
  -- Deliberate work: what a human chose to track, excluding calendar noise.
  coalesce(sum(e.duration_seconds) filter (where not e.is_calendar), 0) as tracked_seconds,
  count(*)                                                      as entry_count,
  count(distinct e.member_id)                                   as active_members,
  count(distinct e.project_id)                                  as active_projects
from time.entry e
where e.duration_seconds is not null
group by date_trunc('week', e.started_at);

grant select on time.org_week to authenticated;


-- Per-project rollup. Hours only -- no rates, so it is safe for anyone whose
-- RLS lets them see the underlying entries.
--
-- LEFT JOIN from project, so a project with no time logged still appears with
-- zeroes. An inner join would hide exactly the projects worth asking about.
create or replace view time.project_summary
with (security_invoker = true) as
select
  p.id                                                          as project_id,
  p.name                                                        as project_name,
  p.is_billable,
  p.is_archived,
  c.id                                                          as customer_id,
  c.name                                                        as customer_name,
  p.estimated_hours,
  coalesce(sum(e.duration_seconds), 0)                          as total_seconds,
  coalesce(sum(e.duration_seconds) filter (where e.is_billable), 0) as billable_seconds,
  coalesce(sum(e.duration_seconds) filter (where e.is_calendar), 0) as calendar_seconds,
  -- count(e.id) not count(*): the LEFT JOIN produces one all-null row for a
  -- project with no entries, and count(*) would report that as 1.
  count(e.id)                                                   as entry_count,
  count(distinct e.member_id)                                   as member_count,
  max(e.started_at)                                             as last_activity_at,
  -- Budget burn. estimated_hours is HOURS, duration_seconds is SECONDS.
  -- nullif guards a zero or absent estimate: "no budget set" must read as
  -- unknown, not as 0% or a division error.
  case
    when coalesce(p.estimated_hours, 0) > 0
    then round((coalesce(sum(e.duration_seconds), 0) / 3600.0)
               / nullif(p.estimated_hours, 0) * 100, 1)
  end                                                           as burn_percent
from time.project p
left join time.customer c on c.id = p.customer_id
left join time.entry e    on e.project_id = p.id and e.duration_seconds is not null
group by p.id, p.name, p.is_billable, p.is_archived, c.id, c.name, p.estimated_hours;

grant select on time.project_summary to authenticated;


-- Per-customer rollup. Same hours-only safety as project_summary.
--
-- The project count is a SCALAR SUBQUERY, not a second LEFT JOIN, and that is
-- not a stylistic preference. Joining customer to both project and entry
-- fans out: N projects x M entries produces N*M rows, so every sum() is
-- multiplied by the project count. Measured before this was fixed -- a customer
-- with 2 projects and 4 entries reported 8 entries and exactly double the
-- hours. The bug hid because count(distinct p.id) was still correct, so the
-- one column anyone would sanity-check looked fine while the hours lied.
create or replace view time.customer_summary
with (security_invoker = true) as
select
  c.id                                                          as customer_id,
  c.name                                                        as customer_name,
  c.is_archived,
  coalesce(sum(e.duration_seconds), 0)                          as total_seconds,
  coalesce(sum(e.duration_seconds) filter (where e.is_billable), 0) as billable_seconds,
  (select count(*) from time.project p where p.customer_id = c.id) as project_count,
  count(e.id)                                                   as entry_count,
  max(e.started_at)                                             as last_activity_at
from time.customer c
left join time.entry e on e.customer_id = c.id and e.duration_seconds is not null
group by c.id, c.name, c.is_archived;

grant select on time.customer_summary to authenticated;


-- Per-service rollup. This is the closest thing to HSE's real service
-- catalogue, so "which service actually consumes our week" is a first-class
-- question rather than a drill-down.
create or replace view time.service_summary
with (security_invoker = true) as
select
  s.id                                                          as service_id,
  s.name                                                        as service_name,
  s.is_travel,
  s.is_paid_travel,
  s.is_internal,
  coalesce(sum(e.duration_seconds), 0)                          as total_seconds,
  coalesce(sum(e.duration_seconds) filter (where e.is_billable), 0) as billable_seconds,
  count(e.id)                                                   as entry_count
from time.service s
left join time.entry e on e.service_id = s.id and e.duration_seconds is not null
group by s.id, s.name, s.is_travel, s.is_paid_travel, s.is_internal;

grant select on time.service_summary to authenticated;


-- Per-member utilisation over a rolling window.
--
-- Deliberately NOT joined to member_rate: this view answers "how busy is this
-- person", and adding cost would drag the whole thing behind the exec gate for
-- no benefit. Utilisation uses tracked_seconds (calendar excluded), because a
-- day of synced meetings is not a day of billable capacity.
create or replace view time.member_utilisation
with (security_invoker = true) as
select
  m.id                                                          as member_id,
  m.display_name,
  m.hub_person_id,
  m.is_archived,
  m.weekly_hours,
  coalesce(sum(e.duration_seconds), 0)                          as total_seconds,
  coalesce(sum(e.duration_seconds) filter (where e.is_billable), 0) as billable_seconds,
  coalesce(sum(e.duration_seconds) filter (where e.is_calendar), 0) as calendar_seconds,
  coalesce(sum(e.duration_seconds) filter (where not e.is_calendar), 0) as tracked_seconds,
  count(e.id)                                                   as entry_count,
  count(distinct date_trunc('week', e.started_at))              as weeks_active,
  max(e.started_at)                                             as last_activity_at
from time.member m
left join time.entry e on e.member_id = m.id and e.duration_seconds is not null
group by m.id, m.display_name, m.hub_person_id, m.is_archived, m.weekly_hours;

grant select on time.member_utilisation to authenticated;


-- Money. A function, not a view, and the difference is the whole point.
--
-- security definer means the rate join runs with the owner's rights, so the
-- total is always complete -- there is no partial-aggregate failure mode. The
-- guard is an explicit permission check that returns zero rows for anyone
-- without it, which is a visibly empty result rather than a quietly wrong one.
--
-- The rate join is effective-dated on the ENTRY's date, not today's: re-costing
-- last year's work at this year's rate produces a confident wrong answer.
-- LEFT JOIN, so an entry whose member has no rate row still contributes its
-- hours and simply adds nothing to revenue -- an inner join would silently drop
-- those hours and understate the project.
create or replace function time.project_economics(
  p_from date default null,
  p_to   date default null
)
returns table (
  project_id       bigint,
  project_name     text,
  customer_name    text,
  total_seconds    bigint,
  billable_seconds bigint,
  revenue          numeric,
  cost             numeric,
  margin           numeric,
  margin_percent   numeric
)
language sql stable security definer set search_path = time, public
as $$
  select
    p.id,
    coalesce(p.name, '(no project)'),
    c.name,
    coalesce(sum(e.duration_seconds), 0)::bigint,
    coalesce(sum(e.duration_seconds) filter (where e.is_billable), 0)::bigint,
    round(coalesce(sum(
      case when e.is_billable
           then e.duration_seconds / 3600.0 * coalesce(r.hourly_rate, 0)
           else 0 end), 0), 2),
    round(coalesce(sum(e.duration_seconds / 3600.0 * coalesce(r.hourly_cost, 0)), 0), 2),
    round(coalesce(sum(
      case when e.is_billable
           then e.duration_seconds / 3600.0 * coalesce(r.hourly_rate, 0)
           else 0 end), 0)
      - coalesce(sum(e.duration_seconds / 3600.0 * coalesce(r.hourly_cost, 0)), 0), 2),
    case
      when coalesce(sum(
        case when e.is_billable
             then e.duration_seconds / 3600.0 * coalesce(r.hourly_rate, 0)
             else 0 end), 0) > 0
      then round((coalesce(sum(
             case when e.is_billable
                  then e.duration_seconds / 3600.0 * coalesce(r.hourly_rate, 0)
                  else 0 end), 0)
           - coalesce(sum(e.duration_seconds / 3600.0 * coalesce(r.hourly_cost, 0)), 0))
           / nullif(coalesce(sum(
             case when e.is_billable
                  then e.duration_seconds / 3600.0 * coalesce(r.hourly_rate, 0)
                  else 0 end), 0), 0) * 100, 1)
    end
  from time.entry e
  -- LEFT, not INNER. 1,691 of 4,194 live entries carry no project_id, and an
  -- inner join dropped every one of them from the only panel that reports cost
  -- -- so economics and the totals strip disagreed about the same period (866.9h
  -- against 649h for July) with nothing on screen to explain the difference.
  -- Unattributed time still costs money: a member rate times hours worked is
  -- spend the business incurred whether or not anyone filed it against a
  -- project, and hiding it flatters every margin on the page. It surfaces as a
  -- single "(no project)" row with a null project_id, which the UI renders
  -- unlinked because there is no record to open.
  left join time.project p on p.id = e.project_id
  left join time.customer c on c.id = p.customer_id
  left join time.member_rate r
         on r.member_id = e.member_id
        and e.started_at::date >= r.valid_from
        and (r.valid_to is null or e.started_at::date < r.valid_to)
  where app_user_has_permission('overview:export')
    and e.duration_seconds is not null
    and (p_from is null or e.started_at::date >= p_from)
    and (p_to   is null or e.started_at::date <= p_to)
  group by p.id, p.name, c.name;
$$;

revoke execute on function time.project_economics(date, date) from public, anon;
grant  execute on function time.project_economics(date, date) to authenticated;


-- Seed the service catalogue observed in the live account. on conflict do
-- nothing so a re-run never disturbs edits made in the app.
insert into time.service (name, is_travel, is_paid_travel, is_internal, sort_order) values
  ('DGUV V2: Sifa / Safety Engeineer',            false, false, false, 10),
  ('DGUV V2: Betriebsarzt / Company doctor',      false, false, false, 20),
  ('SiGeKo / construction coordination',          false, false, false, 30),
  ('Brandschutzhelfer',                           false, false, false, 40),
  ('Brandschutzbeauftragter (Fire Safety Officer)', false, false, false, 45),
  ('Risk Assessment',                             false, false, false, 50),
  ('Grundunterweisung / Trainingsacademy',        false, false, false, 60),
  ('Projekt: Health & Safety Consulting',         false, false, false, 70),
  ('Anfahrt & Abfahrt / Travelltime (Payed)',     true,  true,  false, 80),
  ('Anfahrt & Abfahrt / Travelltime (unpayed)',   true,  false, false, 90),
  ('intern',                                      false, false, true, 100)
on conflict (name) do nothing;


-- ---------------------------------------------------------------------------
-- 9. Module schema grants for service_role
-- ---------------------------------------------------------------------------
-- Deliberately last: `grant all on all tables in schema` resolves the table
-- list at execution time, so it must run after every table above exists.
--
-- Why this is needed at all: service_role bypasses RLS, which makes it easy to
-- assume it bypasses everything. It does not -- schema and table permissions
-- still apply. Without these grants the TrackingTime importer fails with
-- 42501 "permission denied for schema time", which reads exactly like the
-- schema not existing and sends you looking in the wrong place. Measured
-- against live: every raw.* and time.* probe returned 403 while public
-- returned 200.
--
-- The `alter default privileges` lines cover tables added later, so a new
-- module table does not silently break the importer.

grant all on all tables    in schema raw  to service_role;
grant all on all sequences in schema raw  to service_role;
alter default privileges in schema raw  grant all on tables    to service_role;
alter default privileges in schema raw  grant all on sequences to service_role;

grant all on all tables    in schema time to service_role;
grant all on all sequences in schema time to service_role;
alter default privileges in schema time grant all on tables    to service_role;
alter default privileges in schema time grant all on sequences to service_role;
