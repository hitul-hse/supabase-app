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
  change_requests text
);

alter table projects enable row level security;

create policy "authenticated can read projects"
  on projects for select to authenticated using (true);

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

create policy "authenticated can read project_timeline"
  on project_timeline for select to authenticated using (true);

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

create policy "authenticated can read project_tasks"
  on project_tasks for select to authenticated using (true);

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

create policy "authenticated can read people"
  on people for select to authenticated using (true);

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

create policy "authenticated can read person_assignments"
  on person_assignments for select to authenticated using (true);

create table if not exists person_qualifications (
  id bigint generated always as identity primary key,
  person_id text not null references people(id) on delete cascade,
  name text not null,
  validity text not null,
  status text not null,
  sort_order int not null
);

alter table person_qualifications enable row level security;

create policy "authenticated can read person_qualifications"
  on person_qualifications for select to authenticated using (true);

create table if not exists weekly_bookings (
  id bigint generated always as identity primary key,
  person_id text not null references people(id) on delete cascade,
  week text not null,
  hours numeric,
  status text not null,
  unique (person_id, week)
);

alter table weekly_bookings enable row level security;

create policy "authenticated can read weekly_bookings"
  on weekly_bookings for select to authenticated using (true);

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

create policy "authenticated can read approval_decisions"
  on approval_decisions for select to authenticated using (true);

create policy "authenticated can update approval_decisions"
  on approval_decisions for update to authenticated using (true);

create table if not exists timesheet_entries (
  id bigint generated always as identity primary key,
  entry_group int not null,
  task_name text not null,
  project_name text not null,
  customer text,
  is_billable boolean not null,
  warning text,
  day_of_week smallint not null,
  hours numeric not null
);

alter table timesheet_entries enable row level security;

create policy "authenticated can read timesheet_entries"
  on timesheet_entries for select to authenticated using (true);
