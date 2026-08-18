# User profile section — design

**Date:** 2026-08-18
**Branch:** `feat/user-profile`
**Status:** approved design, not yet implemented

## What this is

A self-service profile page at `/profile` where a signed-in person manages the things the Hub owns about them: their photo, the name they are shown as, their password, and their preferences. It also shows the employment data HR owns, read-only, so the page answers "what does the system think about me" in one place.

## What this is not

Not a directory of other people's profiles. `/people` already lists colleagues, and a per-colleague detail page is a separate feature with a much harder question attached — who may see `billable_rate_eur` and `cost_rate_eur`. This design avoids that question by never rendering another person's record.

## The constraint that shapes everything

`public.people` is destined to be fed by Factorial and TrackingTime. Anything a user edits that a future sync also owns will be silently overwritten, and there is no conflict-resolution story.

**Therefore: this feature never writes to `people`.** User-owned fields live on `app_user_profile`, which no vendor sync touches. HR fields render from `people` as read-only, visibly styled as such, with a "managed by HR" note.

## Architecture

One route, four independently-submitting cards. Chosen over tabbed sub-routes (navigation overhead for four small sections) and a sidebar drawer (cannot be deep-linked; an upload-with-crop flow has nowhere to land if interrupted).

```
src/app/(app)/profile/
  page.tsx             Server Component; reads, composes the four cards
  actions.ts           Server Actions; all writes
  IdentityCard.tsx     photo + display name        (client)
  EmploymentCard.tsx   HR data, read-only          (server)
  SecurityCard.tsx     password change             (client)
  PreferencesCard.tsx  three settings              (client)
src/lib/queries/profile.ts     the single read
src/components/Avatar.tsx      monogram fallback + image
src/lib/password-strength.ts   extracted from auth/set-password/page.tsx
```

`/profile` sits inside the `(app)` route group, inheriting the existing auth gate, sidebar and layout.

Each card posts independently. A failed password change must not discard an unsaved display name.

## Data model

Two nullable columns on `public.app_user_profile`:

| Column | Type | Meaning |
| --- | --- | --- |
| `display_name` | `text` | Preferred name. Null means fall back to `people.name`. |
| `avatar_url` | `text` | Storage object path. Null means render the monogram. |

Both nullable, so existing rows need no backfill.

One **private** Storage bucket, `avatars`. Private with signed URLs rather than public: a public bucket makes every employee photo world-readable by URL to anyone who can guess or enumerate a path — the same class of mistake as the anon-readable views closed earlier today.

Object path is `{user_id}/avatar.{ext}`. RLS on `storage.objects` scopes select, insert, update and delete to a prefix matching the caller's own uid.

Preferences are three columns rather than a JSON blob, because each has a fixed domain and benefits from a database-level check constraint:

| Column | Type | Domain |
| --- | --- | --- |
| `pref_landing_page` | `text` | one of the app's known routes |
| `pref_locale` | `text` | `de-DE` or `en-GB` |
| `pref_sidebar_collapsed` | `boolean` | default false |

### Explicitly unchanged

`public.user_display_names` is **not** modified. A preferred display name and an avatar appear on `/profile` and in the sidebar chip only. Propagating them to task rows, comments and the org chart means adding `avatar_url` to that view and threading an Avatar component through roughly six surfaces that are under active edit in another session. That is a second phase, and this design is built so it is additive rather than a refactor.

## Write paths

`src/app/(app)/profile/actions.ts` exports five Server Actions:

- `updateDisplayName`
- `uploadAvatar`
- `removeAvatar`
- `changePassword`
- `updatePreferences`

Every one re-checks the caller's identity server-side. A Server Action is a public HTTP endpoint, reachable without ever loading the page, so a page-level gate does not protect it. Each action writes only to the row whose `user_id` equals `auth.uid()`; none accepts a target user id as a parameter.

This rule is not written down anywhere in the repo — `AGENTS.md` holds nine lines of Next.js boilerplate and no security guidance. It is enforced by convention and by `scripts/check-server-action-auth.mjs` (commit `8474cc4`), which drives the time-tracking actions over HTTP with varying server-side identities. Worth promoting into `AGENTS.md` so it survives the people who currently remember it.

### Avatar upload

The client resizes to at most 512x512 and rejects anything over 2MB or outside jpeg/png/webp. **The same three limits are re-validated server-side**, because the client check is a convenience and not a control — a Server Action is a public endpoint and receives whatever the caller sends.

Ordering on replace: write the new object first, then delete the old key. A failure part-way leaves the old photo in place rather than no photo.

### Password change

Requires the current password, verified with `signInWithPassword` before calling `updateUser`. Supabase does not require this when a session is valid, but without it an unlocked laptop is a full account takeover rather than a nuisance.

`getPasswordStrength` and `PasswordStrengthBar` currently live unexported inside `src/app/auth/set-password/page.tsx`. They move to `src/lib/password-strength.ts` and both call sites import them. A second strength meter that disagreed with the first would be worse than the extraction.

## Preferences content

Three real settings. No placeholder card.

1. **Default landing page** after sign-in. Currently always `/portal`.
2. **Locale and date format** — `de-DE` or `en-GB`. A German company reading timesheets cares which one renders.
3. **Sidebar collapsed**, migrated from localStorage to the profile so the choice follows a person between devices.

Item 3 touches the sidebar collapse shipped on master at 13:40 today. It is the first item to drop if that merge proves awkward; items 1 and 2 stand alone.

## Visual design

Strictly the tokens in `DESIGN.md` — `--bg-1` cards on `--bg-0`, `--border` hairlines, Poppins with the uppercase tracked labels used across the app, JetBrains Mono for the employee number.

Read-only HR fields get deliberately different treatment: `--text-2`, no input chrome, no focus ring, with a "managed by HR" note on the card. A field that looks editable and silently is not is worse than one that plainly is not.

The avatar is a circular well with a hover overlay, an inline square crop step, and optimistic preview so the new photo appears before the upload resolves.

The monogram fallback derives initials from the display name and picks its background deterministically from the HSE Teal palette, so a person's colour is stable across sessions and reads as designed rather than as a broken image.

## Testing

Following the existing `scripts/check-*.mjs` gate pattern rather than introducing a framework.

- **`check-profile-rls.mjs`** — user A cannot read, overwrite or delete user B's avatar object, and cannot update user B's profile row. This is the gate that matters; the rest are correctness checks.
- **`check-profile-action-auth.mjs`** — anonymous and wrong-user calls to each of the five actions are refused server-side, modelled on the existing `check-server-action-auth.mjs`.
- **`check-profile-upload-limits.mjs`** — oversize, wrong-MIME and zero-byte uploads are rejected by the server action, not merely by the client.
- Password gate: a wrong current password is rejected and no session is issued.

Each gate must be shown to fail when the behaviour it guards is reverted. A gate that passes against broken code is worse than no gate.

## Isolation

Built on `feat/user-profile` in a worktree at `C:\hse-hub-profile`, off master at `9b9f084`. Another session is committing to `C:\Supabase` roughly every fifteen minutes.

Merge risk is confined to one file: `src/components/SidebarNav.tsx`, which gains the signed-in user chip and was rewritten twice today for the collapse work. Everything else in this design is new files.

## Out of scope

- Profiles of other people
- Avatars and display names outside `/profile` and the sidebar
- Editing any field sourced from Factorial or TrackingTime
- Email address changes, which need a confirmation round-trip
- Two-factor enrolment
