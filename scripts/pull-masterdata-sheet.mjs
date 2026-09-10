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
 * Usage:  node --env-file=.env.local scripts/pull-masterdata-sheet.mjs [--dry-run]
 * Needs:  NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (bucket read),
 *         SUPABASE_DB_URL (the importer's write path)
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadEnv } from "./lib/gate-env.mjs";

const DRY_RUN = process.argv.includes("--dry-run");
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
  console.log(`already staged as batch ${newest.id} at ${newest.received_at}; nothing to do`);
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
  stdio: "inherit",
  env: { ...process.env, ...env, MASTERDATA_SHEET_XLSX: TARGET, MASTERDATA_SHEET_MODIFIED: manifest.modified },
});
process.exit(run.status ?? 1);
