-- Verification query for the two fixes that CANNOT be checked over the REST API.
--
-- Paste into: Supabase Dashboard -> SQL Editor -> New query -> Run.
-- This is READ-ONLY. It reads catalog views and changes nothing.
--
-- Why it's needed: PostgREST does not expose pg_policies, and the service-role
-- key bypasses RLS, so neither scripts/audit-live-db.mjs nor
-- scripts/probe-live-rls.mjs can confirm these two. Everything else in the
-- fix set is already verified against the live project; these are the last two.
--
-- Expected result: 5 rows, all with verdict = 'OK'.
-- Any row reading 'MISSING' or 'INCOMPLETE' means that fix is not deployed to
-- this project, and supabase/schema.sql should be re-run for that section.

-- 1. The approvals UPDATE policy must carry BOTH using and with_check.
--    USING alone controls which rows may be targeted but not what they may
--    become, so an authorised caller could rewrite a row into any status.
select
  'approval_decisions UPDATE has WITH CHECK' as fix,
  case
    when count(*) = 0 then 'MISSING - no UPDATE policy on approval_decisions'
    when bool_and(with_check is not null) then 'OK'
    else 'INCOMPLETE - policy exists but WITH CHECK is null'
  end as verdict,
  coalesce(string_agg(coalesce(with_check, '(null)'), ' | '), '(none)') as detail
from pg_policies
where schemaname = 'public'
  and tablename = 'approval_decisions'
  and cmd = 'UPDATE'

union all

-- 2-4. app_user_profile needs INSERT, UPDATE and DELETE policies, otherwise
--      there is no non-service-role path to change a role or deactivate an
--      account, which makes the admin console's ACTIVE/INACTIVE column inert.
select
  'app_user_profile has ' || c.cmd || ' policy' as fix,
  case when count(p.policyname) > 0 then 'OK' else 'MISSING' end as verdict,
  coalesce(string_agg(p.policyname, ' | '), '(none)') as detail
from (values ('INSERT'), ('UPDATE'), ('DELETE')) as c(cmd)
left join pg_policies p
  on p.schemaname = 'public'
 and p.tablename = 'app_user_profile'
 and p.cmd = c.cmd
group by c.cmd

union all

-- 5. Bonus: confirm the three role helpers filter on is_active, so a
--    deactivated account actually loses its permissions.
select
  'role helpers filter on is_active' as fix,
  case
    when count(*) filter (where prosrc like '%is_active%') = 3 then 'OK'
    else 'INCOMPLETE - only '
         || count(*) filter (where prosrc like '%is_active%')::text
         || ' of 3 helpers filter on is_active'
  end as verdict,
  string_agg(proname || ':' || case when prosrc like '%is_active%' then 'yes' else 'NO' end, ' | ') as detail
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('app_user_role', 'app_user_department', 'app_user_person_id');
