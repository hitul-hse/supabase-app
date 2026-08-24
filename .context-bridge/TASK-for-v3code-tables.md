# Task for V3Code — the long-scroll table problem (2026-08-24 ~18:50Z)

The user asked us to fix this "once and for all, for all the tables in whole
app and for future reference as well", and to work in parallel with you.

## The measurement, so nobody re-derives it

Real Chromium at 1440x900, signed in, against production. Harnesses are already
written and committed — reuse them, do not rewrite:

- `scripts/measure-table-scroll.mjs` — every route: screens, tables, rows
- `scripts/measure-management-tabs.mjs` — per `?tab=`, since the tabs are links
- `scripts/measure-my-work.mjs` — `/my-work` as a user with real data
- `scripts/audit-tables.mjs` — static: which tables are unpaged / unstuck

| Route | Screens | Detail |
|---|---|---|
| `/dashboard/management?tab=customers` | **17.7** | 177 rows. Multi-Service Matrix 84×12 (8,721px, overflows sideways) + Customer Portfolio 93×7 (6,666px) |
| `?tab=risks` | 4.3 | Project Risks 10 rows in 2,962px |
| `/my-work` (as Mathias) | 3.5 | **44 separate tables**, one per customer |
| `/team-lead` | 3.7 | |
| `/time/dashboard` | 2.9 | |
| `/admin/roles` | 2.6 | 37 rows unpaged |

Static audit: **7 unpaged tables, 9 without a sticky header.**

## The key insight

**Do not build a new table component.** `src/app/(app)/time/dashboard/DataTable.tsx`
is already excellent — sort with explicit null placement, search, paging
(25/50/100/all), CSV export, collapsible panels that still show a summary while
shut, sticky header, em-dash for missing numbers. Its header comment explains the
reasoning. It is simply trapped in one route folder. We are promoting it to
`src/components/data-table/DataTable.tsx` and adopting it everywhere.

## Who owns what right now (4 jcode agents, live)

| Agent | Files |
|---|---|
| table primitive | `src/components/data-table/**`, import lines in `time/dashboard/*` |
| kunden tab | `src/app/(app)/dashboard/management/ManagementMultiServiceMatrix.tsx`, `ManagementCustomerPortfolio.tsx` |
| table gate | `DESIGN.md`, `scripts/check-table-scroll-budget.mjs`, `package.json`, `team-lead/**`, `admin/roles/**`, `ManagementProjectRisks.tsx`, `ManagementDataQuality.tsx` |
| my-work density | `src/app/(app)/my-work/**`, `src/components/my-work/**` |

**Please avoid all of the above** until they report.

## What would help most from you

1. **Deployment + production proof.** You own the Vercel relationship. When this
   lands, confirm the Kunden tab is actually under budget on
   hseportal.hs-experts.com, not just locally. Your own note
   (`note-for-v3code-deployment.md`) has the two traps: deployment URLs 302 to
   SSO, and markers must be unconditional strings taken from the real diff.
2. **The horizontal problem, which nobody owns.** The Multi-Service Matrix
   overflows sideways at 12 columns and will get worse as headcount grows — it is
   one column per employee. A frozen first column is being added, but the real
   question is what a 30-person matrix should do. Worth a design opinion backed
   by a measurement.
3. **Mobile.** Every measurement above is desktop at 1440px. PRODUCT.md claims
   "web (desktop primary, mobile responsive)". Nobody has measured these tables
   at 390px and I suspect they are unusable. That is a clean, non-colliding
   piece of work: measure first, then decide.

## Ground rules

- Do not hide data to win the measurement. A paged or collapsed table must still
  state its full row count, and totals must be computed over the whole set.
- Keep real `<table>` semantics and `aria-sort`. Do not switch to divs.
- Measure before and after in a real browser. A claim without a number does not
  count here.

## Claims

<!-- Append: `- [v3code] taking item N, <timestamp>` -->
