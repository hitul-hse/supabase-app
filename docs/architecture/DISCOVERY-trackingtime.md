# TrackingTime — discovery findings

Stage 1 of the three-stage process in `docs/architecture/PLATFORM-ARCHITECTURE.md` §5:
**discover, then model, then own.** This document is the output of discover.

Everything here was observed against the live account on 2026-08-17, not read from
vendor documentation. Where the two disagree, this file wins.

- Account: **438393** (resolved from `/me`)
- Sampled: 19 users · 197 customers · 200 projects · 100 tasks · 21 custom fields ·
  3 timeoff policies · 200 events
- Raw inventories: `docs/discovery/trackingtime/*.md` — **gitignored**, because they
  contain real names, emails, hourly rates and customer names. This summary is the
  committed artefact; the payload reports are not.

---

## 1. Facts that change the schema

### 1.1 Duration is SECONDS — proved, not assumed

This repo already stores Factorial in minutes and TrackingTime in seconds, so
guessing here corrupts every hour figure in the platform. It was verified
arithmetically rather than trusted:

| Field | Start | End | Value |
|---|---|---|---|
| `events/flat.Duration` | `07:30:00` | `08:30:00` | **3600** |

Also observed: `3300` (55 min) and `660` (11 min). Independently corroborated by
`tasks.accumulated_time = 1800` sitting beside `accumulated_time_display = "00:30:00"`.

**Model as `duration_seconds integer`.** Never name a column `hours` for this value.

`projects.worked_hours` genuinely *is* fractional hours (`0.833333`, `7.833333`) —
the same concept in a different unit on a different entity. That inconsistency is
the vendor's, and it is exactly why the unit belongs in the column name.

### 1.2 Pagination is inconsistent per entity

Three different behaviours in one API. A generic paging loop will silently lose data:

| Entity | Behaviour | Real total |
|---|---|---|
| `/projects` | Returns everything in one response; `page=2` is empty | **334** |
| `/customers` | **Ignores `page` entirely** — page 2 returns the identical 197 records (197/197 overlap) | 197 |
| `/tasks` | Genuinely paginates at 100/page | **600+**, not exhausted at page 6 |

The response envelope carries **no total or count** — only `status`, `version`,
`message`, `note`, `note_type`. So completeness cannot be asserted from a header;
it has to be inferred by paging until records repeat or run out.

**Consequence for the discovery reports:** `SAMPLE_LIMIT` is 200, so "projects: 200"
in the inventory means *334 exist*, and "tasks: 100" means *600+ exist*. The
inventory is a shape report, never a census.

### 1.3 Errors arrive as HTTP 200

Confirmed again in live use. An error is `{ response: { status: 500 }, data: {} }`
with a 200 status line, so `res.ok` is not a success check for this vendor. The
connector's `unwrap()` throws on `response.status >= 400`; anything new that calls
this API must do the same or a failed call inventories as "0 records".

A *wrong password* does return a real **401**, so a bad credential fails loudly.
Only in-band API errors are disguised.

### 1.4 The App Password is the entire credential

`base64(email:APP_PASSWORD)` is the documented form, but the email half is ignored.
Verified: a nonexistent address and the literal string `x` both authenticate and
resolve to the same identity (`account_id 438393`, role `ADMIN`).

Treat the App Password as a full secret. It is in `.env.local`, which is gitignored
at `.gitignore:51`.

---

## 2. The shape of the time model

`events/flat` is the entity the `time` schema is really about. Every row is one
tracked interval, already denormalised across user, task, project, customer and
service — which is why TrackingTime's own Power BI integration uses it.

**Core columns, all observed non-null:**

`ID` · `User Id` · `Task Id` · `Start` · `End` · `Duration` · `Event Type` ·
`Is Billable` · `Is Billed` · `Timezone`

**The five-level hierarchy** — and how often each level is actually absent:

```
Customer  (null 33%)  →  Project  (null 33%)  →  Task  (null 35%)
Service   (null 36%)  attaches to the event, not the project
User      (never null)
```

That a third of tracked time has **no customer and no project** is the single most
important number in this report. It is not a data-quality accident to be cleaned up
later — it is a third of the dataset, and the schema must represent it without
inventing a placeholder customer.

**Billing:** `Is Billable` varies (true/false observed), `Is Billed` is uniformly
`false` — nothing has been invoiced through TrackingTime. `Hourly Rate` is null on
77% of events and `0` where present, while `User Hourly Rate` (null 80%) shows real
values (`50`) and `User Hourly Cost` shows `24`. So **rate lives on the user, not the
event**, and margin is derivable.

**Services** are a real, small, stable vocabulary — the closest thing to HSE's
actual service catalogue anywhere in the vendor data:

`DGUV V2: Sifa / Safety Engeineer` · `DGUV V2: Betriebsarzt / Company doctor` ·
`SiGeKo / construction coordination` · `Brandschutzhelfer` · `Risk Assessment` ·
`Grundunterweisung / Trainingsacademy` · `Projekt: Health & Safety Consulting` ·
`Anfahrt & Abfahrt / Travelltime (Payed)` · `Anfahrt & Abfahrt / Travelltime (unpayed)` ·
`intern`

Note that travel time is split into paid and unpaid variants — that distinction is
business logic already encoded in the service name, and should become a column
rather than staying a string match.

---

## 3. Google Calendar is already in the data

Two system custom fields carry it:

| Slug | Populated on |
|---|---|
| `CALENDAR_SYNC_EVENT` | ~43% of events |
| `CALENDAR_SYNC_TASK` | ~33% of events |

So calendar-sourced time is not a separate integration to build — it is already
flowing through TrackingTime and is distinguishable by these fields. Whether those
events should be treated as authoritative time or as suggestions is a **business
decision**, not a technical one.

---

## 4. Absence: TrackingTime is not the owner

| Endpoint | Result |
|---|---|
| `/timeoffs` | **0 records** |
| `/holidays` | **0 records** |
| `/timeoffs/policies?status=ACTIVE` | **3 records** |

The feature exists on this plan and is configured (3 policies, one with
`allowance.unit = WORKING_DAYS`, another `HOURS`, one `is_unlimited: true`) but
carries no data.

**Recommendation: Factorial owns absence.** Model TrackingTime timeoffs as
out-of-scope for the `time` schema rather than building tables that will stay empty.
Worth re-checking once Factorial discovery runs, in case the two disagree.

---

## 5. Custom fields — 21, across 5 object classes

Attached to `customer`, `event`, `project`, `task`, `user`. Nine have system slugs
(`CALENDAR_SYNC_*`, `TIMELINE_*`, `PROJECT_TIMELINE_*`, `INVOICE_ID`, `HIRING_DATE`,
`EVENT_STATUS`); the rest are user-defined and several are German —
`Ansprechpartner`, `Kundennummer`, `Fahrtzeit von und zu Kunden`, `Standort`,
`Vor Ort`.

`value_type` observed: `text`, `enum`, `date`, `number`, `boolean`.

Most are **100% null** in the sample, so they are configured but unused. Do not
model each as a column. A single `custom_fields jsonb` on the owning entity is the
honest representation until one proves it earns a column.

---

## 6. People

19 users in `/users`, but only **10 distinct users appear in 60 days of events**.
Roughly half the licensed seats logged no time in the window.

Roles observed: `ADMIN`, `MANAGER`, `PROJECT_MANAGER`, `CO_WORKER`.
Status observed: `REGISTERED`, `VERIFIED`, `INVITED`.

Every user carries a `schedule` object with per-weekday hours (`mon: 8` … `sat: 0`,
`sun: 0`) — a real contracted-hours source, useful for utilisation denominators.

`billing.hourly_rate` (`50`) and `billing.hourly_cost` (`24`) are present on users.
**These are commercially sensitive** and must not land in any client-readable view.

---

## 7. Open questions — need a human answer before DDL

1. **The 33% with no customer or project.** Is untagged internal time expected and
   permanent, or a tagging discipline problem to fix at migration? The schema
   differs: nullable FK versus a mandatory "Internal" pseudo-customer.
2. **Are Google-Calendar-sourced events authoritative time**, or suggestions a
   person confirms? Determines whether they are `time.entry` rows or a staging table.
3. **Paid vs unpaid travel time** is currently encoded in the service *name*. Should
   `is_travel` and `is_paid` become real columns?
4. **Rate history.** `User Hourly Rate` is a single current value with no effective
   dating. Re-costing last year at this year's rate is wrong — do we need
   `valid_from`/`valid_to` on rates from day one?
5. **Do we import history, and how far back?** 600+ tasks and 334 projects exist;
   the event volume over years is unknown and unbounded by any count in the API.
6. **Which of the 21 custom fields matter?** Most are unused. Confirm before any is
   promoted from `jsonb` to a column.

---

## 8. What happens next

Nothing is modelled yet — deliberately. Per §5 of the architecture doc, the typed
`time` schema is written *from* observed shape, and that shape is now known.

The landing zone already exists (`schema.sql` §7, `raw.vendor_record`) and needs no
change: it stores payloads verbatim as `jsonb` and makes no assumptions about any of
the above.

Re-run discovery at any time with `npm run discover trackingtime`.
