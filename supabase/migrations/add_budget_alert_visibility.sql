-- =============================================================================
-- Budget alerts that survive a missing mail transport
-- =============================================================================
--
-- WHY THIS EXISTS. A user hit a refusal and got no email. The alert itself was
-- recorded correctly:
--
--   requested=1h logged=21.1h budget=5h over=17.1h notified=null
--
-- `notified = null` means "email never attempted", because RESEND_API_KEY is
-- not set. So the record-first design worked exactly as intended and the user
-- still experienced silence. That is the bug: the feature's only OUTPUT was a
-- channel that does not exist yet.
--
-- The fix is to make the alert readable IN THE APP, and to widen what an alert
-- can be about. Until now the only recordable event was a refusal; the whole
-- point of warning "we are near the limit" is that the interesting events
-- happen BEFORE the refusal.
--
-- WHAT THIS DOES NOT DO. It does not send anything. Email stays opt-in behind
-- RESEND_API_KEY, and the UI states plainly whether mail was attempted rather
-- than implying a send.

begin;

-- ------------------------------------------------------------------ columns

/*
 * The kind of event. Defaulted to 'over' so every existing row stays valid and
 * correctly classified: before this migration, an alert could only ever be a
 * refusal.
 *
 * A text column with a CHECK rather than an enum: adding a value to a Postgres
 * enum cannot be done inside a transaction that also uses it, which makes
 * future migrations awkward for no benefit here.
 */
alter table public.overbooking_alert
  add column if not exists kind text not null default 'over';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'overbooking_alert_kind_check'
  ) then
    alter table public.overbooking_alert
      add constraint overbooking_alert_kind_check
      check (kind in (
        'approaching',       -- crossed the warning threshold, still inside budget
        'over',              -- this booking would cross the budget: refused
        'already_over',      -- the budget was spent before this attempt: refused
        'outside_contract',  -- the date falls in no contract period: allowed, flagged
        'contract_expiring'  -- the contract ends soon and needs renewing
      ));
  end if;
end $$;

comment on column public.overbooking_alert.kind is
  'What happened. approaching/outside_contract/contract_expiring are ALLOWED events -- the booking '
  'went through and somebody should know. over/already_over are refusals.';

-- Which contract period the alert concerns. Nullable: a project with no
-- contract recorded can still trip a fallback-budget alert, and the alert must
-- not be lost because there is nothing to point at.
alter table public.overbooking_alert
  add column if not exists contract_period_id bigint
    references time.project_contract_period(id) on delete set null;

-- Which warning line tripped, so "approaching" alerts can be told apart when a
-- threshold is later changed.
alter table public.overbooking_alert
  add column if not exists threshold_percent integer;

/*
 * Acknowledgement. Sales need to mark an alert as handled, otherwise the list
 * grows forever and stops being read -- which is the same failure as the email
 * nobody received, arriving more slowly.
 */
alter table public.overbooking_alert
  add column if not exists acknowledged_at timestamptz;
alter table public.overbooking_alert
  add column if not exists acknowledged_by uuid references auth.users(id) on delete set null;
alter table public.overbooking_alert
  add column if not exists acknowledged_note text;

comment on column public.overbooking_alert.acknowledged_at is
  'When somebody took responsibility for this alert. Null means open. Acknowledged alerts stay on '
  'record: this is a log, not a queue that empties.';

-- ------------------------------------------------------------- no spamming

/*
 * THE STATE CHANGING IS THE EVENT, NOT EVERY BOOKING AFTER IT.
 *
 * Without this, a project sitting at 85% raises an "approaching" alert on every
 * single entry somebody logs, and a project that is already over raises one on
 * every refused attempt. Sales would get dozens of identical rows for one
 * situation and stop reading them.
 *
 * A PARTIAL unique index, restricted to un-acknowledged rows, so:
 *   - only one OPEN alert can exist per project/period/kind/threshold
 *   - once acknowledged, the same situation CAN alert again, which is right:
 *     if sales handled it and it recurs, that is new information
 *
 * coalesce() because both period and threshold are legitimately null, and null
 * is not equal to itself in a unique index -- without it, nulls would let
 * unlimited duplicates through, which is exactly the case this prevents.
 */
create unique index if not exists overbooking_alert_open_unique
  on public.overbooking_alert (
    project_id,
    coalesce(contract_period_id, -1),
    kind,
    coalesce(threshold_percent, -1)
  )
  where acknowledged_at is null;

comment on index public.overbooking_alert_open_unique is
  'At most one OPEN alert per project, period, kind and threshold. The state changing is the event; '
  'a fresh row per booking would bury the signal. Acknowledging one allows the situation to alert '
  'again if it recurs.';

-- Reading the open list is the common query.
create index if not exists overbooking_alert_open_idx
  on public.overbooking_alert (acknowledged_at, created_at desc)
  where acknowledged_at is null;

-- --------------------------------------------------------------- permission

/*
 * A capability of its own. Reading budget alerts is reading commercial
 * pressure, and acknowledging one is claiming responsibility for it -- neither
 * is implied by being able to log time.
 *
 * The column is permission_key (not key), and display_name/resource/action are
 * NOT NULL. Omitting resource/action is what broke the HR migration on the live
 * database, so the full row is spelled out.
 */
insert into public.app_permission
  (permission_key, display_name, resource, action, description, module_key, sort_order)
values
  ('projects:alerts:read',        'View Budget Alerts',        'projects', 'alerts:read',
   'See open budget and contract alerts across the portfolio.', 'projects', 36),
  ('projects:alerts:acknowledge', 'Acknowledge Budget Alerts', 'projects', 'alerts:acknowledge',
   'Mark a budget or contract alert as handled.', 'projects', 37)
on conflict (permission_key) do nothing;

insert into public.app_role_permission (role_key, permission_key)
select r.role_key, 'projects:alerts:read'
from public.app_role r
where r.role_key in ('exec', 'dept_head', 'project_manager', 'hr')
on conflict do nothing;

insert into public.app_role_permission (role_key, permission_key)
select r.role_key, 'projects:alerts:acknowledge'
from public.app_role r
where r.role_key in ('exec', 'dept_head')
on conflict do nothing;

-- --------------------------------------------------------------------- RLS

/*
 * Policies are dropped by name first: `create policy` is not idempotent, and
 * re-running a migration after a partial failure is exactly when that bites.
 * The HR migration died on precisely this.
 */
drop policy if exists "scoped read of overbooking_alert" on public.overbooking_alert;
drop policy if exists "read budget alerts" on public.overbooking_alert;
drop policy if exists "acknowledge budget alerts" on public.overbooking_alert;

/*
 * Read: the alert recipients and anybody with the capability. A person can
 * always see an alert they themselves triggered -- being told why your own
 * booking was refused is not privileged information, and hiding it would send
 * people to support instead of to sales.
 */
create policy "read budget alerts" on public.overbooking_alert
  for select to authenticated
  using (
    public.app_user_has_permission('projects:alerts:read')
    or actor_user_id = auth.uid()
  );

-- Acknowledging is an UPDATE, gated on its own capability.
create policy "acknowledge budget alerts" on public.overbooking_alert
  for update to authenticated
  using (public.app_user_has_permission('projects:alerts:acknowledge'))
  with check (public.app_user_has_permission('projects:alerts:acknowledge'));

grant select, update on public.overbooking_alert to authenticated;

-- ------------------------------------------------------------------- view

/*
 * The list the UI reads. Exposes the delivery state as one honest field rather
 * than leaving the UI to interpret a three-valued boolean:
 *
 *   notified = null   -> never attempted (no transport configured)
 *   notified = false  -> attempted and FAILED (delivery_error says why)
 *   notified = true   -> sent
 *
 * Getting this wrong is how "it said it sent" happens. The whole reason this
 * migration exists is that silence looked like success.
 */
create or replace view public.budget_alert_feed as
select
  a.id,
  a.created_at,
  a.kind,
  a.project_id,
  a.project_name,
  a.actor_user_id,
  a.actor_name,
  a.budget_hours,
  a.logged_hours,
  a.requested_hours,
  a.projected_hours,
  a.over_by_hours,
  a.threshold_percent,
  a.contract_period_id,
  a.reason,
  a.source,
  a.acknowledged_at,
  a.acknowledged_by,
  a.acknowledged_note,
  (a.acknowledged_at is null) as is_open,
  -- Whether this alert BLOCKED the booking. 'approaching' and
  -- 'outside_contract' did not: the hours were recorded.
  (a.kind in ('over', 'already_over')) as blocked_the_booking,
  case
    when a.notified is null  then 'not_attempted'
    when a.notified is false then 'failed'
    else 'sent'
  end as email_state,
  a.delivery_error,
  a.notify_recipients
from public.overbooking_alert a;

comment on view public.budget_alert_feed is
  'Budget alerts for the in-app list. email_state is explicit (not_attempted / failed / sent) so the '
  'UI can never imply an email that was not sent -- the failure that made this view necessary.';

grant select on public.budget_alert_feed to authenticated;

commit;

-- Verify (run after applying):
--   select kind, count(*), email_state from public.budget_alert_feed
--    group by kind, email_state order by kind;
--   select indexname from pg_indexes where tablename = 'overbooking_alert';
