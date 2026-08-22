# Contract periods, budget warnings, and renewals — design spec

Author: Jcode, 2026-08-22. Written BEFORE any code, from graphify + live data.

## What the user asked for

1. Budgets are **contract terms agreed by sales**, set when the project is set
   up, not scraped from a time tracker.
2. A contract has a **start date and an end date**.
3. Warn when hours are **near** the budget, not only refuse at the ceiling.
4. On sales confirmation, **renew** the contract: a fresh budget and period,
   **without deleting the previous budget or the hours booked against it**.
5. The overbooking email never arrived. Explain and fix.

## Why the email never arrived (answered, with evidence)

The guard worked. The alert row exists:

```
id=9f66f86d-4468-45b3-8947-7a40e69e4f24  2026-08-22T13:01:58Z
project=10303_WorkMotion Software GmbH / 25/26 GU
requested=1h logged=21.1h budget=5h over=17.1h
notified=null  recipients=[hitul@, bjoern.schoenemann@]
```

`notified = null` means, by design, "email never attempted" — because
`RESEND_API_KEY` is not set in the Vercel environment. The row was written
first on purpose, so a missing transport loses the alert's *delivery*, never
the alert itself. Two things follow:

- **In-app alerts must exist.** Relying on email alone means a missing env var
  silently swallows the whole feature. Sales need to see these in the app.
- Email stays opt-in via `RESEND_API_KEY`, and the UI must state plainly
  whether mail is armed, rather than implying a mail was sent.

## The constraint that decides the data model

`scripts/import-trackingtime.mjs:448` upserts `estimated_hours` on
`time.project` from the vendor on **every sync run**:

```js
estimated_hours: typeof p.estimated_time === "number" ? p.estimated_time : null,
```

So a contract budget stored in `time.project.estimated_hours` would be
**silently overwritten by the next sync**. Sales' agreed number would vanish
and nobody would know why.

Therefore: contract terms live in a **new table the sync never touches**.
`estimated_hours` stays what it is — the vendor's estimate — and becomes a
*fallback* only.

Related fact from the same investigation: `time.entry` dates are
`started_at timestamptz`, so period matching is on `started_at`, and
`time.project` has no create-project UI at all (projects arrive from the
vendor). Contract terms must therefore attach to **existing** projects, which
is also what "when we set up the project" means in practice today.

## Data model

New table `time.project_contract_period` — one row per contract term.

| column | type | why |
|---|---|---|
| `id` | bigint identity PK | |
| `project_id` | FK -> time.project | |
| `period_no` | int | 1, 2, 3… human-facing "renewal number" |
| `budget_hours` | numeric(10,2) NOT NULL, CHECK > 0 | the number sales agreed |
| `starts_on` | date NOT NULL | contract start |
| `ends_on` | date NOT NULL, CHECK >= starts_on | contract end |
| `warn_at_percent` | int NOT NULL default 80, CHECK 1..100 | the "near the limit" line |
| `contract_reference` | text | sales' contract/order number |
| `confirmed_by` | uuid -> auth.users | who recorded the sales confirmation |
| `confirmed_at` | timestamptz | when |
| `renewed_from_id` | FK -> self | the renewal chain, so history is navigable |
| `notes` | text | |
| `created_by`, `created_at` | | audit |

**Integrity rules that carry the design:**

- `unique (project_id, period_no)`.
- **No overlapping periods per project**, enforced by a GiST exclusion
  constraint on `daterange(starts_on, ends_on, '[]')`. Without this, two
  periods could both claim a date and the guard's answer would depend on row
  order. This is the one rule that makes "which budget applies?" total.
- Nothing is ever deleted or mutated on renewal. A renewal **inserts** a new
  row. The old row keeps its budget, its dates, and (because hours are counted
  by date window) its hours. That is requirement 5, expressed as a constraint
  rather than a convention.

## How hours are counted (the important change)

Today the guard sums **all** hours ever logged on a project. With contract
periods that is wrong: after a renewal, last year's hours would eat this
year's budget.

New rule: **hours are summed within the active period's date window**
(`started_at::date between starts_on and ends_on`). So:

- Period 1 (5h, 2025-07-01..2026-06-30) keeps its 21.1h and stays visibly over.
- Period 2 (renewed, 8h, 2026-07-01..2027-06-30) starts at 0h of 8h.
- No data is moved or deleted to achieve this.

## The decision function

`evaluateBudget()` gains a `level` instead of a bare boolean:

| level | meaning | write allowed? |
|---|---|---|
| `unbudgeted` | no contract period and no vendor estimate | yes |
| `within` | below the warn threshold | yes |
| `approaching` | at/over `warn_at_percent` but at/under 100% | **yes, with a warning** |
| `exhausted` | this booking lands exactly on the budget | yes (hitting the number is success) |
| `over` | this booking would cross the budget | **no** |
| `already_over` | the period is already past its budget | no |
| `outside_contract` | the entry's date falls in no period | **yes, with a warning** |

Two deliberate "allow with a warning" cases, both for the same reason: this
guard blocks writes, and refusing to record hours somebody actually worked is
worse than recording them with a flag.

- `approaching` is the feature the user asked for: tell me *before* I hit the
  wall.
- `outside_contract` must not block. If sales are late renewing, the
  consultant still worked those hours. Blocking would push people to log time
  against the wrong project, which corrupts the data the whole app reports on.
  It warns loudly and raises an alert instead.

## Notifications

- Record-first stays: a row is written before any email attempt.
- New reason codes so sales can tell apart: `approaching`, `over`,
  `already_over`, `outside_contract`, `contract_expiring`.
- **In-app alert list** so the feature works with no mail transport.
- Threshold alerts must not spam: at most one `approaching` alert per
  (project, period, threshold) — the state changing is the event, not each
  booking after it.

## Rollout / compatibility

- Projects with no contract period fall back to `estimated_hours` and today's
  all-time sum. Nothing regresses on day one.
- A backfill is offered, not forced: 251 projects have a vendor estimate, and
  turning those into "contracts" would be inventing dates sales never agreed.
  Sales enter real terms; the fallback covers the rest.

## Verification plan

- Migration executed against real Postgres (PGlite) before handover, twice, to
  prove idempotence — the trap that bit the HR migration.
- The exclusion constraint proven by attempting an overlap and asserting the
  failure.
- Guard unit-tested at every level boundary, including the WorkMotion case and
  a renewal that must NOT inherit the previous period's hours.
- Live read-only replay against production data.
