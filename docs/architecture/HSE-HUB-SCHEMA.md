# HSE Hub — Data Model Documentation

**Status:** Draft for Sprint 0 review
**Owner:** TBD
**Companion to:** Miro board *HSE Hub — Portal Architecture & Design*, frames 5–7

---

## 1. What this document is

This is the reference for the HSE Hub warehouse schema — the tables, what each column means, how the tables relate, and the reasoning behind the design choices. It exists so that:

- Whoever writes the DDL doesn't have to re-derive intent from an ER diagram
- Whoever writes a metric knows which table to join and which to avoid
- Whoever inherits this in a year understands *why* it looks like this

It documents a **proposed** model. It has not been validated against the four source APIs yet — that's the Sprint 0 spike work. Section 12 lists the assumptions that could force changes.

---

## 2. What the portal is

HSE Hub aggregates data from four external systems into one warehouse and presents role-based dashboards on top of it.

| Source | What we take from it | Why |
|---|---|---|
| **Asana** | Projects, tasks, users, teams | What work exists and who owns it |
| **TrackingTime** | Time entries, billable flag, project budgets | Where hours actually went |
| **Samdock** (CRM) | Deals, pipeline stages, owners, companies | What's being sold |
| **FactorialHR** | Employees, contracts, working hours, absences | Who is available, and for how many hours |

HubSpot replaces Samdock at an unconfirmed future date. The schema is built so that this is a connector swap, not a rebuild (see §7.5).

The flagship deliverable is a CEO overview answering: *is the company healthy right now?* Everything in this schema exists to serve a question on the KPI catalogue.

---

## 3. The layered architecture

Data moves through four layers. Each has one job and does not do the others' jobs.

```
External APIs → RAW → STAGING → ANALYTICS → METRIC VIEWS → Dashboards
                              ↓
                       IDENTITY MAPS
```

### 3.1 Raw

Verbatim payloads from the APIs, stored as JSON. Append-only. Never edited, never deleted on a schedule.

**Why keep it:** we can rebuild every downstream layer without re-calling any API. That protects against three real risks — hitting rate limits during a rebuild, a vendor changing or removing an endpoint, and our own transform logic being wrong (which it will be, at least once). Storage is cheap; re-fetching three years of time entries is not.

**Design note:** one generic `raw_record` table rather than one table per source. Adding a fifth connector needs zero new raw DDL.

### 3.2 Staging

Typed, deduplicated, still shaped like the source system. One table per source entity.

This is where vendor messiness gets contained: inconsistent date formats, nulls where you'd expect values, a "project" that means something subtly different in TrackingTime than in Asana. Everything ugly stops here.

### 3.3 Analytics

The conformed star schema. Dimensions (`dim_*`) describe things; facts (`fact_*`) record events and measurements. This is the **only** layer that dashboards and metric views read from.

### 3.4 Metric views

Every KPI defined once, in SQL, in one place. Expensive ones are materialised and refreshed when a sync completes.

**Why this matters:** if utilisation is computed inline in two different React components, they will eventually disagree, and the moment the CEO notices two numbers that should match but don't, trust in the whole portal is gone. One definition, one place.

---

## 4. Conventions

### Naming

- Schema prefixes: `raw_`, `stg_`, `dim_`, `fact_`, `vw_`
- `snake_case`, singular table names (`dim_person`, not `dim_persons`)
- Booleans read as assertions: `is_billable`, `is_active`, `is_working_day`
- Foreign keys carry the parent's key name: `person_id`, `project_id`

### Types

- Surrogate primary keys are `uuid` (via `gen_random_uuid()`)
- All timestamps are `timestamptz`, stored UTC, rendered in local time by the UI
- A field meaning a calendar day stays `date` — `work_date` is a day, not an instant
- Money is `numeric`, never `float`
- Hours are `numeric(6,2)`

### The rule that matters most

> **Never join on a source system's native ID.**

Every cross-system join goes through `person_id`, `project_id`, or `client_id` resolved from an identity map. If you find yourself writing `JOIN ... ON stg_tt_time_entry.user_external_id = ...`, stop. That is precisely how the numbers go silently wrong.

---

## 5. Layer 1 — Ingestion & sync

### `sync_source`

Registry of connectors. One row per external system.

| Column | Type | Notes |
|---|---|---|
| `source_key` | `text` PK | `asana`, `trackingtime`, `samdock`, `factorial` |
| `display_name` | `text` | For the admin UI |
| `is_enabled` | `boolean` | Kill switch — disable a connector without deploying |
| `rate_limit_per_min` | `int` | Read by the sync framework's throttle |

### `sync_run`

One row per execution of a connector. This is the observability backbone.

| Column | Type | Notes |
|---|---|---|
| `run_id` | `uuid` PK | |
| `source_key` | `text` FK | — `sync_source` |
| `started_at` / `finished_at` | `timestamptz` | `finished_at` null means still running or crashed |
| `status` | `text` | `running`, `success`, `failed`, `partial` |
| `rows_fetched` / `rows_upserted` | `int` | Divergence between these two is a useful alarm |
| `error_message` | `text` | Populated on failure |

**Why it matters:** the admin status page and the freshness stamp on every dashboard tile both read from here. A dashboard showing three-day-old numbers without saying so is worse than a dashboard that's down.

### `sync_cursor`

Incremental sync watermark, per source *and* entity type.

| Column | Type | Notes |
|---|---|---|
| `source_key` | `text` PK (composite) | |
| `entity_type` | `text` PK (composite) | `project`, `task`, `time_entry`, … |
| `cursor_value` | `text` | Usually an ISO timestamp; text because some APIs use opaque tokens |
| `updated_at` | `timestamptz` | |

Per-entity rather than per-source because APIs often paginate entities independently — Asana tasks may sync fine while projects fail.

### `raw_record`

| Column | Type | Notes |
|---|---|---|
| `raw_id` | `uuid` PK | |
| `source_key` | `text` FK | |
| `entity_type` | `text` | |
| `external_id` | `text` | The vendor's own ID, kept verbatim |
| `payload` | `jsonb` | The complete API response object |
| `fetched_at` | `timestamptz` | |
| `run_id` | `uuid` FK | — `sync_run`, so any row is traceable to its run |

Index on `(source_key, entity_type, external_id, fetched_at DESC)` to get the latest version of any object cheaply.

---

## 6. Layer 2 — Staging

One table per source entity, typed but not yet conformed. Representative examples:

- `stg_asana_project`, `stg_asana_task`, `stg_asana_user`
- `stg_tt_time_entry`, `stg_tt_project`, `stg_tt_user`
- `stg_samdock_deal`, `stg_samdock_company`, `stg_samdock_user`
- `stg_factorial_employee`, `stg_factorial_work_hours`, `stg_factorial_absence`

Each keeps `external_id` as its primary key and carries the source's foreign keys as `*_external_id` text columns — because at this layer we still don't know who anyone *is*. Resolution happens next.

Staging is idempotent: re-running a sync upserts on `external_id` and produces no duplicates.

---

## 7. Layer 3 — Identity resolution

**This is the hardest correctness problem in the project, and the most likely source of "the numbers look wrong" during UAT. Budget real time for it.**

### 7.1 The problem

One person exists three times:

| System | ID | Email |
|---|---|---|
| Asana | `1204...` | `anna.schmidt@hs-experts.com` |
| TrackingTime | `88231` | `a.schmidt@hs-experts.com` |
| FactorialHR | `4417` | `anna.schmidt@hsexperts.de` |

Different IDs, different email formats. Utilisation requires dividing her *billable hours* (TrackingTime) by her *available hours* (Factorial). If those two records aren't linked, the metric is wrong — and it will not throw an error. It will produce a plausible number.

The same problem applies to projects (an Asana project vs its TrackingTime counterpart, needed for budget-vs-actual) and clients (a Samdock company vs the client on a delivery project).

### 7.2 `person_identity_map`

| Column | Type | Notes |
|---|---|---|
| `map_id` | `uuid` PK | |
| `person_id` | `uuid` FK | — `dim_person` — the canonical identity |
| `source_key` | `text` | |
| `external_id` | `text` | |
| `external_email` | `text` | Kept for auditing a match after the fact |
| `match_method` | `text` | `email_exact`, `name_fuzzy`, `manual` |
| `confidence` | `numeric` | 0–1; anything below threshold goes to review |
| `valid_from` / `valid_to` | `date` | See §7.4 |
| `reviewed_by` | `uuid` FK | — `app_user_profile`, null if auto-matched |

Unique constraint on `(source_key, external_id, valid_from)`.

`project_identity_map` and `client_identity_map` follow the same shape.

### 7.3 `identity_review_queue`

Anything the matcher isn't confident about lands here for a human to resolve in the admin UI.

**The critical behaviour:** when a lookup misses, the row goes to the review queue — it is **not** written to a fact table with a guessed or null ID. A visible gap is recoverable. A confidently wrong number is not.

### 7.4 Effective dating

`valid_from` / `valid_to` exist because identities change:

- Someone leaves and their Asana seat is reassigned to a new hire
- A contractor becomes an employee and gets a fresh Factorial record
- A project is recreated in TrackingTime mid-flight after a mistake

Without effective dating, any of these silently rewrites historical utilisation. Last quarter's numbers would change after the fact, which destroys trust faster than almost anything else a BI tool can do.

### 7.5 Vendor-neutral CRM

`dim_pipeline_stage` holds **our** canonical stage vocabulary plus a per-source mapping:

| Column | Notes |
|---|---|
| `canonical_stage` | Our own taxonomy — the same regardless of CRM |
| `source_key` + `source_stage_name` | The vendor's name for it |
| `sort_order`, `default_probability` | For weighted pipeline |
| `is_won`, `is_lost` | Terminal-state flags |

`fact_deal` references `stage_id`. It never stores a vendor stage name.

**The test:** when you migrate to HubSpot, only the connector and the rows in `dim_pipeline_stage` change. Every view, metric, and dashboard is untouched.

**Side benefit worth naming:** the warehouse ends up holding continuous pipeline history across *both* CRMs. Neither Samdock nor HubSpot will give you that. The portal outlives the tools it reads from.

---

## 8. Layer 4 — Analytics core

### 8.1 Dimensions

#### `dim_person`

| Column | Type | Notes |
|---|---|---|
| `person_id` | `uuid` PK | |
| `full_name`, `primary_email` | `text` | |
| `department_id` | `uuid` FK | Nullable — not everyone sits in a department |
| `weekly_contract_hours` | `numeric` | From Factorial; denominator for utilisation |
| `employment_start` / `employment_end` | `date` | |
| `is_active` | `boolean` | |

#### `dim_department`

`department_id` PK, `name`, `head_person_id` FK — `dim_person`.

> ⚠️ **Circular reference.** `dim_person.department_id` — `dim_department`, and `dim_department.head_person_id` — `dim_person`. Both are nullable so it resolves, but seeding needs either deferred constraints or a two-step insert (people first with null department, then departments, then update). Know this before someone hits it mid-migration.

#### `dim_client`

`client_id` PK, `name`, `industry`.

#### `dim_project`

| Column | Notes |
|---|---|
| `project_id` PK | |
| `client_id` FK | Required |
| `owner_person_id` FK | Nullable |
| `status` | |
| `budget_hours`, `budget_amount` | **See §12.1 — sourcing these is an open risk** |
| `is_billable` | Internal projects exist and must not pollute utilisation |
| `start_date`, `end_date` | |

#### `dim_pipeline_stage`

See §7.5.

#### `dim_date`

`date_key` PK, `iso_week`, `month`, `quarter`, `year`, `is_working_day`.

A real date dimension rather than date arithmetic in every query. `is_working_day` encodes German public holidays and is what makes "available hours" correct without special-casing.

### 8.2 Facts

#### `fact_time_entry`

The most important table in the warehouse.

| Column | Notes |
|---|---|
| `time_entry_id` PK | |
| `person_id`, `project_id` FK | Both required |
| `task_id` FK | Nullable — not all time is logged against a task |
| `work_date` FK — `dim_date` | |
| `hours` | `numeric(6,2)` |
| `is_billable` | Drives every utilisation metric |
| `billable_rate` | **See §12.2** |
| `source_key` | Provenance, in case a second time system ever appears |

#### `fact_work_hours`

Per person, per day, from Factorial: `contracted_hours`, `worked_hours`, `absence_hours`, `absence_type`.

This is the denominator side of utilisation. Without it you can only compute "hours logged", not "hours logged *versus what was available*" — and the second is the number leadership actually wants.

#### `fact_task`

Asana tasks: `project_id`, `assignee_person_id`, `name`, `status`, `due_date`, `completed_date`.

#### `fact_deal`

| Column | Notes |
|---|---|
| `deal_id` PK | |
| `client_id` FK | |
| `owner_person_id` FK | Nullable |
| `stage_id` FK | — `dim_pipeline_stage` |
| `project_id` FK | **Nullable — the sold-vs-delivered link, see below** |
| `amount`, `currency`, `probability` | |
| `created_date`, `expected_close_date`, `closed_date` | |
| `outcome` | `open`, `won`, `lost` |

**On `project_id`:** linking a won deal to its delivery project is what enables *sold vs delivered* — hours quoted against hours actually logged. It probably isn't in the first dashboard, but wire it while the model is being built rather than retrofitting it later.

---

## 9. Layer 5 — App, auth & audit

### `app_user_profile`

Extends Supabase `auth.users`.

| Column | Notes |
|---|---|
| `user_id` PK FK | — `auth.users.id` |
| `person_id` FK | Nullable one-to-one — `dim_person` |
| `role_key` FK | — `app_role` |
| `department_id` FK | Scope for department-head role |
| `is_active` | |

> **Decision needed:** `person_id` is currently optional, because an admin account might not be an employee and an employee might have no login. If every portal user *must* correspond to a real person in Factorial, tighten it to required and eliminate a class of orphan record.

### `app_role` / `role_permission`

Roles: `exec`, `dept_head`, `project_manager`, `employee`. `role_permission` maps a role to a `resource` and a `scope` (`all`, `department`, `own`), which is what RLS policies read.

### `audit_log`

`user_id`, `action`, `entity_kind`, `entity_id`, `before_value` / `after_value` (jsonb), `occurred_at`.

### `notification`

`user_id`, `kind`, `title`, `body`, `is_read`, `created_at`.

---

## 10. Referential integrity

Delete behaviour is deliberately not uniform. Three patterns:

### RESTRICT — on dimension references from facts

`fact_time_entry.person_id`, `fact_time_entry.project_id`, `fact_deal.stage_id`, and similar.

You should not be able to delete a person who has logged hours. The history has to remain valid. If someone leaves, set `is_active = false` — don't delete the row.

### CASCADE — on true ownership

Identity map rows, `sync_cursor`, `raw_record`, `role_permission`, `notification`.

These have no meaning without their parent. A `sync_cursor` for a deleted source is garbage.

### SET NULL — on soft references

`dim_project.owner_person_id`, `fact_task.assignee_person_id`, `fact_deal.owner_person_id`, `audit_log.user_id`.

When someone leaves the company, the deal, the task, and the audit trail all survive without them. Losing the deal because the salesperson left would be absurd.

The complete list of all 31 foreign keys is in Miro frame 7.

---

## 11. Cross-cutting concerns

### 11.1 Indexes

Beyond primary keys:

- `raw_record (source_key, entity_type, external_id, fetched_at DESC)`
- `fact_time_entry (person_id, work_date)` — the utilisation query
- `fact_time_entry (project_id, work_date)` — the burn query
- `fact_work_hours (person_id, work_date)`
- `fact_deal (stage_id)`, `fact_deal (expected_close_date)`
- `person_identity_map (source_key, external_id)` — hit on every transform

### 11.2 Row-level security

RLS is enforced on the analytics tables, scoped by `app_user_profile`. **Filtering in the UI is presentation, not security.**

| Role | Scope |
|---|---|
| `exec` | Everything |
| `dept_head` | Own department — see the privacy note below |
| `project_manager` | Projects they own |
| `employee` | Rows where `person_id` matches their own profile |

> ⚠️ **Privacy gate.** Working hours and absences from Factorial are sensitive HR data. Whether a department head sees individual-level hours or team aggregates only is a **policy decision, not a technical one**. It needs a written answer covering lawful basis, retention, and deletion on offboarding before the RLS policies are written. Consider a minimum group size before showing an aggregate, so a "team of two" view isn't de-anonymising by arithmetic.

### 11.3 Refresh strategy

Materialise expensive metric views; refresh on sync completion, not on page load. Every dashboard tile exposes the `finished_at` of the sync that fed it.

### 11.4 Data quality checks

Run after each sync, surfaced on the admin page:

- Rows in `identity_review_queue` older than N days
- Time entries whose `work_date` falls outside the person's employment dates
- Projects with logged hours but no `budget_hours`
- Deals in a non-terminal stage past `expected_close_date`
- `sync_run` rows where `rows_fetched` and `rows_upserted` diverge materially

---

## 12. Open questions and assumptions

These are assumptions the model currently rests on. Each needs an answer in Sprint 0.

### 12.1 Does TrackingTime expose project budgets via API?

**Highest-impact unknown.** If it does not, `dim_project.budget_hours` has to be maintained inside the portal, which means building a whole project-admin surface — a material scope increase. Check this first.

### 12.2 Where does `billable_rate` come from?

Per person, per project, or per contract? It currently sits on the time entry, which is the most flexible option but needs a source. If rates are commercially sensitive, it also needs its own RLS treatment.

### 12.3 Currency

`fact_deal.currency` is modelled. If you only trade in EUR, drop it rather than carry dead complexity and a future multi-currency conversation nobody asked for.

### 12.4 Lexoffice is not in this schema

Invoicing appears in your Automation Portal flow but isn't modelled here. Without it you get *sold* and *delivered*, but no *invoiced* leg — so no revenue recognition and no answer to "did we bill what we delivered?" Decide whether it's v1 scope.

### 12.5 The Google Sheet

The Tally-form flow writes to a shared Google Sheet that is acting as a data store today. Does the portal read it, replace it, or ignore it? This also affects where identity mapping should hook in — if customers are created in Asana and TrackingTime at the same handover step, that's the natural moment to *write* the mapping rather than reconcile it afterwards.

### 12.6 Samdock API maturity

Smaller vendor, thinner API surface than HubSpot. If the API turns out to be inadequate, that's a strong argument for either skipping CRM in v1 or accelerating the HubSpot migration rather than building a connector with a known expiry date.

---

## 13. What this schema deliberately does not do

**No type-2 slowly changing dimensions** on `dim_project` or `dim_client`. If a project is renamed, history shows the new name. This is normally fine and avoids real complexity — but flag it if anyone asks for point-in-time reporting ("what did the pipeline look like on 1 March?").

**No `fact_invoice`.** See §12.4.

**No forecasting or ML.** Weighted pipeline is arithmetic on `probability`, not a model. Say so plainly to anyone who calls it a forecast.

---

## 14. Glossary

| Term | Meaning here |
|---|---|
| **Available hours** | Contracted hours minus absences, on working days |
| **Billable ratio** | Billable hours ÷ total logged hours |
| **Utilisation** | Billable hours ÷ available hours |
| **Burn rate** | Hours consumed per week against a project budget |
| **Weighted pipeline** | Σ (deal amount × stage probability) for open deals |
| **Conformed** | Reshaped into our canonical model, source-agnostic |
| **Canonical ID** | Our own `person_id` / `project_id` / `client_id` — never a vendor's |
