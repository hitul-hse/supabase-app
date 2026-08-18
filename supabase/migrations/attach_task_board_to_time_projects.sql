-- Attach the task board to real (TrackingTime) projects.
--
-- WHAT THIS IS FOR
-- ----------------
-- project_tasks and project_sections could only hang off public.projects -- the
-- five-row table keyed by text ids that /projects stopped reading. The pages
-- people use read time.project (334 rows, bigint ids). There was no join
-- between them, so the finished Kanban board, subtasks, sections and comments
-- were reachable from nowhere in the app.
--
-- ADDITIVE ON PURPOSE. Nothing is dropped and no row is rewritten: project_id
-- keeps its data and simply becomes optional, and a second optional parent is
-- added beside it. Repointing the column from text to bigint would have meant
-- destroying the existing rows to find out whether they mattered.
--
-- Safe to run more than once.

begin;

-- 1. The second parent -------------------------------------------------------
alter table public.project_sections
  alter column project_id drop not null,
  add column if not exists time_project_id bigint;

alter table public.project_tasks
  alter column project_id drop not null,
  add column if not exists time_project_id bigint;

do $mig$ begin
  if not exists (select 1 from pg_constraint where conname = 'project_sections_one_parent') then
    alter table public.project_sections add constraint project_sections_one_parent
      check ((project_id is null) <> (time_project_id is null));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'project_tasks_one_parent') then
    alter table public.project_tasks add constraint project_tasks_one_parent
      check ((project_id is null) <> (time_project_id is null));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'project_sections_time_project_fk') then
    alter table public.project_sections add constraint project_sections_time_project_fk
      foreign key (time_project_id) references time.project(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'project_tasks_time_project_fk') then
    alter table public.project_tasks add constraint project_tasks_time_project_fk
      foreign key (time_project_id) references time.project(id) on delete cascade;
  end if;
end $mig$;

create index if not exists project_sections_time_project_idx
  on public.project_sections (time_project_id, position);
create index if not exists project_tasks_time_project_idx
  on public.project_tasks (time_project_id, sort_order);

-- 2. Helpers -----------------------------------------------------------------
create or replace function task_time_project_id(target_task_id bigint)
returns bigint
language sql stable security definer set search_path = public
as $$
  select time_project_id from project_tasks where id = target_task_id;
$$;

create or replace function section_time_project_id(target_section_id bigint)
returns bigint
language sql stable security definer set search_path = public
as $$
  select time_project_id from project_sections where id = target_section_id;
$$;

create or replace function can_view_task_parent(p_hub_id text, p_time_id bigint)
returns boolean
language sql stable security definer set search_path = public
as $$
  select case
    when p_hub_id is not null then can_view_project(p_hub_id)
    -- No lookup in time.project, for two reasons. It is redundant: the FK on
    -- time_project_id already guarantees the row exists, so a non-null value
    -- IS a real project by construction. And it is unreachable from here --
    -- this function is declared ~1,000 lines before section 8 creates that
    -- table, and a `language sql` body is validated at CREATE time, so the
    -- reference made a fresh run of this file fail outright.
    --
    -- Dropping it also removes a per-row subquery from every policy that
    -- calls this, which is the same cost pattern the entry-policy hoisting
    -- was done to avoid.
    else p_time_id is not null
  end;
$$;

revoke execute on function
  task_time_project_id(bigint), section_time_project_id(bigint),
  can_view_task_parent(text, bigint)
  from public, anon;
grant execute on function
  task_time_project_id(bigint), section_time_project_id(bigint),
  can_view_task_parent(text, bigint)
  to authenticated;

-- 3. Policies ----------------------------------------------------------------
-- Postgres has no CREATE OR REPLACE POLICY, so each is dropped and recreated.
-- Inside the transaction, so a failure leaves the old policies in place rather
-- than a table with none.
drop policy if exists "role-scoped read on project_tasks" on public.project_tasks;
drop policy if exists "role-scoped read on project_sections" on public.project_sections;
drop policy if exists "role-scoped insert on project_sections" on public.project_sections;
drop policy if exists "role-scoped update on project_sections" on public.project_sections;
drop policy if exists "role-scoped delete on project_sections" on public.project_sections;
drop policy if exists "role-scoped insert on project_tasks" on public.project_tasks;
drop policy if exists "role-scoped update on project_tasks" on public.project_tasks;
drop policy if exists "role-scoped delete on project_tasks" on public.project_tasks;
drop policy if exists "role-scoped read on task_comments" on public.task_comments;
drop policy if exists "role-scoped insert on task_comments" on public.task_comments;

create policy "role-scoped read on project_tasks"
  on project_tasks for select to authenticated using (can_view_task_parent(project_id, time_project_id));

create policy "role-scoped read on project_sections"
  on project_sections for select to authenticated using (can_view_task_parent(project_id, time_project_id));

create policy "role-scoped insert on project_sections"
  on project_sections for insert to authenticated
  with check (can_view_task_parent(project_id, time_project_id)
    and (time_project_id is null or app_user_has_permission('projects:write')));

create policy "role-scoped update on project_sections"
  on project_sections for update to authenticated
  using (can_view_task_parent(project_id, time_project_id))
  with check (can_view_task_parent(project_id, time_project_id)
    and (time_project_id is null or app_user_has_permission('projects:write')));

create policy "role-scoped delete on project_sections"
  on project_sections for delete to authenticated
  using (can_view_task_parent(project_id, time_project_id)
    and (time_project_id is null or app_user_has_permission('projects:write')));

create policy "role-scoped insert on project_tasks"
  on project_tasks for insert to authenticated
  with check (
    can_view_task_parent(project_id, time_project_id)
    and (time_project_id is null or app_user_has_permission('projects:write'))
    and (parent_task_id is null or (
      project_id is not distinct from task_project_id(parent_task_id)
      and time_project_id is not distinct from task_time_project_id(parent_task_id)))
    and (section_id is null or (
      project_id is not distinct from section_project_id(section_id)
      and time_project_id is not distinct from section_time_project_id(section_id)))
  );

create policy "role-scoped update on project_tasks"
  on project_tasks for update to authenticated
  using (can_view_task_parent(project_id, time_project_id))
  with check (
    can_view_task_parent(project_id, time_project_id)
    and (time_project_id is null or app_user_has_permission('projects:write'))
    and (parent_task_id is null or (
      project_id is not distinct from task_project_id(parent_task_id)
      and time_project_id is not distinct from task_time_project_id(parent_task_id)))
    and (section_id is null or (
      project_id is not distinct from section_project_id(section_id)
      and time_project_id is not distinct from section_time_project_id(section_id)))
  );

create policy "role-scoped delete on project_tasks"
  on project_tasks for delete to authenticated
  using (can_view_task_parent(project_id, time_project_id)
    and (time_project_id is null or app_user_has_permission('projects:write')));

create policy "role-scoped read on task_comments"
  on task_comments for select to authenticated
  using (exists (
    select 1 from project_tasks pt
    where pt.id = task_id and can_view_task_parent(pt.project_id, pt.time_project_id)
  ));

create policy "role-scoped insert on task_comments"
  on task_comments for insert to authenticated
  with check (
    author_id = auth.uid()
    and exists (
      select 1 from project_tasks pt
      where pt.id = task_id and can_view_task_parent(pt.project_id, pt.time_project_id)
    )
  );

commit;
