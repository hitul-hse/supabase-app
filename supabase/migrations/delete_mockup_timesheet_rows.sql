-- Remove the seeded mockup timesheet/booking rows.
--
-- WHAT WAS THERE, MEASURED RATHER THAN ASSUMED
-- --------------------------------------------
-- public.timesheet_entries held 28 rows, 46.0 h, and every one of them was
-- fiction in five independent ways at once:
--
--   * all 28 belonged to person_id 'emp-1' -- 'Anna Brandt', is_active=false,
--     source='seed', one of the eight seeded mockup people that
--     check:no-mockup-people already exists to keep off the screen;
--   * no app_user_profile row links to 'emp-1'. All 19 real accounts point at
--     an 'md-*' person, so these rows described a colleague with no account;
--   * all 28 had project_id NULL and a free-text project_name -- 'SITE RISK
--     ASSESSMENT 2026', 'ISO 45001 READINESS', 'NEEDS PROJECT ASSIGNMENT',
--     'NON-BILLABLE'. Checked against both project tables: 0 of 4 match a row
--     in time.project or public.projects. They are labels, not references;
--   * all 28 sat in one week (2026-08-10) and were already status='approved',
--     so the approval flow they appear to document had never run;
--   * 14 of 28 carried customer NULL while the other 14 named customers.
--
-- public.weekly_bookings held 20 more rows across five seeded people (emp-1,
-- emp-2, emp-4, emp-5, emp-8 -- all is_active=false, source='seed'). Its last
-- reader was the old getTeamLeadBoard, which queries/team-lead-live.ts replaced
-- with measured time and check:no-mockup-people now forbids re-adding. Nothing
-- in src/ reads the table.
--
-- Meanwhile time.entry holds 5,322 real rows and 8,458.7 h spanning all of 2026
-- from trackingtime/calendar/manual. Mathias alone has 612 entries and 1,186.7 h
-- there and 0 rows here.
--
-- WHY DELETE RATHER THAN REPOINT THE PAGE
-- ---------------------------------------
-- /timesheets is not a reporting surface that got wired to the wrong table. It
-- is the Hub's own editable weekly grid with a real write path -- insert, submit,
-- withdraw, lead approve/reject, copy-last-week, and the running timer -- all
-- against this table, all governed by the six RLS policies on it. time.entry is
-- an imported read-only mirror of TrackingTime in seconds, already rendered by
-- /time next door, and RecordsTabs deliberately presents the two as different
-- views. Pointing the grid at time.entry would delete a working feature and show
-- the same hours twice.
--
-- So the table is right and the rows were wrong. Deleting them makes the page
-- honest: an employee with no logged week sees the empty state, which is the
-- truth, instead of a stranger's approved week.
--
-- WHY THIS WAS INVISIBLE TO EVERY EXISTING GATE
-- ---------------------------------------------
-- No real user could reach these rows today: the SELECT policy is
-- can_view_person(person_id), no live profile is 'emp-1', and the one exec-facing
-- reader (getPendingTimesheetApprovals) filters status='submitted' while all 28
-- were 'approved'. That is luck, not design -- a single UPDATE to 'submitted'
-- would have put 'Anna Brandt' in the team lead's approval queue, joined to
-- people(name) at runtime.
--
-- Which is exactly why the source-level gates missed it. check:no-mockup-people
-- greps for the eight names in rendering code and forbids a listed set of files
-- from querying people/weekly_bookings/org_chart_nodes; 'timesheet_entries' is
-- not in its table list and /timesheets is not in its file list. Nothing in src/
-- ever spells 'Anna Brandt' -- the name arrives through a FK join at request
-- time. check:no-mock-data is explicit that "people/timesheet_entries pages are
-- deliberately out of scope: they are a separate migration". This is that
-- migration, and scripts/check-timesheet-truth.mjs is the data gate neither had.
--
-- REVERSIBILITY. The 28 rows were dumped to SQL before deletion. They are seed
-- data with no dependents: nothing references timesheet_entries.id, and
-- approval_decisions is keyed by its own sort_order rather than by these rows.

begin;

-- Scoped to seeded, inactive people rather than to 'emp-1' or to a row count, so
-- this stays correct if the seed set is ever re-inserted in part. A real
-- colleague's entries can never match: every live account links to an 'md-*'
-- person with is_active=true and source<>'seed'.
delete from public.timesheet_entries te
using public.people p
where p.id = te.person_id
  and p.source = 'seed'
  and p.is_active = false;

delete from public.weekly_bookings wb
using public.people p
where p.id = wb.person_id
  and p.source = 'seed'
  and p.is_active = false;

commit;

-- Expected after: 0 rows in both tables.
--   select count(*) from public.timesheet_entries;  -- 0
--   select count(*) from public.weekly_bookings;    -- 0
