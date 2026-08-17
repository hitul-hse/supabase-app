// Test gate for the TrackingTime connector's response handling.
//
// Why this exists as a gate rather than a comment: TrackingTime reports errors
// as HTTP 200 with an error status INSIDE the body. Verified against
// developers.trackingtime.co:
//
//   { "response": { "status": 500, "message": "..." }, "data": {} }
//
// So `res.ok` is not a success check for this vendor. The original connector
// used a permissive unwrap that returned `{}` for that payload without
// throwing, which means a failed call would have been inventoried as
// "0 records" and a human would have written DDL believing the entity was
// empty rather than broken. That is worse than a crash, because it is quiet.
//
// The second trap pinned here: a login belonging to several workspaces needs
// /:account_id/ in the path. Omitted, the API silently uses the default
// workspace -- so discovery can inventory the WRONG COMPANY's data and look
// perfectly healthy doing it.
//
// Run: node scripts/discover/check-trackingtime.mjs

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(join(HERE, "run.mjs"), "utf8");

let failed = false;
function check(label, condition, detail = "") {
  const ok = Boolean(condition);
  if (!ok) failed = true;
  console.log(`${ok ? "PASS" : "FAIL"} | ${label}${!ok && detail ? `\n       ${detail}` : ""}`);
}

// ---------------------------------------------------------------------------
// The envelope contract, exercised as behaviour rather than asserted as text.
//
// This mirrors the unwrap in run.mjs. Kept as a local copy on purpose: the
// connector's copy is a closure inside run(), and importing run.mjs would fire
// real network calls. If the two drift, the source assertions below catch it.
// ---------------------------------------------------------------------------

const unwrap = (body) => {
  const status = body?.response?.status;
  if (status !== undefined && Number(status) >= 400) {
    throw new Error(`API error ${status}: ${body?.response?.message ?? "no message"}`);
  }
  const data = body?.data ?? body;
  return Array.isArray(data) ? data : data ? [data] : [];
};

const threw = (body) => {
  try {
    unwrap(body);
    return false;
  } catch {
    return true;
  }
};

// --- the trap: an error arriving as HTTP 200 -------------------------------
check(
  "an in-body status 500 raises rather than returning empty",
  threw({ response: { status: 500, message: "boom" }, data: {} }),
  "this is the exact payload shape TrackingTime returns for a failed call",
);
check(
  "an in-body status 403 raises",
  threw({ response: { status: 403, message: "forbidden" }, data: [] }),
);
check("status 400 raises (lower boundary)", threw({ response: { status: 400 }, data: [] }));
check(
  "status 399 does NOT raise (boundary is >= 400, not > 400)",
  !threw({ response: { status: 399 }, data: [{ a: 1 }] }),
);
check("status 200 does NOT raise", !threw({ response: { status: 200 }, data: [{ a: 1 }] }));

// --- normal unwrapping still works -----------------------------------------
check(
  "array data unwraps to its elements",
  unwrap({ response: { status: 200 }, data: [{ id: 1 }, { id: 2 }] }).length === 2,
);
check(
  "a single object unwraps to one record",
  unwrap({ response: { status: 200 }, data: { id: 7 } }).length === 1,
);
check("an empty array stays empty", unwrap({ response: { status: 200 }, data: [] }).length === 0);
check("a bare array (no envelope) still works", unwrap([{ id: 1 }]).length === 1);
check("a null body yields no records", unwrap(null).length === 0);

// --- the negative control ---------------------------------------------------
// The permissive unwrap that shipped first. If this ever stops swallowing the
// error, the assertions above have stopped testing anything meaningful.
const permissive = (r) => (Array.isArray(r) ? r : (r?.data ?? (r ? [r] : [])));
let permissiveThrew = false;
try {
  permissive({ response: { status: 500, message: "boom" }, data: {} });
} catch {
  permissiveThrew = true;
}
check(
  "NEGATIVE CONTROL: the permissive unwrap really does swallow a 500",
  !permissiveThrew,
  "if this fails the trap no longer exists and these checks prove nothing",
);

// ---------------------------------------------------------------------------
// Source assertions -- properties that live in run.mjs, not in the copy above.
// ---------------------------------------------------------------------------

const tt = SOURCE.slice(
  SOURCE.indexOf("trackingtime: {"),
  SOURCE.indexOf("factorial: {"),
);

check("the trackingtime connector block was found", tt.length > 500);
check(
  "the connector's own unwrap checks the envelope status",
  /response\?\.status/.test(tt) && /Number\(status\) >= 400/.test(tt),
  "if this drifts from the local copy above, the gate is testing a fiction",
);
check(
  "the workspace is resolved rather than left to the API default",
  /TRACKINGTIME_ACCOUNT_ID/.test(tt) && /\/me/.test(tt),
  "omitting :account_id silently reads the wrong workspace",
);
check(
  "every entity path is scoped to the resolved workspace",
  /const full = `\$\{scope\}\$\{path\}`/.test(tt),
);
check(
  "a User-Agent is sent (required by their docs)",
  /"User-Agent"/.test(tt) && /hs-experts\.com/.test(tt),
);
check(
  "no /services endpoint is requested",
  !/simple\("\/services"/.test(tt),
  "it is not in the documented API; requesting it wastes a call and reads as a plan limitation",
);
check(
  "events/flat is still inventoried",
  /events\/flat/.test(tt),
  "it is the bulk read their own Power BI integration uses",
);
check(
  "timeoffs are inventoried so we can see if TT or Factorial owns absence",
  /simple\("\/timeoffs"/.test(tt),
);

// --- repo-wide: discovery must remain read-only -----------------------------
check(
  "the runner still issues GET only",
  !/method:\s*"(POST|PUT|PATCH|DELETE)"/.test(SOURCE),
  "discovery must never mutate a vendor system",
);

console.log(
  failed
    ? "\nTRACKINGTIME CONNECTOR: checks failed"
    : "\nTRACKINGTIME CONNECTOR: all checks passed",
);
process.exit(failed ? 1 : 0);
