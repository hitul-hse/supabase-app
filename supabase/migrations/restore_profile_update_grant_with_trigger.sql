-- Restore table-wide UPDATE on app_user_profile and replace the column-level
-- grant lockdown from fix_profile_self_update.sql with a BEFORE UPDATE
-- trigger, because the grant-based approach broke exec admin actions.
--
-- WHAT BROKE
-- ----------
-- fix_profile_self_update.sql revoked UPDATE on app_user_profile from
-- authenticated entirely, then granted it back column-by-column for only the
-- five self-service columns (display_name, avatar_url, pref_landing_page,
-- pref_locale, pref_sidebar_collapsed). Column-level GRANT is enforced by
-- Postgres before RLS is even consulted. But src/app/(app)/admin/users/actions.ts
-- has three exec-only actions -- setUserActive, changeUserRole,
-- changeUserDepartment -- that write is_active, role_key and department using
-- the ordinary session client (Postgres role authenticated). Those columns
-- were never re-granted, so every exec action now fails with
-- "permission denied for column ...". The RLS policy "exec can update
-- profiles" still permits the row; the grant no longer permits the column.
--
-- WHY NOT JUST RE-GRANT THOSE COLUMNS
-- ------------------------------------
-- That is exactly what fix_profile_self_update.sql existed to prevent. With
-- "user can update own profile" using/with check (user_id = auth.uid()), any
-- signed-in employee could PATCH their own row and set role_key = 'exec' --
-- the row check passes because they own the row. RLS WITH CHECK only sees the
-- NEW row, so it cannot detect that a privileged column changed.
--
-- THE FIX
-- -------
-- Grant UPDATE back on all columns, and enforce the privileged-column
-- restriction with a BEFORE UPDATE trigger instead of a grant. A trigger sees
-- both OLD and NEW, so it can allow a self-service caller to change
-- display_name etc. while blocking any change to role_key, is_active,
-- user_id, person_id or department -- unless the caller is exec, or there is
-- no JWT identity at all (service-role / migrations / maintenance scripts).
--
-- Safe to run more than once.

begin;

-- 1. Table-wide UPDATE grant restored. Column-level lockdown replaced by the
--    trigger below.
grant update on public.app_user_profile to authenticated;

-- anon still gets nothing: there is no unauthenticated write path to this
-- table, and fix_profile_self_update.sql never granted it any columns either.

-- 2. Guard trigger -----------------------------------------------------------
create or replace function public.app_user_profile_guard_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Service-role / internal maintenance path: no JWT identity at all. Let
  -- migrations, seed scripts and admin tooling through untouched.
  if auth.uid() is null then
    return new;
  end if;

  -- Exec may change anything, including other users' privileged columns --
  -- this is precisely the admin path (setUserActive, changeUserRole,
  -- changeUserDepartment) that this migration exists to unbreak.
  if app_user_role() = 'exec' then
    return new;
  end if;

  -- Everyone else: self-service columns only. Any change to a privileged
  -- column is refused, even on the caller's own row.
  if new.role_key is distinct from old.role_key
    or new.is_active is distinct from old.is_active
    or new.user_id is distinct from old.user_id
    or new.person_id is distinct from old.person_id
    or new.department is distinct from old.department
  then
    raise exception
      'app_user_profile: only an exec may change role_key, is_active, user_id, person_id or department (attempted by user_id=%)',
      auth.uid();
  end if;

  return new;
end;
$$;

drop trigger if exists app_user_profile_guard_privileged_columns on public.app_user_profile;

create trigger app_user_profile_guard_privileged_columns
  before update on public.app_user_profile
  for each row
  execute function public.app_user_profile_guard_privileged_columns();

commit;
