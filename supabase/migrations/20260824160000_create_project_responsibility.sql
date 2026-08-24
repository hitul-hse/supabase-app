-- ============================================================================
-- public.project_responsibility: who looks after this customer
-- ============================================================================
--
-- WHY
-- ---
-- The masterdata workbook names, for every order, a responsible person (the
-- "SiFa / main contact" column) and a replacement (Vertretung). That is the
-- fact the business runs on: when a customer calls, who owns it, and who
-- covers when that person is away.
--
-- Verified against information_schema: NO table in this database has a
-- responsible / replacement / vertretung / betreuer column -- the query
--   select count(*) from information_schema.columns
--    where column_name ~* 'responsib|replacement|vertretung|betreuer'
-- returns 0. public.projects.owner_person_id and .lead are a different fact
-- (delivery ownership inside the portal) and neither can express a second,
-- role-tagged person. So today the answer lives only in a spreadsheet on one
-- laptop and the app cannot answer it at all. This table closes that gap.
--
-- SHAPE
-- -----
-- One row per (project, person, role). Not two columns on projects, because:
--   * a replacement is the same kind of fact as a responsible, differing only
--     by role -- two nullable columns would duplicate every future rule;
--   * the workbook does name more than one person per cell for some orders;
--   * the unique key (project_id, person_id, role) makes re-import idempotent,
--     which is what lets the importer be run repeatedly without duplicating.
--
-- order_no keeps the Excel key that produced the row, so any single row can be
-- traced back to its spreadsheet line. source records the provenance so a
-- later human-entered row is distinguishable from an imported one.
--
-- VISIBILITY
-- ----------
-- Responsibility is exactly as sensitive as the project it describes, so it
-- reuses the existing can_view_project(text) helper rather than inventing a
-- second rule that could drift out of agreement with projects. No write policy
-- is granted: the importer connects as the table owner over a direct
-- PostgreSQL connection, and nothing in the app is entitled to reassign
-- responsibility yet.
--
-- Idempotent: safe to run twice.
-- ============================================================================

begin;

create table if not exists public.project_responsibility (
  project_id text not null references public.projects (id) on delete cascade,
  person_id  text not null references public.people (id)   on delete restrict,
  role       text not null check (role in ('responsible', 'replacement')),
  source     text not null default 'masterdata',
  order_no   text,
  created_at timestamptz not null default now(),
  unique (project_id, person_id, role)
);

comment on table public.project_responsibility is
  'Who is responsible for a project/customer, and who is their replacement. '
  'Imported from the HSE masterdata workbook, which was the only place this '
  'fact existed. One row per (project, person, role).';
comment on column public.project_responsibility.role is
  'responsible = owns the customer; replacement = Vertretung, covers absence.';
comment on column public.project_responsibility.order_no is
  'The masterdata order-number the row came from, for traceability back to the workbook line.';

-- The read path is always "responsibilities of these projects" or "projects of
-- this person", so index both directions. The unique constraint already covers
-- project_id as a leading column; person_id needs its own.
create index if not exists project_responsibility_person_idx
  on public.project_responsibility (person_id, role);

alter table public.project_responsibility enable row level security;

-- Visibility matches projects exactly, by delegating to the same helper the
-- project policies use. If project visibility changes, this follows for free.
drop policy if exists "responsibility follows project visibility" on public.project_responsibility;
create policy "responsibility follows project visibility"
  on public.project_responsibility
  for select
  to authenticated
  using (public.can_view_project(project_id));

grant select on public.project_responsibility to authenticated;

commit;

-- Verification (run separately):
--   select role, count(*) from public.project_responsibility group by role;
--   select count(*) from public.project_responsibility
--    where person_id = 'md-mathias' and role = 'responsible';
