-- "YPOG Berlin" is ambiguous. Record that, do not guess it.
--
-- Order 10305_00404_501_01 carries the customer text "YPOG Berlin" and is the last
-- of 231 orders with no customer_legal_entity_id. The obvious move is to link it to
-- "YPOG GmbH & Co. KG" and close the gap.
--
-- That would be wrong. There are TWO active YPOG legal entities:
--   3cac70b8-b220-4c6d-bbde-bf58661f0997  YPOG GmbH & Co. KG
--   2c637f54-c9bf-4b58-b0a9-00ec3ae5b7c4  YPOG Partnerschaft von Rechtsanwälten mbB
-- and customer 10305 already has orders against BOTH of them (four orders name the
-- Partnerschaft, five name the GmbH). A German law firm structured as a mbB
-- partnership alongside a service GmbH bills through different entities on purpose,
-- so "Berlin" does not disambiguate them -- it names an office both may share.
--
-- Picking one would be exactly the name-similarity guess ADR-001 forbids, on an
-- invoicing relationship. So this migration records the ambiguity where a human
-- will see it and leaves the FK null, because null is the honest value.
--
-- Resolve by asking which entity the 501 (Brandschutz) order was contracted with,
-- then set customer_legal_entity_id directly. Idempotent; safe to re-run.

do $$
declare
  v_gmbh uuid;
  v_part uuid;
begin
  select id into v_gmbh from crm.legal_entity
   where crm.normalise_legal_name(legal_name) = crm.normalise_legal_name('YPOG GmbH & Co. KG')
     and lifecycle_status = 'active' and superseded_by_id is null;
  select id into v_part from crm.legal_entity
   where legal_name ilike 'YPOG Partnerschaft%'
     and lifecycle_status = 'active' and superseded_by_id is null;

  -- Both candidates must exist, or the ambiguity described above is not the real
  -- situation any more and this note would be misleading.
  if v_gmbh is null or v_part is null then
    raise notice 'YPOG entity set changed; review 10305_00404_501_01 by hand';
    return;
  end if;

  update crm.legal_entity
     set review_status = 'review_required',
         review_reason = coalesce(review_reason || ' | ', '') ||
           'Order 10305_00404_501_01 names customer "YPOG Berlin", which matches neither ' ||
           'entity exactly. Customer 10305 holds orders against both this entity and ' ||
           v_part::text || '. Needs a human to say which one the 501 order belongs to.',
         updated_at = now()
   where id = v_gmbh
     and position('10305_00404_501_01' in coalesce(review_reason, '')) = 0;

  -- Same note on the other candidate, so whoever opens either one sees it.
  update crm.legal_entity
     set review_status = 'review_required',
         review_reason = coalesce(review_reason || ' | ', '') ||
           'Order 10305_00404_501_01 names customer "YPOG Berlin"; the other candidate is ' ||
           v_gmbh::text || '. Needs a human decision.',
         updated_at = now()
   where id = v_part
     and position('10305_00404_501_01' in coalesce(review_reason, '')) = 0;
end $$;
