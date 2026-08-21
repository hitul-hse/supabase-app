-- Overbooking alerts: a durable record of every refused booking.
--
-- WHY A TABLE AND NOT JUST AN EMAIL. This project has NO mail transport (no
-- Resend/Postmark/SMTP dependency exists), and Supabase's built-in mailer is
-- rate-limited PROJECT-WIDE -- measured earlier in this codebase when the
-- re-invite feature reported "Invite re-sent" while sending nothing. A feature
-- whose only output is an email nobody can prove arrived is a feature that
-- silently does nothing. So the alert is COMMITTED here first; delivery is a
-- second, observable step recorded on the same row.
--
-- This is therefore the source of truth for "did we catch the overbooking",
-- and the sales team can read it in the app even with mail switched off.
--
-- Apply: paste into the Supabase SQL Editor, or psql -f this file.

create table if not exists public.overbooking_alert (
  id uuid primary key default gen_random_uuid(),

  -- WHO tried to book. The auth user, plus the TrackingTime member id and the
  -- display name captured AT THE TIME: names change and members get archived,
  -- and an alert must stay readable years later without a join that may fail.
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_member_id bigint,
  actor_name text not null,

  -- WHAT they tried to book against. project_id is not an FK on purpose: the
  -- projects live in the `time` schema which is vendor-synced and can be
  -- re-imported, and losing the alert history to a cascade would defeat the
  -- point. The name is captured for the same reason as the actor's.
  project_id bigint,
  project_name text not null,

  -- THE ARITHMETIC that caused the refusal, so the record justifies itself
  -- without recomputing anything.
  budget_hours numeric not null,
  logged_hours numeric not null,
  requested_hours numeric not null,
  projected_hours numeric not null,
  over_by_hours numeric not null,
  -- True when the project was ALREADY past budget before this attempt: a
  -- different conversation from a first crossing.
  already_over boolean not null default false,

  -- The message the user was shown, verbatim. If someone reports "it wouldn't
  -- let me book", this is what they actually saw.
  reason text not null,

  -- Which write path refused: manual entry, an edit, or a stopped timer.
  source text not null check (source in ('create_entry', 'update_entry', 'start_timer', 'stop_timer')),

  created_at timestamptz not null default now(),

  -- DELIVERY, tracked honestly. null = never attempted (no transport
  -- configured), false = attempted and failed (see delivery_error), true =
  -- provider accepted it. "Notified" is never assumed.
  notified boolean,
  notified_at timestamptz,
  notify_recipients text[],
  delivery_error text
);

comment on table public.overbooking_alert is
  'Every booking refused by the budget guard. Written before any email is attempted, so the record exists whether or not mail is configured.';

-- The sales/exec read pattern is "newest first", and the per-project view is
-- "has this one been hit before".
create index if not exists overbooking_alert_created_idx
  on public.overbooking_alert (created_at desc);
create index if not exists overbooking_alert_project_idx
  on public.overbooking_alert (project_id, created_at desc);

alter table public.overbooking_alert enable row level security;

do $$
begin
  -- READ: whoever may see the whole portfolio's money/budgets may see the
  -- alerts about them. projects:read_all is the key the Projects ledger already
  -- gates on, so this grants nothing new -- it reuses the existing boundary.
  -- Plus: you can always see an alert you personally triggered, so a blocked
  -- user can show someone what happened without needing a manager's role.
  if not exists (select 1 from pg_policies
                 where schemaname = 'public' and tablename = 'overbooking_alert'
                   and policyname = 'scoped read of overbooking_alert') then
    create policy "scoped read of overbooking_alert" on public.overbooking_alert
      for select to authenticated using (
        (select app_user_has_permission('projects:read_all'))
        or actor_user_id = (select auth.uid())
      );
  end if;

  -- No INSERT policy for `authenticated`, deliberately. The alert is written by
  -- the server action with the service role, in the same breath as the refusal.
  -- Letting clients insert would let anyone forge an overbooking alert against
  -- a colleague, and there is no legitimate client-side reason to write one.

  -- UPDATE is limited to the delivery columns and to exec, so a failed send can
  -- be retried/acknowledged without allowing the ARITHMETIC to be rewritten
  -- after the fact.
  if not exists (select 1 from pg_policies
                 where schemaname = 'public' and tablename = 'overbooking_alert'
                   and policyname = 'exec can record delivery on overbooking_alert') then
    create policy "exec can record delivery on overbooking_alert" on public.overbooking_alert
      for update to authenticated
      using ((select app_user_role()) = 'exec')
      with check ((select app_user_role()) = 'exec');
  end if;
end $$;

grant select on public.overbooking_alert to authenticated;
grant update (notified, notified_at, notify_recipients, delivery_error)
  on public.overbooking_alert to authenticated;

-- Verify:
--   select policyname, cmd from pg_policies
--    where tablename = 'overbooking_alert';
