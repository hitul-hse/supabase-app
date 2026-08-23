-- =============================================================================
-- HSE Hub round 2: customer master foundation + change control
-- Paste this whole file into the Supabase SQL editor and Run.
-- =============================================================================
--
-- WHAT THIS ENABLES, per empty surface on the dashboard:
--   - Customer Master tab: the crm/projects/stg schemas it reads
--   - Multi-Service Matrix + Customer Portfolio: the order->legal-entity
--     mapping both group by
--   - Verantwortlichenwechsel: request/approve with four-eyes control
--
-- SECURITY, verified by executing on real Postgres (check-customer-master-
-- foundation.mjs, 10 checks; check-change-control.mjs, 11 checks):
--   - RLS on all 17 new tables
--   - crm/projects readable+writable by EXEC ONLY; stg has no API access at
--     all (importer-only over a direct pg connection)
--   - anon has nothing
--   - change-control tables cannot be written directly; only the SECURITY
--     DEFINER functions mutate them, and self-approval is refused
--
-- SAFE TO RE-RUN: all three are idempotent (executed twice in the gates).
--
-- After running, tell the agent; it verifies over REST and then loads the
-- curated customer masterdata into staging.
-- =============================================================================


-- ###########################################################################
-- 1 of 3 — customer master foundation (crm/projects/stg)
-- source: supabase/migrations/20260822130000_create_customer_master_foundation.sql
-- ###########################################################################

-- Customer Master foundation for the first Lexware import.
--
-- This migration is additive. It does not remove or alter the existing
-- public/time application model. Source payloads must still land in raw and
-- pass through stg before they can be written to crm or projects.
--
-- Review and lifecycle values intentionally use text + CHECK constraints rather
-- than PostgreSQL enums. This keeps future workflow changes additive.

begin;

create schema if not exists crm;
create schema if not exists projects;
create schema if not exists stg;

grant usage on schema crm, projects to authenticated;
grant usage on schema crm, projects, stg to service_role;
revoke all on schema stg from anon, authenticated;

-- raw.vendor_record is the append-only payload landing zone. The existing
-- sources remain valid; Lexware is added without changing the other values.
-- Match the existing source CHECK by definition rather than relying only on
-- its generated name, so a differently named equivalent constraint cannot
-- remain behind and reject Lexware rows.
do $$
declare
  source_constraint record;
begin
  for source_constraint in
    select conname
    from pg_constraint
    where conrelid = 'raw.vendor_record'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%trackingtime%'
      and pg_get_constraintdef(oid) like '%asana%'
      and pg_get_constraintdef(oid) like '%factorial%'
      and pg_get_constraintdef(oid) like '%samdock%'
  loop
    execute format('alter table raw.vendor_record drop constraint %I', source_constraint.conname);
  end loop;
end $$;

alter table raw.vendor_record
  add constraint vendor_record_source_check
  check (source in ('trackingtime', 'asana', 'factorial', 'samdock', 'lexware'));

comment on constraint vendor_record_source_check on raw.vendor_record is
  'Supported raw sources. Lexware is enabled for the Customer Master import; existing sources remain valid.';

-- ---------------------------------------------------------------------------
-- 1. Canonical CRM model
-- ---------------------------------------------------------------------------

create table if not exists crm.legal_entity (
  id                    uuid primary key default gen_random_uuid(),
  legal_name            text not null,
  legal_form            text,
  vat_id                text,
  registration_court    text,
  registration_number   text,
  country_code          text,
  lifecycle_status      text not null default 'active'
    check (lifecycle_status in ('active', 'inactive', 'historical', 'merged')),
  review_status         text not null default 'unreviewed'
    check (review_status in ('unreviewed', 'review_required', 'in_review', 'approved', 'rejected')),
  review_reason         text,
  reviewed_by           uuid references auth.users(id) on delete set null,
  reviewed_at           timestamptz,
  superseded_by_id      uuid references crm.legal_entity(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists legal_entity_vat_id_idx
  on crm.legal_entity (vat_id);
create index if not exists legal_entity_review_status_idx
  on crm.legal_entity (review_status);

create table if not exists crm.location (
  id                    uuid primary key default gen_random_uuid(),
  legal_entity_id       uuid not null references crm.legal_entity(id) on delete cascade,
  location_name         text,
  location_type         text,
  street                text,
  house_number          text,
  postal_code           text,
  city                  text,
  region                text,
  country_code          text,
  is_primary            boolean not null default false,
  lifecycle_status      text not null default 'active'
    check (lifecycle_status in ('active', 'inactive', 'historical', 'merged')),
  review_status         text not null default 'unreviewed'
    check (review_status in ('unreviewed', 'review_required', 'in_review', 'approved', 'rejected')),
  review_reason         text,
  reviewed_by           uuid references auth.users(id) on delete set null,
  reviewed_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists location_legal_entity_idx
  on crm.location (legal_entity_id);
create index if not exists location_review_status_idx
  on crm.location (review_status);

create table if not exists crm.lexware_customer (
  id                    uuid primary key default gen_random_uuid(),
  legal_entity_id       uuid references crm.legal_entity(id) on delete set null,
  location_id           uuid references crm.location(id) on delete set null,
  customer_number       text not null,
  source_account_ref    text not null,
  display_name_source   text,
  billing_name          text,
  billing_street        text,
  billing_house_number  text,
  billing_postal_code   text,
  billing_city          text,
  billing_country_code  text,
  vat_id_source         text,
  contact_name          text,
  contact_email         text,
  lifecycle_status      text not null default 'active'
    check (lifecycle_status in ('active', 'inactive', 'historical', 'merged')),
  review_status         text not null default 'unreviewed'
    check (review_status in ('unreviewed', 'review_required', 'in_review', 'approved', 'rejected')),
  review_reason         text,
  reviewed_by           uuid references auth.users(id) on delete set null,
  reviewed_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint lexware_customer_account_number_key
    unique (source_account_ref, customer_number)
);

create index if not exists lexware_customer_legal_entity_idx
  on crm.lexware_customer (legal_entity_id);
create index if not exists lexware_customer_location_idx
  on crm.lexware_customer (location_id);
create index if not exists lexware_customer_review_status_idx
  on crm.lexware_customer (review_status);

create table if not exists crm.legal_entity_alias (
  id                    uuid primary key default gen_random_uuid(),
  legal_entity_id       uuid not null references crm.legal_entity(id) on delete cascade,
  alias_text            text not null,
  alias_type            text,
  source_system         text,
  valid_from            date,
  valid_to              date,
  lifecycle_status      text not null default 'active'
    check (lifecycle_status in ('active', 'inactive', 'historical', 'merged')),
  review_status         text not null default 'unreviewed'
    check (review_status in ('unreviewed', 'review_required', 'in_review', 'approved', 'rejected')),
  review_reason         text,
  reviewed_by           uuid references auth.users(id) on delete set null,
  reviewed_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists legal_entity_alias_entity_idx
  on crm.legal_entity_alias (legal_entity_id);
create index if not exists legal_entity_alias_text_idx
  on crm.legal_entity_alias (lower(alias_text));

create table if not exists crm.corporate_group (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  description           text,
  lifecycle_status      text not null default 'active'
    check (lifecycle_status in ('active', 'inactive', 'historical', 'merged')),
  review_status         text not null default 'unreviewed'
    check (review_status in ('unreviewed', 'review_required', 'in_review', 'approved', 'rejected')),
  review_reason         text,
  reviewed_by           uuid references auth.users(id) on delete set null,
  reviewed_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table if not exists crm.corporate_group_member (
  corporate_group_id    uuid not null references crm.corporate_group(id) on delete cascade,
  legal_entity_id       uuid not null references crm.legal_entity(id) on delete cascade,
  membership_type       text,
  valid_from            date,
  valid_to              date,
  lifecycle_status      text not null default 'active'
    check (lifecycle_status in ('active', 'inactive', 'historical', 'merged')),
  review_status         text not null default 'unreviewed'
    check (review_status in ('unreviewed', 'review_required', 'in_review', 'approved', 'rejected')),
  review_reason         text,
  reviewed_by           uuid references auth.users(id) on delete set null,
  reviewed_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  primary key (corporate_group_id, legal_entity_id)
);

create index if not exists corporate_group_member_entity_idx
  on crm.corporate_group_member (legal_entity_id);

create table if not exists crm.framework_agreement (
  id                    uuid primary key default gen_random_uuid(),
  agreement_number      text,
  name                  text not null,
  status                text not null default 'active',
  valid_from            date,
  valid_to              date,
  description           text,
  lifecycle_status      text not null default 'active'
    check (lifecycle_status in ('active', 'inactive', 'historical', 'merged')),
  review_status         text not null default 'unreviewed'
    check (review_status in ('unreviewed', 'review_required', 'in_review', 'approved', 'rejected')),
  review_reason         text,
  reviewed_by           uuid references auth.users(id) on delete set null,
  reviewed_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table if not exists crm.framework_agreement_party (
  id                    uuid primary key default gen_random_uuid(),
  framework_agreement_id uuid not null references crm.framework_agreement(id) on delete cascade,
  legal_entity_id       uuid not null references crm.legal_entity(id) on delete cascade,
  party_role             text,
  lifecycle_status       text not null default 'active'
    check (lifecycle_status in ('active', 'inactive', 'historical', 'merged')),
  review_status          text not null default 'unreviewed'
    check (review_status in ('unreviewed', 'review_required', 'in_review', 'approved', 'rejected')),
  review_reason          text,
  reviewed_by            uuid references auth.users(id) on delete set null,
  reviewed_at            timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint framework_agreement_party_key
    unique (framework_agreement_id, legal_entity_id)
);

create index if not exists framework_agreement_party_entity_idx
  on crm.framework_agreement_party (legal_entity_id);

-- ---------------------------------------------------------------------------
-- 2. Canonical projects and relationships
-- ---------------------------------------------------------------------------

create table if not exists projects.project_order (
  id                    uuid primary key default gen_random_uuid(),
  order_number          text not null,
  name                  text,
  status                text,
  legal_entity_id       uuid references crm.legal_entity(id) on delete set null,
  primary_location_id   uuid references crm.location(id) on delete set null,
  lifecycle_status      text not null default 'active'
    check (lifecycle_status in ('active', 'inactive', 'historical', 'merged')),
  review_status         text not null default 'unreviewed'
    check (review_status in ('unreviewed', 'review_required', 'in_review', 'approved', 'rejected')),
  review_reason         text,
  reviewed_by           uuid references auth.users(id) on delete set null,
  reviewed_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint project_order_number_key unique (order_number)
);

create index if not exists project_order_legal_entity_idx
  on projects.project_order (legal_entity_id);
create index if not exists project_order_review_status_idx
  on projects.project_order (review_status);

create table if not exists projects.project_location (
  project_id            uuid not null references projects.project_order(id) on delete cascade,
  location_id           uuid not null references crm.location(id) on delete cascade,
  location_role         text,
  is_primary            boolean not null default false,
  primary key (project_id, location_id)
);

create index if not exists project_location_location_idx
  on projects.project_location (location_id);

create table if not exists crm.framework_agreement_project (
  framework_agreement_id uuid not null references crm.framework_agreement(id) on delete cascade,
  project_id             uuid not null references projects.project_order(id) on delete cascade,
  relationship_type      text,
  review_status           text not null default 'unreviewed'
    check (review_status in ('unreviewed', 'review_required', 'in_review', 'approved', 'rejected')),
  review_reason           text,
  reviewed_by             uuid references auth.users(id) on delete set null,
  reviewed_at             timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  primary key (framework_agreement_id, project_id)
);

create index if not exists framework_agreement_project_project_idx
  on crm.framework_agreement_project (project_id);

-- ---------------------------------------------------------------------------
-- 3. Phase-1 external references
-- ---------------------------------------------------------------------------
-- A generic crm.external_reference would make internal_entity_id polymorphic:
-- PostgreSQL could not enforce that it points to the declared entity. Phase 1
-- therefore uses explicit typed reference tables with real foreign keys. This
-- keeps Lexware, TrackingTime, Asana and Factorial references stable without
-- making external IDs technical primary keys. A generic table can be introduced
-- later only if its referential integrity is explicitly solved.

create table if not exists crm.trackingtime_customer_reference (
  id                    uuid primary key default gen_random_uuid(),
  time_customer_id      bigint not null references time.customer(id) on delete cascade,
  source_system         text not null default 'trackingtime'
    check (source_system = 'trackingtime'),
  entity_type           text not null default 'customer'
    check (entity_type = 'customer'),
  external_id           text not null,
  account_ref           text not null,
  first_seen_at         timestamptz not null default now(),
  last_seen_at          timestamptz not null default now(),
  is_active             boolean not null default true,
  source_payload_hash   text,
  unique (source_system, external_id, entity_type, account_ref)
);

create table if not exists crm.trackingtime_project_reference (
  id                    uuid primary key default gen_random_uuid(),
  project_id            uuid not null references projects.project_order(id) on delete cascade,
  source_system         text not null default 'trackingtime'
    check (source_system = 'trackingtime'),
  entity_type           text not null default 'project',
  external_id           text not null,
  account_ref           text not null,
  first_seen_at         timestamptz not null default now(),
  last_seen_at          timestamptz not null default now(),
  is_active             boolean not null default true,
  source_payload_hash   text,
  unique (source_system, external_id, entity_type, account_ref),
  check (entity_type = 'project')
);

create table if not exists crm.asana_project_reference (
  id                    uuid primary key default gen_random_uuid(),
  project_id            uuid not null references projects.project_order(id) on delete cascade,
  source_system         text not null default 'asana'
    check (source_system = 'asana'),
  entity_type           text not null default 'project',
  external_id           text not null,
  account_ref           text not null,
  first_seen_at         timestamptz not null default now(),
  last_seen_at          timestamptz not null default now(),
  is_active             boolean not null default true,
  source_payload_hash   text,
  unique (source_system, external_id, entity_type, account_ref),
  check (entity_type = 'project')
);

create table if not exists crm.factorial_person_reference (
  id                    uuid primary key default gen_random_uuid(),
  person_id             text not null references public.people(id) on delete cascade,
  source_system         text not null default 'factorial'
    check (source_system = 'factorial'),
  entity_type           text not null default 'person',
  external_id           text not null,
  account_ref           text not null,
  first_seen_at         timestamptz not null default now(),
  last_seen_at          timestamptz not null default now(),
  is_active             boolean not null default true,
  source_payload_hash   text,
  unique (source_system, external_id, entity_type, account_ref),
  check (entity_type = 'person')
);

create index if not exists trackingtime_customer_reference_entity_idx
  on crm.trackingtime_customer_reference (time_customer_id);
create index if not exists trackingtime_project_reference_entity_idx
  on crm.trackingtime_project_reference (project_id);
create index if not exists asana_project_reference_entity_idx
  on crm.asana_project_reference (project_id);
create index if not exists factorial_person_reference_entity_idx
  on crm.factorial_person_reference (person_id);

-- ---------------------------------------------------------------------------
-- 4. Import and review staging
-- ---------------------------------------------------------------------------

create table if not exists stg.import_batch (
  id                    uuid primary key default gen_random_uuid(),
  source_system         text not null,
  entity_type           text not null,
  file_name             text,
  file_hash             text not null,
  received_at           timestamptz not null default now(),
  started_at            timestamptz,
  finished_at           timestamptz,
  status                text not null default 'received'
    check (status in ('received', 'processing', 'completed', 'failed')),
  row_count             integer not null default 0 check (row_count >= 0),
  error_count           integer not null default 0 check (error_count >= 0),
  created_at            timestamptz not null default now(),
  constraint import_batch_source_file_key unique (source_system, file_hash)
);

create table if not exists stg.import_record (
  id                       uuid primary key default gen_random_uuid(),
  batch_id                 uuid not null references stg.import_batch(id) on delete cascade,
  row_number               integer not null check (row_number > 0),
  source_external_id       text,
  source_customer_number   text,
  raw_payload              jsonb not null,
  normalized_payload       jsonb,
  validation_status        text not null default 'pending'
    check (validation_status in ('pending', 'valid', 'invalid')),
  validation_error         text,
  resolution_status        text not null default 'pending'
    check (resolution_status in ('pending', 'matched', 'unresolved')),
  candidate_legal_entity_id uuid references crm.legal_entity(id) on delete set null,
  candidate_location_id    uuid references crm.location(id) on delete set null,
  review_status            text not null default 'unreviewed'
    check (review_status in ('unreviewed', 'review_required', 'in_review', 'approved', 'rejected')),
  review_reason            text,
  reviewed_by              uuid references auth.users(id) on delete set null,
  reviewed_at              timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint import_record_batch_row_key unique (batch_id, row_number)
);

create index if not exists import_record_batch_idx
  on stg.import_record (batch_id, row_number);
create index if not exists import_record_review_status_idx
  on stg.import_record (review_status);

-- ---------------------------------------------------------------------------
-- 5. RLS, grants and administrative access
-- ---------------------------------------------------------------------------
-- No anon policies are created. CRM/projects access is limited to exec users
-- until dedicated customer-master permission keys and narrower review scopes
-- are designed. stg has no authenticated policy or grant at all: review and
-- import operations must use a server-side service_role path. service_role is
-- used by import jobs and bypasses RLS; it still receives explicit
-- schema/table grants because service_role does not bypass PostgreSQL object
-- privileges.

do $$
declare
  target record;
begin
  for target in
    select * from (values
      ('crm', 'legal_entity'),
      ('crm', 'location'),
      ('crm', 'lexware_customer'),
      ('crm', 'legal_entity_alias'),
      ('crm', 'corporate_group'),
      ('crm', 'corporate_group_member'),
      ('crm', 'framework_agreement'),
      ('crm', 'framework_agreement_party'),
      ('crm', 'framework_agreement_project'),
      ('crm', 'trackingtime_customer_reference'),
      ('crm', 'trackingtime_project_reference'),
      ('crm', 'asana_project_reference'),
      ('crm', 'factorial_person_reference'),
      ('projects', 'project_order'),
      ('projects', 'project_location'),
      ('stg', 'import_batch'),
      ('stg', 'import_record')
    ) as tables(schema_name, table_name)
  loop
    execute format('alter table %I.%I enable row level security', target.schema_name, target.table_name);

    if target.schema_name in ('crm', 'projects') then
      if not exists (
        select 1 from pg_policies
        where schemaname = target.schema_name
          and tablename = target.table_name
          and policyname = 'customer master exec access'
      ) then
        execute format(
          'create policy "customer master exec access" on %I.%I for all to authenticated using (public.app_user_role() = ''exec'') with check (public.app_user_role() = ''exec'')',
          target.schema_name,
          target.table_name
        );
      end if;

      execute format('grant select, insert, update, delete on table %I.%I to authenticated, service_role', target.schema_name, target.table_name);
    else
      execute format('grant select, insert, update, delete on table %I.%I to service_role', target.schema_name, target.table_name);
    end if;
  end loop;
end $$;

comment on schema crm is
  'Canonical HSE Customer Master. Lexware remains the source of truth for billing-relevant source data.';
comment on schema projects is
  'Canonical HSE projects and orders; existing public/time project structures remain compatible.';
comment on schema stg is
  'Typed import, validation, entity-resolution and manual-review layer; not a browser/API surface.';

commit;


-- ###########################################################################
-- 2 of 3 — legal entity fields
-- source: supabase/migrations/20260822140000_add_customer_master_legal_entity_fields.sql
-- ###########################################################################

-- Preserve curated Customer Master fields that are present in
-- HSE_Customer_Masterdata_V1_2.xlsx.
--
-- This migration is additive only. It does not import or modify customer data.
-- The first Lexware import must use:
--   source_account_ref = 'LEXWARE_HSE'
-- source_account_ref remains required by crm.lexware_customer.

begin;

alter table crm.legal_entity
  add column if not exists tax_number text,
  add column if not exists notes text,
  add column if not exists external_source_id text;

commit;


-- ###########################################################################
-- 3 of 3 — project change control (four-eyes)
-- source: supabase/migrations/20260823090000_add_project_change_control.sql
-- ###########################################################################

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
