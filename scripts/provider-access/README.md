# Provider access probes

Diagnostics for "why can't this agent use OpenAI or Gemini?", plus a one-command
setup for the working route.

These read credentials from outside the repo (`~/.gemini`, `~/.codex`). They are
operator tooling, not application code, and none of them embed a secret.

## Current state

| Provider | Status | Why |
|---|---|---|
| Claude | working | in use |
| Gemini | **one API key away** | free AI Studio API already enabled; stored token lacks the right scope |
| OpenAI | blocked (purchase) | ChatGPT plan is `free` and its quota is exhausted; no API key; OpenAI has no free API tier |

## Enabling Gemini (free, ~2 minutes)

1. Create a key at <https://aistudio.google.com/apikey>
2. Run:

   ```
   node scripts/provider-access/setup-gemini-key.mjs <API_KEY>
   ```

The script validates the key against the real API, generates a test completion,
configures Jcode, and smoke-tests it. It writes nothing until the key is proven
to work, so a bad key fails loudly instead of half-configuring.

No billing and no Google Cloud changes are involved:
`generativelanguage.googleapis.com` is already enabled on the "Default Gemini
Project".

## Scripts

- `probe-gemini.mjs` — full Gemini auth chain: token refresh, Code Assist tier
  eligibility, GCP project access, required APIs, and a real generate attempt.
- `probe-openai.mjs` — reads the stored OpenAI credential and decodes the
  id_token offline. Makes no API call, so it cannot consume quota.
- `setup-gemini-key.mjs` — validate a key, wire it up, smoke-test it.
- `_creds.mjs` — shared credential loading.

`probe-gemini.mjs` needs the gemini-cli OAuth client credentials, which are
deliberately not committed:

```
set GEMINI_OAUTH_CLIENT_ID=...
set GEMINI_OAUTH_CLIENT_SECRET=...
```

They are a published constant of the open-source gemini-cli, but GitHub push
protection flags them as a Google OAuth Client Secret, and it is right to:
committing credential-shaped strings normalises the habit that leaks real ones.

## What was found, and what was deliberately not done

The Code Assist deprecation applies to the **free tier for this client**, not to
the account. `loadCodeAssist` returns `standard-tier: ALLOWED`, and the "Default
Gemini Project" is accepted with no validation error. Code Assist is one
API-enable call away.

That call was **not** made. `standard-tier` reports `usesGcpTos: true` and Code
Assist Standard is normally a paid per-seat subscription, and the Cloud Billing
API is itself disabled so the exposure cannot even be read. Starting a possible
subscription on someone else's cloud account is not a decision to make on their
behalf. If you want that route instead of the free one, the call is:

```
POST https://serviceusage.googleapis.com/v1/projects/gen-lang-client-0654198490/services/cloudaicompanion.googleapis.com:enable
```
