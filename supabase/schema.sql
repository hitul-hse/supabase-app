-- Canonical schema for this project. Run this once against a fresh Supabase
-- project's SQL Editor to create every table and policy the app expects.
-- See supabase/README.md for how netflix_users was originally populated.

create table if not exists todos (
  id bigint generated always as identity primary key,
  task text not null,
  is_complete boolean not null default false,
  inserted_at timestamptz not null default now()
);

alter table todos enable row level security;

create policy "Allow anon full access to todos"
  on todos
  for all
  to anon
  using (true)
  with check (true);

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
  object_path text not null unique,
  original_name text not null,
  content_type text,
  size_bytes bigint,
  uploaded_at timestamptz not null default now()
);

alter table files enable row level security;

create policy "Allow anon full access to files"
  on files
  for all
  to anon
  using (true)
  with check (true);
