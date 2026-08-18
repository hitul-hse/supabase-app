-- Let everyone see the organisation chart, without exposing anything else.
--
-- THE PROBLEM THIS FIXES, found by rendering the deployed page as two different
-- people rather than by reading the policy. `time.member`'s read policy is
-- `can_view_member(id)`, which is right for TIME data: an employee has no business
-- reading a colleague's logged hours. But the org chart reads the same table, so
-- signed in as a real employee the chart said "0 OF 1 PLACED" and showed a
-- hierarchy containing only herself. Correct per the policy, and useless: a
-- reporting structure that only executives can see is not an org chart.
--
-- THE SAME REASONING THE OLD VIEW USED. `public.org_chart_nodes` was deliberately
-- NOT security_invoker, with a comment explaining why: an org chart needs every
-- employee to see the whole reporting line, the opposite need from the views that
-- respect RLS. That judgement was sound; only its data (eight mockup people) was
-- not. So this is the same pattern over the real roster.
--
-- WHAT IS SAFE TO EXPOSE, and the list is deliberately short. Identity and
-- structure only:
--
--     id, display_name, email, role, job_title, team,
--     supervisor_member_id, supervisor_source, is_archived, has_account
--
-- WHAT IS DELIBERATELY NOT HERE. `user_id` is omitted -- it is the auth identifier
-- that decides whose hours someone sees, and a company-wide view is the wrong
-- place for it; `has_account` answers the only question the UI actually asks of it
-- ("is this person on the Hub yet") as a boolean. Nothing about hours, rates, cost
-- or utilisation appears at all: those live in member_rate and member_utilisation,
-- which keep their own scoping. Email is included because a directory without
-- contact details is not useful, and it is already visible to every colleague in
-- TrackingTime itself.
--
-- So the widest this can leak is: who works here, what they do, and who they
-- report to. That is what an org chart IS.

create or replace view time.org_chart as
select
  m.id                              as member_id,
  m.display_name,
  m.email,
  m.role                            as account_role,
  m.job_title,
  m.team,
  m.supervisor_member_id,
  m.supervisor_source,
  m.is_archived,
  -- A boolean, not the uuid. See above: the UI needs "do they have a Hub account",
  -- not the identifier that governs access to their time.
  (m.user_id is not null)           as has_account
from time.member m;

grant select on time.org_chart to authenticated;

-- No RLS on the view itself: it is intentionally company-wide, which is the whole
-- point. Without security_invoker it runs as its owner and so is not filtered by
-- time.member's row policy.
