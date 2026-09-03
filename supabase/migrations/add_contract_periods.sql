-- =============================================================================
-- Contract periods: budgets that sales agree, with start/end dates and renewals
-- =============================================================================
--
-- WHY A NEW TABLE RATHER THAN A COLUMN ON time.project.
--
-- The obvious move is to add contract columns to time.project, or to reuse
-- time.project.estimated_hours as "the budget". Both are wrong here, and the
-- reason is in scripts/import-trackingtime.mjs:448 --
--
--     estimated_hours: typeof p.estimated_time === "number" ? p.estimated_time : null,
--
-- The vendor sync UPSERTS that column on every run. A budget agreed by sales
-- and typed into estimated_hours would be silently overwritten the next time
-- TrackingTime syncs, with no error and no trace. So contract terms live in a
-- table the sync never writes, and estimated_hours stays what it honestly is:
-- the vendor's estimate, usable only as a fallback.
--
-- WHY PERIODS RATHER THAN ONE BUDGET PER PROJECT.
--
-- The requirement is that a renewal starts a fresh budget WITHOUT deleting the
-- old budget or the hours booked against it. A single mutable budget column
-- cannot express that: raising the number on renewal loses last year's ceiling,
-- and resetting the hours would mean deleting real work. One row per contract
-- term makes history immutable by construction -- a renewal INSERTS, and
-- nothing is ever updated or deleted to make it happen.
--
-- Hours are then attributed to a period by DATE WINDOW rather than by a
-- foreign key on the entry. That matters: entries arrive from the vendor sync
-- and would not know their period, and re-dating an entry must move it between
-- periods automatically rather than leave a stale pointer.

begin;

create table if not exists time.project_contract_period (
  id             bigint generated always as identity primary key,
  project_id     bigint not null references time.project(id) on delete cascade,

  -- Human-facing renewal number: "period 2" is the first renewal. Kept
  -- explicit rather than derived from dates so the UI can say "Period 2 of 3"
  -- without re-sorting, and so a correction to a date cannot silently renumber
  -- somebody's contract history.
  period_no      integer not null,

  -- The number sales agreed. NOT NULL and > 0: a contract period with no
  -- budget is not a contract period, it is the absence of one, and that case
  -- is already represented by having no row at all.
  budget_hours   numeric(10,2) not null check (budget_hours > 0),

  starts_on      date not null,
  ends_on        date not null,
  constraint contract_period_dates_ordered check (ends_on >= starts_on),

  -- The "near the limit" line the user asked for. Per period, because a 5h
  -- retainer and a 1200h programme do not want the same warning point.
  warn_at_percent integer not null default 80
    check (warn_at_percent between 1 and 100),

  -- Sales' own reference, so an alert can be traced back to the contract.
  contract_reference text,

  -- The renewal chain. Nullable: period 1 is renewed from nothing. Kept as a
  -- self-reference rather than inferred from period_no so the lineage survives
  -- a correction, and set null on delete so removing a mistaken period cannot
  -- cascade away the real history after it.
  renewed_from_id bigint references time.project_contract_period(id) on delete set null,

  -- Who recorded the sales confirmation, and when. This is the audit trail for
  -- "the sales team confirmed the renewal", which is the event that authorises
  -- a new period at all.
  confirmed_by   uuid references auth.users(id) on delete set null,
  confirmed_at   timestamptz,

  notes          text,
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint contract_period_unique_no unique (project_id, period_no)
);

-- NO OVERLAPPING PERIODS PER PROJECT.
--
-- This is the rule that makes "which budget applies to this date?" a total
-- function with exactly one answer. Without it two periods could both claim a
-- date, and the guard's verdict would depend on row order -- meaning the same
-- booking could be allowed or refused at random. Enforced in the database
-- rather than in application code because the guard, the UI, the renewal
-- function and any future import all have to obey it.
--
-- WHY A TRIGGER RATHER THAN AN EXCLUSION CONSTRAINT. The natural form is
--
--     exclude using gist (project_id with =, daterange(...) with &&)
--
-- but the "project_id with =" part needs the btree_gist extension. Requiring
-- an extension in a migration the user applies by hand is a real risk: if it
-- is unavailable or not permitted, the migration dies partway with a cryptic
-- error and they are left mid-apply. It is also untestable locally (PGlite has
-- no btree_gist), so shipping it would mean shipping a constraint nobody had
-- ever executed. This trigger needs no extensions, behaves identically for the
-- one thing that matters, and is proven by scripts/check-contract-periods.mjs.
--
-- The advisory lock closes the race an exclusion constraint would have handled
-- for free: two concurrent renewals could each see no overlap and both insert.
-- Locking on the project id serialises exactly the rows that can collide,
-- rather than taking a table lock and blocking every project at once.
create or replace function time.assert_no_contract_period_overlap()
returns trigger
language plpgsql
as $$
declare
  v_clash "time".project_contract_period;
begin
  -- Serialise per project. Transaction-scoped, so it is released on commit or
  -- rollback with no explicit unlock.
  perform pg_advisory_xact_lock(
    hashtext('time.project_contract_period:' || new.project_id::text)
  );

  select * into v_clash
  from time.project_contract_period
  where project_id = new.project_id
    and id is distinct from new.id
    -- Inclusive of both endpoints, matching how a human reads "1 July to 30
    -- June" and how the guard compares dates. Two periods clash when each
    -- starts on or before the other ends.
    and new.starts_on <= ends_on
    and starts_on     <= new.ends_on
  limit 1;

  if v_clash.id is not null then
    raise exception
      'contract period %..% overlaps period % (%..%) on project %',
      new.starts_on, new.ends_on, v_clash.period_no,
      v_clash.starts_on, v_clash.ends_on, new.project_id
      using errcode = '23P01',  -- exclusion_violation: the code this replaces
            hint = 'End the previous period before the new one starts. Renewals should begin the day after the old contract ends.';
  end if;

  return new;
end;
$$;

comment on function time.assert_no_contract_period_overlap() is
  'Rejects a contract period that overlaps another on the same project. Stands in for a btree_gist '
  'exclusion constraint so the migration needs no extension; raises 23P01 (exclusion_violation) so '
  'callers can treat it identically.';

drop trigger if exists contract_period_no_overlap on time.project_contract_period;
create trigger contract_period_no_overlap
  before insert or update of project_id, starts_on, ends_on
  on time.project_contract_period
  for each row execute function time.assert_no_contract_period_overlap();

create index if not exists contract_period_project_idx
  on time.project_contract_period (project_id, starts_on desc);
-- The guard's hot path: "the period covering this date for this project".
create index if not exists contract_period_window_idx
  on time.project_contract_period (project_id, starts_on, ends_on);

comment on table time.project_contract_period is
  'One row per contract term: the budget sales agreed, its date window, and its warning threshold. '
  'Renewals INSERT a new row and never modify or delete the previous one, so a renewed contract keeps '
  'the old budget and the hours booked against it. Deliberately separate from time.project because the '
  'TrackingTime sync upserts time.project.estimated_hours and would overwrite an agreed budget.';

comment on column time.project_contract_period.warn_at_percent is
  'Percent of budget at which bookings start warning (default 80). Per period: a 5h retainer and a '
  '1200h programme do not want the same warning point.';

comment on column time.project_contract_period.renewed_from_id is
  'The period this one renewed, forming a navigable chain. Null for the first period.';

-- ---------------------------------------------------------------- updated_at
create or replace function time.touch_contract_period()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists contract_period_touch on time.project_contract_period;
create trigger contract_period_touch
  before update on time.project_contract_period
  for each row execute function time.touch_contract_period();

-- =============================================================================
-- The active period for a date, and the hours logged inside it
-- =============================================================================
--
-- Exposed as SQL rather than left to the application so that the guard, the
-- dashboards and any report all answer this question identically. A second
-- implementation in TypeScript is how the 10h "placeholder floor" bug happened:
-- the writer disagreed with the readers.

create or replace function time.active_contract_period(
  p_project_id bigint,
  p_on date default current_date
)
returns "time".project_contract_period
language sql
stable
as $$
  select *
  from time.project_contract_period
  where project_id = p_project_id
    and p_on between starts_on and ends_on
  -- The exclusion constraint guarantees at most one row, so this LIMIT is
  -- belt-and-braces rather than a tie-break.
  limit 1;
$$;

comment on function time.active_contract_period(bigint, date) is
  'The contract period covering a date, or no row. At most one can match: the no-overlap exclusion '
  'constraint makes this single-valued.';

-- Hours logged against a project INSIDE a period's window.
--
-- This is the change that makes renewal work. The old guard summed every hour
-- ever logged on a project, so after a renewal last year''s hours would eat
-- this year''s budget. Scoping the sum to the window means period 1 keeps its
-- overrun and period 2 starts at zero, without moving or deleting a single
-- entry.
create or replace function time.contract_period_logged_hours(
  p_period_id bigint
)
returns numeric
language sql
stable
as $$
  select coalesce(sum(e.duration_seconds), 0)::numeric / 3600
  from time.project_contract_period cp
  join time.entry e
    on e.project_id = cp.project_id
   and e.duration_seconds is not null
   -- started_at is timestamptz; the contract is written in dates. Compare in
   -- Europe/Berlin, the business's own timezone, so an entry logged at 23:30
   -- on the last day of a contract counts against that contract and not the
   -- next one.
   and (e.started_at at time zone 'Europe/Berlin')::date
       between cp.starts_on and cp.ends_on
  where cp.id = p_period_id;
$$;

comment on function time.contract_period_logged_hours(bigint) is
  'Hours logged inside a period''s date window, in Europe/Berlin. Window-scoped rather than keyed on '
  'the entry so that renewals reset the count without touching entries, and re-dating an entry moves '
  'it between periods automatically.';

-- A convenience view for the UI and reports: every period with its burn.
-- security_invoker: the caller's own projects:contracts:read policy on
-- time.project_contract_period decides which periods come back. The clause has to be
-- INLINE here, not only in the later alter -- `create or replace view` with no WITH
-- resets reloptions to null, so replaying this file without it silently un-fixes the
-- view (20260903090000_contract_status_view_must_not_bypass_rls.sql).
create or replace view time.contract_period_status
with (security_invoker = true) as
select
  cp.id,
  cp.project_id,
  p.name              as project_name,
  p.customer_id,
  cp.period_no,
  cp.budget_hours,
  cp.starts_on,
  cp.ends_on,
  cp.warn_at_percent,
  cp.contract_reference,
  cp.renewed_from_id,
  cp.confirmed_at,
  time.contract_period_logged_hours(cp.id) as logged_hours,
  round(
    time.contract_period_logged_hours(cp.id) / nullif(cp.budget_hours, 0) * 100,
    1
  )                                        as burn_percent,
  round(
    cp.budget_hours - time.contract_period_logged_hours(cp.id),
    2
  )                                        as remaining_hours,
  (current_date between cp.starts_on and cp.ends_on) as is_current,
  (cp.ends_on < current_date)                        as is_expired,
  -- Days until the contract ends: the number a renewal reminder needs.
  (cp.ends_on - current_date)                        as days_remaining
from time.project_contract_period cp
join time.project p on p.id = cp.project_id;

comment on view time.contract_period_status is
  'Every contract period with its burn, remaining hours and days left. is_current uses the date '
  'window, so a renewed project shows the new period as current while the old one remains visible '
  'with its own budget and hours intact.';

-- =============================================================================
-- Access control
-- =============================================================================
--
-- Reading a contract period is reading commercial terms, so it follows the
-- existing project read model rather than inventing a new one. Writing is a
-- commercial act (sales agreed a number), so it needs an explicit permission
-- rather than "anybody who can log time".

alter table time.project_contract_period enable row level security;

-- New permission keys.
--
-- The column is permission_key, not key, and display_name/resource/action are
-- all NOT NULL. Omitting resource and action is precisely what broke the HR
-- migration on the live database, so the full row is spelled out here, matching
-- the convention the seed data already uses. module_key = 'projects' and the
-- sort_order continue the projects block so these appear beside the other
-- project toggles in /admin/roles rather than at the end of the list.
insert into public.app_permission
  (permission_key, display_name, resource, action, description, module_key, sort_order)
values
  ('projects:contracts:read',  'View Contract Terms',   'projects', 'contracts:read',
   'See contract periods: agreed budgets, contract dates and renewal history.',
   'projects', 34),
  ('projects:contracts:write', 'Manage Contract Terms', 'projects', 'contracts:write',
   'Record and renew contract periods after sales confirm the terms.',
   'projects', 35)
on conflict (permission_key) do nothing;

-- Who gets them. exec and sales-facing roles write; anybody who can already
-- read projects can read the terms. Grants are additive and idempotent.
insert into public.app_role_permission (role_key, permission_key)
select r.role_key, 'projects:contracts:read'
from public.app_role r
where r.role_key in ('exec', 'dept_head', 'project_manager', 'hr', 'employee')
on conflict do nothing;

insert into public.app_role_permission (role_key, permission_key)
select r.role_key, 'projects:contracts:write'
from public.app_role r
where r.role_key in ('exec', 'dept_head')
on conflict do nothing;

-- Policies. Dropped by both old and new names first: `create policy` is not
-- idempotent, and re-running a migration that fails halfway is exactly when
-- that bites.
drop policy if exists "read contract periods" on time.project_contract_period;
drop policy if exists "write contract periods" on time.project_contract_period;
drop policy if exists "update contract periods" on time.project_contract_period;
drop policy if exists "delete contract periods" on time.project_contract_period;

create policy "read contract periods" on time.project_contract_period
  for select to authenticated
  using (public.app_user_has_permission('projects:contracts:read'));

create policy "write contract periods" on time.project_contract_period
  for insert to authenticated
  with check (public.app_user_has_permission('projects:contracts:write'));

-- Update is allowed (a typo in a budget must be fixable) but is a separate
-- policy from insert so the permission can be split later without a rewrite.
create policy "update contract periods" on time.project_contract_period
  for update to authenticated
  using (public.app_user_has_permission('projects:contracts:write'))
  with check (public.app_user_has_permission('projects:contracts:write'));

-- DELETE is exec-only, and deliberately narrow: deleting a period destroys the
-- history this table exists to preserve. Correcting a mistake is an update;
-- ending a contract is an end date, not a delete.
create policy "delete contract periods" on time.project_contract_period
  for delete to authenticated
  using (public.app_user_role() = 'exec');

grant select on time.project_contract_period to authenticated;
grant insert, update on time.project_contract_period to authenticated;
grant delete on time.project_contract_period to authenticated;
grant select on time.contract_period_status to authenticated;
grant usage, select on sequence time.project_contract_period_id_seq to authenticated;

-- =============================================================================
-- Renewal
-- =============================================================================
--
-- A function rather than "the UI inserts a row", because a renewal has to do
-- three things atomically: pick the next period_no, link the chain, and refuse
-- to overlap. Doing that in application code invites two half-renewals racing.

create or replace function time.renew_contract_period(
  p_project_id  bigint,
  p_budget_hours numeric,
  p_starts_on   date,
  p_ends_on     date,
  p_contract_reference text default null,
  p_warn_at_percent integer default null,
  p_notes       text default null
)
returns "time".project_contract_period
language plpgsql
security invoker
as $$
declare
  v_previous "time".project_contract_period;
  v_next_no  integer;
  v_row      "time".project_contract_period;
begin
  if not public.app_user_has_permission('projects:contracts:write') then
    raise exception 'not permitted to record contract periods'
      using errcode = '42501';
  end if;

  -- The most recent period, whatever its dates: the chain is by recency, not
  -- by whether it happens to be current (a renewal is often recorded after the
  -- old contract has already lapsed).
  select * into v_previous
  from time.project_contract_period
  where project_id = p_project_id
  order by period_no desc
  limit 1;

  v_next_no := coalesce(v_previous.period_no, 0) + 1;

  insert into time.project_contract_period (
    project_id, period_no, budget_hours, starts_on, ends_on,
    warn_at_percent, contract_reference, renewed_from_id,
    confirmed_by, confirmed_at, notes, created_by
  )
  values (
    p_project_id, v_next_no, p_budget_hours, p_starts_on, p_ends_on,
    -- Inherit the previous warning threshold when none is given: a renewal of
    -- the same contract should behave the same way unless somebody says
    -- otherwise.
    coalesce(p_warn_at_percent, v_previous.warn_at_percent, 80),
    p_contract_reference,
    v_previous.id,
    auth.uid(), now(), p_notes, auth.uid()
  )
  returning * into v_row;

  return v_row;
end;
$$;

comment on function time.renew_contract_period is
  'Record a renewal: inserts the next period, links it to the previous one, and leaves the previous '
  'period''s budget and hours untouched. Raises 42501 without projects:contracts:write, and the '
  'no-overlap exclusion constraint rejects a period that collides with an existing one.';

commit;

-- Verify (run after applying):
--   select * from time.contract_period_status order by project_id, period_no;
--   select count(*) from public.app_role_permission
--    where permission_key like 'projects:contracts:%';
