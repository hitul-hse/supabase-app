-- ============================================================================
-- A view was publishing budget alerts to the internet
-- ============================================================================
--
-- WHAT WAS WRONG
-- --------------
-- `public.budget_alert_feed` carried a SELECT grant to `anon` and, being a view
-- without `security_invoker`, ran with its `postgres` owner's rights -- which
-- are exempt from row-level security. The table underneath, `overbooking_alert`,
-- is correctly protected with RLS and three policies, and it made no difference
-- whatsoever, because nothing was ever evaluating them.
--
-- Verified against the production API with no session, using only the anon key
-- that ships in the browser bundle by design:
--
--     200 [{"project_name":"10303_WorkMotion Software GmbH / 25/26 GU",
--          "actor_name":"Hitul Shah","budget_hours":5,"logged_hours":21.1,
--          "reason":"This project is already over its 5h budget (21.1h logged)…",
--          "notify_recipients":["hitul@hs-experts.com","bjoern.schoenemann@hs-experts.com"]}]
--
-- A customer's name, a staff member's name, a commercial overrun, and two staff
-- email addresses, readable by anyone who opens the site and reads the page
-- source. PRODUCT.md commits this project to "no PII in logs or error
-- messages"; serving it from an API endpoint is the same promise broken louder.
--
-- WHY IT SURVIVED
-- ---------------
-- Nothing was broken. RLS was on, the policies were sensible, every RLS gate in
-- the suite passed, and no page in the app reads this endpoint, so nothing ever
-- looked wrong. The defect lived in the gap between "the table is protected"
-- and "every path to the table is protected", and a view is a path that looks
-- like a table.
--
-- WHAT THIS DOES, AND WHAT IT DELIBERATELY DOES NOT
-- -------------------------------------------------
-- `budget_alert_feed` gets `security_invoker = true`, so the caller's own
-- policy on `overbooking_alert` decides what comes back, and the anonymous
-- grant is revoked. Measured afterwards: exec and dept_head see 2 alerts, an
-- ordinary employee sees 0, anonymous gets 401.
--
-- Two OTHER views also lack `security_invoker` -- `org_chart_nodes` and
-- `user_display_names` -- and they are left alone ON PURPOSE. Both are
-- documented in src/lib/queries/hse.ts as deliberate bypasses, with reasons
-- that hold up: an org chart that shows you only yourself is not an org chart,
-- and a comment thread where every author reads "Team member" is worse than no
-- names at all. I changed them first and had to revert: it dropped every
-- non-exec from 26 org-chart nodes to 1.
--
-- What made that bypass safe was worth checking rather than assuming, so it was
-- checked: `org_chart_nodes` exposes id, name, role, department, manager_id and
-- `user_display_names` exposes user_id, display_name. No rates, no salary, no
-- certificates. The comment's claim is accurate.
--
-- They do, however, lose their `anon` grants here. A deliberate bypass is for
-- SIGNED-IN users; nothing in this database should answer a caller with no
-- session at all.
-- ============================================================================

alter view public.budget_alert_feed set (security_invoker = true);

-- PostgREST checks role grants before it evaluates policies, so the grant has
-- to go too. With security_invoker alone an anonymous caller would receive an
-- empty set rather than a refusal, which is safe but still advertises that the
-- endpoint exists.
revoke all on public.budget_alert_feed from anon;

comment on view public.budget_alert_feed is
  'Budget overbooking alerts. security_invoker=true so the caller''s own RLS on '
  'overbooking_alert decides what comes back. Without it this view ran as its '
  'postgres owner and served every alert to anyone, including anonymously: '
  'customer names, staff names, overruns and notification email addresses.';

-- The two deliberate bypasses keep their owner rights and lose anon access.
revoke all on public.org_chart_nodes from anon;
revoke all on public.user_display_names from anon;
