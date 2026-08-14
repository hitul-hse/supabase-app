-- Canonical schema for this project. Run this once against a fresh Supabase
-- project's SQL Editor to create every table and policy the app expects.
-- See supabase/README.md for how netflix_users was originally populated.

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

-- HSE Hub tables. These back the Overview / Team Lead / People / Projects /
-- Timesheets pages, replacing what used to be static mock data in
-- src/data/hse-data.ts. Shared internal company data with no per-row
-- ownership model yet, so RLS just requires an authenticated session rather
-- than scoping by owner_id like `files` above.

create table if not exists sync_sources (
  source text primary key,
  freshness text not null,
  status text not null,
  message text,
  sort_order int not null
);

alter table sync_sources enable row level security;

create policy "authenticated can read sync_sources"
  on sync_sources for select to authenticated using (true);

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

create policy "authenticated can read executive_metrics"
  on executive_metrics for select to authenticated using (true);

create table if not exists weekly_trends (
  id bigint generated always as identity primary key,
  week text not null,
  billable_hours numeric not null,
  non_billable_hours numeric not null,
  is_open boolean not null default false,
  sort_order int not null
);

alter table weekly_trends enable row level security;

create policy "authenticated can read weekly_trends"
  on weekly_trends for select to authenticated using (true);

create table if not exists team_utilisations (
  id bigint generated always as identity primary key,
  team text not null,
  percent numeric,
  status_color text,
  sort_order int not null
);

alter table team_utilisations enable row level security;

create policy "authenticated can read team_utilisations"
  on team_utilisations for select to authenticated using (true);

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
  department text
);

alter table projects enable row level security;

create policy "role-scoped read on projects"
  on projects for select to authenticated using (can_view_project(id));

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

create policy "role-scoped read on project_timeline"
  on project_timeline for select to authenticated using (can_view_project(project_id));

create table if not exists project_tasks (
  id bigint generated always as identity primary key,
  project_id text not null references projects(id) on delete cascade,
  name text not null,
  estimate_hours numeric not null,
  logged_hours numeric not null,
  status text not null,
  owner text not null,
  sort_order int not null
);

alter table project_tasks enable row level security;

create policy "role-scoped read on project_tasks"
  on project_tasks for select to authenticated using (can_view_project(project_id));

create table if not exists people (
  id text primary key,
  name text not null,
  role text not null,
  department text not null,
  since text not null,
  contract_hours numeric not null,
  employee_number text not null,
  capacity_status text not null,
  logged_this_month numeric not null,
  total_monthly_hours numeric not null,
  billable_share numeric not null,
  open_tasks int not null,
  overdue_tasks int not null,
  holiday_left numeric not null,
  total_holiday numeric not null,
  timesheet_status text,
  certificate_status text,
  certificate_text text
);

alter table people enable row level security;

create policy "role-scoped read on people"
  on people for select to authenticated using (can_view_person(id));

create table if not exists person_assignments (
  id bigint generated always as identity primary key,
  person_id text not null references people(id) on delete cascade,
  project_name text not null,
  logged_hours numeric not null,
  tasks_count int not null,
  share_percent numeric not null,
  sort_order int not null
);

alter table person_assignments enable row level security;

create policy "role-scoped read on person_assignments"
  on person_assignments for select to authenticated using (can_view_person(person_id));

create table if not exists person_qualifications (
  id bigint generated always as identity primary key,
  person_id text not null references people(id) on delete cascade,
  name text not null,
  validity text not null,
  status text not null,
  sort_order int not null
);

alter table person_qualifications enable row level security;

create policy "role-scoped read on person_qualifications"
  on person_qualifications for select to authenticated using (can_view_person(person_id));

create table if not exists weekly_bookings (
  id bigint generated always as identity primary key,
  person_id text not null references people(id) on delete cascade,
  week text not null,
  hours numeric,
  status text not null,
  unique (person_id, week)
);

alter table weekly_bookings enable row level security;

create policy "role-scoped read on weekly_bookings"
  on weekly_bookings for select to authenticated using (can_view_person(person_id));

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

create policy "exec and dept_head can read approval_decisions"
  on approval_decisions for select to authenticated using (app_user_role() in ('exec', 'dept_head'));

create policy "exec and dept_head can update approval_decisions"
  on approval_decisions for update to authenticated using (app_user_role() in ('exec', 'dept_head'));

create table if not exists timesheet_entries (
  id bigint generated always as identity primary key,
  entry_group int not null,
  task_name text not null,
  project_name text not null,
  customer text,
  is_billable boolean not null,
  warning text,
  day_of_week smallint not null,
  hours numeric not null,
  person_id text not null references people(id)
);

alter table timesheet_entries enable row level security;

create policy "role-scoped read on timesheet_entries"
  on timesheet_entries for select to authenticated using (can_view_person(person_id));

-- Roles and per-user profiles. app_user_role()/app_user_department()/
-- app_user_person_id() are security definer so they can safely read
-- app_user_profile from inside that table's own RLS policies without
-- recursing through RLS; can_view_person()/can_view_project() build on them
-- and are reused across every person/project-scoped policy above. All five
-- are granted to `authenticated` only (required for RLS to evaluate them)
-- and explicitly revoked from `anon` and `public` — Supabase's project
-- defaults grant EXECUTE on new public-schema functions to anon at creation
-- time, so that revoke has to be explicit, not just assumed.

create table if not exists app_role (
  role_key text primary key,
  display_name text not null,
  seniority int not null
);

alter table app_role enable row level security;

create policy "authenticated can read app_role"
  on app_role for select to authenticated using (true);

create table if not exists app_user_profile (
  user_id uuid primary key references auth.users(id) on delete cascade,
  person_id text references people(id) on delete set null,
  role_key text not null references app_role(role_key),
  department text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table app_user_profile enable row level security;

create or replace function app_user_role()
returns text
language sql stable security definer set search_path = public
as $$
  select role_key from app_user_profile where user_id = auth.uid();
$$;

create or replace function app_user_department()
returns text
language sql stable security definer set search_path = public
as $$
  select department from app_user_profile where user_id = auth.uid();
$$;

create or replace function app_user_person_id()
returns text
language sql stable security definer set search_path = public
as $$
  select person_id from app_user_profile where user_id = auth.uid();
$$;

create policy "user can read own profile"
  on app_user_profile for select to authenticated using (user_id = auth.uid());

create policy "exec can read all profiles"
  on app_user_profile for select to authenticated using (app_user_role() = 'exec');

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
          where pa.project_name = pr.name and pa.person_id = app_user_person_id()
        )
      )
    );
$$;

revoke execute on function
  app_user_role(), app_user_department(), app_user_person_id(),
  can_view_person(text), can_view_project(text)
from public, anon;

grant execute on function
  app_user_role(), app_user_department(), app_user_person_id(),
  can_view_person(text), can_view_project(text)
to authenticated;

insert into app_role (role_key, display_name, seniority) values
  ('exec', 'Executive', 4),
  ('dept_head', 'Department Head', 3),
  ('project_manager', 'Project Manager', 2),
  ('employee', 'Employee', 1)
on conflict (role_key) do nothing;
