-- Reports module for the HSE Hub. Adds a reports table with role-scoped
-- access, following the same pattern as the rest of the schema.
-- Review before merging.

create table if not exists reports (
  id text primary key,
  title text not null,
  status text not null default 'draft',
  author_person_id text references people(id) on delete set null,
  department text
);

alter table reports enable row level security;

create policy "role-scoped read on reports"
  on reports for select to authenticated using (can_view_report(id));

create policy "authors and heads can update reports"
  on reports for update to authenticated
  using (app_user_role_v2() in ('exec', 'dept_head'));

create table if not exists people (
  id text primary key,
  name text not null,
  department text not null
);

create or replace function app_user_role_v2()
returns text
language sql stable security definer set search_path = public
as $$
  select role_key from app_user_profile where user_id = auth.uid();
$$;

create or replace function can_view_report(target_report_id text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select
    app_user_role_v2() = 'exec'
    or exists (
      select 1 from reports r
      join projects pr on pr.name = r.title
      where r.id = target_report_id
        and pr.owner_person_id = app_user_person_id()
    );
$$;

grant execute on function app_user_role_v2(), can_view_report(text) to authenticated;
