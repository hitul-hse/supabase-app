-- Make an approved responsibility handover actually reach the person's My Work.
--
-- THE BUG
-- -------
-- decide_project_responsible_change (20260823090000) updates
-- public.projects.owner_person_id and rewrites public.person_assignments, but
-- never touches public.project_responsibility. my-work.ts:516 sets the
-- `responsible` rung EXCLUSIVELY from project_responsibility, so after an
-- approved reassignment:
--
--   the person who handed over  -> still reads RESPONSIBLE
--   the person who took over    -> reads OWNER, never RESPONSIBLE
--
-- Reproduced against live data on 10110_00358_104_01 (Björn -> Thorsten) with
-- scripts/diagnose-reassignment-propagation.mjs, which replays the RPC's exact
-- writes in a rolled-back transaction. The handover is the whole point of the
-- feature, so this is not cosmetic: the covering colleague never sees the work.
--
-- THE FIX, and the three things it must get right
-- ----------------------------------------------
-- 1. `source`. The column defaults to 'masterdata', which would be a lie: this
--    row is a deliberate in-product decision, not something the importer read
--    from the workbook. A later import that trusts source='masterdata' would
--    also be entitled to overwrite it. So reassignments are written as
--    'change_control', and the check constraint is widened to admit that.
--
-- 2. The UNIQUE (project_id, person_id, role) key. The commonest real case is
--    promoting the NAMED REPLACEMENT (74 projects have a distinct one), and that
--    person already holds a `replacement` row for the project. Inserting a
--    `responsible` row for them is fine -- role differs -- but leaving the stale
--    `replacement` row behind would make one person both the responsible AND
--    their own cover, which is exactly the self-cover bug e922254 removed from
--    the coverage metric. So the promotion deletes the replacement row.
--
-- 3. Idempotence. `on conflict do nothing` is wrong here because it would
--    silently skip; the desired end state is exactly one 'responsible' row for
--    the project, naming the new person, so delete-then-insert is the honest
--    expression of that.
--
-- Nothing about the four-eyes approval, the optimistic-lock check on
-- expected_owner_person_id, or the audit trail changes. This only widens what an
-- approval propagates to.

-- 1. Admit the new provenance value. Existing rows keep 'masterdata'.
alter table public.project_responsibility
  drop constraint if exists project_responsibility_source_check;

alter table public.project_responsibility
  add constraint project_responsibility_source_check
  check (source in ('masterdata', 'change_control'));

-- 2. Replace the decision function, adding the project_responsibility writes.
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
  v_order_no text;
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

  /*
   * THE FIX. Move the masterdata role too, or My Work keeps showing the handover
   * to the wrong person.
   *
   * order_no is carried over from whichever row already described this project,
   * so the reassigned row keeps its link back to the workbook order rather than
   * silently becoming null.
   */
  select order_no into v_order_no
    from public.project_responsibility
   where project_id = v_request.project_id
   order by (role = 'responsible') desc
   limit 1;

  delete from public.project_responsibility
   where project_id = v_request.project_id
     and role = 'responsible';

  /*
   * If the incoming person was the NAMED REPLACEMENT, drop that row: nobody may
   * be their own cover. That is the same rule the coverage metric enforces in
   * management-employee-ownership.ts, and leaving the row would resurrect the
   * fabricated-100%-coverage bug through a different door.
   */
  delete from public.project_responsibility
   where project_id = v_request.project_id
     and role = 'replacement'
     and person_id = v_request.requested_person_id;

  insert into public.project_responsibility (project_id, person_id, role, source, order_no)
  values (v_request.project_id, v_request.requested_person_id, 'responsible', 'change_control', v_order_no);

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

revoke all on function public.decide_project_responsible_change(uuid, boolean, text) from public;
grant execute on function public.decide_project_responsible_change(uuid, boolean, text) to authenticated;
