-- Self-service profile fields, and a private bucket for photos.
--
-- Everything here hangs off app_user_profile, never public.people. people is
-- destined to be fed by Factorial and TrackingTime, so a display name written
-- there would be silently overwritten by the next sync with no way to detect
-- or resolve the conflict.
--
-- Safe to run more than once.

begin;

alter table public.app_user_profile
  add column if not exists display_name           text,
  add column if not exists avatar_url             text,
  add column if not exists pref_landing_page      text    not null default '/',
  add column if not exists pref_locale            text    not null default 'de-DE',
  add column if not exists pref_sidebar_collapsed boolean not null default false;

-- Constraints rather than a JSON blob: each preference has a fixed domain, and
-- a bad value should fail at write time rather than render as a broken page.
do $mig$ begin
  if not exists (select 1 from pg_constraint where conname='app_user_profile_locale_check') then
    alter table public.app_user_profile add constraint app_user_profile_locale_check
      check (pref_locale in ('de-DE','en-GB'));
  end if;
  if not exists (select 1 from pg_constraint where conname='app_user_profile_landing_check') then
    alter table public.app_user_profile add constraint app_user_profile_landing_check
      check (pref_landing_page in ('/','/people','/projects','/timesheets','/time/dashboard','/leave'));
  end if;
  if not exists (select 1 from pg_constraint where conname='app_user_profile_display_name_len') then
    alter table public.app_user_profile add constraint app_user_profile_display_name_len
      check (display_name is null or char_length(btrim(display_name)) between 1 and 60);
  end if;
end $mig$;

-- Private. A public bucket serves every employee photo to anyone who can guess
-- a path, and the paths are user uuids, which appear in other responses.
insert into storage.buckets (id, name, public)
values ('avatars','avatars', false)
on conflict (id) do update set public = false;

-- One object per user at {user_id}/avatar.{ext}. foldername(name)[1] is that
-- first path segment; comparing it to auth.uid() is what keeps one employee
-- out of another's photo.
drop policy if exists avatars_select_own on storage.objects;
drop policy if exists avatars_insert_own on storage.objects;
drop policy if exists avatars_update_own on storage.objects;
drop policy if exists avatars_delete_own on storage.objects;

create policy avatars_select_own on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy avatars_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy avatars_update_own on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy avatars_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

commit;
