# Supabase schema & procedures

## Fresh setup

Run [`schema.sql`](./schema.sql) once in the Supabase SQL Editor (Dashboard →
SQL Editor → New query → paste → Run). It creates all three tables this app
uses and their RLS policies:

| Table           | RLS policy                          | Why                                                             |
| --------------- | ------------------------------------ | ---------------------------------------------------------------- |
| `todos`         | anon: full access (select/insert/update/delete) | Demo table, no auth yet — tighten once user auth is added.        |
| `netflix_users` | anon: read-only                      | Imported dataset (see below); the app only ever reads from it.   |
| `files`         | anon: full access                    | Upload metadata for the [/uploads](../src/app/uploads/page.tsx) page. |

The `anon` policies use Supabase's publishable/anon API key, which is safe to
ship in the frontend (`NEXT_PUBLIC_SUPABASE_ANON_KEY`) — RLS is what limits
what that key can actually do. **`service_role`/secret keys must never be
used in frontend code.**

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
