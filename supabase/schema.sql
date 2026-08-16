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

create table if not exists project_tasks (
  id bigint generated always as identity primary key,
  project_id text not null references projects(id) on delete cascade,
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

create policy "owner can edit their own draft timesheet_entries"
  on timesheet_entries for update to authenticated
  using (person_id = app_user_person_id() and status = 'draft')
  with check (person_id = app_user_person_id() and status in ('draft', 'submitted'));

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
  );

create policy "role-scoped update on project_tasks"
  on project_tasks for update to authenticated
  using (can_view_project(project_id))
  with check (
    can_view_project(project_id)
    and (parent_task_id is null or project_id = task_project_id(parent_task_id))
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
