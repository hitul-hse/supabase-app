-- ============================================================================
-- `anon` held TRUNCATE on 33 tables, and TRUNCATE does not read RLS
-- ============================================================================
--
-- WHAT WAS MEASURED, read-only, on production 2026-09-03
-- ------------------------------------------------------
--     select table_name, string_agg(privilege_type, ',' order by privilege_type)
--       from information_schema.role_table_grants
--      where grantee = 'anon' and table_schema = 'public'
--      group by 1;
--
-- 33 rows, every one of them
--
--     DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--
-- and an EIGHTH that information_schema does not report at all. Reading
-- pg_class.relacl directly gives `anon=arwdDxtm/postgres` on all 33: the
-- trailing `m` is MAINTAIN, new in PostgreSQL 17 (production runs 17.6), which
-- carries VACUUM, ANALYZE, CLUSTER, REINDEX, REFRESH MATERIALIZED VIEW and LOCK
-- TABLE. information_schema.role_table_grants only knows the SQL-standard
-- privileges, so a check written against it is blind to MAINTAIN in exactly the
-- way a behavioural HTTP probe is blind to TRUNCATE. CLUSTER and VACUUM FULL
-- take ACCESS EXCLUSIVE locks; that is not a read.
--
-- (public.app_user_profile alone lacks UPDATE, revoked separately in August by
-- grant_app_user_profile_writes.sql). The 33 include `people`,
-- `weekly_employee_summary`, `timesheet_entries`, `leave_requests`,
-- `leave_balances`, `person_qualifications`, `billable_value_by_person` and
-- `app_role_permission` -- the staff roster, everybody's hours, everybody's
-- absence, and the permission catalogue itself.
--
-- WHY RLS IS NOT AN ANSWER TO THIS
-- --------------------------------
-- Every one of those tables has row-level security enabled and none of them
-- carries a policy for `anon` (checked: `pg_policy` returns zero rows where
-- polroles includes anon, and zero policies target PUBLIC either). That is what
-- makes the SELECT/INSERT/UPDATE/DELETE grants inert today, and it is a single
-- layer: they are refused by policy evaluation, not by privilege.
--
-- TRUNCATE, REFERENCES and TRIGGER are not refused by anything, because RLS
-- never runs for them. Postgres checks table privileges and executes.
-- `truncate public.people` is not a filtered delete of zero rows; it is the
-- whole table, and it does not fire the row triggers a DELETE would.
--
-- HOW REACHABLE IS IT, HONESTLY
-- -----------------------------
-- Not reachable through PostgREST today, and this migration does not claim
-- otherwise. `anon` is NOLOGIN (checked: pg_roles.rolcanlogin = false), so the
-- published anon key cannot open a Postgres session; PostgREST reaches the role
-- via SET ROLE and emits no TRUNCATE verb. The two SECURITY DEFINER functions
-- `anon` can EXECUTE -- request_project_responsible_change and
-- decide_project_responsible_change, which hold that grant from the same
-- Supabase default -- both open with `if auth.uid() is null ... raise exception`,
-- so neither is a way in. Checked before writing this, not assumed.
--
-- So this is least privilege, not incident response. It is worth doing anyway
-- for the reason public.netflix_users was worth doing: nothing was broken there
-- either. RLS was on, a policy existed, no test failed -- the table was simply
-- configured open, for a demo, and the demo ended. A privilege nothing uses,
-- sitting on the roster and everybody's hours, waiting for one future
-- SECURITY INVOKER helper or one exposed schema change to become a path, is the
-- same shape of defect one step earlier.
--
-- WHERE THE GRANTS CAME FROM -- AND WHY REVOKING IS NOT ENOUGH
-- ------------------------------------------------------------
-- No migration in this repo granted them. They come from Supabase's stock
-- DEFAULT PRIVILEGES on schema public:
--
--     select pg_get_userbyid(defaclrole), defaclacl from pg_default_acl d
--       join pg_namespace n on n.oid = d.defaclnamespace where n.nspname='public';
--     -> postgres | {postgres=arwdDxtm/postgres, anon=arwdDxtm/postgres, ...}
--
-- `arwdDxtm` is ALL: INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES,
-- TRIGGER. Every table created since inherited it at CREATE time, which is why
-- the list is 33 of 36 relations -- the three exceptions (budget_alert_feed,
-- org_chart_nodes, user_display_names) are views whose anon grants were revoked
-- by hand in August, one incident at a time.
--
-- All 36 relations in public are owned by `postgres` (checked), so the postgres
-- default ACL is the only one that governs this repo's tables. supabase_admin
-- carries an identical default ACL and is deliberately NOT touched: `postgres`
-- is not a member of it (checked in pg_auth_members), the statement would
-- simply fail, and nothing here is owned by that role.
--
-- WHAT IS DELIBERATELY KEPT
-- -------------------------
-- SELECT. The brief for this change is to remove the write-shaped privileges
-- nothing uses, not to remove reads something might. `anon` reads nothing today
-- -- check-no-anonymous-read.mjs proves that behaviourally with a live
-- unauthenticated HTTP request against every relation in public, and it proves
-- it through RLS, which is the layer that decides. Dropping SELECT as well
-- would change PostgREST's answer from an empty set to 401/permission-denied on
-- endpoints, which is a different (and separately arguable) decision; it would
-- also silently disarm that gate's behavioural assertion, since a privilege
-- error is not the same evidence as a policy refusal. Left alone on purpose.
--
-- USAGE and SELECT on sequences are likewise kept. UPDATE on them is not:
-- `setval()` needs it, it is write-shaped, and with INSERT gone there is no
-- caller. Same reasoning, one object type down.
--
-- SAFE TO RE-RUN. Every statement is a REVOKE, which is a no-op when there is
-- nothing to revoke. Proved twice in PGlite by
-- scripts/check-anon-grants-migration.mjs, which also reproduces the vulnerable
-- state first as a negative control and asserts an authenticated caller still
-- writes afterwards.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- The whole change, as one guarded loop.
-- ---------------------------------------------------------------------------
-- Written as a loop over pg_namespace rather than eighteen flat statements for
-- two reasons that both came out of testing it:
--
--   * `revoke ... on all tables in schema crm` ABORTS if crm does not exist,
--     and crm, projects and stg arrive in later migrations. A paste that dies
--     on schema 3 of 6 leaves the fix half-applied with no error anyone reads.
--   * MAINTAIN does not parse at all before PostgreSQL 17, so it has to be
--     dynamic and version-guarded. Production is 17.6; the PGlite gate that
--     proves this file is 17 too, and a 16 would silently skip that one letter
--     rather than refuse the whole migration.
--
-- `all tables in schema` resolves the list at execution time and covers views,
-- so this does not go stale the way a hand-written list of 33 names would.
-- SELECT is not in any list below.

do $$
declare
  s        text;
  pg17     boolean := current_setting('server_version_num')::int >= 170000;
  writes   constant text := 'insert, update, delete, truncate, references, trigger';
begin
  foreach s in array array['public', 'time', 'crm', 'projects', 'raw', 'stg'] loop
    if not exists (select 1 from pg_namespace where nspname = s) then
      raise notice 'schema % does not exist yet — skipped', s;
      continue;
    end if;

    -- 1. The tables that exist now.
    execute format('revoke %s on all tables in schema %I from anon', writes, s);

    -- 2. The tables that do not exist yet. Without this, the next `create
    --    table` in public re-grants all seven privileges at creation time and
    --    the revoke above lasts exactly until the next migration. This is the
    --    half that makes the change permanent.
    --
    --    No FOR ROLE clause: it applies to the current role, which is
    --    `postgres` in the SQL editor, and postgres owns every relation here.
    execute format('alter default privileges in schema %I revoke %s on tables from anon', s, writes);

    if pg17 then
      execute format('revoke maintain on all tables in schema %I from anon', s);
      execute format('alter default privileges in schema %I revoke maintain on tables from anon', s);
    end if;
  end loop;

  -- 3. setval() on a public sequence. USAGE (nextval) and SELECT (currval)
  --    stay: neither writes, and revoking USAGE would be a different decision.
  execute 'revoke update on all sequences in schema public from anon';
  execute 'alter default privileges in schema public revoke update on sequences from anon';
end $$;
