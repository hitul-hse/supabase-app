/**
 * Push the masterdata Google Sheet to the HSE Hub, hourly, without editing it.
 *
 * WHERE THIS RUNS. As a STANDALONE Apps Script project in hitul's own Drive
 * (script.google.com -> New project), not bound to the sheet. It reads the
 * sheet through his own access, exports it as xlsx exactly as "File > Download"
 * would, and POSTs the bytes to the Supabase function masterdata-sheet-drop.
 * The sheet itself is never written to. Chosen on 2026-09-10 over a Google
 * service account: nothing to create in the Cloud console, no key file.
 *
 * SETUP (once, from any browser):
 *   1. script.google.com -> New project -> name it "HSE masterdata push".
 *   2. Replace Code.gs with this file. Project Settings -> tick "Show
 *      appsscript.json manifest file" -> replace it with apps-script-manifest.json.
 *   3. Project Settings -> Script Properties -> add:
 *        SHEET_ID     16Xs8SbSdfW_yLY51IKPYZUsZVo-HkEWzGqEt6mJ6rsQ
 *        DROP_URL     https://<project-ref>.supabase.co/functions/v1/masterdata-sheet-drop
 *        ANON_KEY     the project's anon key (public; it only passes the gateway)
 *        DROP_SECRET  the shared secret, the same value set as MASTERDATA_DROP_SECRET
 *                     on the function (from the rig: ~/.config/hse/masterdata-drop.env)
 *   4. Run `pushMasterdataNow` once; approve the permissions it asks for
 *      (read your Drive files, connect to an external service). The execution
 *      log should end in {"stored": ...}.
 *   5. Run `installHourlyTrigger` once. Triggers (clock icon) then shows it.
 *
 * EVERY HOUR. pushMasterdata compares the file's modified time with the last
 * push. Changed: export and POST. Unchanged: POST a heartbeat, so the rig can
 * tell "nobody edited the sheet" from "the trigger died". Either way a failed
 * POST throws, which Apps Script reports by e-mail to the script's owner.
 */

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function settings_() {
  const p = PropertiesService.getScriptProperties();
  const s = {
    sheetId: p.getProperty("SHEET_ID"),
    dropUrl: p.getProperty("DROP_URL"),
    anonKey: p.getProperty("ANON_KEY"),
    secret: p.getProperty("DROP_SECRET"),
  };
  for (const [k, v] of Object.entries(s)) if (!v) throw new Error("Script property missing: " + k);
  return s;
}

function headers_(s, modified, extra) {
  return Object.assign({
    Authorization: "Bearer " + s.anonKey,
    apikey: s.anonKey,
    "x-masterdata-secret": s.secret,
    "x-sheet-id": s.sheetId,
    "x-sheet-modified": modified,
  }, extra || {});
}

function post_(s, options) {
  const res = UrlFetchApp.fetch(s.dropUrl, Object.assign({ method: "post", muteHttpExceptions: true }, options));
  const code = res.getResponseCode();
  const body = res.getContentText();
  if (code !== 200) throw new Error("masterdata-sheet-drop answered " + code + ": " + body);
  return body;
}

/** Hourly trigger target. Pushes when the sheet changed, heartbeats when it did not. */
function pushMasterdata() {
  return push_(false);
}

/** Manual run: pushes even if the sheet is unchanged. Use it once at setup and whenever in doubt. */
function pushMasterdataNow() {
  return push_(true);
}

function push_(force) {
  const s = settings_();
  const p = PropertiesService.getScriptProperties();
  const file = DriveApp.getFileById(s.sheetId);
  const modified = file.getLastUpdated().toISOString();
  const lastPushed = p.getProperty("LAST_PUSHED_MODIFIED");

  if (!force && lastPushed === modified) {
    const hb = post_(s, { headers: headers_(s, modified, { "x-heartbeat": "1" }), payload: "" });
    Logger.log("unchanged since " + modified + "; heartbeat sent: " + hb);
    return hb;
  }

  const exportUrl = "https://docs.google.com/spreadsheets/d/" + s.sheetId + "/export?format=xlsx";
  const exported = UrlFetchApp.fetch(exportUrl, {
    headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true,
  });
  if (exported.getResponseCode() !== 200) {
    throw new Error("xlsx export failed with " + exported.getResponseCode() + " -- is the sheet still shared with this account?");
  }
  const bytes = exported.getContent();
  const answer = post_(s, { contentType: XLSX_MIME, payload: bytes, headers: headers_(s, modified) });
  p.setProperty("LAST_PUSHED_MODIFIED", modified);
  Logger.log("pushed " + bytes.length + " bytes (modified " + modified + "): " + answer);
  return answer;
}

/** Installs the hourly trigger, replacing any earlier one for pushMasterdata. */
function installHourlyTrigger() {
  for (const t of ScriptApp.getProjectTriggers()) {
    if (t.getHandlerFunction() === "pushMasterdata") ScriptApp.deleteTrigger(t);
  }
  ScriptApp.newTrigger("pushMasterdata").timeBased().everyHours(1).create();
  Logger.log("hourly trigger installed for pushMasterdata");
}
