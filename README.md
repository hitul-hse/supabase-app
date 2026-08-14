# supabase-app (HSE Hub)

A Next.js (App Router) frontend backed by Supabase (Postgres + Auth). Live at
https://supabase-app-olive.vercel.app and https://hseportal.hs-experts.com.

An internal BI portal for Health & Safety Experts GmbH, with role-based access
(exec / dept head / project manager / employee) enforced in Postgres via RLS,
not just hidden in the UI. The pages currently render seeded demo data with
the same shape the real thing will have — the intended production direction,
a real portal aggregating Asana, TrackingTime, Samdock and FactorialHR, is
documented in
[`docs/architecture/HSE-HUB-PORTAL.md`](docs/architecture/HSE-HUB-PORTAL.md)
(synced from the team's Miro architecture board), with the full warehouse
data-model reference in
[`docs/architecture/HSE-HUB-SCHEMA.md`](docs/architecture/HSE-HUB-SCHEMA.md).

## Stack

- **Next.js 16** (App Router, TypeScript, Tailwind CSS)
- **Supabase**: Postgres database, Auth, and RLS-enforced authorization —
  `@supabase/ssr` for the browser/server clients (see
  [`src/utils/supabase/`](src/utils/supabase/))
- **Vercel**: hosting/deployment

## Pages

| Route | What it does | Access |
| --- | --- | --- |
| `/` | Executive overview: KPI strip, billable/non-billable trend, utilisation by team, project ledger. | All roles |
| `/team-lead` | Workload/booking board and the pending-approvals queue. | exec, dept_head |
| `/people` | Searchable people directory with per-person assignments and qualifications. | All roles (RLS scopes which rows come back) |
| `/projects` | Project record: burn-down, tasks, milestones, contract/invoicing. | All roles (RLS-scoped) |
| `/timesheets` | Weekly timesheet grid. | All roles (own timesheet only, except exec/dept_head) |
| `/admin/users` | Invite accounts and assign roles/departments. | exec only |
| `/access-pending` | Shown to an authenticated user an admin hasn't provisioned yet. | Anyone logged in with no profile |

## Roles & access

See [`supabase/README.md`](supabase/README.md#roles--accounts) for the role
model and how accounts are provisioned — there's no public signup.

## Design system

All pages share a single dark theme, defined as CSS custom properties in
[`src/app/globals.css`](src/app/globals.css) (`--page`, `--surface`, `--border`,
`--text-primary/secondary/muted`, `--accent`, and status colors `--good`/`--warning`/`--critical`,
each with a `-wash` variant for subtle banner backgrounds). It's intentionally a single
committed theme rather than one gated behind `prefers-color-scheme` — with no in-app
toggle, gating on OS preference means visitors with a light-mode browser would see an
unintended light theme.

[`src/components/Sidebar.tsx`](src/components/Sidebar.tsx) (server component: brand,
role-aware nav via [`SidebarNav.tsx`](src/components/SidebarNav.tsx), and the signed-in
user/role footer) is rendered once in [`src/app/layout.tsx`](src/app/layout.tsx) so every
page gets consistent chrome. [`PageHeader.tsx`](src/components/PageHeader.tsx) and
[`SyncBar.tsx`](src/components/SyncBar.tsx) (a server component reading live
`sync_sources` rows) are shared across every HSE Hub page.

## Local setup

1. `npm install`
2. Copy `.env.local.example` to `.env.local` and fill in:
   - `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — from the
     Supabase dashboard: Project Settings → Data API / API.
   - `SUPABASE_SERVICE_ROLE_KEY` — same dashboard page, needed only for
     `/admin/users` to send invites (see `.env.local.example` for details).
3. Run the Supabase schema: see [`supabase/README.md`](supabase/README.md).
4. `npm run dev` → http://localhost:3000

## Supabase setup

Schema, RLS policies, and the role model are documented in
[`supabase/README.md`](supabase/README.md). The canonical schema lives in
[`supabase/schema.sql`](supabase/schema.sql) — run it once in the Supabase
SQL Editor against a fresh project.

RLS is enabled on every table; the anon/publishable key is safe to ship in
the frontend because RLS policies (not the key itself) control what it can
do. The `service_role` key is server-only (never `NEXT_PUBLIC_`-prefixed)
and is used in exactly one place — `/admin/users`' invite action.

## Deployment

Hosted on Vercel, project `hse-hub/supabase-app`.

```bash
npx vercel link --yes --project supabase-app   # one-time, already done
npx vercel env add <NAME> production           # set/update an env var
npx vercel deploy --prod --yes                 # ship the current code
```

Production env vars (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`) are set directly on Vercel and are **not**
derived from `.env.local` automatically — update both when a value changes.

The GitHub repo is connected to this Vercel project, so every push to
`master` auto-deploys to production — no manual `vercel deploy` needed.

## Working procedure

- Every change gets committed and pushed to
  [github.com/hitul-hse/supabase-app](https://github.com/hitul-hse/supabase-app)
  so GitHub reflects the actual state of the app.
- New/changed Supabase tables or policies get added to
  [`supabase/schema.sql`](supabase/schema.sql) (or documented as a one-off
  procedure in [`supabase/README.md`](supabase/README.md) if they're not
  meant to be re-run, like the `netflix_users` import).
- Pushing to `master` auto-deploys to production via the GitHub↔Vercel
  connection — no manual deploy step required.
