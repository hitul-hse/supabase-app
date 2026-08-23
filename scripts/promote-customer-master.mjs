/**
 * Promote curated customer-master staging into crm.* and projects.project_order.
 *
 * WHY THIS SCRIPT EXISTS. Bjoern built the pipeline in three parts: an importer
 * into stg.* (his, reused), a review UI, and read models that join
 * projects.project_order -> crm.legal_entity. The middle step -- moving
 * curated rows from staging into the canonical tables -- ran manually in his
 * sandbox and was never committed. This is that step, written down.
 *
 * WHAT GOVERNS IT (ADR-001 / ENTITY_RESOLUTION_RULES):
 *   - Only rows the curated workbook itself marks clean are promoted:
 *     review_status='approved' in staging AND the source row's own status was
 *     OK/ACTIVE. Rows his importer marked review_required stay in staging for
 *     the review UI; promoting them would be exactly the auto-merge ADR-001
 *     forbids.
 *   - The workbook's customer_id is a stable UUID (his curation assigned it);
 *     it becomes crm.legal_entity.external_source_id, so re-running is an
 *     UPDATE, not a duplicate.
 *   - project_orders are derived from the ORDER NUMBERS already imported into
 *     public.projects (the masterdata Excel), linked to legal entities via the
 *     Lexware customer number prefix of the order number (10110_... -> Lexware
 *     10110). That is an exact-key join, not a name match.
 *
 * Everything runs in ONE transaction over the direct Postgres connection
 * (stg/crm are not API-exposed -- his design, kept). --dry-run reports and
 * rolls back.
 */
import { readFileSync } from "node:fs";
import pg from "pg";

const DRY = process.argv.includes("--dry-run");
const EXPECTED_PROJECT_REF = "wdbedblvyrfqwypngghs";

const env = { ...process.env };
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const conn = env.SUPABASE_DB_URL || env.DATABASE_URL;
if (!conn) { console.log("no SUPABASE_DB_URL"); process.exit(1); }
if (!conn.includes(EXPECTED_PROJECT_REF)) {
  console.log(`REFUSED: connection is not the expected project (${EXPECTED_PROJECT_REF})`);
  process.exit(1);
}

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
await client.connect();
const q = async (sql, p) => (await client.query(sql, p)).rows;
const one = async (sql, p) => (await client.query(sql, p)).rows[0];

try {
  await client.query("begin");

  /* ------------------------------------------------ read the staged batch */

  const batch = await one(`
    select id, row_count as record_count from stg.import_batch
    where source_system = 'LEXWARE_HSE' order by created_at desc limit 1
  `);
  if (!batch) throw new Error("no staged batch; run the staging importer first");
  console.log(`batch ${batch.id} (${batch.record_count} records)`);

  const recs = await q(
    `select row_number, raw_payload from stg.import_record
     where batch_id = $1 and review_status = 'approved'`,
    [batch.id],
  );
  const bySheet = {};
  for (const r of recs) {
    const sheet = r.raw_payload.sheet_name;
    (bySheet[sheet] ??= []).push(r.raw_payload.values);
  }
  console.log("clean rows per sheet:", Object.entries(bySheet).map(([k, v]) => `${k}=${v.length}`).join(" "));

  /* -------------------------------------------------------- legal entities */

  let entities = 0;
  const entityIdByWorkbookId = new Map();
  const entityIdByLexware = new Map();
  for (const c of bySheet.customers ?? []) {
    if (!c.customer_id || !c.canonical_name) continue;
    // Clean per the workbook's own curation only.
    if (String(c.review_status).toUpperCase() !== "OK" || String(c.status).toUpperCase() !== "ACTIVE") continue;

    /*
     * Manual upsert: external_source_id carries the workbook's stable UUID,
     * but the follow-up migration added the column WITHOUT a unique
     * constraint, so ON CONFLICT cannot target it. Select-then-write inside
     * the transaction is equivalent here -- this batch is the only writer.
     */
    const existing = await one(
      `select id from crm.legal_entity where external_source_id = $1`,
      [c.customer_id],
    );
    const row = existing
      ? await one(
          `update crm.legal_entity
             set legal_name = $2, vat_id = nullif($3,''), tax_number = nullif($4,''), updated_at = now()
           where id = $1 returning id`,
          [existing.id, c.canonical_name.trim(), c.vat_id, c.tax_number],
        )
      : await one(
          `insert into crm.legal_entity
             (legal_name, vat_id, tax_number, notes, external_source_id, review_status)
           values ($1, nullif($2,''), nullif($3,''), nullif($4,''), $5, 'approved')
           returning id`,
          [c.canonical_name.trim(), c.vat_id, c.tax_number, c.notes, c.customer_id],
        );
    entities += 1;
    entityIdByWorkbookId.set(c.customer_id, row.id);
    for (const n of `${c.primary_lexware_customer_number} ${c.additional_lexware_customer_numbers}`.match(/\d{4,6}/g) ?? []) {
      entityIdByLexware.set(n, row.id);
    }

    // The Lexware reference rows: one per customer number, the stable bridge
    // ADR-001 requires between billing SSOT and the customer master.
    for (const n of `${c.primary_lexware_customer_number} ${c.additional_lexware_customer_numbers}`.match(/\d{4,6}/g) ?? []) {
      await client.query(
        `insert into crm.lexware_customer (legal_entity_id, customer_number, source_account_ref, display_name_source, review_status)
         values ($1, $2, 'LEXWARE_HSE', $3, 'approved')
         on conflict do nothing`,
        [row.id, n, c.canonical_name.trim()],
      );
    }
  }
  console.log(`legal entities upserted: ${entities} (with ${entityIdByLexware.size} Lexware number bridges)`);

  /* --------------------------------------------------------------- aliases */

  let aliases = 0;
  for (const a of bySheet.customer_aliases ?? []) {
    const entity = entityIdByWorkbookId.get(a.customer_id);
    if (!entity || !a.alias) continue;
    await client.query(
      `insert into crm.legal_entity_alias (legal_entity_id, alias_text, alias_type, source_system, review_status)
       select $1, $2, nullif($3,''), nullif($4,''), 'approved'
       where not exists (select 1 from crm.legal_entity_alias where legal_entity_id = $1 and alias_text = $2)`,
      [entity, a.alias.trim(), a.alias_type, a.source],
    );
    aliases += 1;
  }
  console.log(`aliases: ${aliases}`);

  /* ------------------------------------------------------------- locations */

  let locations = 0;
  for (const l of bySheet.locations ?? []) {
    const entity = entityIdByWorkbookId.get(l.customer_id);
    if (!entity) continue;
    await client.query(
      `insert into crm.location (legal_entity_id, location_name, street, postal_code, city, location_type, review_status)
       select $1, nullif($2,''), nullif($3,''), nullif($4,''), nullif($5,''), nullif($6,''), 'approved'
       where not exists (
         select 1 from crm.location
         where legal_entity_id = $1 and coalesce(street,'') = coalesce(nullif($3,''),'')
           and coalesce(postal_code,'') = coalesce(nullif($4,''),'')
       )`,
      [entity, l.location_name, l.street, l.postal_code, l.city, l.location_type],
    );
    locations += 1;
  }
  console.log(`locations: ${locations}`);

  /* --------------------------------------------------------- project orders */

  /*
   * public.projects holds one row per Excel order (imported earlier), keyed by
   * the order number whose leading digits ARE the Lexware customer number.
   * That prefix is an exact key, so this join is ADR-001-clean.
   */
  const hubProjects = await q(`select id, name, status from public.projects where id ~ '^\\d{5}_'`);
  let orders = 0;
  let unmatchedOrders = 0;
  for (const p of hubProjects) {
    const lexware = /^(\d{5})_/.exec(p.id)[1];
    const entity = entityIdByLexware.get(lexware) ?? null;
    if (!entity) unmatchedOrders += 1;
    await client.query(
      `insert into projects.project_order (order_number, name, status, legal_entity_id, review_status)
       select $1, $2, $3, $4, case when $4::uuid is null then 'review_required' else 'approved' end
       where not exists (select 1 from projects.project_order where order_number = $1)`,
      [p.id, p.name, p.status, entity],
    );
    // Re-runs refresh the link if a new entity appeared.
    await client.query(
      `update projects.project_order set legal_entity_id = coalesce(legal_entity_id, $2), updated_at = now()
       where order_number = $1`,
      [p.id, entity],
    );
    orders += 1;
  }
  console.log(`project orders: ${orders} (${orders - unmatchedOrders} linked to a legal entity, ${unmatchedOrders} for review)`);

  /* ----------------------------------------------------------------- proof */

  const proof = await one(`
    select
      (select count(*)::int from crm.legal_entity) entities,
      (select count(*)::int from crm.lexware_customer) lexware_refs,
      (select count(*)::int from crm.legal_entity_alias) aliases,
      (select count(*)::int from crm.location) locations,
      (select count(*)::int from projects.project_order where legal_entity_id is not null) linked_orders,
      (select count(*)::int from projects.project_order) orders
  `);
  console.log("\nfinal state:", JSON.stringify(proof));

  // The exact join the dashboard's read model runs:
  const sample = await q(`
    select po.order_number, le.legal_name
    from projects.project_order po join crm.legal_entity le on le.id = po.legal_entity_id
    order by po.order_number limit 5
  `);
  console.log("dashboard join sample:");
  for (const s of sample) console.log(`  ${s.order_number} -> ${s.legal_name}`);

  if (DRY) {
    await client.query("rollback");
    console.log("\nDRY RUN: rolled back, nothing persisted.");
  } else {
    await client.query("commit");
    console.log("\nCOMMITTED.");
  }
} catch (e) {
  await client.query("rollback");
  console.log("FAILED, rolled back:", e.message);
  process.exit(1);
} finally {
  await client.end();
}
