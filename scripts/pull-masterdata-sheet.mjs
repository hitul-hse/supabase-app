/**
 * Pull the newest masterdata sheet export from Storage and stage it.
 *
 * WHY THIS EXISTS. The sheet reaches Supabase by push -- hitul's Apps Script
 * (docs/masterdata/apps-script-push.gs) exports it hourly to the edge function
 * masterdata-sheet-drop, which stores it in the private bucket
 * `masterdata-sheet`. The rig cannot be pushed to (tailnet only), so this is
 * the other half: on its own timer it reads the bucket, and when the export
 * changed it runs import-masterdata-sheet-staging.mjs on it. Together they are
 * the "live connection" HSEHU-18 asked for, with the sheet only ever read.
 *
 * WHAT COUNTS AS FAILURE. This job exits non-zero -- and its dead-man switch
 * therefore reports failure -- when
 *   - the heartbeat the Apps Script leaves is older than MAX_HEARTBEAT_AGE_H:
 *     the Google-side trigger has died, whether or not the sheet changed
 *   - the manifest and the export disagree (sha256), or the download fails
 *   - the importer fails
 * It exits 0 when the export is already staged (same hash as the newest
 * batch): nothing changed is a fine answer, silence about it is not.
 *
 * STAGING ALONE IS NOT LIVE. hitul, 2026-09-10: "new data should be live
 * too". So once a new batch is staged, this job runs the promote step on it
 * (scripts/promote-masterdata-sheet.mjs --apply --batch <id>) in the same
 * run: a clean row reaches public.projects, project_masterdata, the
 * responsibility encodings and the links within the hour; a row with a
 * defect (duplicate key, missing language, unknown customer ...) stays a
 * review case and is reported; a row that vanished from the sheet is marked
 * historical. A failed promote fails the job, so the dead-man switch sees it.
 * --no-promote stages only (the first promote after a schema change is run
 * by hand, dry-run first); --promote promotes the newest batch even when
 * nothing new was staged (a manual re-run after a fix).
 *
 * Usage:  node --env-file=.env.local scripts/pull-masterdata-sheet.mjs [--dry-run] [--no-promote | --promote]
 * Needs:  NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (bucket read),
 *         SUPABASE_DB_URL (the importer's write path)
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadEnv } from "./lib/gate-env.mjs";

const DRY_RUN = process.argv.includes("--dry-run");
const NO_PROMOTE = process.argv.includes("--no-promote");
const FORCE_PROMOTE = process.argv.includes("--promote");
const BUCKET = "masterdata-sheet";
const PREFIX = "V1";
const MAX_HEARTBEAT_AGE_H = Number(process.env.MASTERDATA_MAX_HEARTBEAT_AGE_H || 3);
const SOURCE_SYSTEM = "MASTERDATA_SHEET_V1";
const TARGET = resolve(process.env.MASTERDATA_SHEET_XLSX || ".local/import/masterdata-sheet.xlsx");

const env = loadEnv();
const url = (env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const key = env.SUPABASE_SERVICE_ROLE_KEY || "";
if (!url || !key) {
  console.error("FAIL: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  process.exit(3);
}

async function object(path) {
  const res = await fetch(`${url}/storage/v1/object/${BUCKET}/${PREFIX}/${path}`, { headers: { Authorization: `Bearer ${key}`, apikey: key } });
  if (res.status === 404 || res.status === 400) return null;
  if (!res.ok) throw new Error(`storage ${path}: HTTP ${res.status} ${await res.text()}`);
  return res;
}

const heartbeatRes = await object("heartbeat.json");
if (!heartbeatRes) {
  console.error("FAIL: no heartbeat in the bucket yet -- the Apps Script has never reached the drop function (docs/masterdata/apps-script-push.gs, step 4)");
  process.exit(1);
}
const heartbeat = await heartbeatRes.json();
const ageH = (Date.now() - Date.parse(heartbeat.checked_at)) / 3_600_000;
console.log(`heartbeat: ${heartbeat.checked_at} (${ageH.toFixed(1)} h ago), sheet modified ${heartbeat.modified}, changed=${heartbeat.changed}`);
if (!(ageH <= MAX_HEARTBEAT_AGE_H)) {
  console.error(`FAIL: the Apps Script has not checked in for ${ageH.toFixed(1)} h (limit ${MAX_HEARTBEAT_AGE_H} h) -- its trigger is dead or its push is failing; see the script's Executions page`);
  process.exit(1);
}

const manifestRes = await object("latest.json");
if (!manifestRes) {
  console.error("FAIL: heartbeat present but no export has ever landed (latest.json missing)");
  process.exit(1);
}
const manifest = await manifestRes.json();
console.log(`newest export: ${manifest.path}, ${manifest.bytes} bytes, sheet modified ${manifest.modified}, received ${manifest.received_at}`);

// Already staged? The importer refuses duplicate hashes with exit 1; for this
// timer "nothing new" is success, so ask the batch table first.
let pg;
try {
  ({ default: pg } = await import("pg"));
} catch {
  console.error("FAIL: pg is not installed");
  process.exit(3);
}
const conn = env.SUPABASE_DB_URL || env.DATABASE_URL;
if (!conn) {
  console.error("FAIL: SUPABASE_DB_URL is required for the importer");
  process.exit(3);
}
const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
await client.connect();
const newest = (await client.query(
  `select id, file_hash, received_at from stg.import_batch where source_system = $1 order by received_at desc limit 1`,
  [SOURCE_SYSTEM],
)).rows[0] ?? null;
await client.end();
if (newest && newest.file_hash === manifest.sha256) {
  console.log(`already staged as batch ${newest.id} at ${newest.received_at}; nothing new to stage`);
  if (FORCE_PROMOTE && !NO_PROMOTE) process.exit(promote(newest.id));
  process.exit(0);
}

const fileRes = await object("latest.xlsx");
if (!fileRes) {
  console.error("FAIL: latest.xlsx missing although latest.json names it");
  process.exit(1);
}
const bytes = new Uint8Array(await fileRes.arrayBuffer());
const sha256 = createHash("sha256").update(bytes).digest("hex");
if (sha256 !== manifest.sha256) {
  console.error(`FAIL: latest.xlsx sha256 ${sha256.slice(0, 12)} does not match the manifest ${String(manifest.sha256).slice(0, 12)}`);
  process.exit(1);
}
mkdirSync(dirname(TARGET), { recursive: true });
writeFileSync(TARGET, bytes);
console.log(`downloaded ${bytes.byteLength} bytes to ${TARGET}`);

const args = ["scripts/import-masterdata-sheet-staging.mjs", ...(DRY_RUN ? ["--dry-run"] : [])];
const run = spawnSync(process.execPath, args, {
  stdio: ["inherit", "pipe", "inherit"],
  encoding: "utf8",
  env: { ...process.env, ...env, MASTERDATA_SHEET_XLSX: TARGET, MASTERDATA_SHEET_MODIFIED: manifest.modified },
});
process.stdout.write(run.stdout ?? "");
if (run.status !== 0) process.exit(run.status ?? 1);
if (DRY_RUN || NO_PROMOTE) process.exit(0);
const staged = parseJsonTail(run.stdout);
if (!staged?.import_succeeded || !staged.batch_id) {
  console.error("FAIL: the importer reported no batch id; not promoting");
  process.exit(1);
}
process.exit(promote(staged.batch_id));

/** The last JSON object a child printed, or null. */
function parseJsonTail(text) {
  const i = String(text ?? "").lastIndexOf("\n{");
  try { return JSON.parse(String(text).slice(i < 0 ? 0 : i + 1)); } catch { return null; }
}

/** Promote one staged batch for real; returns the exit status to propagate. */
function promote(batchId) {
  console.log(`promoting batch ${batchId} ...`);
  const p = spawnSync(process.execPath, ["scripts/promote-masterdata-sheet.mjs", "--apply", "--batch", batchId], {
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  return p.status ?? 1;
}
