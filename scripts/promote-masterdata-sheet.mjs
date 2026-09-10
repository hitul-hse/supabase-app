/**
 * Promote the newest staged masterdata-sheet batch into the warehouse.
 *
 * WHY THIS EXISTS. The sheet "V1 HSE-Masterdata Kundenliste" is pulled and
 * staged hourly (pull-masterdata-sheet.mjs -> import-masterdata-sheet-staging.mjs)
 * into stg.import_batch / stg.import_record, where a reviewer sees it on
 * /customer-master/import-review. Staging changes nothing an operations person
 * looks at. This is the step that does: it carries the reviewed rows into
 * public.projects, public.project_masterdata, public.project_contact,
 * public.project_link, projects.project_order and BOTH responsibility
 * encodings, under the decisions of 2026-09-10 (the new key is the stable
 * project key, the old key stays as alias and never moves, a vanished row is
 * marked historical, liveness is contract_end, "-" is null). The logic lives
 * in scripts/lib/masterdata-promote.mjs so the gate
 * scripts/check-masterdata-promote.mjs runs the identical code in PGlite.
 *
 * WHAT IT NEVER DOES
 *   - delete a project, a masterdata row or a project_order: a row the sheet
 *     stopped carrying becomes lifecycle_status = 'historical' with the batch
 *     that last saw it, and comes back to 'active' when it reappears;
 *   - guess: a record resolves by EXACT key only (ADR-001) -- the legacy key
 *     against public.projects.id, the new key against project_masterdata --
 *     and anything else is reported as skipped with its reasons;
 *   - touch the hours refresh-order-hours.mjs owns (status, logged_hours,
 *     logged_hours_as_of, billable_hours, consumed_percent) or the budget
 *     columns; contract_hours is written only when the sheet states a figure;
 *   - promote a record a reviewer has not cleared: 'approved', or
 *     'unreviewed' with no blocking flag. Everything else waits in staging;
 *   - touch a responsibility another process owns (a project_responsibility
 *     row with source 'change_control' is an approved four-eyes handover;
 *     the report says whether the sheet agrees with it) or a hand-added link;
 *   - promote an EMPTY batch, or one that would mark more than half of the
 *     active warehouse historical. Both are refused before any write
 *     persists: a service tab that came through empty or half-filtered is a
 *     broken export, not 120 ended contracts. The dry run prints the refusal
 *     with the figures; --allow-mass-historical is the operator's explicit
 *     answer to it, never the default;
 *   - run against a database other than the one NEXT_PUBLIC_SUPABASE_URL
 *     names, and never applies without --apply.
 *
 * DRY-RUN BY DEFAULT. Without --apply the whole promotion runs inside BEGIN ..
 * ROLLBACK and the report is printed with dry_run: true -- the counts are the
 * real ones, produced by the real writes, and nothing persists. With --apply
 * the same transaction commits. One JSON object on stdout either way; exit 1
 * on any error, after a rollback.
 *
 * Usage:
 *   node --env-file=.env.local scripts/promote-masterdata-sheet.mjs            # dry run, newest completed batch
 *   node --env-file=.env.local scripts/promote-masterdata-sheet.mjs --apply
 *   node --env-file=.env.local scripts/promote-masterdata-sheet.mjs --batch <uuid> [--apply]
 *   node --env-file=.env.local scripts/promote-masterdata-sheet.mjs --apply --allow-mass-historical
 *
 * Required environment: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_DB_URL (or
 * DATABASE_URL). stg is not exposed through PostgREST, so a service-role key
 * cannot do this job; it needs the direct PostgreSQL connection.
 */

import { loadEnv } from "./lib/gate-env.mjs";
import { promoteBatch, SOURCE_SYSTEM } from "./lib/masterdata-promote.mjs";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
// Lifts the disappearance bound (promoteBatch's maxHistoricalShare) to 100%.
// Only for a sheet that really did lose most of its rows, after the dry run
// named the count and a person checked the sheet.
const ALLOW_MASS_HISTORICAL = args.includes("--allow-mass-historical");
const batchArg = args.indexOf("--batch");
const REQUESTED_BATCH = batchArg >= 0 ? args[batchArg + 1] ?? null : null;
if (batchArg >= 0 && !REQUESTED_BATCH) fail("--batch needs a batch id");

const env = loadEnv();

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}
function projectRefFromUrl(url) {
  const m = /^https:\/\/([a-z0-9]+)\.supabase\.co/.exec(url || "");
  return m ? m[1] : null;
}

// The same refusal as import-masterdata-sheet-staging.mjs: the connection must
// belong to the project the app is configured for. A .env.local pointing at
// one project and a DB URL at another would otherwise promote into the wrong
// warehouse without a word.
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

  const batch = REQUESTED_BATCH
    ? (await client.query(`select id, status, source_system, file_name, received_at from stg.import_batch where id = $1`, [REQUESTED_BATCH])).rows[0]
    : (await client.query(
      `select id, status, source_system, file_name, received_at from stg.import_batch
        where source_system = $1 and status = 'completed'
        order by received_at desc, created_at desc limit 1`,
      [SOURCE_SYSTEM],
    )).rows[0];
  if (!batch) fail(REQUESTED_BATCH ? `batch ${REQUESTED_BATCH} does not exist` : `no completed ${SOURCE_SYSTEM} batch is staged; run the staging importer first`);
  if (batch.source_system !== SOURCE_SYSTEM) fail(`batch ${batch.id} is ${batch.source_system}, not ${SOURCE_SYSTEM}`);
  if (batch.status !== "completed") fail(`batch ${batch.id} is ${batch.status}, not completed`);

  await client.query("begin");
  transactionOpen = true;
  const report = await promoteBatch(client, {
    batchId: batch.id, apply: APPLY, now: new Date(), ...(ALLOW_MASS_HISTORICAL ? { maxHistoricalShare: 1 } : {}),
  });

  if (APPLY) {
    await client.query("commit");
    transactionOpen = false;
    console.log(JSON.stringify({ applied: true, dry_run: false, project_ref: projectRef, file_name: batch.file_name, ...report }, null, 2));
  } else {
    await client.query("rollback");
    transactionOpen = false;
    console.log(JSON.stringify({ dry_run: true, applied: false, writes_performed: false, project_ref: projectRef, file_name: batch.file_name, ...report }, null, 2));
  }
} catch (error) {
  if (transactionOpen) await client.query("rollback").catch(() => {});
  console.error(`masterdata sheet promotion rolled back: ${error.message}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
