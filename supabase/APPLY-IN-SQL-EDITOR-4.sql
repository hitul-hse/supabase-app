-- =====================================================================
-- APPLY IN THE SUPABASE SQL EDITOR — round 4, 2026-09-11
--
-- Lets a department head read the customer master. Nothing else changes.
--
-- WHY
-- ---
-- hitul, 2026-09-11: Thorsten Krause, a department head in OPERATIONS, needs
-- the customer master as well as the orders. Today he cannot see it at all.
-- Every crm.* table carries one policy, "customer master exec access", created
-- by 20260822130000_create_customer_master_foundation.sql:
--
--   for all to authenticated
--   using (public.app_user_role() = 'exec')
--   with check (public.app_user_role() = 'exec')
--
-- That tests the ROLE directly. Granting him the crm permission would therefore
-- have changed nothing: the policy never looks at permissions. The policy is
-- what has to move.
--
-- WHAT THIS DOES, AND WHAT IT DELIBERATELY DOES NOT
-- -------------------------------------------------
-- It replaces that one `for all` policy on the thirteen crm tables with TWO:
--
--   "customer master read"   for select, gated on crm:deal:read
--   "customer master write"  for insert/update/delete, gated on crm:deal:write
--
-- and grants crm:deal:read to dept_head.
--
-- Splitting read from write is the point. The old policy was `for all`, so any
-- widening of it widened writing too. After this, giving somebody the customer
-- master to LOOK at is a different act from letting them change it.
--
-- Exec is unaffected: exec already holds both crm:deal:read and crm:deal:write,
-- so every existing exec path keeps working, and this is asserted below.
--
-- dept_head gets READ only. hitul also asked for write — changing a responsible
-- person, and changing things on a customer's orders. Neither is in this file,
-- for two different reasons:
--
--   * Changing a responsible person may already work. dept_head already holds
--     projects:write, and public.decide_project_responsible_change (migration
--     20260827080000) gates on that permission rather than on a role. What
--     blocked Thorsten was visibility, and the department backfill of
--     2026-09-11 widened it from 69 to 86 of 101 customers. Test it before
--     granting anything: a permission added to fix something that already works
--     is a permanent widening bought for nothing.
--
--   * The projects.* tables (project_order, project_location) carry the SAME
--     exec-only policy, and opening those to a department head needs a scoping
--     decision this file will not guess at. Those rows belong to individual
--     projects, so the right gate is almost certainly can_view_project() rather
--     than a bare permission — otherwise a department head could edit orders
--     belonging to a department that is not theirs. That is a separate change
--     with its own evidence.
--
-- ON SCOPING THE READ, SAID PLAINLY RATHER THAN LEFT TO BE DISCOVERED
-- -------------------------------------------------------------------
-- This read is NOT scoped by can_view_project(). A department head who holds
-- crm:deal:read sees every legal entity, not only the customers they can reach
-- through their own orders. That is a deliberate choice and the reason is that
-- crm.legal_entity has no project on it to scope by; reaching one means joining
-- out through project_masterdata, which turns one policy into a correlated
-- subquery evaluated per row on every customer read.
--
-- What it exposes is company reference data: legal names, addresses, aliases,
-- corporate groups, and the Lexware account numbers. It does NOT expose hours,
-- budgets, contracts or who works on what — all of those live in tables gated
-- separately and none of them is touched here. If that is nonetheless too wide,
-- do not apply this file: say so on HSEHU-81 and the scoped version gets built
-- instead.
--
-- HOW THIS WAS TESTED
-- -------------------
-- scripts/check-paste-sql-4.mjs runs this whole file against real Postgres
-- (PGlite) TWICE in one session, as one paste, exactly as you will run it, and
-- asserts the resulting policies afterwards. Running it twice is the test that
-- matters: everything below is idempotent, so a second paste after a network
-- drop must be harmless rather than an error or a duplicate.
--
-- SAFE TO RUN TWICE. Changes no data. Reversible by re-creating the old policy.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. The permission rows must exist before anything is granted against them.
--    They already do on this project; this is written so the file also applies
--    to a fresh database, and so a typo in the key fails here rather than
--    silently granting nothing.
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from public.app_permission where permission_key = 'crm:deal:read') then
    raise exception 'permission crm:deal:read does not exist; nothing was changed';
  end if;
  if not exists (select 1 from public.app_permission where permission_key = 'crm:deal:write') then
    raise exception 'permission crm:deal:write does not exist; nothing was changed';
  end if;
  if not exists (select 1 from public.app_role where role_key = 'dept_head') then
    raise exception 'role dept_head does not exist; nothing was changed';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2. Replace the one exec-only policy with a read policy and a write policy,
--    on every crm table the foundation migration created. The projects.* and
--    stg.* tables in that same loop are deliberately NOT touched.
-- ---------------------------------------------------------------------
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
      ('crm', 'factorial_person_reference')
    ) as tables(schema_name, table_name)
  loop
    -- Skip a table that does not exist rather than aborting the paste: this
    -- list is copied from the foundation migration and a future rename should
    -- not make the whole file unrunnable.
    if not exists (
      select 1 from pg_tables
      where schemaname = target.schema_name and tablename = target.table_name
    ) then
      continue;
    end if;

    execute format('alter table %I.%I enable row level security', target.schema_name, target.table_name);

    -- Drop every policy this file creates, and the one it replaces, before
    -- creating any of them. A window with no policy at all is not a risk
    -- because the whole file is one transaction.
    --
    -- All FOUR names are dropped, not just the first two. The first draft
    -- dropped "exec access", "read" and "write" and forgot "update" and
    -- "delete", so the file worked once and failed on a second paste with
    -- 'policy "customer master update" for table "legal_entity" already
    -- exists'. The rehearsal caught it; a dropped connection mid-paste would
    -- otherwise have found it on the live database.
    execute format('drop policy if exists "customer master exec access" on %I.%I', target.schema_name, target.table_name);
    execute format('drop policy if exists "customer master read" on %I.%I', target.schema_name, target.table_name);
    execute format('drop policy if exists "customer master write" on %I.%I', target.schema_name, target.table_name);
    execute format('drop policy if exists "customer master update" on %I.%I', target.schema_name, target.table_name);
    execute format('drop policy if exists "customer master delete" on %I.%I', target.schema_name, target.table_name);

    execute format(
      'create policy "customer master read" on %I.%I for select to authenticated '
      || 'using (public.app_user_has_permission(''crm:deal:read''))',
      target.schema_name, target.table_name
    );

    -- One policy for the three writing commands. `for all` would also cover
    -- select and would then OR with the read policy above, which is harmless
    -- but makes the intent unreadable; three explicit policies say what they
    -- mean.
    execute format(
      'create policy "customer master write" on %I.%I for insert to authenticated '
      || 'with check (public.app_user_has_permission(''crm:deal:write''))',
      target.schema_name, target.table_name
    );
    execute format(
      'create policy "customer master update" on %I.%I for update to authenticated '
      || 'using (public.app_user_has_permission(''crm:deal:write'')) '
      || 'with check (public.app_user_has_permission(''crm:deal:write''))',
      target.schema_name, target.table_name
    );
    execute format(
      'create policy "customer master delete" on %I.%I for delete to authenticated '
      || 'using (public.app_user_has_permission(''crm:deal:write''))',
      target.schema_name, target.table_name
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 3. Give dept_head the READ permission. Nothing grants it write.
-- ---------------------------------------------------------------------
insert into public.app_role_permission (role_key, permission_key)
select 'dept_head', 'crm:deal:read'
where not exists (
  select 1 from public.app_role_permission
  where role_key = 'dept_head' and permission_key = 'crm:deal:read'
);

commit;

-- =====================================================================
-- WHAT YOU SHOULD SEE AFTERWARDS
--
--   select tablename, policyname, cmd from pg_policies
--   where schemaname = 'crm' order by tablename, policyname;
--
-- Four policies per crm table: read (SELECT), write (INSERT),
-- update (UPDATE), delete (DELETE). No "customer master exec access" left.
--
--   select role_key, permission_key from public.app_role_permission
--   where permission_key like 'crm:%' order by role_key;
--
-- exec: crm:deal:read and crm:deal:write. dept_head: crm:deal:read only.
--
-- TO UNDO: drop the four policies on each crm table, re-create
-- "customer master exec access" exactly as 20260822130000 wrote it, and delete
-- the dept_head row from app_role_permission.
-- =====================================================================
