# HSE Platform — Bridge Portal & Module Architecture

Companion to [HSE-HUB-PORTAL.md](./HSE-HUB-PORTAL.md), which stays the authority on the warehouse,
identity resolution and dashboard design. This document covers the layer above it: **how the four
tools become one platform**, how people sign in once, and how we stay portable enough to move off
hosted Supabase onto our own infrastructure without a rewrite.

Status: **proposal for review.** Nothing here is built yet. Sections marked ⚠️ need a decision from
you before the work they describe can start.

---

## 1. The shape of the platform

Today HSE Hub is one app doing two jobs: it is both the *system of record* for projects, tasks,
timesheets and leave, **and** the analytics portal on top of them. That works at the current size and
will not keep working — every new module makes the schema, the RLS surface and the test suite grow in
one undifferentiated mass.

The target shape separates those two jobs:

```
                          ┌──────────────────────────────┐
                          │      BRIDGE PORTAL           │
                          │   portal.hs-experts.com      │
                          │                              │
                          │  One sign-in. Google /       │
                          │  Microsoft / password.       │
                          │  Then choose your tool.      │
                          └──────────────┬───────────────┘
                                         │
        ┌────────────────┬───────────────┼───────────────┬────────────────┐
        ▼                ▼               ▼               ▼                ▼
  ┌───────────┐   ┌───────────┐   ┌───────────┐   ┌───────────┐   ┌──────────────┐
  │  PROJECTS │   │   TIME    │   │    HR     │   │    CRM    │   │   HSE HUB    │
  │           │   │           │   │           │   │  (later)  │   │              │
  │ projects  │   │ clock in/ │   │ holidays  │   │ deals,    │   │ ANALYTICS    │
  │ tasks     │   │ out, hrs  │   │ sick días │   │ pipeline  │   │ ONLY         │
  │ boards    │   │ billable  │   │ contracts │   │           │   │              │
  │ milestones│   │ services  │   │ jobs      │   │           │   │ read-only    │
  │           │   │ calendar  │   │ clocking  │   │           │   │ across all   │
  │ ← Asana   │   │ ← TrackT. │   │ ← Factor. │   │ ← Samdock │   │              │
  └─────┬─────┘   └─────┬─────┘   └─────┬─────┘   └─────┬─────┘   └──────▲───────┘
        │               │               │               │                │
        │               │               │               │                │
        └───────────────┴───────────────┴───────────────┴────────────────┘
                     all write into the same warehouse; Hub only reads
```

**The division of responsibility that makes this work:**

| | Operating modules | HSE Hub |
|---|---|---|
| Who uses it | everyone, daily | CEO, team leads |
| Reads | own module's data | every module |
| Writes | own module's data | **nothing** except approvals & decisions |
| Optimised for | speed of entry | speed of comprehension |
| Failure mode | a colleague can't log time | a manager sees a stale number |

Hub becoming read-only is the single most valuable constraint in this whole document. It means Hub can
never corrupt operational data, its RLS surface is `SELECT`-only, and it can be rebuilt or replaced
without touching anything people depend on to do their jobs.

The one deliberate exception is **decisions**: approving overtime, approving leave, acknowledging a
budget overrun. Those are managerial acts that belong where the manager already is. They write to
`decisions.*` (see §4), never directly into a module's own tables — the module reads the decision and
applies it. That keeps the write path owned by exactly one module.

---

## 2. ⚠️ The decision everything else depends on

**One Supabase project with a schema per module — not four separate projects.**

This is the fork in your plan and it is worth being explicit, because it is expensive to reverse.

I recommend **one project, many schemas**, and I want to give you the reasoning rather than just the
answer:

**Why not four projects:**

- **It breaks Hub.** Hub's entire purpose is cross-system analytics: hours logged (Time) against budget
  (Projects) for a person who was on leave (HR). Across separate Supabase projects those are separate
  Postgres instances — you cannot write a SQL join. You'd need a fifth ETL pipeline copying data between
  projects over the network, which reintroduces exactly the sync-lag and identity-drift problems the
  warehouse exists to eliminate.
- **It breaks single sign-on.** `auth.users` is per-project. Four projects means four user tables, four
  invite flows, four password resets, and a "bridge portal" that is really just a page of links to four
  separate logins. The bridge concept only means something if the session carries across.
- **It multiplies the security surface** you have to get right — 4× the RLS policies, 4× the helper
  functions, and no single place to answer "what may this person see?"
- **It makes the GCP migration harder, not easier.** One `pg_dump` versus four, one connection string
  versus four, one set of secrets.

**Why one project with schemas is not a compromise:**

- Postgres schemas are a real isolation boundary — separate namespaces, separate grants, separate
  migration files. `time.entry` and `projects.task` cannot collide.
- Supabase supports per-query schema selection: `supabase.schema('time').from('entry')`. Each module's
  server code gets a client pinned to its own schema, so a module *cannot* accidentally read another's
  tables even by typo.
- Cross-schema joins are ordinary SQL, so Hub's analytics views stay simple and fast.
- **This is already the agreed design.** `HSE-HUB-PORTAL.md` §"Naming conventions" specifies "separate
  Postgres schemas per layer". This extends that same decision from layers to modules.

**Proposed schema layout:**

| Schema | Owns | Written by |
|---|---|---|
| `platform` | people, departments, roles, permissions, audit, notifications | bridge portal + admin |
| `projects` | projects, tasks, sections, milestones, comments | Projects module |
| `time` | time entries, timers, services, billable rates, approvals | Time module |
| `hr` | leave, absences, contracts, clocking, job postings | HR module |
| `crm` | deals, pipeline stages, companies | CRM module (later) |
| `raw` | verbatim vendor JSON, append-only | connectors only |
| `stg` | typed/deduped per-source staging | transform jobs only |
| `analytics` | conformed dims/facts + metric views | transform jobs; Hub reads |
| `public` | kept for what's already there, then drained | — |

Two rules that keep this honest:

1. **`platform.person` is the only place a human is defined.** Every module references
   `platform.person.person_id`. No module keeps its own copy of a colleague.
2. **No module reads another module's schema directly.** If Projects needs to know someone is on leave,
   it reads an `analytics` view or a published function — not `hr.leave_request`. This is what lets us
   change `hr` internals without breaking Projects.

⚠️ **I need your decision on this before writing any DDL.** If you specifically want separate projects
for billing, blast-radius or team-boundary reasons that I'm not seeing, say so — it's a legitimate
choice, it just costs Hub the ability to join, and we'd need to design around that explicitly.

---

## 3. Sign-in: one identity, several ways to prove it

You have a real constraint here that shapes the design: **Asana seats are Microsoft accounts,
TrackingTime is Google.** So the same colleague may arrive with either, and they must land on the same
account rather than creating two.

Supabase Auth handles this natively, and I verified the mechanics rather than assuming:

- **Automatic identity linking** joins identities that share a **verified** email address to one
  `auth.users` row. Sign in with Microsoft on Monday and Google on Tuesday, same email → one user, two
  linked identities. ([Supabase docs — Identity Linking](https://supabase.com/docs/guides/auth/auth-identity-linking))
- The verified-email requirement is a security feature, not an obstacle: linking on an *unverified*
  address would allow pre-account-takeover, so Supabase refuses. Both Google and Microsoft return
  verified emails for managed workspace accounts.
- **SAML SSO accounts are excluded from linking.** If you later move to Entra ID SAML SSO rather than
  Azure OAuth, linking stops applying and identity has to be handled at the IdP. Worth knowing before
  choosing SAML.

**What this means concretely:**

```
Colleague opens portal.hs-experts.com
        │
        ├── "Continue with Microsoft"  ─┐
        ├── "Continue with Google"     ─┼──▶ one auth.users row
        └── email + password           ─┘    (identities linked on verified email)
                                              │
                                              ▼
                                     platform.app_user_profile
                                       role, department, person_id
                                              │
                                              ▼
                              module tiles, shown by permission
```

Three things to get right:

1. **Domain allow-list.** OAuth alone would let *any* Google account in. The callback must reject any
   email outside `hs-experts.com` (and whatever domains you actually use — `hsexperts.de` appears in the
   identity-resolution examples, so there may be more than one).
2. **Provisioning is not authentication.** A successful Google sign-in proves who someone is, not that
   they work here. First sign-in should create a profile in a **pending** state with no module access
   until an admin assigns a role — the `/access-pending` route already exists for exactly this.
3. **Guest Asana licences.** You mentioned paid seats plus guests. Guests likely should *not* get portal
   accounts; if any do, they need a role with a much narrower permission set than `employee`.

⚠️ **Questions I need answered:** which email domains are legitimate? Should guests get accounts at all?
And is Microsoft here Entra ID (Azure AD) or personal Microsoft accounts — it changes the app
registration.

---

## 4. Permissions: extend what exists, don't rebuild it

The `app_permission` / `app_role_permission` tables already built for `/admin/roles` are the right
foundation, and they extend to modules cleanly by making the permission key carry the module:

```
module : resource : action
─────────────────────────
projects : task     : write
time     : entry    : approve
hr       : leave    : approve
hub      : dashboard: read_all
platform : user     : invite
```

`app_user_has_permission('time:entry:approve')` already works — no function change, just more rows.
Module visibility on the bridge portal then falls out of the same data: a module tile is shown if the
user holds any permission whose key starts with that module's prefix. **No hard-coded tile list.**

Two additions the current model needs:

- **`platform.decision`** — the write surface Hub is allowed to touch. One row per managerial act
  (`kind`, `subject_ref`, `outcome`, `decided_by`, `decided_at`, `note`). Modules react to decisions;
  Hub never writes into module tables.
- **Scope, not just capability.** `time:entry:approve` says *may approve* — it doesn't say *whose*. Scope
  (own / department / all) already lives on `app_user_profile` via `app_user_department()`, and the RLS
  policies must keep enforcing it. A permission key alone is not authorisation.

**⚠️ Blocking item, unchanged from the last audit:** `supabase/migrations/add_permission_system.sql` has
never been applied to the live database. `app_permission`, `app_role_permission` and
`app_user_has_permission()` all 404 there, so `/admin/roles` silently redirects everyone home. The whole
permission model above assumes those objects exist. **This needs running in the SQL Editor before any
module work starts** — and the migration should be folded into `schema.sql` so a fresh environment
cannot miss it again.

---

## 5. Connectors: learn from the vendor, then own the data

Your instinct to pull real data *before* designing the schema is the right one, and it's worth naming
why: every one of these APIs has fields the docs under-describe, enums that aren't documented at all,
and nullability that only shows up in real records. Designing a schema from documentation and then
meeting the data is how you end up with a migration in week three.

So each integration runs in three stages:

**Stage 1 — Discover (needs only a read-only key).** Call every relevant endpoint, save raw JSON,
generate a field inventory: every path, its inferred type, null rate, distinct-value count, and example
values. Output is a report, not a schema. `scripts/discover/` is built and waiting (§7).

**Stage 2 — Model.** Design `stg_*` from the *observed* shape, then map into `analytics`. Ambiguities go
to the review queue, never to a guess — the existing rule from `HSE-HUB-PORTAL.md` holds:
*never join on a source system's native ID.*

**Stage 3 — Own.** Once our module is authoritative, the connector's direction reverses: it stops being
an import and becomes either a one-time migration or a two-way sync during a transition window.

### Verified API facts

Researched, not assumed — these drive the connector design:

| | Auth | Limits | Notes |
|---|---|---|---|
| **Asana** | PAT (start) or OAuth | **1,500 req/min** on paid domains (150 free); search **60/min**; **50** concurrent GET, 15 concurrent write; plus a cost limiter on wide `opt_fields` | You're paid, so volume is comfortable. Use `limit=100` and narrow `opt_fields`. Webhooks over polling. **A dedicated token per integration** — limits are per token. ([docs](https://developers.asana.com/docs/rate-limits)) |
| **TrackingTime** | App Password (not the login password) or OAuth | not published | `https://api.trackingtime.co/api/v4/...`. The `events/flat` endpoint is the bulk read used by their own Power BI integration — likely our best sync surface. Google Calendar events surface here too. |
| **Factorial HR** | API key, created by an admin under Configuration → API | not published | Also offers OAuth. HRIS payloads are wide and change between plans — Stage 1 matters most here. |
| **Samdock** | TBD | TBD | Lowest priority; `dim_pipeline_stage` already keeps CRM vendor-neutral, so this slot is cheap to fill later. |

Where a vendor doesn't publish limits, the connector treats it as strict: conservative concurrency,
`Retry-After` respected, exponential backoff, and every run logged to `sync_run` so we can see real
throughput and tune from evidence.

⚠️ **Two things to confirm:** does TrackingTime expose **project budgets** via API (already flagged as
Sprint-0 question 1 — if not, budgets must be maintained in the portal, which is a whole admin surface);
and are Google Calendar events reachable through TrackingTime's API or only in their UI?

---

## 6. Portability: assume we move to GCP

You want the option to self-host on a GCP VM with Docker, and possibly Kubernetes. That option stays
open only if we avoid hosted-Supabase lock-in deliberately, from the start. Concretely:

**Safe to rely on** — these are just Postgres, and move with a dump:
schemas, tables, views, functions, **RLS policies**, triggers, extensions.

**Portable, but needs config on the new host:** GoTrue (Auth) and PostgREST both ship in the
self-hosted Docker Compose stack. OAuth providers are re-registered with new callback URLs. Manual
identity linking needs `GOTRUE_SECURITY_MANUAL_LINKING_ENABLED=true` — worth setting the same way in
both environments so behaviour doesn't differ.

**Avoid or isolate:**

| Risk | Rule |
|---|---|
| Dashboard-only configuration | Anything set by clicking in the Supabase dashboard is invisible to git and will be forgotten in a migration. Every schema object must exist in `supabase/`. Exposed-schema and Auth settings that *must* be dashboard-set go in a documented checklist. |
| Edge Functions (Deno) | Fine, but keep business logic in SQL or the Next.js app, not in a Deno runtime we'd have to replace. |
| Storage | If we add file uploads, put them in GCS (already configured) rather than Supabase Storage — one less thing to migrate. |
| `pg_cron` / `pg_net` | Available both places, but pin versions and note them. |
| Connection pooling | Hosted gives you Supavisor. Self-hosted needs PgBouncer/Supavisor stood up deliberately — a silent difference that shows up as connection exhaustion under load. |

**Recommended sequencing:** stay on hosted Supabase through module development, and make the *staging*
environment self-hosted-on-GCP first. That proves the migration path under real conditions while
production is still safe. Kubernetes only if you actually need multi-node — a single VM with Docker
Compose is much less to operate, and Postgres does not want to be a pod.

⚠️ **Worth deciding early:** is the driver for self-hosting cost, data residency, or control? Residency
would push toward doing it sooner (and picking `europe-west3`, Frankfurt); cost alone probably means
later.

---

## 7. Sequencing — what I'd build, in what order

Deliberately ordered so that nothing is built on an unverified assumption, and so the riskiest unknown
(real vendor data) is met early.

**Phase 0 — Foundations.** No new features.
- Apply the permission migration to live; fold it into `schema.sql`.
- Introduce the `platform` schema; move people/roles/permissions into it, leaving compatibility views so
  nothing breaks mid-move.
- Add Google + Microsoft OAuth with a domain allow-list and pending-provisioning.
- Stand up the bridge portal shell with permission-driven tiles.
- **Exit test:** a colleague signs in with Microsoft, then Google, and lands on **one** account — proven
  by a single `auth.users` row with two identities.

**Phase 1 — Discovery.** The moment keys arrive. Run the harness against all three APIs, produce field
inventories, and only then write the module schemas. Days, not weeks.

**Phase 2 — Time module first.** Deliberate choice: it's the highest-frequency daily interaction, its
data model is the best understood (timesheets already exist), and it feeds the metric everyone
cares about — utilisation. Shipping it first proves the platform shape with the least schema risk.

**Phase 3 — Projects module.** Larger surface (boards, tasks, milestones) and a partial head start from
the existing board work.

**Phase 4 — HR module.** Most sensitive data, so it goes after the permission model has been exercised
in anger by two other modules.

**Phase 5 — Hub as pure analytics.** Rebuild Hub to read only from `analytics`, add per-module
dashboards and the decision surface (approve overtime, upcoming birthdays, budget alerts).

**Phase 6 — CRM.** Only if Samdock/HubSpot is still wanted by then.

Two ordering principles worth stating: **each phase ends with a test gate that can fail** (the negative-
control discipline already used in `test:db`), and **no module ships without its RLS tested per role** —
existence of a policy is not proof it does the right thing.

---

## 8. Open questions

Grouped by what they block, so they can be answered in the order they matter.

**Blocks all DDL:**
1. One project with schemas, or four separate projects? (§2 — I recommend one.)
2. Can the permission migration be applied to live now?

**Blocks sign-in work:**
3. Which email domains are legitimate? (`hs-experts.com`, `hsexperts.de`, others?)
4. Microsoft = Entra ID (Azure AD) or personal accounts?
5. Do Asana guest licence holders get portal accounts?

**Blocks connectors:**
6. Does TrackingTime expose project budgets via API?
7. Are Google Calendar events reachable through TrackingTime's API?
8. Is Samdock still in scope, or is HubSpot the destination?

**Blocks hosting:**
9. Is self-hosting driven by cost, residency, or control?

**Blocks Hub design:**
10. How granular may Factorial hours be shown, and to whom? (Carried over from `HSE-HUB-PORTAL.md` — a
    policy question, not a technical one, and it changes what the dept-head dashboard may display.)

---

## 9. What this document deliberately does not decide

- **No UI design.** Bridge portal wireframes come after the module list is settled.
- **No KPI definitions.** `HSE-HUB-PORTAL.md` §4 already says run the workshop first; that still holds.
- **No estimates.** Phase 1 discovery will change them, so any number given now is fiction.
- **No connector code.** Only the discovery harness, which is safe to build because it makes read-only
  calls and assumes nothing about the shape of what comes back.
