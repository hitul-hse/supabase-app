# Supabase schema & procedures

## ⚠ Pending migration: `migrations/hoist_entry_read_policy.sql`

**Not yet applied to production.** It makes the TrackingTime dashboard roughly 2.5s
faster on a wide selection and changes no access.

Measured on the live project (`npm run check:rls-hoisting`), fetching the same
4,194 rows the dashboard reads:

| | time |
| --- | --- |
| as `service_role` (RLS bypassed) | 311ms |
| as a real exec (RLS applied) | 2,870ms |

The `scoped read of entry` policy called `time.can_view_member(member_id)` with a
per-**row** argument, so Postgres evaluated it once per candidate row — 4,194
times, each invoking `app_user_role()`, which reads `app_user_profile`. The
migration hoists the two caller-scoped disjuncts into scalar subqueries so the
planner evaluates them once per statement.

Access is unchanged, and that is proved rather than argued: `npm run
test:entry-policy-equivalence` installs the old and new predicates against the
same fixture and compares the exact set of entry ids visible to all four roles,
with negative controls (the fixture must discriminate between roles, and a
deliberately permissive `using (true)` must be detected as different). It runs in
`test:db`.

`schema.sql` is already updated, so a **fresh** install gets the fast policy. An
existing database needs this migration, because that policy block is guarded by
`if not exists`.

**To apply:** paste `migrations/hoist_entry_read_policy.sql` into the Supabase SQL
Editor. It is one transaction; if it fails halfway the table has no SELECT policy
and RLS defaults to DENY, so the failure mode is "reads are locked out", never
"reads are open". With a direct Postgres connection available,
`node scripts/apply-rls-hoisting.mjs` does it with before/after timings and a
`--rollback` flag.

**To confirm afterwards:** `npm run check:live-dashboard` — its 3s budget for the
widest selection currently fails at ~3.3s and should pass once this lands.

## Fresh setup

Run [`schema.sql`](./schema.sql) once in the Supabase SQL Editor (Dashboard →
SQL Editor → New query → paste → Run). It creates every table this app
uses and their RLS policies:

| Table | RLS policy | Why |
| --- | --- | --- |
| `netflix_users` | anon: read-only | Imported dataset (see below); the app only ever reads from it. |
| `files` | authenticated: owner-scoped | Upload metadata; no page reads/writes it currently — the `/uploads` starter route was removed, the table and policy are left as-is. |
| `sync_sources`, `executive_metrics`, `weekly_trends`, `team_utilisations` | authenticated: read-only | Non-sensitive dashboard aggregates, same for every role. |
| `people`, `person_assignments`, `person_qualifications`, `weekly_bookings`, `timesheet_entries` | authenticated: role-scoped via `can_view_person()` | exec sees all; dept_head sees their department; everyone else sees only their own row. |
| `projects`, `project_timeline`, `project_tasks` | authenticated: role-scoped via `can_view_project()` | exec sees all; dept_head sees their department; owners and assigned people see their own. |
| `approval_decisions` | exec/dept_head: read + update | Team Lead approval queue — not relevant to other roles. |
| `app_role`, `app_user_profile` | authenticated: read own row; exec: read all | Backs the role model itself — see "Roles & accounts" below. |

The `anon` policies use Supabase's publishable/anon API key, which is safe to
ship in the frontend (`NEXT_PUBLIC_SUPABASE_ANON_KEY`) — RLS is what limits
what that key can actually do. **`service_role`/secret keys must never be
used in frontend code.**

## Roles & accounts

Four roles live in `app_role`: `exec`, `dept_head`, `project_manager`,
`employee`. Every login needs a row in `app_user_profile` (role, optional
linked `people` row, optional department) — there's no self-signup, and a
logged-in user with no profile lands on `/access-pending`. Accounts are
created from `/admin/users` (exec-only), which needs
`SUPABASE_SERVICE_ROLE_KEY` set (see `.env.local.example`) to actually send
invites; the page still lists existing accounts without it.

The scoping logic lives in two `security definer` SQL functions,
`can_view_person()`/`can_view_project()` (see `schema.sql`), reused across
every person/project-scoped policy above rather than repeated per table.

## How `netflix_users` was populated

This table was seeded from a Kaggle CSV (`netflix_users.csv`, ~25,000 rows),
not through the app itself. The one-time procedure was:

1. Create the table with a **read-only** anon policy (as in `schema.sql`).
2. Temporarily add an anon **insert** policy so the import script could write
   rows using only the public anon key (no service_role key needed):
   ```sql
   create policy "Temp allow anon insert to netflix_users"
     on netflix_users
     for insert
     to anon
     with check (true);
   ```
3. Run a small Node script that reads the CSV and POSTs batches of 1,000 rows
   to Supabase's REST API (`POST {SUPABASE_URL}/rest/v1/netflix_users`).
4. Drop the temporary insert policy so the table goes back to read-only:
   ```sql
   drop policy "Temp allow anon insert to netflix_users" on netflix_users;
   ```

If you need to re-import or load a different dataset, repeat that pattern —
add a temporary insert policy, load the data, then remove the policy again.
Don't leave anon insert access open on a table you don't want the public
writing to.
