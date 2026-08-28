-- External staff are people, and the model has to say so.
--
-- WHAT THIS FIXES
-- ---------------
-- Stefan Goelzner is an external contractor hired for specific projects and to
-- cover for Thorsten. He works: 149.0h across 62 entries between 19 July and
-- 26 August 2026, every one of them billable, all on Enercon W-13294 Ostervesede
-- and W-13301 Wohlsdorf plus their travel time.
--
-- He exists in time.member (id 40, stefan-external@hs-expert.com, CO_WORKER) but
-- has no row in public.people. Everything keyed on people therefore cannot see
-- him:
--
--   * six views -- billable_value_by_person, leave_balances, org_chart_nodes,
--     person_week_metrics, project_budget_status, user_display_names
--   * the reassignment picker, which reads public.people where is_active, so he
--     can never be offered as cover
--   * request_project_responsible_change, which raises 'requested person is not
--     active' for any id absent from public.people
--
-- So the person hired *to be* cover was the one person who could not be picked
-- as cover. That is the gap this closes.
--
-- WHY A NEW SOURCE VALUE RATHER THAN source='masterdata'
-- ------------------------------------------------------
-- people_source_check allows only seed/factorial/masterdata. Stefan is in none
-- of those: he is not in the HSE masterdata workbook, and as an external he will
-- never appear in Factorial, so the Factorial sync must not treat his absence
-- from the roster as a leaver and deactivate him. 'external' states the origin
-- honestly and gives that sync an explicit category to skip.
--
-- CONTRACT HOURS ARE LEFT NULL, DELIBERATELY
-- ------------------------------------------
-- An external on call-off work has no weekly contract. Writing 40 would make
-- utilisation render a confident percentage against a denominator nobody agreed,
-- which is precisely the failure DESIGN.md rule 7 exists to prevent. NULL means
-- unmeasured, and the UI already renders that as n/a rather than 0%.

begin;

alter table public.people drop constraint if exists people_source_check;
alter table public.people add constraint people_source_check
  check (source = any (array['seed', 'factorial', 'masterdata', 'external']));

comment on column public.people.source is
  'Where this person record came from. external = contractor or freelancer who '
  'will never appear in the Factorial roster; the Factorial sync must not treat '
  'their absence from it as a leaver.';

-- Idempotent: safe to run twice, and will not clobber a hand-edited row.
insert into public.people (id, name, role, department, is_active, source, contract_hours)
values ('ext-stefan-goelzner', 'Stefan Goelzner', 'External Consultant', 'OPERATIONS', true, 'external', null)
on conflict (id) do nothing;

-- Join his tracked time to the person record so the six people-keyed views stop
-- silently dropping 149h of billable work.
update time.member
   set hub_person_id = 'ext-stefan-goelzner'
 where id = 40
   and hub_person_id is null;

commit;
