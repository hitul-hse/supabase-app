/*
 * Does promoteCustomers create a customer the warehouse lacks from the
 * sheet's Kontakte row, by Lexware number only, and refuse a name that is
 * already an active legal entity?
 *
 * The world is real: schema.sql + the customer-master foundation + the
 * legal-entity fields + the dedupe migration (crm.normalise_legal_name and
 * the active-name unique index, which is the guard this module leans on) +
 * the masterdata warehouse migration. The fixture batch is shaped like the
 * staging importer writes it (sheet_name, values keys). Run twice: the second
 * run must create nothing.
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { record } from "./lib/gate-result.mjs";
import { promoteCustomers, EXTERNAL_SOURCE_PREFIX } from "./lib/masterdata-customers.mjs";

let failures = 0;
const check = (label, ok, detail = "") => {
  record(ok);
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};
const preamble = `
  create schema if not exists auth;
  create table auth.users (id uuid primary key, email text);
  do $$ begin
    if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
    if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
  end $$;
  create or replace function auth.uid() returns uuid
    language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
`;
const db = await new PGlite();
await db.exec(preamble);
for (const f of [
  "supabase/schema.sql",
  "supabase/migrations/20260822130000_create_customer_master_foundation.sql",
  "supabase/migrations/20260822140000_add_customer_master_legal_entity_fields.sql",
  "supabase/migrations/20260824181000_dedupe_legal_entities.sql",
  "supabase/migrations/20260910120000_masterdata_sheet_warehouse.sql",
]) await db.exec(readFileSync(f, "utf8"));
const rows = async (sql, p = []) => (await db.query(sql, p)).rows;
const one = async (sql, p = []) => (await rows(sql, p))[0];

// An entity that already exists, under a name the sheet will reuse.
await db.exec(`insert into crm.legal_entity (legal_name, review_status) values ('Alt Bestand GmbH', 'approved');
               insert into crm.lexware_customer (legal_entity_id, customer_number, source_account_ref, review_status)
                 select id, '10100', 'LEXWARE_HSE', 'approved' from crm.legal_entity where legal_name = 'Alt Bestand GmbH'`);

const batch = await one(`insert into stg.import_batch (source_system, entity_type, file_name, file_hash, status, row_count)
                         values ('MASTERDATA_SHEET_V1', 'masterdata_v1', 'fixture.xlsx @ 2026-09-09T12:57:12.340Z', 'h1', 'completed', 6) returning id`);
const rec = (n, sheet, values) => db.query(
  `insert into stg.import_record (batch_id, row_number, source_customer_number, raw_payload, validation_status, resolution_status, review_status)
   values ($1, $2, $3, $4::jsonb, 'valid', 'unresolved', 'unreviewed')`,
  [batch.id, n, values.customer_number ?? null, JSON.stringify({ sheet_name: sheet, sheet_row: n, values, flags: [] })],
);
// services for 10284 (new), 10285 (name taken), 10286 (no company name), 10100 (already known)
await rec(1, "service_orders", { customer_number: "10284", order_number: "10284_00184_1000.2_01" });
await rec(2, "service_orders", { customer_number: "10285", order_number: "10285_00183_1000.2_01" });
await rec(3, "service_orders", { customer_number: "10286", order_number: "10286_00001_1000.1_01" });
await rec(4, "service_orders", { customer_number: "10100", order_number: "10100_00001_1000.1_01" });
// contacts
await rec(10, "contacts", { customer_number: "10284", company_name: "Neu Kunde GmbH", vat_id: "DE123456789", tax_number: "12/345/67890", street: "Neue Straße 1", postal_code: "10115", city: "Berlin", country_code: "DE", contact1_first_name: "Erika", contact1_last_name: "Muster", contact1_email: "erika@example.com" });
await rec(11, "contacts", { customer_number: "10285", company_name: "alt  bestand gmbh", street: "Irgendwo 2", postal_code: "20095", city: "Hamburg", country_code: "DE" });
await rec(12, "contacts", { customer_number: "10286", street: "Namenlos 3", postal_code: "30159", city: "Hannover", country_code: "DE" });
await rec(13, "contacts", { customer_number: "10100", company_name: "Alt Bestand GmbH" });
await rec(14, "contacts", { customer_number: "10999", company_name: "Ohne Service AG", city: "Köln" });

const r1 = await promoteCustomers(db, { batchId: batch.id, now: new Date("2026-09-10T12:00:00Z") });
check("candidates are the customers with a service row and no warehouse row (10284, 10285, 10286)", r1.counts.candidates === 3, JSON.stringify(r1.counts));
check("exactly one customer is created", r1.counts.created === 1 && r1.created[0]?.customer_number === "10284");
check("a company name that normalises to an active entity is NOT bridged by name (LEGAL_ENTITY_NAME_TAKEN)", r1.counts.skipped.LEGAL_ENTITY_NAME_TAKEN === 1);
check("a contacts row without a company name is skipped (COMPANY_NAME_MISSING)", r1.counts.skipped.COMPANY_NAME_MISSING === 1);
check("a customer with no service row in the batch is ignored, not created", !(await one(`select 1 as x from crm.legal_entity where legal_name = 'Ohne Service AG'`)));
check("a customer the warehouse already knows is untouched", (await one(`select count(*)::int n from crm.lexware_customer where customer_number = '10100'`)).n === 1);

const entity = await one(`select id, legal_name, vat_id, tax_number, country_code, external_source_id, review_status, lifecycle_status from crm.legal_entity where external_source_id = $1`, [`${EXTERNAL_SOURCE_PREFIX}10284`]);
check("the legal entity carries name, VAT id, tax number, country and its provenance", entity && entity.legal_name === "Neu Kunde GmbH" && entity.vat_id === "DE123456789" && entity.tax_number === "12/345/67890" && entity.country_code === "DE" && entity.review_status === "approved" && entity.lifecycle_status === "active", JSON.stringify(entity));
const lex = await one(`select customer_number, source_account_ref, display_name_source, billing_street, billing_postal_code, billing_city, billing_country_code, vat_id_source, contact_name, contact_email, location_id, legal_entity_id from crm.lexware_customer where customer_number = '10284'`);
check("the Lexware bridge row is keyed on the number with the LEXWARE_HSE account ref", lex && lex.source_account_ref === "LEXWARE_HSE" && lex.legal_entity_id === entity.id);
check("billing address, VAT id and first contact come from the Kontakte row", lex.billing_street === "Neue Straße 1" && lex.billing_postal_code === "10115" && lex.billing_city === "Berlin" && lex.billing_country_code === "DE" && lex.vat_id_source === "DE123456789" && lex.contact_name === "Erika Muster" && lex.contact_email === "erika@example.com");
const loc = await one(`select legal_entity_id, location_type, street, postal_code, city, country_code, is_primary from crm.location where id = $1`, [lex.location_id]);
check("one primary billing location is created and linked from the bridge row", loc && loc.legal_entity_id === entity.id && loc.location_type === "billing" && loc.is_primary === true && loc.city === "Berlin");

const before = await one(`select (select count(*)::int from crm.legal_entity) e, (select count(*)::int from crm.lexware_customer) l, (select count(*)::int from crm.location) o`);
const r2 = await promoteCustomers(db, { batchId: batch.id, now: new Date("2026-09-10T13:00:00Z") });
const after = await one(`select (select count(*)::int from crm.legal_entity) e, (select count(*)::int from crm.lexware_customer) l, (select count(*)::int from crm.location) o`);
check("a second run creates nothing (idempotent)", r2.counts.created === 0 && JSON.stringify(before) === JSON.stringify(after), JSON.stringify(r2.counts));
check("the second run still reports the two skips, so they stay visible until a person acts", r2.counts.skipped.LEGAL_ENTITY_NAME_TAKEN === 1 && r2.counts.skipped.COMPANY_NAME_MISSING === 1);

// Negative control: the name guard must be the normalised one, not exact text.
const guard = await one(`select crm.normalise_legal_name('alt  bestand gmbh') = crm.normalise_legal_name('Alt Bestand GmbH') as same`);
check("the guard compares normalised names (case and whitespace do not evade it)", guard.same === true);

console.log(failures ? `FAIL (${failures})` : "PASS");
process.exit(failures ? 1 : 0);
