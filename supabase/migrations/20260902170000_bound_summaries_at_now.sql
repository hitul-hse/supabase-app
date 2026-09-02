-- Bound the two rollup views at now(). Verified in PGlite twice by
-- scripts/check-bound-summaries-migration.mjs before pasting.
--
-- Decision 2026-09-02: planned time is not logged time. Every page and the
-- nightly refresh already exclude entries dated after now(); the two rollup
-- views did not, so anything new that reads them inherits ~582 h of planned
-- time (12 projects over budget by the view, 11 by the pages).
-- This moves the bound into the views. Column list is unchanged, so
-- `create or replace view` is enough and no consumer needs a code change;
-- the per-page corrections become no-ops rather than double-counting.

create or replace view time.project_summary
with (security_invoker = true) as
select
  p.id                                                          as project_id,
  p.name                                                        as project_name,
  p.is_billable,
  p.is_archived,
  c.id                                                          as customer_id,
  c.name                                                        as customer_name,
  p.estimated_hours,
  coalesce(sum(e.duration_seconds), 0)                          as total_seconds,
  coalesce(sum(e.duration_seconds) filter (where e.is_billable), 0) as billable_seconds,
  coalesce(sum(e.duration_seconds) filter (where e.is_calendar), 0) as calendar_seconds,
  count(e.id)                                                   as entry_count,
  count(distinct e.member_id)                                   as member_count,
  max(e.started_at)                                             as last_activity_at,
  case
    when coalesce(p.estimated_hours, 0) > 0
    then round((coalesce(sum(e.duration_seconds), 0) / 3600.0)
               / nullif(p.estimated_hours, 0) * 100, 1)
  end                                                           as burn_percent
from time.project p
left join time.customer c on c.id = p.customer_id
left join time.entry e    on e.project_id = p.id
                        and e.duration_seconds is not null
                        and e.started_at <= now()          -- planned time is not logged time
group by p.id, p.name, p.is_billable, p.is_archived, c.id, c.name, p.estimated_hours;

create or replace view time.customer_summary
with (security_invoker = true) as
select
  c.id                                                          as customer_id,
  c.name                                                        as customer_name,
  c.is_archived,
  coalesce(sum(e.duration_seconds), 0)                          as total_seconds,
  coalesce(sum(e.duration_seconds) filter (where e.is_billable), 0) as billable_seconds,
  (select count(*) from time.project p where p.customer_id = c.id) as project_count,
  count(e.id)                                                   as entry_count,
  max(e.started_at)                                             as last_activity_at
from time.customer c
left join time.entry e on e.customer_id = c.id
                      and e.duration_seconds is not null
                      and e.started_at <= now()              -- planned time is not logged time
group by c.id, c.name, c.is_archived;

-- grants are unchanged: create or replace keeps them.
