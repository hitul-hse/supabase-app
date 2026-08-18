# Enable Google sign-in: step by step

(and Microsoft later, if you want it)

## ✅ Part A is DONE — Google sign-in works

The redirect URI was registered in the Google Cloud console on 18 Aug 2026.
Verified against production: `diagnose:oauth` section 5 reports the Supabase
callback as `ACCEPTED (registered)`, and clicking **Continue with Google** now
reaches Google's real sign-in screen rather than its error page.

Nothing further is needed. Part A is kept below as a record of what was changed
and how to re-check it.

**One thing to tell colleagues:** use your **work** address. A personal
`@gmail.com` is a different identity to Google, so it becomes a new user with no
profile and stops at `/access-pending`.

Microsoft is **parked**: its button is hidden, because enabling it needs an Azure
app registration nobody has created yet and a sign-in button that cannot succeed
for anybody is worse than no button. Part B below is complete whenever you want
it, and turning it back on is one environment variable.

So the login page today offers **Continue with Google** and **email + password**.

---

**Before you start**, know the two values you will paste. Everything below is one
of these:

| what | value |
| --- | --- |
| Supabase callback (goes in *provider* consoles) | `https://wdbedblvyrfqwypngghs.supabase.co/auth/v1/callback` |
| the app | `https://hseportal.hs-experts.com` |

> The one mistake worth naming up front: the provider needs the **Supabase**
> callback, not the app's own `/auth/callback`. The browser goes to Google →
> Google returns to **Supabase** → Supabase returns to the app. Providers only
> ever see the middle address.

---

# Part A — Google (done 18 Aug 2026; kept as a record)

**What was wrong:** Google was enabled in Supabase with its client ID and secret
configured, but the OAuth client did not have our callback among its allowed
redirect URIs, so Google refused the handoff. The only URI on that client was
`http://localhost:3000/auth/callback` — someone set it up for local development
and it was never pointed at Supabase.

**What fixed it:** adding the Supabase callback in step A2 below. Both URIs now
read `ACCEPTED (registered)`.

### A1. Open the credential

1. Go to **<https://console.cloud.google.com/apis/credentials>**
2. Sign in as **hitul@hs-experts.com**.
3. Check the **project picker** in the blue bar at the top. It must be the
   project that owns the client below — if you see no OAuth clients at all, you
   are in the wrong project, so click the picker and switch.
4. Under **OAuth 2.0 Client IDs**, click the one whose ID starts:

   ```
   729675374290-ob9itec0be6…
   ```

   Click the **name**, not the copy icon. That opens the edit page.

### A2. Add the redirect URI

5. Scroll to **Authorised redirect URIs**. You should see the existing
   `http://localhost:3000/auth/callback` entry — that confirms you have the right
   client.
6. Click **+ ADD URI**.
7. Paste **exactly** this, and nothing else:

   ```
   https://wdbedblvyrfqwypngghs.supabase.co/auth/v1/callback
   ```

   Character for character. Google matches this as an exact string, so `http://`
   instead of `https://`, or a trailing `/`, or a stray space from copying, all
   fail with the identical unhelpful error.

8. Leave the localhost entry in place. Removing it would break local development
   and it does no harm.
9. Click **SAVE** at the bottom.

### A3. The consent screen

Not needed — Google accepted the request, which it would not do if the consent
screen were blocking us. Recorded in case it ever changes: under **APIs &
Services → OAuth consent screen**, if **Publishing status** is *Testing*, only
listed test users can sign in and everyone else gets `access_blocked`. Either
click **PUBLISH APP**, or add each colleague under **Test users**.

### A4. Re-checking it later

```
npm run diagnose:oauth
```

Section 5 currently reports, and should keep reporting:

```
https://wdbedblvyrfqwypngghs.supabase.co/auth/v1/callback  ACCEPTED (registered)
http://localhost:3000/auth/callback                        ACCEPTED (registered)
```

`https://hseportal.hs-experts.com/auth/callback` reads `MISMATCH`, and that is
correct — Google never sees the app's own callback, only Supabase's.

If either ACCEPTED line ever flips to MISMATCH, wait two minutes and re-run before
changing anything. **Propagation is genuinely slow and non-monotonic:** right after
this fix, localhost briefly read MISMATCH before settling back to ACCEPTED. After
that, suspect a typo: delete the URI and re-paste it.

> Do **not** judge this by section 2. It said `302 -> accounts.google.com` both
> before and after the fix, because reaching Google's host only means Supabase
> handed the browser over — Google can still refuse on arrival. Reading that line
> as success is what hid this fault in the first place.

For a fuller check, `npm run check:oauth-diagnosis` drives a real browser and now
asserts the handoff actually reaches Google's sign-in screen rather than its error
page.

---

# Part B — Microsoft (parked; skip unless you want it)

**Not needed.** Google sign-in works and the Microsoft button is hidden, so there
is nothing broken on the login page while this sits undone. Come back when you
actually want Microsoft sign-in; ~10 minutes.

Nothing exists yet, so this has three halves: create the app registration in
Azure, paste its credentials into Supabase, then un-hide the button. Keep the
Azure and Supabase tabs open — you will copy values from the first into the
second, and one of them is shown only once.

### B1. Create the app registration

1. Go to **<https://portal.azure.com>** and open **Microsoft Entra ID**
   (formerly Azure Active Directory).
2. In the left menu, **App registrations** → **+ New registration**.
3. **Name**: `HSE Portal` (internal only; users never see it).
4. **Supported account types**: choose
   **Accounts in this organizational directory only (single tenant)**.
   This is the right choice for an internal tool — it means only
   `@hs-experts.com` accounts can even attempt sign-in.
5. **Redirect URI**: change the dropdown from the default to **Web**, then paste:

   ```
   https://wdbedblvyrfqwypngghs.supabase.co/auth/v1/callback
   ```

6. Click **Register**.

### B2. Collect the three values

On the **Overview** page that opens:

7. Copy the **Application (client) ID** — a UUID. Paste it somewhere temporary.
8. Copy the **Directory (tenant) ID** — also a UUID. You need this because you
   chose single tenant in step 4.
9. Left menu → **Certificates & secrets** → **Client secrets** tab →
   **+ New client secret**. Description `Supabase`, expiry **24 months**, then
   **Add**.
10. Copy the **Value** column immediately.

    > This is the one irreversible step in the guide. The secret is displayed
    > only once; leaving the page hides it forever. If that happens, nothing is
    > broken — just delete that secret and create another. Also note: whatever
    > expiry you chose, **Microsoft sign-in will break on that date** unless a new
    > secret is issued, so put a calendar reminder a month before.
    >
    > Copy the **Value**, not the **Secret ID** next to it. They look alike and
    > the Secret ID does not work.

### B3. Enable it in Supabase

11. Go to **<https://supabase.com/dashboard/project/wdbedblvyrfqwypngghs/auth/providers>**
12. Find **Azure** in the list and expand it.
13. Toggle **Enable Sign in with Azure** on.
14. **Application (client) ID**: the UUID from step 7.
15. **Secret Value**: the secret from step 10.
16. **Azure Tenant URL**: since you chose single tenant, set this to your tenant
    ID from step 8:

    ```
    https://login.microsoftonline.com/<your-tenant-id>
    ```

    Leaving it blank means multi-tenant, which would let any Microsoft account in
    the world reach the sign-in step. They would still be stopped at
    `/access-pending` with no data, but for an internal tool it is better to
    refuse them at the door.

17. Click **Save**.

### B4. Un-hide the button

The button is hidden by a build-time flag, so Azure and Supabase alone will not
make it reappear.

18. In Vercel → project **supabase-app** → **Settings → Environment Variables**,
    add for **Production**:

    ```
    NEXT_PUBLIC_ENABLE_MICROSOFT_SIGNIN = true
    ```

19. **Redeploy.** `NEXT_PUBLIC_*` values are baked into the JavaScript bundle at
    build time, so a redeploy is required — restarting or just saving the variable
    changes nothing.

    For local development, add the same line to `.env.local` and restart.

### B5. Verify it worked

```
npm run diagnose:oauth
```

Section 1 should now read `azure    ENABLED`, and section 2 should show
`Microsoft (azure)  302 -> login.microsoftonline.com` instead of
`400 <== PROVIDER NOT ENABLED`.

Then confirm the button is back and correctly wired:

```
npm run check:sso-ui
```

With the flag set this asserts the button renders, uses `provider=azure` (not
`microsoft`, a genuinely easy mistake), and requests the `email openid profile`
scopes Azure needs — without them the user arrives with no name or email.

Finally, click **Continue with Microsoft** on the live site in a private window.

---

# Part C — what you do NOT need to do

Both already verified against the live project, so skip them:

- **Supabase redirect allowlist.** Already correct. `npm run
  check:redirect-allowlist` confirms the app's callbacks are honoured and that a
  bogus target is rejected. This is worth knowing about because a wrong entry
  here fails in the most confusing possible way — the user appears to sign in and
  then lands logged out, with no error anywhere.
- **Any code or deploy for Part A.** The login page, the callback route, the
  invite gate and the RLS policies are all done and live. (Part B is the one
  exception: un-hiding the Microsoft button needs a redeploy, step B4.)

---

# Now that Google works: who can actually get in

Enabling a public identity provider does **not** widen access. Verified against
the live database, not inferred from the code.

**An uninvited person clicking "Continue with Google"** authenticates — that is
what OAuth does — and lands on `/access-pending`. They read **zero rows** from
all 18 tables holding people, hours or money, cannot create their own profile
(RLS returns 403), and get nothing from the finance RPCs.

**An invited colleague using Google on their work address keeps their role.**
Google asserts a verified email that matches the invited one, so Supabase
attaches the Google identity to the existing user. Same `user_id`, same profile,
same permissions.

**Tell colleagues to use their work address.** A personal `@gmail.com` is a
*different* identity, so it becomes a new user with no profile and stops at
`/access-pending`. Nothing leaks, but they cannot get in until an administrator
invites that address too.

Optional tidiness: **Authentication → Sign In / Providers → "Allow new users to
sign up"** is currently **on**. Turning it off refuses unknown accounts at the
door instead of holding them at `/access-pending`. The security difference is
nil — both read nothing — but off stops unknown rows accumulating in
`auth.users`.

Full detail, and the commands that prove each claim, are in
[`oauth-setup.md`](./oauth-setup.md).

---

# If something goes wrong

Run this first. It reads each provider's own response rather than guessing:

```
npm run diagnose:oauth
```

| what it reports | what it means | fix |
| --- | --- | --- |
| section 5: Supabase callback `MISMATCH` | the URI was removed or mistyped | re-add it, A2; wait 2 min for propagation |
| `azure    disabled` / `PROVIDER NOT ENABLED` | expected — Microsoft is parked | nothing, or Part B |
| `invalid_client` | client ID or secret is wrong, or the secret expired | re-paste; for Azure re-issue via B2 |
| `access_blocked` | consent screen still in *Testing* | Part A3 |
| `org_internal` | client restricted to one organisation | expected on a single-tenant setup |
| signs in, then appears logged out | redirect allowlist | `npm run check:redirect-allowlist` |
| reaches `/access-pending` | working correctly — that address has no profile | invite that exact address |
| Microsoft button missing | intended, it is flagged off | Part B4 if you want it back |

Note that `diagnose:oauth` still reports on Azure even though the button is
hidden, because it asks the Supabase project rather than the login page. Seeing
`azure    disabled` there is the expected state today, not a fault.

Whatever the state, **email and password sign-in keeps working**, so nobody is
locked out while this is being sorted. If Google is misconfigured, the login page
says so in place and names the fix instead of dumping the user on a provider error
page with no way back.
