/**
 * Land the masterdata Google Sheet in staging -- stg only, one transaction.
 *
 * WHY THIS EXISTS. On 2026-09-10 the business side handed over "V1
 * HSE-Masterdata Kundenliste", the sheet that replaces the August Excel as the
 * single source for customers, service orders, responsibilities and the links
 * the My Work tab shows. hitul's rule: the sheet is never edited from our side;
 * Supabase mirrors it -- staging, review on /customer-master/import-review,
 * then promotion with exact keys (ADR-001) -- exactly as the customer-master
 * workbook was handled by import-customer-master-staging.mjs. This is the
 * staging half. It never writes to crm, projects, time or public.
 *
 * WHAT IT WRITES. One stg.import_batch per distinct file (sha256 of the xlsx;
 * the same export twice is refused, not duplicated) and one stg.import_record
 * per service row and per customer row. raw_payload carries
 *   sheet_name       "service_orders" | "contacts"
 *   sheet_row        the row in the Google Sheet, so a reviewer can point at it
 *   values           the parsed, typed row under the English keys the review
 *                    page already understands (customer_name, street, city,
 *                    order_number, order_name, customer_id ...)
 *   source_values    the cells exactly as the sheet holds them, under the
 *                    sheet's own German headers
 *   flags            what a reviewer must know: DUPLICATE_ORDER_KEY,
 *                    MISSING_LANGUAGE, KEY_PREFIX_MISMATCH, NEW_SERVICE,
 *                    CUSTOMER_NOT_IN_WAREHOUSE, UNMATCHED_RESPONSIBLE ...
 * normalized_payload repeats `values`; review_reason lists errors and flags.
 *
 * RESOLUTION IS READ-ONLY AND EXACT. A customer resolves through
 * crm.lexware_customer.customer_number (never by name); a service order
 * through projects.project_order.order_number, first by the new key, then by
 * the legacy key the warehouse holds today; a person through public.people.name
 * as written. Anything that does not resolve is a review case, never a guess.
 *
 * Usage:
 *   node --env-file=.env.local scripts/import-masterdata-sheet-staging.mjs [--dry-run]
 *   MASTERDATA_SHEET_XLSX=path/to/export.xlsx ...   (default .local/import/masterdata-sheet.xlsx)
 *   MASTERDATA_SHEET_MODIFIED=2026-09-09T12:57:12Z  (the sheet's modifiedTime, recorded in file_name)
 *
 * Required environment: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_DB_URL (or
 * DATABASE_URL). The stg schema is not exposed through PostgREST, so a
 * service-role key cannot do this job.
 */

import { basename, resolve } from "node:path";
import { loadEnv } from "./lib/gate-env.mjs";
import {
  SERVICE_TAB, CONTACT_TAB, SERVICE_SHEET_NAME,
  SERVICE_COLUMNS, CONTACT_COLUMNS, SERVICE_HEADER_ANCHOR, CONTACT_HEADER_ANCHOR,
  readWorkbook, headerDrift, dataRows, normaliseServiceRow, normaliseContactRow,
  flagDuplicateKeys, BLOCKING_FLAGS, indexPeopleByFirstName, resolveStagedRecords,
} from "./lib/masterdata-sheet.mjs";

const DRY_RUN = process.argv.includes("--dry-run");
const SOURCE_SYSTEM = "MASTERDATA_SHEET_V1";
const ENTITY_TYPE = "masterdata_v1";
const env = loadEnv();
const INPUT_FILE = resolve(env.MASTERDATA_SHEET_XLSX || ".local/import/masterdata-sheet.xlsx");

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}
function projectRefFromUrl(url) {
  const m = /^https:\/\/([a-z0-9]+)\.supabase\.co/.exec(url || "");
  return m ? m[1] : null;
}

// ---------------------------------------------------------------- read + normalise

const { tabs, fileHash, bytes } = readWorkbook(INPUT_FILE);
const serviceHeader = headerDrift(tabs[SERVICE_TAB], SERVICE_HEADER_ANCHOR, SERVICE_COLUMNS);
const contactHeader = headerDrift(tabs[CONTACT_TAB], CONTACT_HEADER_ANCHOR, CONTACT_COLUMNS);
if (serviceHeader.drift.length || contactHeader.drift.length) {
  console.error("The sheet's layout no longer matches the contract in scripts/lib/masterdata-sheet.mjs. Refusing to import rather than guessing which column is which:");
  for (const d of [...serviceHeader.drift, ...contactHeader.drift]) console.error(`  ${d}`);
  process.exit(1);
}

const services = flagDuplicateKeys(dataRows(tabs[SERVICE_TAB], serviceHeader.headerRow).map(normaliseServiceRow));
const contacts = dataRows(tabs[CONTACT_TAB], contactHeader.headerRow).map(normaliseContactRow);
const customersWithServices = new Set(services.map((s) => s.values.customer_number).filter(Boolean));

// ---------------------------------------------------------------- database

const projectRef = projectRefFromUrl(env.NEXT_PUBLIC_SUPABASE_URL);
if (!projectRef) fail("NEXT_PUBLIC_SUPABASE_URL is missing or not a Supabase URL");
const connectionString = env.SUPABASE_DB_URL || env.DATABASE_URL;
if (!connectionString) fail("SUPABASE_DB_URL or DATABASE_URL is required (direct PostgreSQL; stg is not exposed through PostgREST)");
if (!connectionString.includes(projectRef)) fail(`the database connection is not the project NEXT_PUBLIC_SUPABASE_URL names (${projectRef}); refusing`);

let pg;
try {
  ({ default: pg } = await import("pg"));
} catch {
  fail("the pg package is not installed");
}
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
let transactionOpen = false;

try {
  await client.connect();

  // Read-only lookups for exact-key resolution.
  const lexware = new Map((await client.query(`select customer_number, legal_entity_id from crm.lexware_customer`)).rows
    .map((r) => [String(r.customer_number).trim(), r.legal_entity_id]));
  const orderNumbers = new Set((await client.query(`select order_number from projects.project_order`)).rows.map((r) => r.order_number));
  // People resolve by normalised first name; the rule and its ambiguity
  // handling live with resolveStagedRecords in lib/masterdata-sheet.mjs.
  const people = indexPeopleByFirstName((await client.query(`select id, name from public.people where is_active`)).rows);

  // The resolution step itself is shared with check-masterdata-promote.mjs, so
  // the gate's fixture is shaped by exactly this code.
  const { records, tally } = resolveStagedRecords({ services, contacts, lexware, orderNumbers, people });

  const blocking = records.filter((r) => r.review_status === "review_required");
  const invalid = records.filter((r) => r.validation_status === "invalid");
  const summary = {
    project_ref: projectRef,
    file: basename(INPUT_FILE),
    file_bytes: bytes,
    file_hash: fileHash,
    sheet_modified: env.MASTERDATA_SHEET_MODIFIED ?? null,
    service_rows: services.length,
    contact_rows: contacts.length,
    records: records.length,
    review_required: blocking.length,
    invalid: invalid.length,
    unresolved: records.filter((r) => r.resolution_status === "unresolved").length,
    customers_with_services: customersWithServices.size,
    customers_in_warehouse: lexware.size,
    orders_in_warehouse: orderNumbers.size,
    people_matchable: [...people.values()].filter((v) => v !== "AMBIGUOUS").length,
    flags: Object.fromEntries(Object.entries(tally).sort()),
    blocking_rows: Object.fromEntries([...BLOCKING_FLAGS].map((flag) => [
      flag,
      records.filter((r) => r.flags.includes(flag) && r.raw_payload.sheet_name === SERVICE_SHEET_NAME).map((r) => r.sheet_row),
    ]).filter(([, rows]) => rows.length)),
    invalid_rows: invalid.map((r) => `${r.raw_payload.sheet_name} row ${r.sheet_row}: ${r.validation_error}`),
  };

  const existing = await client.query(
    `select id, received_at from stg.import_batch where source_system = $1 and file_hash = $2 limit 1`,
    [SOURCE_SYSTEM, fileHash],
  );

  if (DRY_RUN) {
    console.log(JSON.stringify({ dry_run: true, writes_performed: false, duplicate_batch_found: existing.rowCount > 0, existing_batch_id: existing.rows[0]?.id ?? null, ...summary }, null, 2));
    await client.end();
    process.exit(0);
  }
  if (existing.rowCount) fail(`this exact export was already staged as batch ${existing.rows[0].id} at ${existing.rows[0].received_at}; a changed sheet has a different hash`);

  await client.query("begin");
  transactionOpen = true;
  const fileName = env.MASTERDATA_SHEET_MODIFIED ? `${basename(INPUT_FILE)} @ ${env.MASTERDATA_SHEET_MODIFIED}` : basename(INPUT_FILE);
  const batch = await client.query(
    `insert into stg.import_batch (source_system, entity_type, file_name, file_hash, status, started_at, row_count, error_count)
     values ($1, $2, $3, $4, 'processing', now(), $5, 0) returning id`,
    [SOURCE_SYSTEM, ENTITY_TYPE, fileName, fileHash, records.length],
  );
  const batchId = batch.rows[0].id;
  const chunk = 100;
  for (let start = 0; start < records.length; start += chunk) {
    const slice = records.slice(start, start + chunk);
    const params = [];
    const tuples = slice.map((r, i) => {
      const o = i * 11;
      params.push(batchId, r.row_number, r.source_external_id, r.source_customer_number, JSON.stringify(r.raw_payload), JSON.stringify(r.normalized_payload),
        r.validation_status, r.validation_error, r.resolution_status, r.candidate_legal_entity_id, r.review_status);
      return `($${o + 1}, $${o + 2}, $${o + 3}, $${o + 4}, $${o + 5}::jsonb, $${o + 6}::jsonb, $${o + 7}, $${o + 8}, $${o + 9}, $${o + 10}, $${o + 11})`;
    });
    await client.query(
      `insert into stg.import_record (batch_id, row_number, source_external_id, source_customer_number, raw_payload, normalized_payload,
         validation_status, validation_error, resolution_status, candidate_legal_entity_id, review_status)
       values ${tuples.join(", ")}`,
      params,
    );
  }
  // review_reason is written separately so the tuple above stays readable
  for (const r of records) {
    if (r.review_reason) await client.query(`update stg.import_record set review_reason = $3 where batch_id = $1 and row_number = $2`, [batchId, r.row_number, r.review_reason]);
  }
  const verify = (await client.query(
    `select count(*)::int n, count(*) filter (where review_status = 'review_required')::int review_required,
            count(*) filter (where validation_status = 'invalid')::int invalid,
            count(*) filter (where resolution_status = 'unresolved')::int unresolved,
            count(*) filter (where candidate_legal_entity_id is not null)::int with_candidate
       from stg.import_record where batch_id = $1`,
    [batchId],
  )).rows[0];
  if (verify.n !== records.length) fail(`wrote ${verify.n} records, expected ${records.length}`);
  await client.query(`update stg.import_batch set status = 'completed', finished_at = now(), row_count = $2, error_count = $3 where id = $1`, [batchId, verify.n, verify.invalid]);
  await client.query("commit");
  transactionOpen = false;
  console.log(JSON.stringify({ import_succeeded: true, batch_id: batchId, ...summary, verified: verify }, null, 2));
} catch (error) {
  if (transactionOpen) await client.query("rollback").catch(() => {});
  console.error(`masterdata sheet staging import rolled back: ${error.message}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
