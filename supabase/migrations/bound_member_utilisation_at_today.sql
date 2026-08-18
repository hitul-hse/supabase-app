-- Stop time.member_utilisation counting PLANNED work as logged.
--
-- THE FAULT. TrackingTime stores planned entries months ahead: 19 of 53 weeks in
-- this dataset are future-dated. This view's join had no upper date bound, so
-- every per-member figure it produced included work nobody has done yet.
--
-- getOrgWeeks (the Overview's source) already bounds with lte(today) and carries
-- a comment explaining why. This view did not, so the two disagreed:
--
--     People, built on this view : 8.263 h
--     Overview, bounded at today :  7.592 h   -> 671 h (9%) apart, one click apart
--
-- Per member, before this migration, the view matched all-time totals for 49 of
-- 49 rows and bounded-at-today for only 40. The worst case was Björn Schönemann
-- at 1.154 h against 694 h actually worked, with last_activity_at reading
-- 2026-12-31 -- a "last active" date four months in the future.
--
-- It also corrupted utilisation rather than only totals: the ratio is
-- tracked_seconds / (weekly_hours * weeks_active), so unworked time inflated the
-- numerator AND weeks_active, letting somebody read as over capacity on work they
-- had not started.
--
-- THE BOUND. `e.started_at::date <= current_date` is applied in the JOIN, not in
-- a WHERE clause. That distinction matters: this is a LEFT JOIN, and moving the
-- predicate to WHERE would drop every member with no qualifying entry, silently
-- shrinking the roster from 49 to 18 and hiding everyone who has not logged time.
-- In the join condition, such members are kept with zeroed sums, which is what a
-- directory needs.
--
-- current_date, not now(): entries carry a timestamptz, and comparing a date to a
-- timestamp would exclude everything logged later today. Casting the entry to a
-- date keeps the whole of today inclusive, matching getOrgWeeks, which includes
-- the in-progress week rather than the last completed one.
--
-- WHY NOT KEEP THE PLANNED NUMBER SOMEWHERE. Planned hours are legitimately
-- interesting, but they are a different measurement and belong in their own
-- column with its own label. Leaving them summed into total_seconds means every
-- caller reports them as logged, which is the bug being fixed here. A future
-- `planned_seconds` can be added without changing what these columns mean.
--
-- Verified by npm run check:people-overview-agree, which compares this view
-- against time.entry recomputed both bounded and unbounded, and so can tell
-- "bounded" apart from "happens to agree".

create or replace view time.member_utilisation
with (security_invoker = true) as
select
  m.id                                                          as member_id,
  m.display_name,
  m.hub_person_id,
  m.is_archived,
  m.weekly_hours,
  coalesce(sum(e.duration_seconds), 0)                          as total_seconds,
  coalesce(sum(e.duration_seconds) filter (where e.is_billable), 0) as billable_seconds,
  coalesce(sum(e.duration_seconds) filter (where e.is_calendar), 0) as calendar_seconds,
  coalesce(sum(e.duration_seconds) filter (where not e.is_calendar), 0) as tracked_seconds,
  count(e.id)                                                   as entry_count,
  count(distinct date_trunc('week', e.started_at))              as weeks_active,
  max(e.started_at)                                             as last_activity_at
from time.member m
left join time.entry e
  on e.member_id = m.id
 and e.duration_seconds is not null
 -- The bound. Planned future entries are excluded from every aggregate above.
 and e.started_at::date <= current_date
group by m.id, m.display_name, m.hub_person_id, m.is_archived, m.weekly_hours;

grant select on time.member_utilisation to authenticated;
