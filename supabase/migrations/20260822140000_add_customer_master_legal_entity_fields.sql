-- Preserve curated Customer Master fields that are present in
-- HSE_Customer_Masterdata_V1_2.xlsx.
--
-- This migration is additive only. It does not import or modify customer data.
-- The first Lexware import must use:
--   source_account_ref = 'LEXWARE_HSE'
-- source_account_ref remains required by crm.lexware_customer.

begin;

alter table crm.legal_entity
  add column if not exists tax_number text,
  add column if not exists notes text,
  add column if not exists external_source_id text;

commit;
