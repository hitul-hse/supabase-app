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
