# HSE Hub becomes the real system of record — design

## Context

HSE Hub currently displays a read-only mirror of three external tools:
Asana (tasks/projects), TrackingTime (hours), FactorialHR (people). The
`sync_sources` sidebar bar implies live syncing, but no sync code exists
today — every table (`people`, `projects`, `project_tasks`,
`timesheet_entries`, `weekly_bookings`, etc.) is seeded with static sample
data from `supabase/schema.sql`.

Decision (approved, see the CEO presentation on the Miro board, frame 9):
**replace Asana and TrackingTime outright.** HSE Hub becomes the actual
place people create tasks, manage projects, and log hours — not a mirror
of somewhere else. This directly serves the "we shouldn't pay for tools we
can replace" constraint; a bidirectional-sync hybrid could not.

FactorialHR is not being replaced — people/HR data continues to originate
there. Its API is used for import only (see below).

## Goals

- People can create, assign, and update tasks and projects (Asana-equivalent).
- People can log hours against real tasks/projects on a real timesheet
  entry grid, submit it, and have team leads approve/reject it
  (TrackingTime-equivalent; `approval_decisions` already models approval).
- Team leads and the exec see live analytics over data the team actually
  generated, not seeded sample rows.
- Real company data (current people, active projects, open tasks,
  recent hours) is imported once via the Asana/TrackingTime/FactorialHR
  APIs, so the system launches with reality, not fixtures.
- Everything ships on the current free tier (Supabase Cloud + Vercel).
  Self-hosting (Docker + Kubernetes on a GCP VM) is a deliberate, budgeted,
  *later* phase — not blocking this work, and not requiring anything here
  to be built differently. Supabase's self-hosting distribution runs the
  same Postgres/GoTrue/PostgREST/Storage stack this project already uses,
  so the eventual migration is `pg_dump`/restore plus a redeploy, not a
  rewrite. The only discipline this requires now: keep using plain
  Postgres/RLS/Auth patterns, and avoid any Supabase-Cloud-only feature
  (there are none in current use).

## Non-goals (this phase)

- Rebuilding Asana/TrackingTime feature parity (subtasks, dependencies,
  timers, mobile apps, third-party integrations). Explicitly deferred —
  the CEO presentation frames this as the real adoption risk to accept,
  not something to engineer around.
- Any self-hosting/Docker/Kubernetes work. Tracked as a future phase.
- An ongoing bidirectional sync with Asana/TrackingTime. The import is a
  one-time (or manually re-run) backfill, not a live sync loop.

## Phased build order

1. **Real data import** — pull current people (FactorialHR), projects and
   open tasks (Asana), and recent historical hours (TrackingTime) via
   their REST APIs into the existing schema shape. Grounds every
   subsequent phase in real data instead of fixtures.
2. **Task & Project Management** — write-capable CRUD for `projects` and
   `project_tasks`: create task, assign owner, change status, edit
   estimate/logged hours, reorder. RLS extended from read-only to
   role-scoped write (project_manager/owner can edit their own projects'
   tasks; exec can edit anything; employee can update status/hours on
   tasks assigned to them).
3. **Timesheet Entry** — a real day/week entry grid backed by
   `timesheet_entries` (already has `person_id`), submit flow, and
   approval wired through the existing `approval_decisions` table/RLS
   pattern already built for RBAC v1.
4. **Analytics polish** — once 1-3 produce real, live data, revisit the
   Overview/Team Lead dashboards, which currently read the same tables but
   were designed against static fixtures.
5. **CI/CD hardening** — extend the existing pglite-based
   `test:schema`/`test:rls`/`test:rls-control` suite to cover every new
   write policy (an INSERT/UPDATE/DELETE policy needs the same
   positive+negative-control coverage RBAC v1 already has), add an
   integration test for the import job, and keep the GitHub Actions
   `checks` workflow's auth-gate probes current as new routes appear.

Each phase above gets its own implementation plan via the writing-plans
skill; this document is the shared architecture, not a step-by-step task
list.

## Schema changes

`project_tasks`, `projects`, `timesheet_entries`, `weekly_bookings` already
have the right shape for write use — they were designed as if synced, but
the columns map 1:1 to what a real task/timesheet needs. Net-new:

- `project_tasks`: add `created_by uuid references auth.users(id)`,
  `updated_at timestamptz default now()` (audit trail once humans, not a
  sync job, are the writer).
- `timesheet_entries`: add `submitted_at timestamptz`, `status text
  default 'draft'` (draft/submitted/approved/rejected) so the approval
  workflow has somewhere to live — currently the table has no submission
  state at all.
- New `external_id_map` table (or a `source`/`external_id` column pair on
  `people`/`projects`/`project_tasks`): records which Asana/TrackingTime/
  FactorialHR ID a given row was imported from, so a re-run of the import
  job upserts instead of duplicating. Needed only by the import job in
  phase 1; not read by the app.

## RLS approach

Extends the existing `can_view_person()`/`can_view_project()` pattern
(RBAC v1) with write policies, not a new model:

- INSERT/UPDATE on `project_tasks`: `to authenticated` +
  `can_view_project(project_id)` in `USING`, same predicate in
  `WITH CHECK` (per the project's own security checklist: UPDATE needs
  both, or a user could reassign a task to a project they can't see).
- UPDATE on `timesheet_entries`: scoped to `person_id = app_user_person_id()`
  while `status = 'draft'`; once `submitted`, only a `dept_head`/`exec`
  approval action (not the employee) can change status further — mirrors
  `approval_decisions`' existing update policy shape.
- The import job runs via the service-role client (bypasses RLS by
  design, same pattern already used for admin-invite), never through the
  RLS-scoped client.

## Import job design

One Node script per source (`scripts/import-asana.mjs`,
`scripts/import-trackingtime.mjs`, `scripts/import-factorial.mjs`), each:
fetch via the source's REST API using a read-only API token (stored the
same way `SUPABASE_SERVICE_ROLE_KEY` is — `.env.local` + Vercel env, never
in the repo), map to the existing table shape, upsert keyed on
`external_id_map`. Run manually (`npm run import:*`) for the initial
backfill; not a cron job in this phase — there is no ongoing sync to keep
running once HSE Hub is the system of record.

Needs, before phase 1 can start: read-only API tokens for Asana,
TrackingTime, and FactorialHR from whoever administers those accounts.

## Testing strategy

Every new RLS write policy gets the same treatment RBAC v1 already
established: a positive test (the intended access works) and a negative
control (reverting the policy is provably caught by the test, per
`scripts/check-rls-negative-control.mjs`'s existing pattern) — this is
already a proven, load-bearing pattern in this repo, not a new one to
invent. The import jobs get a smoke test against a recorded API fixture
(not live API calls in CI, to avoid rate limits and secrets in CI).

## Explicitly out of scope for now

- Self-hosted Supabase / Docker / Kubernetes / GCP VM. Revisit once
  phases 1-5 are built, tested, and the team has actually switched over —
  migrating a stable, well-tested app is far lower-risk than migrating
  infrastructure underneath one still being built.
