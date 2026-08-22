# Two migrations to apply — contract periods and budget alerts

Apply in this order. Both were **executed against real Postgres before you got
them** (PGlite), twice each, to prove they run and that re-running is safe:

| Migration | Verified by | Checks |
|---|---|---|
| `supabase/migrations/add_contract_periods.sql` | `npm run check:contract-periods` | 42 |
| `supabase/migrations/add_budget_alert_visibility.sql` | `npm run check:budget-alerts` | 50 |

Run them in the Supabase SQL editor. Each is wrapped in a transaction, so a
failure rolls back rather than leaving you half-applied.

## 1. `add_contract_periods.sql`

Creates `time.project_contract_period` — one row per contract term.

**Why a new table rather than a column on `time.project`:**
`scripts/import-trackingtime.mjs:448` upserts `time.project.estimated_hours`
from TrackingTime on **every sync run**. A budget you typed there would be
silently overwritten the next time the sync ran, with no error and no trace.
So contract terms live where the sync cannot reach them.

Also creates:
- `time.contract_period_status` — every period with its burn, remaining hours
  and days left
- `time.active_contract_period(project_id, date)` — the period covering a date
- `time.contract_period_logged_hours(period_id)` — hours inside a period's window
- `time.renew_contract_period(...)` — atomic renewal
- Permissions `projects:contracts:read` / `projects:contracts:write`
  (write goes to exec + dept_head only)

**Verify after applying:**
```sql
select * from time.contract_period_status order by project_id, period_no;
select count(*) from public.app_role_permission
 where permission_key like 'projects:contracts:%';   -- expect 6
```

## 2. `add_budget_alert_visibility.sql`

Extends `public.overbooking_alert` so an alert can be a *warning* and not only
a refusal, and adds `public.budget_alert_feed` for the in-app list.

Also adds the anti-spam index: at most **one open alert** per project, period,
kind and threshold. Without it, a project at 85% raises an identical alert on
every entry logged against it.

**Verify after applying:**
```sql
select kind, email_state, count(*) from public.budget_alert_feed
 group by kind, email_state order by kind;
select indexname from pg_indexes
 where tablename = 'overbooking_alert';   -- expect overbooking_alert_open_unique
```

---

# Then: record the WorkMotion contract

Your own example, with the real numbers already in the database. Once the
migrations are applied, go to the project page for
**10303_WorkMotion Software GmbH / 25/26 GU** and record the terms.

Its 21.1h actually splits across two contract years:

| Window | Real hours logged |
|---|---|
| 2025-07-01 to 2026-06-30 | **15.48h** |
| 2026-07-01 onwards | **5.63h** |

So if the 5h contract covered 2025/26 and you renew at, say, 8h for 2026/27:

- Period 1 shows 15.5h against 5h (309%) and stays on record permanently
- Period 2 shows 5.6h against 8h (70%) and **accepts new bookings**
- Backdating into period 1 is still refused, correctly

That is the renewal requirement working: the new contract frees up the work
without erasing what the old one cost.

You can do the same for the other 11 projects currently over budget — the list
is on `/admin/alerts` under the contract watchlist.

---

# Optional: turn on email

Everything above works **without** email. Alerts are recorded and shown in the
app, and each row states plainly whether mail was attempted.

To enable real emails, set `RESEND_API_KEY` in Vercel (and optionally
`OVERBOOKING_ALERT_FROM`). Recipients default to `hitul@hs-experts.com` and
`bjoern.schoenemann@hs-experts.com`.

Until you do, every alert reads *"No email sent (no mail transport
configured)"* — which is why you saw silence earlier rather than a message.
