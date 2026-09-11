/*
 * Customers the sheet knows and the warehouse does not -- created from the
 * sheet's Kontakte tab, keyed on the Lexware number, never matched by name.
 *
 * WHY THIS EXISTS. hitul, 2026-09-10: the data chain must work "with
 * customers as well". The first staged sheet carried services for nine
 * customers that crm.lexware_customer had never seen; without this step
 * those services stay review cases for ever (CUSTOMER_NOT_IN_WAREHOUSE),
 * although the sheet's Kontakte tab holds everything the customer master
 * needs: company name, VAT id, tax number, billing address, the first
 * contact person.
 *
 * WHAT IT DOES, inside the caller's transaction, before the service rows
 * are promoted: for every contacts record of the batch whose Lexware number
 * has at least one service row in the same batch and no crm.lexware_customer
 * row yet, insert crm.legal_entity, crm.lexware_customer (source_account_ref
 * LEXWARE_HSE, the same bridge promote-customer-master.mjs writes) and one
 * crm.location. The Lexware number is the key -- exact, ADR-001.
 *
 * WHAT IT REFUSES. A company name that normalises to an ACTIVE legal entity
 * that already exists (crm.normalise_legal_name, the partial unique index
 * from 20260824181000) is NOT bridged to that entity: that would be matching
 * by name. It is skipped with LEGAL_ENTITY_NAME_TAKEN and reported, so a
 * person links the number to the entity in the customer-master review. A
 * contacts row without a company name is skipped (COMPANY_NAME_MISSING).
 * Existing customers are never touched here; the customer-master review
 * owns them.
 */

import { CONTACT_SHEET_NAME, SERVICE_SHEET_NAME } from "./masterdata-sheet.mjs";

export const SOURCE_ACCOUNT_REF = "LEXWARE_HSE";
export const EXTERNAL_SOURCE_PREFIX = "masterdata-sheet:lexware:";

const payloadOf = (record) => {
  const p = record?.raw_payload;
  if (typeof p === "string") { try { return JSON.parse(p); } catch { return {}; } }
  return p && typeof p === "object" ? p : {};
};
const isFiveDigits = (s) => /^\d{5}$/.test(String(s ?? ""));
const nz = (v) => (v === null || v === undefined || String(v).trim() === "" ? null : String(v).trim());

/** Full name of the first contact person, from whichever fields the tab filled. */
function contactName(v) {
  const full = nz(v.contact1_name);
  if (full) return full;
  const parts = [nz(v.contact1_first_name), nz(v.contact1_last_name)].filter(Boolean);
  return parts.length ? parts.join(" ") : null;
}

/**
 * @param db   anything with query(sql, params) -> Promise<{ rows }>
 * @returns    { created: [...], skipped: [...], counts }
 */
export async function promoteCustomers(db, { batchId, now = new Date() } = {}) {
  if (!batchId) throw new Error("promoteCustomers: batchId is required");
  const nowIso = new Date(now).toISOString();
  const rows = async (sql, params = []) => (await db.query(sql, params)).rows;
  const one = async (sql, params = []) => (await rows(sql, params))[0] ?? null;

  const serviceCustomers = new Set((await rows(
    `select distinct raw_payload->'values'->>'customer_number' as n
       from stg.import_record
      where batch_id = $1 and raw_payload->>'sheet_name' = $2`,
    [batchId, SERVICE_SHEET_NAME],
  )).map((r) => r.n).filter(isFiveDigits));

  const contacts = await rows(
    `select id, row_number, raw_payload from stg.import_record
      where batch_id = $1 and raw_payload->>'sheet_name' = $2
      order by row_number`,
    [batchId, CONTACT_SHEET_NAME],
  );

  const known = new Set((await rows(`select customer_number from crm.lexware_customer`)).map((r) => String(r.customer_number).trim()));

  const created = [];
  const skipped = [];
  const counts = { candidates: 0, created: 0, skipped: {} };
  const skip = (v, reason) => { counts.skipped[reason] = (counts.skipped[reason] ?? 0) + 1; skipped.push({ sheet_row: v.sheet_row ?? null, customer_number: v.customer_number ?? null, reason }); };

  for (const record of contacts) {
    const v = payloadOf(record).values ?? {};
    const number = nz(v.customer_number);
    if (!isFiveDigits(number) || !serviceCustomers.has(number) || known.has(number)) continue;
    counts.candidates += 1;
    const name = nz(v.company_name);
    if (!name) { skip(v, "COMPANY_NAME_MISSING"); continue; }

    // Name is not a key. An active entity with the same normalised name is a
    // review case, not a match.
    const taken = await one(
      `select id, legal_name from crm.legal_entity
        where crm.normalise_legal_name(legal_name) = crm.normalise_legal_name($1)
          and lifecycle_status = 'active' and superseded_by_id is null
        limit 1`,
      [name],
    );
    if (taken) { skip(v, "LEGAL_ENTITY_NAME_TAKEN"); continue; }

    const entity = await one(
      `insert into crm.legal_entity (legal_name, vat_id, tax_number, country_code, external_source_id, review_status, updated_at)
       values ($1, $2, $3, $4, $5, 'approved', $6::timestamptz)
       returning id`,
      [name, nz(v.vat_id), nz(v.tax_number), nz(v.country_code), `${EXTERNAL_SOURCE_PREFIX}${number}`, nowIso],
    );
    const location = (nz(v.street) || nz(v.postal_code) || nz(v.city))
      ? await one(
        `insert into crm.location (legal_entity_id, location_name, location_type, street, postal_code, city, country_code, is_primary, review_status, updated_at)
         values ($1::uuid, null, 'billing', $2, $3, $4, $5, true, 'approved', $6::timestamptz)
         returning id`,
        [entity.id, nz(v.street), nz(v.postal_code), nz(v.city), nz(v.country_code), nowIso],
      )
      : null;
    await db.query(
      `insert into crm.lexware_customer
         (legal_entity_id, location_id, customer_number, source_account_ref, display_name_source,
          billing_name, billing_street, billing_postal_code, billing_city, billing_country_code, vat_id_source,
          contact_name, contact_email, review_status, updated_at)
       values ($1::uuid, $2::uuid, $3, $4, $5, $5, $6, $7, $8, $9, $10, $11, $12, 'approved', $13::timestamptz)
       on conflict do nothing`,
      [entity.id, location?.id ?? null, number, SOURCE_ACCOUNT_REF, name,
        nz(v.street), nz(v.postal_code), nz(v.city), nz(v.country_code), nz(v.vat_id),
        contactName(v), nz(v.contact1_email) ?? nz(v.email_1), nowIso],
    );
    known.add(number);
    counts.created += 1;
    created.push({ sheet_row: v.sheet_row ?? null, customer_number: number, legal_entity_id: entity.id, location_id: location?.id ?? null });
  }
  return { counts, created, skipped };
}
