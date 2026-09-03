-- Factorial contract hours: the real weekly-hours denominator, replacing the
-- fake uniform 40h. Fills the DENOMINATOR only -- see
-- scripts/sync-factorial-contracts.mjs for what this deliberately does not
-- also build (a per-person utilisation view).
--
-- Source: docs/factorial-api-integration.md §5 row 2 (contracts/reference_contracts),
-- §5.2 (unit and "today-shaped" caveats), §7.5 (salary is on this same endpoint
-- and is deliberately not ingested), and the vault "Factorial data plan" §4
-- (where the hundredths-of-an-hour unit was established against the live API).
--
-- WHY THE UNIT IS IN THE COLUMN NAME, NOT ONLY A COMMENT
-- -------------------------------------------------------
-- Factorial's own field is called `working_hours` and its value is hundredths
-- of an hour (4000 = 40,00 h/week) -- a name that actively lies about its
-- unit. `working_hours_frequency` is likewise a bare, undocumented enum.
-- Repeating the vendor's misleading names here would hand the next reader
-- exactly the trap this migration exists to close, so every stored column is
-- named for what it actually holds: *_centihours. The conversion lives in
-- exactly one place, scripts/lib/factorial.mjs#contractWeeklyHours() -- see
-- its own comment for why a second implementation would be worse than none.
--
-- IDEMPOTENT: every statement is `if not exists` or guarded, per house rule.
-- Run through PGlite twice before this is pasted anywhere.

/* ================================== 1. crm.factorial_contract_version */

-- One row per Factorial employee: the contract in force TODAY, per
-- `contracts/reference_contracts` (docs §5.2 -- it is a "today-shaped"
-- answer, not history; a future phase could extend to
-- `contracts/contract_versions` for correct historical weeks).
--
-- Deliberately NOT FK'd to crm.factorial_person_reference: that table has no
-- surrogate key exposed for this purpose (person_id is the FK it carries, and
-- the Factorial id lives in its `external_id` column, scoped by
-- source_system/entity_type/account_ref). crm.factorial_identity_review
-- already establishes the house convention of keying directly on
-- factorial_employee_id rather than inventing a second reference shape, and
-- this table follows it.
create table if not exists crm.factorial_contract_version (
  id                                  uuid primary key default gen_random_uuid(),
  factorial_employee_id               text not null unique,

  effective_on                        date,
  starts_on                           date,
  ends_on                             date,

  working_hours_centihours            integer,
  working_hours_frequency             text,
  working_week_days                   text[],
  working_time_percentage_in_cents    integer,
  maximum_weekly_hours_centihours     integer,

  job_title                           text,
  country                             text,

  -- deliberately absent: salary_amount, salary_frequency. Both are documented
  -- on this exact endpoint (docs §7.5); scripts/lib/factorial.mjs's
  -- CONTRACT_FORBIDDEN_FIELDS tripwire refuses to project them, and this
  -- table's column list is the proof that they were never taken.

  first_seen_at                       timestamptz not null default now(),
  last_seen_at                        timestamptz not null default now(),
  is_active                           boolean not null default true
);

create index if not exists factorial_contract_version_employee_idx
  on crm.factorial_contract_version (factorial_employee_id);

comment on table crm.factorial_contract_version is
  'The contract Factorial says applies TODAY for each mapped employee '
  '(contracts/reference_contracts). One row per employee, upserted on every contract '
  'sync -- not a history. working_hours_frequency is documented only as a bare, '
  'unenumerated string; a row whose frequency is not in {week, day, month} must leave '
  'people.contract_hours NULL, never default to weekly. salary_amount/salary_frequency '
  'are documented on this same endpoint and are deliberately never ingested (docs §7.5).';

comment on column crm.factorial_contract_version.working_hours_centihours is
  'Factorial''s working_hours field, HUNDREDTHS OF AN HOUR (4000 = 40,00 h/week). '
  'Verified against the independently-documented working_time_percentage_in_cents -- see '
  'the vault Factorial data plan, §4. Divide by 100 in exactly one place: '
  'scripts/lib/factorial.mjs#contractWeeklyHours(). Never inline "/100" anywhere else.';
comment on column crm.factorial_contract_version.working_time_percentage_in_cents is
  'Independent cross-check for working_hours_centihours -- the two should imply the same '
  'weekly hours. scripts/check-factorial-contract-hours.mjs re-proves this every run.';
comment on column crm.factorial_contract_version.maximum_weekly_hours_centihours is
  'Same hundredths-of-an-hour unit as working_hours_centihours. Not currently converted or '
  'read by any query; stored for a future legal-ceiling check.';

alter table crm.factorial_contract_version enable row level security;

do $$
begin
  -- Mirrors "factorial identity review exec access" on
  -- crm.factorial_identity_review exactly, so the access model does not
  -- acquire a second dialect. This table holds a person's contracted weekly
  -- hours -- employment data, not commercial project data (see
  -- src/lib/budget-visibility.ts:150, which already ring-fences the
  -- distinction on public.people.contract_hours).
  if not exists (
    select 1 from pg_policies
     where schemaname = 'crm'
       and tablename  = 'factorial_contract_version'
       and policyname = 'factorial contract version exec access'
  ) then
    create policy "factorial contract version exec access"
      on crm.factorial_contract_version
      for all to authenticated
      using (public.app_user_role() = 'exec')
      with check (public.app_user_role() = 'exec');
  end if;
end $$;

/* ============================== 2. terminated_on on the identity row */

-- Already fetched and allow-listed (scripts/lib/factorial.mjs
-- EMPLOYEE_ALLOWED_FIELDS) but never persisted anywhere. factorial_active is
-- an app-access flag, not employment status -- measured live, 1 of 20
-- excluded_not_employee decisions is for an employee with factorial_active =
-- true -- so this is the honest signal a future employment-status gate needs,
-- not a duplicate of a column that already exists.
alter table crm.factorial_identity_review
  add column if not exists terminated_on date;

comment on column crm.factorial_identity_review.terminated_on is
  'From Factorial employees.terminated_on. NULL means employed. Distinct from '
  'factorial_active, which is an app-access flag, not employment status -- a person can be '
  'excluded_not_employee while still factorial_active = true, and vice versa.';
