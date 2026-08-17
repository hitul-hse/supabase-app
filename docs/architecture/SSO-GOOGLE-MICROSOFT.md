# Google and Microsoft sign-in

The login page offers **Continue with Google** and **Continue with Microsoft**
alongside email/password. The app code is complete and tested; the buttons will
return an error until each provider is configured in the three places below.

## What signing in does and does not do

This is the part worth being precise about, because it is what makes it safe to
put a public identity provider in front of an internal tool.

Google will authenticate **any** Google account. Microsoft will authenticate any
account in whichever tenants you allow. Neither grants access to HSE data,
because authentication and authorisation are separate here:

| | Created by | Grants |
|---|---|---|
| `auth.users` row | signing in with any provider | nothing |
| `app_user_profile` row | an administrator, explicitly | a role, and with it RLS access |

Every RLS policy resolves permissions through `app_user_profile`. A stranger who
signs in successfully gets a session, is redirected, finds no profile, and lands
on `/access-pending` with **zero** rows readable — they cannot even see that the
tables exist, and cannot self-provision.

That is not an assumption. `npm run test:oauth-access` executes it against the
real schema: an authenticated-but-unprovisioned user reads 0 rows from `people`,
`projects`, `timesheet_entries`, `app_user_profile`, `leave_requests` and
`project_tasks`, cannot INSERT a profile for themselves, and cannot hijack an
existing one. A positive control in the same run confirms a provisioned user
*does* see those rows, so the test cannot pass by denying everybody.

**Consequence for admins:** enabling these providers does not create an approval
queue. Someone who signs in is invisible until you give them a role, and there is
no notification. Provision access the same way as before, in
**Admin → Users & Roles**.

## Setup

### 1. Supabase redirect URLs

**Authentication → URL Configuration.** Both entries matter:

- **Site URL:** your production origin, e.g. `https://hub.hs-experts.com`
- **Redirect URLs:** add every origin the app runs on, with the callback path:
  ```
  https://hub.hs-experts.com/auth/callback
  http://localhost:3000/auth/callback
  ```

If the callback URL is not in this allowlist, Supabase **silently** substitutes
the bare Site URL. The PKCE code never reaches `/auth/callback`, the exchange
never happens, and the user is bounced back to login with no useful error. This
has already caused confusion with invite links in this project.

### 2. Google

1. [Google Cloud Console](https://console.cloud.google.com/apis/credentials) →
   **Create credentials → OAuth client ID → Web application**.
2. **Authorised redirect URI** — this is Supabase's callback, not the app's:
   ```
   https://<project-ref>.supabase.co/auth/v1/callback
   ```
3. Copy the client ID and secret into Supabase → **Authentication → Providers →
   Google**, and enable it.

To restrict sign-in to company accounts, set the OAuth consent screen to
**Internal** in a Google Workspace org. Note this only limits who can reach the
consent screen; the profile requirement above is what actually protects data.

### 3. Microsoft

1. [Azure Portal](https://portal.azure.com) → **Microsoft Entra ID → App
   registrations → New registration**.
2. **Redirect URI**, platform *Web*, same Supabase callback:
   ```
   https://<project-ref>.supabase.co/auth/v1/callback
   ```
3. **Certificates & secrets → New client secret.** Copy the *value* immediately;
   Azure never shows it again.
4. Supabase → **Authentication → Providers → Azure**: paste the Application
   (client) ID and secret, and enable it.
5. If the app registration is single-tenant, set **Azure Tenant URL** in Supabase
   to `https://login.microsoftonline.com/<tenant-id>`. Leaving it blank uses the
   `common` endpoint, which accepts any Microsoft account including personal ones.

Supabase calls this provider **`azure`**, not `microsoft` — that is the string in
`signInWithOAuth({ provider: "azure" })`.

## Verifying it

```
npm run test:oauth-callback      # redirect safety + flow-dependent defaults
npm run test:oauth-access        # signing in grants nothing without a profile
```

Both run in `npm run test:db` and need no credentials.

Against the live project, to see which providers are actually switched on:

```
npm run check:sso-providers
```

It asks Supabase's `/auth/v1/authorize` for each provider and reports `ENABLED` or
`NOT SET` with the reason. A disabled provider answers
`400 Unsupported provider: provider is not enabled` — which is exactly what the
button surfaces to the user, so this is the same signal, seen earlier. It never
follows the redirect, so no consent screen is involved and nothing signs in.

It also lists the callback URLs that must appear in the redirect allowlist, and
warns if `NEXT_PUBLIC_SITE_URL` still points at localhost. Whether a URL is
allowlisted is not readable through the anon API, so that part is a prompt rather
than an assertion.

And with the app running, to check the buttons themselves:

```
npm run build && npm run start   # in one shell
npm run check:sso-ui             # in another
```

18 assertions in a real browser: both buttons render, each starts a same-origin
PKCE flow naming the right provider, and a hostile `?redirect_to=` is dropped
before the provider sees it. It skips if nothing is serving port 3000.

To check a live provider end to end: sign in with an account that has **no**
profile, confirm you land on `/access-pending`, then have an admin assign a role
and sign in again.

## Notes for whoever changes this next

- **`redirectTo` must be `/auth/callback`**, never the destination page. Supabase
  appends `?code=` and only that route exchanges it. The final destination rides
  along as `?next=`, which the callback validates as a same-site path.
- **OAuth users have no password, ever.** `/auth/callback` therefore defaults them
  to `/`, while email invites default to `/auth/set-password`. Sending an OAuth
  user to set-password strands them on a form they cannot use.
- **A denied consent screen returns `?error_description=` with no code.** It is
  handled before the missing-code branch, so the user sees the provider's actual
  reason rather than "missing its verification token".
- `/auth/callback` is in `PUBLIC_ROUTES`. It has to be: the visitor has no session
  until the exchange inside it succeeds.
- **`signInWithOAuth` does not validate the provider.** This one cost real time.
  supabase-js builds the authorize URL client-side and returns no error even for a
  provider that is switched off, then navigates straight to it. The result was the
  whole page being replaced by
  `{"code":400,...,"msg":"Unsupported provider: provider is not enabled"}` with no
  way back and no email form. `OAuthButtons` therefore passes
  `skipBrowserRedirect: true`, probes the URL itself, and only then navigates.
- **The probe uses GET, not HEAD.** `/auth/v1/authorize` answers HEAD with `405`,
  which looks like success if you only test for `400`. That mistake was made here
  first, and the browser sailed into the JSON page exactly as before. With
  `redirect: "manual"` the request is never followed, so an enabled provider costs
  one opaque response and no consent screen.
- If the probe itself fails (offline, CORS), the code navigates anyway. A network
  hiccup must not block someone who could otherwise sign in.
