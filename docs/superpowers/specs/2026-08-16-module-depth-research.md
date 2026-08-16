# Module depth: research findings and build order

Date: 2026-08-16
Status: living document — updated as waves ship

## Why this exists

The first pass at replacing Asana / TrackingTime / FactorialHR produced working
but shallow features: a task list, a 4-column board, a weekly hours grid, an
org chart, a leave request form. Each was real and tested, but none was deep
enough to actually replace the tool it was modelled on.

This document records what the source products actually do — verified against
their own documentation, not from memory — and the order we close the gaps in.

## Research method and honesty note

Findings below were gathered by fetching vendor documentation directly. Where a
claim could not be verified from a primary source it is marked UNVERIFIED and
should not be treated as fact. Several planned research threads (Asana's help
centre, TrackingTime's own docs, FactorialHR's permission model) were cut short
by an API session limit and are listed under "Not yet researched" rather than
guessed at.

Vendor marketing claims about legal compliance are recorded as *claims*. Nothing
here is legal advice.

## What the source products actually do

### Time tracking (Toggl Track, Clockify, FactorialHR — all verified)

The gap between our weekly grid and a real time tracker is larger than the gap
in any other module.

**Tracking modes.** A grid is the *slowest* way to log time and the one most
prone to end-of-week guessing. Real trackers lead with a live timer, then offer
manual entry, a calendar drag-to-create, and (desktop only) background activity
timelines. Toggl's timer bar is a single always-present strip: description →
project → tags → billable toggle → duration → start/stop.

**Rates are hierarchical, most-specific-wins.** Both Toggl and Clockify
document five levels. Clockify's order: project-member → task → project →
member → workspace. Toggl's: task → project-member → project → workspace-member
→ workspace. We currently have exactly one level (person), which cannot express
"this consultant is billed at a different rate on this contract".

**Cost rate is separate from bill rate.** Revenue = billable hours × bill rate.
Cost = *all* hours × cost rate. Profit = revenue − cost. Clockify: cost rates
"are always applied, whether entry is billable or not". Without a cost rate the
system cannot answer whether a project made money — only what it invoiced.

**Budgets.** Hours budgets and fee budgets, manual or task-rolled-up, with
percentage alert thresholds and optional recurring reset for retainers. This is
the mechanism that catches overruns, which is the stated business pain.

**Approval states.** Unsubmitted → Pending → Approved/Rejected, plus
**Withdrawn**, with an archive kept for audit. Rejection **requires a note**.
Approval **locks** the period. Separately, a rolling **lock date** freezes
everything older than N days.

**Timesheet ergonomics worth stealing.** "Copy last week"; flexible duration
parsing (`1:30`, `1.5`, `90m`, `1h30m`); tab-across-the-week entry; row totals
and weekly targets; per-row billable/tag toggles.

### HR (FactorialHR — verified, German-language docs)

**Estimated vs actual (Soll/Ist) and Saldo.** Expected hours come from the
contract or an assigned work schedule; the balance is the difference. Approved
absence reduces expected hours rather than counting as a shortfall.

**Bank of hours (Stundenkonto).** `worked + paid leave − contract`, accrued
daily/weekly/monthly, with configurable carry-over or reset.

**Overtime compensation** routes three ways: into the hours bank, into a
time-off counter (Freizeitausgleich), or into payroll — with optional caps.

**Breaks.** Fixed, manual, or automatic; typed paid/unpaid; enforceable minimum
duration and work-duration→break-duration rules (the documented example is 30
minutes after 6 hours). Germany-only automatic timesheet correction exists.

**Project time is a parallel layer to attendance.** Factorial explicitly lets
employees log project time independently of clock-in/clock-out. That is an
architectural decision we should copy: attendance answers "were they working",
project time answers "what did we bill".

### German working-time recording (primary sources)

- **BAG 13.09.2022, 1 ABR 22/21**: employers are obliged under § 3 Abs. 2 Nr. 1
  ArbSchG to have a system that records working time. Per the written reasons,
  recording need **not** be electronic and **may be delegated** to the employee.
- **EuGH C-55/18 (CCOO)**: member states must require a system measuring daily
  working time.
- **§ 16 Abs. 2 ArbZG**: record time exceeding 8 hours per working day; retain
  **at least two years**.
- **BMAS (page dated 08.08.2025)**: Beginn, Ende und Dauer; no prescribed form;
  Vertrauensarbeitszeit remains permissible.
- A 2023 draft requiring *electronic, same-day* recording never became law; a
  further draft dated 18.06.2026 remains an internal working draft with no
  cabinet decision. **Nothing new is in force.**

Implication for us: storing real start/end timestamps (not just a daily total)
is the right shape. No verified statutory immutability requirement exists —
treat audit-trail work as good practice, not compliance.

UNVERIFIED: retention specifics beyond § 16 Abs. 2; any statutory right of the
employee to a copy of their own records (it was in the 2023 draft; DSGVO Art. 15
applies independently). § 26 BDSG's continued validity is genuinely contested
after EuGH C-34/21 — flagged, not resolved.

## Build order

Ranked by value to a 15–30 person consultancy that bills contracted hours.

### Wave 1 — Live timer ✅ shipped
One running timer per person, enforced by a partial unique index rather than
app code, because a double-clicked start button would otherwise double-count
every hour that followed. Persistent bar across all app pages. Elapsed duration
computed server-side from the stored `started_at`, so a wrong client clock
cannot inflate logged hours.

### Wave 2 — Budgets and margin ✅ shipped
Hours and fee budgets per project with a percentage alert threshold, a cost
rate per person, and a `project_budget_status` view deriving burn and margin.

Three asymmetries in that view are load-bearing:
- Only **approved** hours count. Draft and submitted time is still being
  argued about; billing off it would be guessing.
- **Revenue** counts only *billable* hours, at the project rate if one is set,
  otherwise the person's own rate.
- **Cost** counts *every* approved hour, billable or not, because people are
  paid for internal time too. A project can invoice well and still lose money;
  revenue alone hides that.

Rate resolution was trimmed to two levels (project, then person). The source
tools model five; project-member and per-task rates each cost a table and an
editor and buy very little at this company's size. Recorded here as a
deliberate trim rather than an oversight.

**Prerequisite fixed along the way**: `timesheet_entries` linked to projects by
*name only*. The schema already documented that exact pattern as a bug fixed
for `person_assignments` ("ambiguous across same-named projects and breaks
silently on rename"). Budget figures built on a name join would have inherited
it, so `project_id` was added and backfilled — and only where a name maps to
exactly one project. Ambiguous names were left null rather than guessed at,
since attributing hours to the wrong client's budget is worse than to none.

### Wave 3 — Timesheet depth
Copy-last-week, flexible duration parsing, row totals against a weekly target,
withdraw, mandatory rejection notes, rolling lock date.

### Wave 4 — Working-time and absence depth
Work schedules driving expected hours, Soll/Ist balance, break rules, absence
types beyond holiday (sick leave etc.), German public holidays per Bundesland.

### Wave 5 — Project management depth
Task detail slide-over, dependencies, custom fields, saved views, milestones.

## Not yet researched

Cut short by an API session limit; to be completed before the waves that depend
on them:

- Asana: information architecture, view types, the full task object, rules and
  forms, reporting, My Tasks / Portfolios / Goals.
- TrackingTime's own documentation (Toggl and Clockify were used as verified
  proxies for the category).
- FactorialHR: permission model, certification/qualification expiry tracking —
  the latter matters more than usual here, because HSE consultants hold safety
  certifications that expire.

## Design foundation

Applied alongside Wave 1:

- **Typeface**: the app shell had drifted to Roboto while `DESIGN.md` records
  Poppins as the real brand face taken from hs-experts.com. Moved to Poppins,
  with JetBrains Mono for numerals.
- **Tabular figures** app-wide, so numbers stop jittering as values change in a
  UI that is almost entirely tables of hours and rates.
- **Visible focus rings** — an accessibility requirement that was missing.
- **Shared primitives**: `StatusBadge` (replacing divergent inline status
  colour maps, so "approved" is the same green everywhere) and `EmptyState`
  (replacing bare grey sentences that read as dead ends). A `SlideOver` panel
  is deliberately deferred to Wave 5 rather than landed unused.
- **Route-level error boundary** — a failed query previously fell through to a
  blank page in production.
