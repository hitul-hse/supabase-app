-- =============================================================================
-- HSE Hub round 3: tell real people apart from mockup people
-- Paste this whole file into the Supabase SQL editor and Run.
-- =============================================================================
--
-- WHAT THIS FIXES
--   `public.people.source` says where a person record came from, and its check
--   constraint allows only ('seed', 'factorial'). But the customer-masterdata
--   import added NINE REAL COLLEAGUES (the md-* rows -- Björn, Hendryk,
--   Mathias, Mustafa, Ousmane, Rency, Serhii, Stephan, Thorsten, named as
--   responsibles in your masterdata Excel). Its own header says they should be
--   source='masterdata'; the code wrote 'seed' because the constraint allowed
--   nothing else.
--
--   So real colleagues carry the label that means "made-up demo row", and
--   nothing in the system can tell them apart from the eight emp-* mockups
--   (Anna Brandt, C. Haas and friends -- invented people with invented
--   employee numbers and a uniform 40h contract).
--
-- WHY IT MATTERS NOW
--   Nine user accounts were just linked to their real person rows, which is
--   what made these columns show real values instead of "n/a":
--     - Profile page: employee number, contract hours, holiday
--     - Admin > Users: the PERSON column
--     - Leave: the balance path
--   The safety check that guards this ("no account may be linked to a MOCKUP
--   person, or invented HR data lands on a real profile page") cannot do its
--   job while both populations share one label.
--
-- WHAT IT DOES
--   1. Widens the allowed values by exactly one: adds 'masterdata'.
--   2. Relabels the nine md-* rows.
--   The eight emp-* mockups deliberately STAY 'seed'. They really are fiction,
--   kept only because timesheet foreign keys prevent deleting them.
--
-- VERIFIED BEFORE HANDING IT OVER
--   scripts/check-masterdata-source-migration.mjs executes this file against a
--   real Postgres TWICE (11 checks): the old constraint rejects 'masterdata'
--   beforehand, the migration runs, the md-* rows flip, the emp-* rows do not,
--   the widened constraint still rejects an unknown value, the column default
--   stays 'seed' so no future importer can claim provenance silently, and no
--   profile is left pointing at a mockup person.
--
-- SAFE TO RE-RUN.
-- =============================================================================

begin;

alter table public.people
  drop constraint if exists people_source_check;

alter table public.people
  add constraint people_source_check
  check (source in ('seed', 'factorial', 'masterdata'));

-- Scoped by the id prefix the importer itself assigns -- an exact key, never a
-- name match (ADR-001).
update public.people
   set source = 'masterdata'
 where id like 'md-%'
   and source <> 'masterdata';

commit;

-- =============================================================================
-- Verification: run these two after the above, and tell the agent the numbers.
-- =============================================================================

-- Expected: masterdata 9, seed 8
select source, count(*) as rows
  from public.people
 group by source
 order by source;

-- Expected: 0 rows. Any row here means a real account is showing mockup HR data.
select p.user_id, p.person_id, pe.name
  from public.app_user_profile p
  join public.people pe on pe.id = p.person_id
 where pe.source = 'seed';
