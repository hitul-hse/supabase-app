-- Prevent duplicate canonical rows in crm.legal_entity from recurring.
--
-- Background: `Addleshaw Goddard (Germany) LLP` existed 4x. Any roll-up joining
-- on the canonical entity fanned out 4x, which inflated the projects baseline
-- from 231 to 237 and left 2 projects unresolvable (the customer resolver
-- correctly refuses to guess between identical candidates).
--
-- The fix is a partial unique index on the normalised name, scoped to rows that
-- are still ACTIVE. Superseded/merged rows are deliberately exempt so the
-- supersede mechanism (superseded_by_id + lifecycle_status='merged') keeps
-- working and referential history is never destroyed.

-- Normalisation must match scripts/dedupe-legal-entities.mjs and
-- scripts/link-project-customers.mjs: lowercase, German transliteration,
-- collapse every non-alphanumeric run to a single space.
create or replace function crm.normalise_legal_name(p_name text)
returns text
language sql
immutable
strict
as $$
  select btrim(regexp_replace(
    replace(replace(replace(replace(
      lower(p_name),
      'ß', 'ss'),
      'ä', 'ae'),
      'ö', 'oe'),
      'ü', 'ue'),
    '[^a-z0-9]+', ' ', 'g'
  ))
$$;

comment on function crm.normalise_legal_name(text) is
  'Canonical name normalisation for identity matching. Byte-for-byte mirror of normName() in scripts/link-project-customers.mjs and scripts/dedupe-legal-entities.mjs: lowercase, ß->ss, ä->ae, ö->oe, ü->ue, then collapse every non-alphanumeric run to a single space and trim.';

-- Guard only ACTIVE rows: merged/historical duplicates must remain.
create unique index if not exists legal_entity_active_normalised_name_uidx
  on crm.legal_entity (crm.normalise_legal_name(legal_name))
  where lifecycle_status = 'active' and superseded_by_id is null;

comment on index crm.legal_entity_active_normalised_name_uidx is
  'Stops a second ACTIVE legal_entity with the same normalised legal_name being created. Duplicates must instead be merged via superseded_by_id + lifecycle_status=''merged'' (see scripts/dedupe-legal-entities.mjs). Rows already merged are exempt so history is preserved.';

-- Offices are locations, not legal entities. Keep office rows unique per entity
-- so a future import cannot recreate the same office repeatedly.
create unique index if not exists location_entity_city_type_uidx
  on crm.location (legal_entity_id, lower(coalesce(city, '')), lower(coalesce(location_type, '')))
  where lifecycle_status = 'active';
