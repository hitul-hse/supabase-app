# HSE Hub — Product Context

## Product Name
HSE Hub

## Tagline
Operations. Unified.

## What it is
An internal BI and operations portal for **HSE Health & Safety Experts GmbH** — a German HSE consulting firm. The product aggregates four external SaaS systems (Asana, TrackingTime, Samdock CRM, FactorialHR) into a single role-gated dashboard, replacing hours of manual spreadsheet consolidation each week.

## Who uses it
- **Executives (exec)** — full data access, KPI overview, approve/reject workload decisions
- **Department heads (dept_head)** — own department's people, projects, timesheets
- **Project managers (project_manager)** — own projects and the people assigned to them
- **Employees (employee)** — own timesheets and profile only

## Core jobs to be done
1. See billable utilisation, headcount, and active project counts at a glance — no manual collation
2. Book and approve workload across the team for 4-week rolling windows
3. Browse and export timesheet entries per person per week
4. Manage user accounts, roles, and fine-grained RBAC permissions without touching code
5. Know how fresh the synced data is at all times (SyncBar shows last-sync per system)

## Success metrics
- < 5 minutes to get a weekly status read on the whole team
- Zero manual data entry for time tracking or project status
- Every user sees only what their role permits (enforced at DB level via RLS)

## Tech stack
- **Frontend:** Next.js 15 App Router, React 19, Tailwind CSS, Framer Motion
- **Backend/DB:** Supabase (PostgreSQL 15, Row-Level Security, Edge Functions)
- **Auth:** Supabase Auth (email/password + magic link)
- **Deployment:** Vercel (production domain: hseportal.hs-experts.com)
- **CI:** GitHub Actions (lint → tsc → build → db-tests on every PR)
- **Connectors:** Asana API, TrackingTime API, Samdock CRM API, FactorialHR API

## Design mode
**Operate** — users are completing real tasks inside a professional tool. Brand lives in precise, confident details; scanability and data density outrank expression. The demo/marketing page is **Persuade** mode.

## Platforms
Web (desktop primary, mobile responsive)

## Constraints
- All data joins go through canonical identity maps — never on source-system native IDs
- RLS enforced at DB level; UI just mirrors what the DB returns
- No PII in logs or error messages
- German company — data residency in EU (Supabase Frankfurt region)
