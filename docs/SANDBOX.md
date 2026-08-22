# The sandbox workflow: experiment freely, merge deliberately

How colleagues work on the HSE Hub without risking production, and how good
work gets back in. Written 2026-08-22, after reviewing the first sandbox
project (Bjoern's customer dashboard), and shaped by what actually went wrong
and right in it.

## The three rules that matter

1. **Fork on GitHub, develop on a branch, PUSH the branch.** Work that only
   exists on your laptop cannot be reviewed, cannot be merged, and is one
   spilled coffee from gone. The first sandbox had 100% of its work local:
   the fork on GitHub was byte-identical to an old master with zero own
   commits, so there was nothing to review when the time came.

2. **Your own Supabase project, always.** Create a free Supabase instance and
   apply `supabase/schema.sql` to it (the sandbox proof: 34 tables, RLS on all
   of them, straight from the repo -- it works first time). NEVER point a
   sandbox at the production instance, and NEVER copy the production
   `SUPABASE_SERVICE_ROLE_KEY` into a sandbox env: that key bypasses RLS
   entirely, so one leaked laptop equals the whole database. Realistic data
   comes from the seed script, not from production credentials.

3. **Decisions travel as documents, code travels as PRs.** An architecture
   decision made in a sandbox (like ADR-001) is valuable even when the code
   is thrown away. Write it as an ADR in `docs/architecture/`; ADRs merge
   fast because they carry no runtime risk. Code merges through the gate
   below.

## Setting up a sandbox (once)

```
# 1. Fork https://github.com/hitul-hse/supabase-app on GitHub, then:
git clone https://github.com/<you>/<your-fork>.git
cd <your-fork>
git remote add upstream https://github.com/hitul-hse/supabase-app.git

# 2. Branch. master stays a clean mirror of upstream.
git checkout -b feature/<what-you-are-building>

# 3. Your own Supabase project (free tier is fine):
#    - create it at supabase.com
#    - SQL editor -> paste supabase/schema.sql -> Run
#    - Project Settings -> API -> copy YOUR url + keys into .env.local
cp .env.local.example .env.local   # then fill in YOUR instance's values

npm install
npm run dev
```

Staying current with the main portal:

```
git fetch upstream
git merge upstream/master     # or rebase, your choice, it is your sandbox
```

## Getting work back into the hub portal

Open a PR from your fork's branch against `hitul-hse/supabase-app:master`.
The bar the main repo holds is the same one it holds for itself:

- **CI must pass.** The repo runs lint, typecheck, build and `test:db` --
  around 70 gate scripts. They execute migrations against real Postgres,
  check RLS behaviour, and enforce the design system (no emoji glyphs in
  app-shell files, CSS variables not hex, focus rings never removed).
- **Migrations are executed, not proposed.** If your feature needs schema,
  write the migration idempotently (`create policy` is NOT idempotent -- drop
  by name first) and add a PGlite gate that applies it twice. Copy the
  pattern in `scripts/check-contract-periods.mjs`. Two pitfalls that have
  bitten every author so far: the schema is named `time`, which is a SQL
  keyword, so plpgsql type positions need `"time".tablename` quoted; and
  `app_permission`'s key column is `permission_key` with NOT NULL
  `display_name`/`resource`/`action`.
- **Server actions re-check permission in the database.** Never trust the
  client, never gate on a role string; ask `app_user_has_permission`.
- **Paged PostgREST reads always `.order()`.** Unordered `.range()` silently
  repeats and skips rows.
- **Stammdaten changes respect ADR-001** (`docs/architecture/`): no automatic
  entity merging, Lexware stays SSOT for billing data.

A PR does not have to be finished to be opened. A draft PR with a clear
description is the cheapest way to find out whether the direction is right
before investing weeks.

## What the main repo owes the sandbox

- Review within a reasonable time, with reasons rather than verdicts.
- Cherry-picking: if one commit of ten is good, that commit gets taken and
  credited rather than the whole branch being rejected.
- Decisions adopted from sandbox work carry the author's name (see ADR-001).

## Seeding realistic data without production credentials

`supabase/schema.sql` gives you the structure. For data, run the anonymised
seed against YOUR instance:

```
npm run sandbox:seed       # writes plausible fake customers/projects/entries
```

(If that script does not exist yet in your checkout, `npm run test:schema`
still proves your instance matches the schema; the seed script ships with the
sandbox workflow.)

## Security: what a sandbox may never contain

| Never | Why |
|---|---|
| Production `SUPABASE_SERVICE_ROLE_KEY` | Bypasses RLS; one leak = whole DB |
| Production `NEXT_PUBLIC_SUPABASE_URL` + anon key in a DEPLOYED sandbox | Your deployed experiment becomes a login portal to prod |
| Real customer exports (Excel, CSV) committed to git | GDPR + they never leave Downloads |
| `.env.local` in a commit | The repo's `.gitignore` blocks it; do not force it |

If a production key HAS touched a sandbox environment, say so -- keys get
rotated in minutes and nobody is blamed; a silently leaked key is the only
expensive version.
