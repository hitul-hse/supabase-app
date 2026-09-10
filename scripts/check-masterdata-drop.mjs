/**
 * The masterdata sheet is only ever read, and the drop that receives it
 * cannot be fed by a stranger.
 *
 * WHY THIS GATE EXISTS. hitul's rule for the masterdata Google Sheet
 * (2026-09-10): "make sure we dont edit anything in the masterdata sheet
 * itself". The live mirror he chose is an Apps Script in his own Drive that
 * exports the sheet hourly and POSTs it to the edge function
 * masterdata-sheet-drop, and a rig timer that pulls the export from Storage
 * (scripts/pull-masterdata-sheet.mjs). Three properties of that path must
 * hold forever, and a refactor could lose any of them without a test noticing:
 *
 *   1. the Apps Script holds no call that writes to the sheet -- it exports
 *      and posts, nothing else;
 *   2. the drop function refuses anything without the shared secret, compares
 *      it in constant time, refuses to run with no secret configured, caps the
 *      body, and checks the body is a zip before storing it in a PRIVATE bucket;
 *   3. the puller treats a silent Google-side trigger as a failure (stale
 *      heartbeat -> non-zero exit), so the dead-man switch can see it.
 *
 * Static on purpose: source reading, no credentials, so it runs on every
 * unattended cycle.
 */
import { readFileSync } from "node:fs";
import { record } from "./lib/gate-result.mjs";

let failures = 0;
const check = (ok, label, detail = "") => {
  record(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const read = (p) => readFileSync(p, "utf8");

// ---- 1. the Apps Script never writes to the sheet
const gs = read("docs/masterdata/apps-script-push.gs");
const WRITE_CALLS = /\b(setValue|setValues|appendRow|insertRow|insertRows|deleteRow|deleteRows|clear|clearContent|setFormula|setNote|setBackground|setFontColor|insertSheet|deleteSheet|setName|copyTo|moveTo|setTrashed|setContent|setDescription)\s*\(/;
check(!WRITE_CALLS.test(gs), "Apps Script: no call that writes to a sheet, a range or a file", (WRITE_CALLS.exec(gs) || [""])[0]);
check(!/SpreadsheetApp\./.test(gs), "Apps Script: does not even open the SpreadsheetApp API; it exports through Drive");
check(/export\?format=xlsx/.test(gs) && /getLastUpdated\(\)/.test(gs), "Apps Script: exports the file as xlsx and reads its modified time");
check(/getProperty\("DROP_SECRET"\)/.test(gs) && !/DROP_SECRET"\s*,\s*"/.test(gs), "Apps Script: the secret comes from Script Properties, not a literal");
check(/"x-heartbeat":\s*"1"/.test(gs), "Apps Script: sends a heartbeat when the sheet is unchanged");
const manifest = JSON.parse(read("docs/masterdata/apps-script-manifest.json"));
/*
 * AN EXACT SET, NOT A PATTERN. Until the 2026-09-10 security review this read
 *
 *   manifest.oauthScopes.every((s) => /readonly|external_request|script\.scriptapp/.test(s))
 *   && !manifest.oauthScopes.some((s) => /\/auth\/(drive|spreadsheets)$/.test(s))
 *
 * and the review ran it against candidate manifests. `every` is a SUBSTRING
 * test, so every scope Google publishes ending in `.readonly` satisfied it --
 * gmail.readonly (all mail), contacts.readonly, calendar.readonly and
 * admin.directory.user.readonly (the whole Workspace directory) each PASSED
 * when added beside the real three. Worse, `[].every()` is vacuously true, so
 * emptying oauthScopes -- which makes Apps Script infer scopes at authorisation
 * time from whatever the code happens to call -- also PASSED. That is the
 * plausible-looking edit, not the obviously hostile one.
 *
 * This script holds the drop secret and already has a consented token, so a
 * widened scope is a widened blast radius with no second prompt. Adding one
 * must therefore be a reviewable diff to THIS list that names the scope and
 * says which call needs it. See docs/security/2026-09-10-masterdata-pipeline-
 * review.md, finding 1.
 */
const ALLOWED_SCOPES = [
  // DriveApp.getFileById(SHEET_ID).getLastUpdated() -- the modified time that
  // decides push vs heartbeat -- and the token for the xlsx export URL.
  "https://www.googleapis.com/auth/drive.readonly",
  // UrlFetchApp: the export GET to docs.google.com and the POST to the drop.
  "https://www.googleapis.com/auth/script.external_request",
  // installHourlyTrigger(): list, delete and create this script's own triggers.
  "https://www.googleapis.com/auth/script.scriptapp",
];
const scopes = Array.isArray(manifest.oauthScopes) ? manifest.oauthScopes : null;
const sameSet = (a, b) => a.length === b.length && [...a].sort().join("\n") === [...b].sort().join("\n");
check(
  scopes !== null && sameSet(scopes, ALLOWED_SCOPES),
  "Apps Script manifest: exactly the three scopes this design needs, no more and no fewer",
  scopes === null
    ? "oauthScopes is missing or is not an array — Apps Script would infer scopes at authorisation time"
    : [
      scopes.filter((s) => !ALLOWED_SCOPES.includes(s)).map((s) => `NOT ALLOWED: ${s}`).join(" "),
      ALLOWED_SCOPES.filter((s) => !scopes.includes(s)).map((s) => `MISSING: ${s}`).join(" "),
      scopes.join(" ") || "(empty)",
    ].filter(Boolean).join(" | "),
);

// ---- 2. the drop function
const fn = read("supabase/functions/masterdata-sheet-drop/index.ts");
check(/MASTERDATA_DROP_SECRET/.test(fn) && /if \(!expected\) return json\(500/.test(fn), "drop: refuses to run when the secret is not configured");
check(/secretMatches\(presented, expected\)/.test(fn) && /crypto\.subtle\.digest\("SHA-256"/.test(fn) && /diff \|= x\[i\] \^ y\[i\]/.test(fn), "drop: compares the secret in constant time");
check(/return json\(401/.test(fn), "drop: a wrong secret is 401");
check(/MAX_BYTES = 15 \* 1024 \* 1024/.test(fn) && /return json\(413/.test(fn), "drop: caps the body at 15 MB");
check(/bytes\[0\] !== 0x50 \|\| bytes\[1\] !== 0x4b/.test(fn), "drop: checks the body is a zip before storing it");
check(/createBucket\(BUCKET, \{ public: false/.test(fn), "drop: the bucket it provisions is private");
check(/from\(BUCKET\)\.upload\(`\$\{PREFIX\}\/\$\{path\}`/.test(fn) && !/\.from\("(stg|crm|projects|public)/.test(fn) && !/\.rpc\(/.test(fn), "drop: writes only under the bucket prefix, never to a table");
check(/x-heartbeat/.test(fn) && /heartbeat\.json/.test(fn), "drop: records the heartbeat the puller relies on");
check(!/console\.log\([^)]*(secret|presented|expected)/.test(fn), "drop: never logs the secret");

// ---- 3. the puller
const pull = read("scripts/pull-masterdata-sheet.mjs");
check(/MAX_HEARTBEAT_AGE_H/.test(pull) && /if \(!\(ageH <= MAX_HEARTBEAT_AGE_H\)\)[\s\S]{0,400}process\.exit\(1\)/.test(pull), "pull: a stale heartbeat is a failure, not a quiet skip");
check(/if \(!heartbeatRes\)[\s\S]{0,300}process\.exit\(1\)/.test(pull), "pull: no heartbeat at all is a failure");
check(/sha256 !== manifest\.sha256[\s\S]{0,200}process\.exit\(1\)/.test(pull), "pull: a download that does not match its manifest is a failure");
check(/newest\.file_hash === manifest\.sha256[\s\S]{0,200}process\.exit\(0\)/.test(pull), "pull: an export already staged is success, not a duplicate import");
check(/import-masterdata-sheet-staging\.mjs/.test(pull) && /MASTERDATA_SHEET_MODIFIED: manifest\.modified/.test(pull), "pull: hands the importer the sheet's modified time");
check(!/docs\.google\.com|sheets\.googleapis/.test(pull), "pull: never talks to Google; the sheet is reached only through the drop");

// ---- 4. wired in
const pkg = JSON.parse(read("package.json"));
check(pkg.scripts["check:masterdata-drop"] === "node scripts/check-masterdata-drop.mjs", "package.json: gate registered");
check(/check:masterdata-drop/.test(pkg.scripts["test:db"]), "package.json: gate chained into test:db");
check(typeof pkg.scripts["pull:masterdata-sheet"] === "string", "package.json: pull script registered");

console.log(failures ? `FAIL (${failures})` : "PASS");
process.exit(failures ? 1 : 0);
