-- Working links for a project: the Google Chat room, Asana board, TrackingTime
-- project, Drive folder or Teams link that the operations team actually opens
-- when they pick up a customer.
--
-- WHY A TABLE RATHER THAN COLUMNS ON projects
-- -------------------------------------------
-- A project can carry several links of different kinds, and the source data is
-- sparse and uneven (measured in the 2026 masterdata workbook: 253 TrackingTime,
-- 95 Google Chat, 75 Teams, 44 Asana, 17 Drive URLs across ~555 order rows).
-- Five nullable columns on `projects` would be mostly NULL, would need a new
-- column for every future tool, and would put link data inside the same row that
-- carries commercial budget figures -- a table whose column grants are already
-- delicate. A child table keeps them apart.
--
-- KEYED ON THE ORDER NUMBER, WHICH IS AN EXACT KEY
-- ------------------------------------------------
-- `project_id` is `public.projects.id`, i.e. the order number
-- (e.g. 10110_00358_104_01). That is the key the workbook itself uses, and it
-- matches 231/231 against projects.project_order.order_number. ADR-001 is
-- satisfied without any name similarity: the importer joins on this string or
-- reports the row as unmatched, and never guesses from a customer name.
--
-- VISIBILITY IS INHERITED, NOT INVENTED
-- -------------------------------------
-- One SELECT policy: can_view_project(project_id). A link is visible exactly
-- when the project it belongs to is visible, so this introduces no new
-- permission key and cannot widen what /my-work already shows. A link is an
-- operational convenience, not a commercial term -- it is deliberately NOT
-- gated on projects:contracts:read, which governs budgets.
--
-- anon gets nothing. These are internal working links.

begin;

create table if not exists public.project_link (
  id bigint generated always as identity primary key,
  project_id text not null references public.projects (id) on delete cascade,
  kind text not null check (kind in (
    'asana', 'google_chat', 'google_drive', 'microsoft_teams', 'trackingtime'
  )),
  url text not null,
  label text,
  -- Where the row came from, so a future sync can tell its own rows from a
  -- hand-added one and refresh only what it owns.
  source text not null default 'masterdata',
  created_at timestamptz not null default now(),
  -- A re-import must not duplicate. The importer upserts on this.
  constraint project_link_unique unique (project_id, kind, url)
);

create index if not exists project_link_project_idx
  on public.project_link (project_id);

alter table public.project_link enable row level security;

drop policy if exists "read links for projects you can see" on public.project_link;
create policy "read links for projects you can see"
  on public.project_link for select to authenticated
  using (public.can_view_project(project_id));

-- SELECT only, and only for signed-in users. Writes come from the importer,
-- which runs with the service role.
grant select on public.project_link to authenticated;
revoke all on public.project_link from anon;

comment on table public.project_link is
  'Working links (chat room, board, folder) per project, imported from the masterdata workbook. Visible exactly when the project is.';
comment on column public.project_link.project_id is
  'public.projects.id, i.e. the order number. Exact-key join per ADR-001.';

commit;
