-- Link public.projects to the canonical customer identity map.
--
-- PRODUCT.md: "All data joins go through canonical identity maps - never on
-- source-system native IDs." public.projects.customer is free text, so customer
-- roll-ups currently join on a name. This adds a real FK to crm.legal_entity.
--
-- The existing free-text `customer` column is deliberately KEPT: it is the
-- source-system value and the audit trail for how each link was made.
-- Backfill is performed by scripts/link-project-customers.mjs (--apply), which
-- resolves only through crm.legal_entity.legal_name and crm.legal_entity_alias.

alter table public.projects
  add column if not exists customer_legal_entity_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.projects'::regclass
      and conname = 'projects_customer_legal_entity_id_fkey'
  ) then
    alter table public.projects
      add constraint projects_customer_legal_entity_id_fkey
      foreign key (customer_legal_entity_id)
      references crm.legal_entity (id)
      on delete set null;
  end if;
end $$;

create index if not exists projects_customer_legal_entity_id_idx
  on public.projects (customer_legal_entity_id);

comment on column public.projects.customer_legal_entity_id is
  'Canonical customer identity (crm.legal_entity). Nullable: NULL means the free-text projects.customer value has not been resolved through crm.legal_entity_alias yet and must not be silently rolled up. Populated by scripts/link-project-customers.mjs.';

comment on column public.projects.customer is
  'Source-system free-text customer name. Retained as provenance. Do NOT join on this column; use customer_legal_entity_id.';
