-- Let the projects ledger admit it does not know.
--
-- Audit of 26 Aug 2026. Of 231 orders, 177 resolve to a TrackingTime project by
-- the exact key time.project.hub_project_id and 54 do not. All 54 unlinked orders
-- report logged_hours = 0, consumed_percent = 0 and status = 'NORMAL' across
-- 1,724 contract hours -- but nothing about them was ever measured. The importer
-- had no hours to report and wrote 0 because these columns forbid null.
--
-- The 113 LINKED orders that also report 0 (3,256 contract hours) are a different
-- population: they are measured and genuinely have no logged time yet. That 0 is a
-- fact, and this migration deliberately leaves it alone.
--
-- That is the exact failure the house rule "honest nulls, never a plausible 0"
-- exists to prevent. A project manager reading the ledger cannot distinguish
-- "this client has not been worked yet" from "we have no idea", because both
-- render as a confident 0% NORMAL.
--
-- The columns were the obstacle, so relax them. logged_hours and remaining_hours
-- are already nullable; these three were not.
--
-- Deliberately NOT touching contract_hours: the contract figure comes from the
-- signed order, not from measurement, so it is genuinely known and stays NOT NULL.

alter table public.projects alter column consumed_percent drop not null;
alter table public.projects alter column billable_hours   drop not null;
alter table public.projects alter column status           drop not null;

comment on column public.projects.logged_hours is
  'Hours from linked TrackingTime entries. NULL means no TT project resolved for this order, i.e. unmeasured -- never render as 0.';
comment on column public.projects.consumed_percent is
  'logged_hours/contract_hours as a percent. NULL when logged_hours is NULL or there is no contract -- render n/a, never 0%.';
comment on column public.projects.billable_hours is
  'Billable subset of logged_hours. NULL means unmeasured, not zero billable work.';
comment on column public.projects.remaining_hours is
  'contract_hours - logged_hours. NULL when unmeasured.';
comment on column public.projects.status is
  'Budget status derived from consumed_percent: CRITICAL >=95, WARNING >=80, NORMAL below. NULL when consumed_percent is unknown.';

-- Now correct the rows that are already lying. An order with no TrackingTime
-- link has no measured hours, so its derived columns must read NULL rather than 0.
--
-- "Has no TT link" is decided by the same exact-key rule the importer and
-- check-management-data use (ADR-001: time.project.hub_project_id), never by
-- name similarity.
update public.projects p
   set logged_hours     = null,
       billable_hours   = null,
       remaining_hours  = null,
       consumed_percent = null,
       status           = null
 where not exists (
         select 1 from time.project tp where tp.hub_project_id = p.id
       )
   and coalesce(p.logged_hours, 0) = 0;   -- never overwrite a measured figure
