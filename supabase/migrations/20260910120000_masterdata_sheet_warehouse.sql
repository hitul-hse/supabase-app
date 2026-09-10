-- The masterdata sheet's service fields, contacts and keys, beside the warehouse.
--
-- WHY. On 2026-09-10 the business side's Google Sheet "V1 HSE-Masterdata
-- Kundenliste" became the single source for customers, service orders,
-- responsibilities and the operational links the My Work tab shows. It is
-- staged hourly (stg.import_batch, source MASTERDATA_SHEET_V1) and promoted by
-- scripts/promote-masterdata-sheet.mjs. hitul's decisions that day, recorded in
-- the vault ("2026-09-10 masterdata sheet keys and disappearing rows"):
--
--   1. the sheet's new order number Kundennummer_AB(5)_Service.Sprache_Teil-
--      projekt(2) is the STABLE project key from now on; the old key is kept
--      as an alias and existing project ids never move;
--   2. a row that disappears from the sheet is never deleted -- it is marked
--      historical with the batch that last saw it;
--   3. liveness comes from the contract end, not from the sheet's status column.
--
-- THE INVARIANT THIS MIGRATION PROTECTS. public.projects.id = public.projects
-- .code = projects.project_order.order_number is the OLD key, and five joins,
-- the customer-master drift gate and promote-customer-master.mjs rely on it
-- (management-customer-mapping.ts:43-57, data-hygiene.ts:489, check-data-
-- hygiene-audit-findings.mjs:92). Repointing order_number would make the
-- management tab report every project as unmapped while the drift gate went
-- silently clean. So the new key is added BESIDE the old one, never in its
-- place: `masterdata_key` on projects.project_order and on the new table below.
-- A service that has no old key (14 rows in the first sheet) gets a
-- public.projects row whose id IS its new key, so the invariant holds for it
-- too, and lexwareOf(/^(\d{5})_/) in data-hygiene.ts keeps parsing both.
--
-- WHY A TABLE RATHER THAN COLUMNS ON public.projects. Every column on
-- public.projects is readable by every authenticated user over PostgREST the
-- moment it exists (table-level RLS, no column grants -- 20260903120000
-- _budgets_are_not_readable_by_default.sql:54). A 1:1 table under the same
-- can_view_project() policy keeps the sheet's fields out of every existing
-- select and lets the customer contacts -- personal data -- sit in their own
-- table that is never read in a list, only for one selected row.
--
-- WHAT THIS IS NOT. It drops or renames nothing. It does not touch
-- public.projects, person_assignments, project_responsibility or project_link
-- (the promote script writes those through their existing contracts). It adds
-- no status value: 'historical' already exists on project_order's CHECK, and
-- "open" is derived from contract_end by the readers, not stored.
--
-- ORDER. Requires 20260822130000_create_customer_master_foundation.sql
-- (stg.import_batch, projects.project_order) and the base schema
-- (public.projects, public.people, public.can_view_project).
--
-- Idempotent: `add column if not exists`, `create table if not exists`,
-- `create index if not exists`, `drop policy if exists` before every
-- `create policy`. Executed twice in PGlite by
-- scripts/check-masterdata-warehouse-migration.mjs before paste.

begin;

-- ---------------------------------------------------------------- project_order
-- The new key beside the old, and which batch last saw the order.
alter table projects.project_order
  add column if not exists masterdata_key text,
  add column if not exists last_seen_batch_id uuid references stg.import_batch(id) on delete set null,
  add column if not exists last_seen_at timestamptz,
  add column if not exists historical_since timestamptz;

create unique index if not exists project_order_masterdata_key_key
  on projects.project_order (masterdata_key) where masterdata_key is not null;

comment on column projects.project_order.masterdata_key is
  'The sheet''s stable key Kundennummer_AB(5)_Service.Sprache_Teilprojekt(2). order_number stays the old key (= public.projects.id); this is the alias the other way round.';
comment on column projects.project_order.last_seen_batch_id is
  'The stg.import_batch that last carried this order. Null for orders the sheet has never covered.';
comment on column projects.project_order.last_seen_at is
  'The sheet''s own modified time of that batch -- how fresh the order''s facts are, not when we looked.';
comment on column projects.project_order.historical_since is
  'Set when a batch no longer carried the order (lifecycle_status = ''historical''); cleared if it reappears. Never deleted.';

-- ---------------------------------------------------------------- project_masterdata
-- One row per service order the sheet knows, 1:1 with public.projects.
create table if not exists public.project_masterdata (
  project_id                 text primary key references public.projects(id) on delete cascade,
  masterdata_key             text not null,
  order_number_old           text,
  customer_number            text not null check (customer_number ~ '^[0-9]{5}$'),
  customer_display_name      text,
  customer_name              text,
  corporate_group            text,
  service_number             integer,
  service_name               text,
  language                   smallint check (language in (1, 2)),
  subproject_number          smallint,
  order_confirmation_number  text,
  street                     text,
  postal_code                text,
  city                       text,
  contract_start             date,
  contract_end               date,
  contract_status_sheet      text,
  responsible_kind           text check (responsible_kind in ('person', 'doctor', 'other')),
  replacement_kind           text check (replacement_kind in ('person', 'doctor', 'other')),
  responsible_person_id      text references public.people(id) on delete set null,
  replacement_person_id      text references public.people(id) on delete set null,
  service_role               text,
  min_onsite_time            text,
  travel_flat_rate           boolean,
  travel_flat_rate_text      text,
  travel_as_project_time     boolean,
  travel_as_project_time_text text,
  file_storage               text,
  sheet_row                  integer,
  source_system              text not null default 'MASTERDATA_SHEET_V1',
  lifecycle_status           text not null default 'active'
    check (lifecycle_status in ('active', 'historical')),
  historical_since           timestamptz,
  last_seen_batch_id         uuid references stg.import_batch(id) on delete set null,
  last_seen_at               timestamptz,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

create unique index if not exists project_masterdata_key_key
  on public.project_masterdata (masterdata_key);
create index if not exists project_masterdata_customer_number_idx
  on public.project_masterdata (customer_number);
create index if not exists project_masterdata_order_number_old_idx
  on public.project_masterdata (order_number_old);
create index if not exists project_masterdata_lifecycle_idx
  on public.project_masterdata (lifecycle_status);

comment on table public.project_masterdata is
  'The masterdata sheet''s facts about one service order (source MASTERDATA_SHEET_V1), promoted from stg by scripts/promote-masterdata-sheet.mjs. Visible to exactly the people who can view the project. Hours that are commercial stay on public.projects.contract_hours under the budget redaction; the sheet''s planned/on-site/remote hours are deliberately not promoted here.';
comment on column public.project_masterdata.masterdata_key is
  'The stable key. For orders that predate the sheet, project_id/order_number_old hold the old key; for orders born in the sheet, project_id equals this key.';
comment on column public.project_masterdata.lifecycle_status is
  '''historical'' when the last batch no longer carried the row (decision 2026-09-10: never delete). Liveness for the tabs is contract_end, not this column and not contract_status_sheet.';
comment on column public.project_masterdata.contract_status_sheet is
  'The sheet''s Vertragsstatus as written -- information only; it was stale in 66 of 247 rows when measured.';
comment on column public.project_masterdata.responsible_kind is
  '''person'' when responsible_person_id points at a colleague; ''doctor'' (the company doctor, sheet value DOC) or ''other'' when the sheet names no person.';

-- ---------------------------------------------------------------- project_contact
-- The two customer contacts of a service order. Personal data: read only for
-- a single selected row on My Work, never in a list, never in a CSV.
create table if not exists public.project_contact (
  project_id     text not null references public.projects(id) on delete cascade,
  slot           smallint not null check (slot in (1, 2)),
  name           text,
  phone          text,
  email          text,
  source_system  text not null default 'MASTERDATA_SHEET_V1',
  updated_at     timestamptz not null default now(),
  primary key (project_id, slot)
);

comment on table public.project_contact is
  'Customer contact persons (Ansprechpartner 1 and 2) of a service order, from the masterdata sheet. Personal data of third parties: shown only to the project''s people, for one selected order at a time; omitted from every export.';

-- ---------------------------------------------------------------- RLS and grants
-- Same shape as public.project_link (20260903230000): the project's people
-- read, nobody else; writes only through service_role (the promote script).
alter table public.project_masterdata enable row level security;
drop policy if exists "project masterdata visible to the project's people" on public.project_masterdata;
create policy "project masterdata visible to the project's people"
  on public.project_masterdata for select to authenticated
  using (public.can_view_project(project_id));
grant select on public.project_masterdata to authenticated;
grant select, insert, update, delete on public.project_masterdata to service_role;
revoke all on public.project_masterdata from anon;

alter table public.project_contact enable row level security;
drop policy if exists "project contacts visible to the project's people" on public.project_contact;
create policy "project contacts visible to the project's people"
  on public.project_contact for select to authenticated
  using (public.can_view_project(project_id));
grant select on public.project_contact to authenticated;
grant select, insert, update, delete on public.project_contact to service_role;
revoke all on public.project_contact from anon;

commit;

-- Verify (run after applying):
--   select count(*) from public.project_masterdata;                      -- 0 until the first promote
--   select column_name from information_schema.columns
--    where table_schema='projects' and table_name='project_order'
--      and column_name in ('masterdata_key','last_seen_batch_id','last_seen_at','historical_since');  -- 4 rows
--   select policyname from pg_policies where tablename in ('project_masterdata','project_contact');   -- 2 rows
