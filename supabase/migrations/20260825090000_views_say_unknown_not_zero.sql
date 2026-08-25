-- ============================================================================
-- Two views that answer confidently from an empty table
-- ============================================================================
--
-- WHAT IS WRONG
-- -------------
-- `billable_value_by_person` and `project_budget_status` both aggregate
-- `public.timesheet_entries`. That table is empty: its 28 rows were mockup data
-- belonging to `emp-1`, an inactive seed person, and were removed on
-- 2026-08-24. Every real hour this company has tracked lives in `time.entry`
-- (5,351 rows, 8,473 h, from TrackingTime and calendar sync).
--
-- So both views currently return a full result set of zeroes:
--
--     billable_value_by_person   26 rows, every billable_hours_logged = 0
--     project_budget_status     231 rows, every hours_logged = 0,
--                                        revenue_eur = 0, margin_eur = 0,
--                                        is_over_budget = false
--
-- The `COALESCE(sum(...), 0)` in each definition is what makes this dangerous.
-- Without it these would be NULL, which reads as "unknown" and is the honest
-- answer. With it, "we have no idea" is rendered as "zero", and
-- `is_over_budget = false` becomes a positive assurance that no project has
-- overrun -- computed from no data at all.
--
-- WHY IT IS NOT VISIBLY BROKEN TODAY
-- ----------------------------------
-- Nothing reads them. `getBillableValues()` and `getProjectBudgetStatus()`
-- exist in src/lib/queries/hse.ts but have no callers, and a real browser walk
-- across /, /people, /projects, /time/dashboard and the management tabs never
-- requests either view over PostgREST. The Overview's billable figures come
-- from `time.entry` and are correct.
--
-- That is precisely why this needs fixing NOW rather than later. The hazard is
-- not a wrong number on screen; it is a loaded gun. The views are valid SQL,
-- the accessors are typed and ready, and the next person who builds a budget
-- widget will call `getProjectBudgetStatus()`, see plausible-looking rows, and
-- ship silent zeroes into a commercial report.
--
-- WHY NOT SIMPLY REPOINT THEM AT time.entry
-- -----------------------------------------
-- Because the answer would still be wrong, just less obviously. Two blockers,
-- both measured:
--
--   1. Only 1,465 of 5,351 entries (3,444 h of 8,473 h, about 41%) can reach a
--      hub project at all, because `time.project.hub_project_id` is set on just
--      123 of 334 projects. A budget view built on that would silently omit
--      more than half the hours, and under-report every project's burn.
--   2. `people.billable_rate_eur` and `cost_rate_eur` are NULL for all 18
--      active people. Revenue and margin are uncomputable regardless of which
--      table the hours come from.
--
-- Repointing before those are fixed would replace an obvious zero with a
-- credible underestimate, which is harder to catch and worse to act on.
--
-- WHAT THIS MIGRATION DOES
-- ------------------------
-- Makes the views tell the truth: NULL, not zero, wherever the number is
-- unknown, and no boolean assurance that cannot be justified. A caller now gets
-- an em dash rather than a fabricated figure -- the same rule DESIGN.md already
-- applies to tables ("a missing number renders as an em dash, never as zero,
-- because 0 h is a claim that somebody logged nothing").
--
-- The views are kept rather than dropped so that `getProjectBudgetStatus()`
-- keeps compiling and the shape stays available for the eventual real
-- implementation. They are re-created with `security_invoker` preserved so RLS
-- continues to do the filtering.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- billable_value_by_person
-- ---------------------------------------------------------------------------
create or replace view public.billable_value_by_person
with (security_invoker = true) as
  select
    p.id as person_id,
    p.billable_rate_eur,
    -- No COALESCE. When there are no matching rows this is NULL, meaning "not
    -- known", which is the truth. Zero would assert that this person logged no
    -- billable time, which is a different and currently unsupported claim.
    sum(te.hours) filter (where te.is_billable and te.status = 'approved')
      as billable_hours_logged,
    p.billable_rate_eur
      * sum(te.hours) filter (where te.is_billable and te.status = 'approved')
      as billable_value_eur
  from public.people p
  left join public.timesheet_entries te on te.person_id = p.id
  group by p.id, p.billable_rate_eur;

comment on view public.billable_value_by_person is
  'Billable value per person. Reads public.timesheet_entries, which is EMPTY: '
  'real hours live in time.entry. Returns NULL (unknown) rather than 0 so no '
  'caller mistakes an absence of data for a measurement. Do not build on this '
  'until the time.entry bridge is complete and people.billable_rate_eur is set.';

-- ---------------------------------------------------------------------------
-- project_budget_status
-- ---------------------------------------------------------------------------
create or replace view public.project_budget_status
with (security_invoker = true) as
  select
    p.id as project_id,
    p.name,
    p.budget_hours,
    p.budget_fee_eur,
    p.budget_alert_percent,
    sum(te.hours) filter (where te.status = 'approved')                      as hours_logged,
    sum(te.hours) filter (where te.status = 'approved' and te.is_billable)   as billable_hours_logged,
    sum(te.hours * coalesce(p.billable_rate_eur, pe.billable_rate_eur))
      filter (where te.status = 'approved' and te.is_billable)               as revenue_eur,
    sum(te.hours * pe.cost_rate_eur)
      filter (where te.status = 'approved')                                  as cost_eur,
    sum(te.hours * coalesce(p.billable_rate_eur, pe.billable_rate_eur))
      filter (where te.status = 'approved' and te.is_billable)
      - sum(te.hours * pe.cost_rate_eur)
        filter (where te.status = 'approved')                                as margin_eur,
    round(
      (sum(te.hours) filter (where te.status = 'approved') * 100.0)
        / nullif(p.budget_hours, 0), 2)                                      as hours_consumed_percent,
    -- These two were the worst of it. `coalesce(..., false)` turned "we cannot
    -- tell" into "no, this project is fine" -- an assurance a budget alert
    -- would act on. NULL is the only defensible answer with no hours to check.
    sum(te.hours) filter (where te.status = 'approved')
      > nullif(p.budget_hours, 0)                                            as is_over_budget,
    ((sum(te.hours) filter (where te.status = 'approved') * 100.0)
      / nullif(p.budget_hours, 0)) >= p.budget_alert_percent::numeric        as is_past_alert_threshold
  from public.projects p
  left join public.timesheet_entries te on te.project_id = p.id
  left join public.people pe on pe.id = te.person_id
  group by p.id, p.name, p.budget_hours, p.budget_fee_eur,
           p.budget_alert_percent, p.billable_rate_eur;

comment on view public.project_budget_status is
  'Budget burn per project. Reads public.timesheet_entries, which is EMPTY: '
  'real hours live in time.entry. Returns NULL (unknown) rather than 0, and '
  'is_over_budget is NULL rather than false, so nothing reads an absence of '
  'data as an assurance that a project is within budget.';
