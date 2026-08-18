# Google and Microsoft sign-in

Status, measured against the live project on 18 Aug 2026 with
`npm run diagnose:oauth`:

| provider | Supabase | provider side | works? |
| --- | --- | --- | --- |
| **Google** | enabled | **rejects: `redirect_uri_mismatch`** | no |
| **Microsoft** | **not enabled** | not configured | no |

Both are fixed outside this repository — one in Google Cloud, one in the
Supabase dashboard. No code change is needed for either.

Until then the login page says so in place, naming the exact fix, and email +
password still works. It no longer sends anyone to a provider error page they
cannot get back from.

---

## 1. Google: register the callback URI

Google is enabled in Supabase and the client ID is configured. It fails because
the redirect URI Supabase sends is not on the client's allowlist.

1. Google Cloud console → **APIs & Services → Credentials**
2. Open the OAuth 2.0 Client ID whose ID starts `729675374290-ob9itec0be6…`
3. Under **Authorised redirect URIs**, add exactly:

   ```
   https://wdbedblvyrfqwypngghs.supabase.co/auth/v1/callback
   ```

   Not the app's own `/auth/callback`. The browser goes to Google, Google
   returns to **Supabase**, and Supabase then returns to the app — so this URI
   is Supabase's, and it must match character for character, including
   `https://` and no trailing slash.

4. Save, wait a minute for Google to propagate, then re-run:

   ```
   npm run diagnose:oauth
   ```

   Google should report `302 -> accounts.google.com  (provider consent screen:
   WORKING)` and `npm run check:oauth-diagnosis` should report `ok: true`.

Also check the **OAuth consent screen**. If it is still in *Testing*, only
listed test users can sign in and everyone else gets `access_blocked`. Either
publish it or add each colleague as a test user. `diagnose:oauth` names this
case if it is what is happening.

## 2. Microsoft: enable the provider

Nothing is configured yet. This needs an Azure app registration first.

1. Azure portal → **Microsoft Entra ID → App registrations → New registration**
2. Redirect URI, platform **Web**:

   ```
   https://wdbedblvyrfqwypngghs.supabase.co/auth/v1/callback
   ```

3. Note the **Application (client) ID**, then **Certificates & secrets → New
   client secret** and note the value (it is shown once).
4. Supabase dashboard → **Authentication → Providers → Azure**: enable it and
   paste the client ID and secret. Leave the Azure Tenant URL blank for
   multi-tenant, or set it to your tenant to restrict sign-in to the company
   directory — which is worth doing for an internal tool.

The app already requests `email openid profile` for Azure, because Azure
returns no name or email without it.

## 3. Confirm the app's own callback is allowlisted

Supabase silently replaces a redirect target that is not on its allowlist with
the bare Site URL, which drops the PKCE code and lands the user apparently
logged out. Under **Authentication → URL Configuration → Redirect URLs**, both
of these should be present:

```
https://hseportal.hs-experts.com/auth/callback
http://localhost:3000/auth/callback
```

---

## Who can actually get in

Enabling a public identity provider does **not** widen access. This was
verified against the live project, not just read from the code
(`npm run check:invite-oauth-model`, `npm run prove:oauth-linking`).

### An uninvited person signs in with Google

They authenticate — OAuth creates an `auth.users` row — and then land on
**`/access-pending`**, because `src/app/auth/callback/route.ts` looks for an
active `app_user_profile` and finds none.

They can read **nothing**. Every table's RLS policy keys off
`app_user_profile`, never off an email address, so there is no table that
returns them a row. The `/access-pending` page exists so this reads as a
permissions state rather than as a broken app.

Only an administrator creates a profile, so the invite-only model holds.

> If you would rather they could not even create an auth row, turn on
> **Authentication → Sign In / Providers → "Allow new users to sign up" = off**
> in Supabase. It is currently **on**. The practical difference is small — with
> it on they reach `/access-pending` with no access; with it off they are
> refused at the door — but off is tidier, since it stops unknown rows
> accumulating in `auth.users`.

### An invited colleague uses Google on the same address

**Yes, this works, and they keep their role.**

Invite `hitul@hs-experts.com` in the app, which creates the auth user *and* the
`app_user_profile`. When that person clicks **Continue with Google** on the same
address, Google asserts a verified email that matches, so Supabase attaches the
Google identity to the **existing** auth user rather than creating a second one.
Same `user_id`, so the profile the administrator created still applies and they
land in the app with their role.

Verified: the project currently has **no** address spanning two `auth.users`
rows, every address is confirmed, and access resolves by `user_id`
(`prove:oauth-linking`, cleaned up after itself).

**The one way this breaks:** if their Google account is a *different* address
from the invited one — a personal `@gmail.com` rather than the work account —
they become a new auth user with no profile and stop at `/access-pending`. So
tell colleagues to use their work address. The identity-linking gate
(`npm run test:identity-linking`) covers what happens if a fork ever does
occur: the second account holds no role and reads zero rows.

---

## Diagnosing it again later

```
npm run diagnose:oauth            # which providers are enabled, and what each one answers
npm run check:oauth-diagnosis      # the login page explains failures instead of dead-ending
npm run check:invite-oauth-model   # what happens to invited vs uninvited accounts
npm run prove:oauth-linking        # same-email linking, on a disposable account
npm run test:identity-linking      # the RLS consequences of a forked account
```

`diagnose:oauth` is the one to run first. It reads the provider's own response
and names the failure — `redirect_uri_mismatch`, `invalid_client`,
`access_blocked`, `org_internal`, `admin_policy_enforced` — rather than
reporting a generic error.
