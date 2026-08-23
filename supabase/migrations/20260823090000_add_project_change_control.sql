-- Project responsibility changes are controlled requests, never silent updates.
-- Replacement remains out of scope until a confirmed service assignment model exists.

create table if not exists public.project_change_request (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references public.projects(id) on delete cascade,
  field_name text not null check (field_name = 'responsible_person'),
  expected_owner_person_id text references public.people(id) on delete set null,
  requested_person_id text not null references public.people(id),
  reason text not null check (length(trim(reason)) >= 3),
  status text not null default 'pending'
    check (status in ('pending', 'rejected', 'applied')),
  requested_by uuid not null references auth.users(id),
  requested_at timestamptz not null default now(),
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  decision_reason text,
  applied_at timestamptz
);

create unique index if not exists project_change_request_pending_lock
  on public.project_change_request(project_id)
  where status = 'pending';

create index if not exists project_change_request_project_idx
  on public.project_change_request(project_id, requested_at desc);

create table if not exists public.project_change_event (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.project_change_request(id),
  project_id text not null references public.projects(id),
  event_type text not null check (event_type in ('requested', 'rejected', 'applied')),
  field_name text not null,
  old_person_id text references public.people(id) on delete set null,
  new_person_id text references public.people(id) on delete set null,
  actor_user_id uuid not null references auth.users(id),
  reason text not null,
  created_at timestamptz not null default now()
);

create index if not exists project_change_event_project_idx
  on public.project_change_event(project_id, created_at desc);

alter table public.project_change_request enable row level security;
alter table public.project_change_event enable row level security;

drop policy if exists "project writers can read own change requests" on public.project_change_request;
create policy "project writers can read own change requests"
  on public.project_change_request for select to authenticated
  using (
    requested_by = auth.uid()
    or app_user_has_permission('projects:write')
  );

drop policy if exists "project writers can create change requests" on public.project_change_request;
create policy "project writers can create change requests"
  on public.project_change_request for insert to authenticated
  with check (
    requested_by = auth.uid()
    and app_user_has_permission('projects:write')
  );

drop policy if exists "project writers can read change events" on public.project_change_event;
create policy "project writers can read change events"
  on public.project_change_event for select to authenticated
  using (app_user_has_permission('projects:write'));

-- No direct UPDATE/DELETE policies exist on either table. The functions below
-- are the only write path and record every request, rejection, and application.
create or replace function public.request_project_responsible_change(
  p_project_id text,
  p_requested_person_id text,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request_id uuid;
  v_owner text;
begin
  if auth.uid() is null or not app_user_has_permission('projects:write') then
    raise exception 'project change permission denied';
  end if;
  if nullif(trim(p_reason), '') is null or length(trim(p_reason)) < 3 then
    raise exception 'a change reason is required';
  end if;
  if not exists (select 1 from public.projects where id = p_project_id) then
    raise exception 'project not found';
  end if;
  if not exists (select 1 from public.people where id = p_requested_person_id and is_active) then
    raise exception 'requested person is not active';
  end if;

  select owner_person_id into v_owner from public.projects where id = p_project_id for share;

  insert into public.project_change_request (
    project_id, field_name, expected_owner_person_id, requested_person_id,
    reason, requested_by
  ) values (
    p_project_id, 'responsible_person', v_owner, p_requested_person_id,
    trim(p_reason), auth.uid()
  ) returning id into v_request_id;

  insert into public.project_change_event (
    request_id, project_id, event_type, field_name, old_person_id,
    new_person_id, actor_user_id, reason
  ) values (
    v_request_id, p_project_id, 'requested', 'responsible_person', v_owner,
    p_requested_person_id, auth.uid(), trim(p_reason)
  );

  return v_request_id;
end;
$$;

create or replace function public.decide_project_responsible_change(
  p_request_id uuid,
  p_approve boolean,
  p_reason text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.project_change_request%rowtype;
  v_current_owner text;
  v_project_name text;
  v_sort_order int;
begin
  if auth.uid() is null or not app_user_has_permission('projects:write') then
    raise exception 'project change permission denied';
  end if;
  if nullif(trim(p_reason), '') is null or length(trim(p_reason)) < 3 then
    raise exception 'a decision reason is required';
  end if;

  select * into v_request
    from public.project_change_request
   where id = p_request_id and status = 'pending'
   for update;
  if not found then raise exception 'change request is no longer pending'; end if;
  if v_request.requested_by = auth.uid() then raise exception 'four-eyes approval required'; end if;

  if not p_approve then
    update public.project_change_request
       set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_reason = trim(p_reason)
     where id = p_request_id;
    insert into public.project_change_event (
      request_id, project_id, event_type, field_name, old_person_id,
      new_person_id, actor_user_id, reason
    ) values (
      p_request_id, v_request.project_id, 'rejected', v_request.field_name,
      v_request.expected_owner_person_id, v_request.requested_person_id,
      auth.uid(), trim(p_reason)
    );
    return 'rejected';
  end if;

  select owner_person_id, name into v_current_owner, v_project_name
    from public.projects where id = v_request.project_id for update;
  if v_current_owner is distinct from v_request.expected_owner_person_id then
    raise exception 'project changed since request; create a new request';
  end if;

  update public.projects
     set owner_person_id = v_request.requested_person_id,
         lead = coalesce((select name from public.people where id = v_request.requested_person_id), lead)
   where id = v_request.project_id;

  delete from public.person_assignments
   where project_id = v_request.project_id
     and person_id is not distinct from v_request.expected_owner_person_id;

  select coalesce(max(sort_order), 0) + 1 into v_sort_order
    from public.person_assignments where project_id = v_request.project_id;
  insert into public.person_assignments (
    person_id, project_id, project_name, logged_hours, tasks_count, share_percent, sort_order
  ) values (
    v_request.requested_person_id, v_request.project_id, v_project_name, 0, 0, 100, v_sort_order
  );

  update public.project_change_request
     set status = 'applied', decided_by = auth.uid(), decided_at = now(),
         decision_reason = trim(p_reason), applied_at = now()
   where id = p_request_id;
  insert into public.project_change_event (
    request_id, project_id, event_type, field_name, old_person_id,
    new_person_id, actor_user_id, reason
  ) values (
    p_request_id, v_request.project_id, 'applied', v_request.field_name,
    v_request.expected_owner_person_id, v_request.requested_person_id,
    auth.uid(), trim(p_reason)
  );
  return 'applied';
end;
$$;

revoke all on function public.request_project_responsible_change(text, text, text) from public;
revoke all on function public.decide_project_responsible_change(uuid, boolean, text) from public;
grant execute on function public.request_project_responsible_change(text, text, text) to authenticated;
grant execute on function public.decide_project_responsible_change(uuid, boolean, text) to authenticated;
