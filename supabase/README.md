# Supabase schema & procedures

## Fresh setup

Run [`schema.sql`](./schema.sql) once in the Supabase SQL Editor (Dashboard →
SQL Editor → New query → paste → Run). It creates every table this app
uses and their RLS policies:

| Table | RLS policy | Why |
| --- | --- | --- |
| `netflix_users` | anon: read-only | Imported dataset (see below); the app only ever reads from it. |
| `files` | authenticated: owner-scoped | Upload metadata for the [/uploads](../src/app/uploads/page.tsx) page. |
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
