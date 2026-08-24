-- ============================================================================
-- public.people.source: allow 'masterdata'
-- ============================================================================
--
-- WHY
-- ---
-- `people.source` exists to say where a person record came from, and its check
-- constraint allows only ('seed', 'factorial') -- written when the table held
-- eight mockup rows and Factorial was the planned real source.
--
-- The customer-masterdata import then added nine REAL colleagues (the md-*
-- rows, named as responsibles in the masterdata Excel). Its own header
-- documents them as source='masterdata'; the code wrote 'seed' because that
-- was the only value the constraint permitted. So real people carry the label
-- that means "fiction", and every gate reasoning about mockup rows sweeps them
-- in -- including the one asserting that no account may be linked to a mockup
-- person, which cannot distinguish a legitimate link from a dangerous one.
--
-- This widens the domain by exactly one value and relabels the nine rows.
--
-- WHAT THIS IS NOT
-- ----------------
-- The eight emp-* rows stay 'seed'. They ARE fiction (uniform 40h contracts,
-- invented employee numbers) and are kept only because timesheet foreign keys
-- lock them. Relabelling those would erase the distinction this migration
-- exists to restore.
--
-- Idempotent: safe to run twice. The constraint is dropped by name before it
-- is recreated, and the UPDATE is scoped by a predicate that stops matching
-- once applied.
-- ============================================================================

begin;

alter table public.people
  drop constraint if exists people_source_check;

alter table public.people
  add constraint people_source_check
  check (source in ('seed', 'factorial', 'masterdata'));

-- Scoped by the id prefix the importer itself assigns, not by name and not by
-- is_active: ADR-001 rules apply here too, an exact key or nothing.
update public.people
   set source = 'masterdata'
 where id like 'md-%'
   and source <> 'masterdata';

-- The default stays 'seed'. A row inserted without a stated provenance is not
-- masterdata, and defaulting to the real label would let the next importer
-- silently claim provenance it does not have.

commit;

-- Verification (run separately):
--   select source, count(*) from public.people group by source;
--     expected: masterdata 9, seed 8
--   select count(*) from public.app_user_profile p
--     join public.people pe on pe.id = p.person_id where pe.source = 'seed';
--     expected: 0
