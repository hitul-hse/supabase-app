# Live TrackingTime members vs the mockup `people` table

Measured against the live database on 18 Aug 2026. Written for whoever rewires the
People and Overview tabs onto real data, so the decisions below are made from
counts rather than assumptions.

Reproduce with `npm run check:people-live-source`.

## The two tables

| | `public.people` (mockup) | `time.member` (live TrackingTime) |
| --- | --- | --- |
| rows | **8** | **49** |
| identity | `emp-1` … `emp-8` | integer `id`, plus TrackingTime `source_id` |
| names | `Anna Brandt`, `C. Haas`, … | real: `Rency Sebastian`, `Björn Schönemann`, … |
| email | **none — the column does not exist** | populated for all 49 |
| role | invented job titles (`SENIOR SAFETY CONSULTANT`) | TrackingTime access level (`ADMIN`, `CO_WORKER`, `PROJECT_MANAGER`, `MANAGER`) |
| department | `SAFETY` / `ENG` / `LAB` | **not present** |

**There is no existing mapping between them.** `time.member.hub_person_id` exists
for exactly this purpose and is `null` for all 49 rows. `user_id` (the auth link)
is populated for only 3. And because `people` has no email column, the obvious
join key does not exist on one side — the 8 mockup rows cannot be matched to real
members by anything except hand-written guesswork.

So this is a **replacement**, not a migration. Nothing is preserved by trying to
map `emp-3` onto a real person.

## Who counts as "the people to show"

49 is not the answer. The candidates, with real counts:

| definition | count | |
| --- | --- | --- |
| all members | 49 | includes long-departed staff |
| not archived | 19 | |
| has ever logged time | 18 | |
| **not archived AND has logged time** | **15** | the working organisation |
| not archived, never logged time | 4 | |
| archived but *has* logged history | **3** | 433h, 62h, 1h — hiding them loses real hours |
| status ≠ VERIFIED (invited, never accepted) | 3 | |
| email not `@hs-experts.com` | 5 | externals and personal addresses |
| looks like a shared mailbox | 2 | `info@`, `jobs@` — not people at all |

Two consequences worth deciding deliberately:

1. **A directory of humans should exclude the shared mailboxes.** `info@` and
   `jobs@` are inboxes; listing them as colleagues is the same category of
   fiction the seeded rows were.
2. **Archived-with-history must stay attributable.** Pablo Guerra Ares logged
   433h. If the People tab filters to non-archived, his hours still exist in
   `time.entry` and the Overview totals include them, so a name has to resolve or
   the two tabs will disagree. Filtering the *directory* is fine; filtering the
   *attribution* is not.

## Data quality notes

- `weekly_hours` is **40 for every member**, with none missing. Convenient, but it
  means utilisation denominators are a uniform assumption from TrackingTime, not
  per-contract truth. Do not present it as though it came from a contract.
- **Future-dated entries exist**: last logged dates include `2026-09-16`,
  `2026-12-31`. TrackingTime holds planned time. Any "hours logged" figure must
  bound the window at today, which is the bug already fixed in `getOrgWeeks`. The
  same trap applies to per-person totals on the People tab.
- Only **18 of 49** members appear in `time.entry` at all.

## What still keys off the mockup table

Rewiring People to `time.member` orphans these unless they are handled:

| table | rows | keyed by |
| --- | --- | --- |
| `person_assignments` | 21 | `people.id` |
| `person_qualifications` | 17 | `people.id` |
| `leave_balances` | 8 | `people.id` |
| `timesheet_entries` | 28 | `people.id` |
| `app_user_profile` | 6 | `person_id`, and **5 of 6 are `null`** — only one row points at `emp-2` |

`app_user_profile` is the important one: it is the access model. Since 5 of its 6
rows have a null `person_id`, access does **not** currently depend on the mockup
people rows, which is why replacing them does not break sign-in. Verify that
rather than trusting it — `npm run check:stranger-access` covers the access model
end to end.

## Two measurement traps hit while producing this

Both silently produce confident wrong numbers, so they are worth naming:

1. **`.limit(20000)` does not defeat PostgREST's 1000-row cap.** A first pass
   reported "8 distinct members with logged time" because it read only the first
   page. Fully paging with `.range()` gives 18. Any per-member aggregate must page
   or aggregate in the database.
2. **Selecting a column that does not exist fails the whole request.**
   `time.entry` has `started_at`, not `date`. Asking for `date` returned an error
   and an unchecked `data` then read as an empty array, so a run reported "0
   members have ever logged time" — flatly contradicting the other probe. Always
   check `error`, never infer emptiness from a missing array.
