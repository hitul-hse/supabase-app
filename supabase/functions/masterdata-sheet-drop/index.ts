/**
 * masterdata-sheet-drop -- the landing point for the masterdata Google Sheet.
 *
 * WHY THIS EXISTS. The sheet "V1 HSE-Masterdata Kundenliste" is the single
 * source for customers, service orders and responsibilities, and it is never
 * edited from our side. The rig that mirrors it into Supabase sits behind a
 * private tailnet with no inbound path from Google, so the sheet cannot be
 * pushed to the rig -- but it can be pushed HERE. A standalone Apps Script in
 * hitul's Drive (docs/masterdata/apps-script-push.gs) exports the sheet as xlsx
 * on an hourly trigger and POSTs it to this function, which stores it in the
 * private Storage bucket `masterdata-sheet`. The rig's timer then pulls the
 * newest export and runs scripts/import-masterdata-sheet-staging.mjs. Chosen by
 * hitul on 2026-09-10 over a service account ("go with option 1 apps script"):
 * no Google Cloud console, no key file to move, and the sheet is only read.
 *
 * WHAT IT ACCEPTS. POST with
 *   Authorization: Bearer <anon key>      the gateway's JWT check (verify_jwt)
 *   x-masterdata-secret: <shared secret>  MASTERDATA_DROP_SECRET, compared in
 *                                          constant time; without it: 401
 *   x-sheet-id, x-sheet-modified           the Drive file id and its modified
 *                                          time (ISO), recorded in the manifest
 *   body: the xlsx bytes                   at most MAX_BYTES; must be a zip
 * or, with x-heartbeat: 1 and an empty body, a heartbeat saying "I checked and
 * the sheet is unchanged" -- so the rig can tell a quiet sheet from a dead
 * trigger. That distinction is the whole point of a dead-man switch.
 *
 * WHAT IT WRITES. In the bucket, under V1/:
 *   <modified>_<sha12>.xlsx   one object per distinct export, never overwritten
 *   latest.xlsx               the newest export
 *   latest.json               { sheet_id, modified, sha256, bytes, received_at, path }
 *   heartbeat.json            { checked_at, modified, changed }
 * Nothing else. It never touches stg, crm, projects or public; the importer
 * on the rig owns those decisions.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const BUCKET = "masterdata-sheet";
const PREFIX = "V1";
const MAX_BYTES = 15 * 1024 * 1024;
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

// Constant-time comparison through digests: the lengths differ between a
// wrong guess and the real secret, and a plain string compare leaks that.
async function secretMatches(presented: string, expected: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(presented)),
    crypto.subtle.digest("SHA-256", enc.encode(expected)),
  ]);
  const x = new Uint8Array(a), y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0 && presented.length === expected.length;
}

const isIso = (s: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(s);

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json(405, { error: "POST only" });

  const expected = Deno.env.get("MASTERDATA_DROP_SECRET") ?? "";
  if (!expected) return json(500, { error: "MASTERDATA_DROP_SECRET is not set on this function" });
  const presented = req.headers.get("x-masterdata-secret") ?? "";
  if (!(await secretMatches(presented, expected))) return json(401, { error: "bad secret" });

  const sheetId = (req.headers.get("x-sheet-id") ?? "").trim();
  const modified = (req.headers.get("x-sheet-modified") ?? "").trim();
  if (!/^[A-Za-z0-9_-]{20,}$/.test(sheetId)) return json(400, { error: "x-sheet-id missing or malformed" });
  if (!isIso(modified)) return json(400, { error: "x-sheet-modified must be an ISO instant, e.g. 2026-09-09T12:57:12.340Z" });

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !serviceRole) return json(500, { error: "function is missing its Supabase environment" });
  const supabase = createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });

  // The bucket provisions itself, private, so setup is one deploy and nothing else.
  const { data: buckets, error: listError } = await supabase.storage.listBuckets();
  if (listError) return json(502, { error: `storage: ${listError.message}` });
  if (!buckets?.some((b) => b.name === BUCKET)) {
    const { error } = await supabase.storage.createBucket(BUCKET, { public: false, fileSizeLimit: MAX_BYTES, allowedMimeTypes: [XLSX, "application/json"] });
    if (error) return json(502, { error: `storage: could not create bucket: ${error.message}` });
  }
  const put = (path: string, body: Uint8Array | string, contentType: string, upsert: boolean) =>
    supabase.storage.from(BUCKET).upload(`${PREFIX}/${path}`, body, { contentType, upsert, cacheControl: "0" });

  const receivedAt = new Date().toISOString();

  if (req.headers.get("x-heartbeat") === "1") {
    const { error } = await put("heartbeat.json", JSON.stringify({ checked_at: receivedAt, modified, changed: false, sheet_id: sheetId }), "application/json", true);
    if (error) return json(502, { error: `storage: ${error.message}` });
    return json(200, { heartbeat: true, checked_at: receivedAt, modified });
  }

  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BYTES) return json(413, { error: `export larger than ${MAX_BYTES} bytes` });
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength > MAX_BYTES) return json(413, { error: `export larger than ${MAX_BYTES} bytes` });
  // An xlsx is a zip: "PK\x03\x04". Anything else is not the sheet, whatever the header says.
  if (bytes.byteLength < 1024 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return json(400, { error: "body is not an xlsx export" });

  const sha256 = hex(await crypto.subtle.digest("SHA-256", bytes));
  const path = `${modified.replace(/[:.]/g, "-")}_${sha256.slice(0, 12)}.xlsx`;

  const stored = await put(path, bytes, XLSX, false);
  const alreadyStored = Boolean(stored.error && /exists|duplicate/i.test(stored.error.message));
  if (stored.error && !alreadyStored) return json(502, { error: `storage: ${stored.error.message}` });

  const latest = await put("latest.xlsx", bytes, XLSX, true);
  if (latest.error) return json(502, { error: `storage: ${latest.error.message}` });
  const manifest = { sheet_id: sheetId, modified, sha256, bytes: bytes.byteLength, received_at: receivedAt, path: `${PREFIX}/${path}` };
  const man = await put("latest.json", JSON.stringify(manifest), "application/json", true);
  if (man.error) return json(502, { error: `storage: ${man.error.message}` });
  const hb = await put("heartbeat.json", JSON.stringify({ checked_at: receivedAt, modified, changed: true, sheet_id: sheetId }), "application/json", true);
  if (hb.error) return json(502, { error: `storage: ${hb.error.message}` });

  console.log(`masterdata-sheet-drop: stored ${manifest.path} (${bytes.byteLength} bytes, modified ${modified}${alreadyStored ? ", already present" : ""})`);
  return json(200, { stored: manifest.path, already_stored: alreadyStored, sha256, bytes: bytes.byteLength, modified, received_at: receivedAt });
});
