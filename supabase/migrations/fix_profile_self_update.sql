-- Every profile write silently no-ops for anyone who is not exec.
--
-- app_user_profile has RLS enabled and its ONLY update policy is
-- "exec can update profiles" (app_user_role() = 'exec'). A non-exec UPDATE
-- matches no policy, affects zero rows, and PostgREST returns success with
-- error === null -- the app then reports "Name updated." etc. for a write
-- that never happened. 18 of 21 live accounts are non-exec.
--
-- Fix has two parts, and the second is not optional on its own:
--
--   (a) a self-update policy so a signed-in user can update their own row.
--
--   (b) column-level grants. Verified live: `authenticated` (and even
--       `anon`) currently hold UPDATE on EVERY column of app_user_profile,
--       including role_key, is_active, user_id and person_id. Policy (a)
--       alone, on top of those grants, would let any employee PATCH their
--       own row to set role_key = 'exec' and gain access to every salary,
--       billable rate and cost rate in the company. So: revoke UPDATE
--       entirely from authenticated/anon, then grant it back column-by-
--       column, only for the five fields this feature actually writes.
--
-- Safe to run more than once.

begin;

drop policy if exists "user can update own profile" on public.app_user_profile;

create policy "user can update own profile" on public.app_user_profile
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Column-level lockdown. Without this, the policy above is a privilege
-- escalation hole: RLS decides WHICH ROWS a statement may touch, not WHICH
-- COLUMNS -- a caller who may update their own row can update any column on
-- it unless the grant itself is narrowed.
revoke update on public.app_user_profile from authenticated, anon;

grant update (
  display_name,
  avatar_url,
  pref_landing_page,
  pref_locale,
  pref_sidebar_collapsed
) on public.app_user_profile to authenticated;

-- anon gets nothing: there is no unauthenticated write path to this table.

commit;
