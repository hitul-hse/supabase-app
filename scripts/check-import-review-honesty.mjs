/**
 * The customer-master import review reads the whole batch and says so.
 *
 * WHY THIS GATE EXISTS. On 2026-09-10 the first masterdata-sheet batch had
 * 1,082 records. The review page read `limit 1000` in one query, built its
 * cases from those, and showed "962 records" as if that were the batch. No
 * error, no footnote -- the silent-cap class UI-CONVENTIONS rule 6 forbids
 * ("a silent omission reads as everything is fine, which is a lie by
 * layout") and which the data-hygiene gates already guard on their page.
 *
 * The read model now pages through the batch until a page comes back short,
 * exposes recordsRead / recordsCapped / cleanRecords, and the page renders
 * the cap as an alert and the clean count as a footnote. This gate pins the
 * shape of that, plus the contract between the importer's flags and the
 * page's case types, so a refactor cannot quietly reintroduce the cap or
 * drop a case type from the filter bar.
 *
 * Static on purpose: source reading only, so it runs on every unattended
 * cycle without credentials.
 */
import { readFileSync } from "node:fs";
import { record } from "./lib/gate-result.mjs";
import { BLOCKING_FLAGS as IMPORTER_BLOCKING } from "./lib/masterdata-sheet.mjs";

let failures = 0;
const check = (ok, label, detail = "") => {
  record(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const query = readFileSync("src/lib/queries/customer-master-import-review.ts", "utf8");
const page = readFileSync("src/app/(app)/customer-master/import-review/page.tsx", "utf8");

// ---- the read: paged until exhausted, capped only at a stated ceiling
// Comments are stripped first: the file's own history note quotes the old limit.
const code = query.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const sqlLimits = [...code.matchAll(/\blimit (\d+|\$\d)\b/g)].map((m) => m[1]);
check(!sqlLimits.includes("1000"), "no bare `limit 1000` remains in the record read", sqlLimits.join(","));
check(/async function readAllRecords\(/.test(query) && /limit \$2 offset \$3/.test(query), "records are read page by page with limit/offset parameters");
check(/if \(page\.rows\.length < RECORD_PAGE\) return \{ records, capped: false \}/.test(query), "the loop stops on a short page, not on a fixed count");
check(/return \{ records, capped: true \}/.test(query) && /RECORD_CEILING/.test(query), "a batch beyond the ceiling is reported as capped, not truncated silently");
check(/recordsRead: number;\s*recordsCapped: boolean;\s*cleanRecords: number;/.test(query), "the read model exposes recordsRead, recordsCapped and cleanRecords");
check(/recordsRead: records\.length,[\s\S]{0,400}recordsCapped: capped && [\s\S]{0,200}cleanRecords,/.test(query), "the success path fills the three honest counts from what was actually read");
const emptyReturns = (query.match(/recordsRead: 0,\s*recordsCapped: false,\s*cleanRecords: 0,/g) || []).length;
check(emptyReturns === 2, "the no-batch and error paths report zero read, not undefined", `${emptyReturns} of 2`);

// ---- the page renders what the model says
check(/data\.recordsCapped && <div role="alert"/.test(page) && /Nur die ersten \{data\.recordsRead\} von \{data\.metrics\.record_count\} Records/.test(page), "a capped read is an alert naming read vs total");
check(/data\.cleanRecords > 0 && <p/.test(page) && /\{data\.cleanRecords\} von \{data\.recordsRead\} Records/.test(page), "clean rows left out of the queue are counted on the page");
check(/raw_payload\.sheet_row/.test(page), "a sheet record shows its Google Sheets row number");

// ---- case types: union, page filter and importer flags agree
const union = [...query.matchAll(/^\s+\| "([A-Z_]+)"/gm)].map((m) => m[1]);
const pageList = /const REVIEW_CASE_TYPES: ReviewCaseType\[\] = \[([^\]]+)\]/.exec(page);
const listed = pageList ? [...pageList[1].matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]) : [];
check(union.length >= 10 && listed.length === union.length && union.every((t) => listed.includes(t)), "every case type in the union is offered by the page's filter", `union ${union.length}, page ${listed.length}`);
for (const type of ["ORDER_KEY_REVIEW", "PERSON_REVIEW", "CUSTOMER_NOT_IN_WAREHOUSE", "PARKED_CONTACT"]) {
  check(union.includes(type) && new RegExp(`case_type === "${type}"`).test(query), `${type} exists and has a review reason`);
}
check(/const ORDER_KEY_FLAGS = \["DUPLICATE_ORDER_KEY", "DUPLICATE_OLD_KEY", "MISSING_LANGUAGE", "KEY_FORMULA_MISMATCH", "KEY_PREFIX_MISMATCH", "UNKNOWN_OLD_KEY"\]/.test(query), "the key flags the importer writes are the ones the page classifies as ORDER_KEY_REVIEW");
check(/case_type === "ORDER_KEY_REVIEW"\) return "P0"/.test(query), "an unusable order key is P0");
// ---- the page's blocking set is the importer's, byte for byte (review of 2026-09-10: the ladder had assumed the old set)
const pageBlocking = (() => {
  const o = /const ORDER_KEY_FLAGS = \[([^\]]+)\]/.exec(query), p = /const PERSON_FLAGS = \[([^\]]+)\]/.exec(query);
  const list = (m) => (m ? [...m[1].matchAll(/"([A-Z_]+)"/g)].map((x) => x[1]) : []);
  return new Set([...list(o), ...list(p), "CUSTOMER_NOT_IN_WAREHOUSE"]);
})();
check(/const BLOCKING_FLAGS = \[\.\.\.ORDER_KEY_FLAGS, \.\.\.PERSON_FLAGS, "CUSTOMER_NOT_IN_WAREHOUSE"\]/.test(query), "the page composes its blocking set from the key flags, the person flags and the customer flag");
check(pageBlocking.size === IMPORTER_BLOCKING.size && [...IMPORTER_BLOCKING].every((f) => pageBlocking.has(f)), "the page's blocking set equals the importer's BLOCKING_FLAGS", `page ${[...pageBlocking].sort().join(",")} vs importer ${[...IMPORTER_BLOCKING].sort().join(",")}`);
check(!/"NEW_SERVICE"/.test(query) && !/"NEW_SERVICE"/.test(page), "newness is not a case: a clean new service is promoted without a reviewer");
check(/function isParkedContact\(record: ImportRecord\) \{[\s\S]{0,200}validation_status === "valid"/.test(query), "only a VALID contacts row can be parked; a defective one stays a case");
check(/if \(reviewCase\.records\.some\(isSheetRecord\)\) return null;/.test(query), "the August workbook's documented resolutions never decide a sheet row by name");
check(/recordsCapped: capped && \(metricsResult\.rows\[0\]\?\.record_count === undefined \|\| records\.length < Number\(metricsResult\.rows\[0\]\.record_count\)\)/.test(query), "a batch of exactly the ceiling is complete, not capped; a missing total cannot be called complete");
check(/function isCleanSheetRecord[\s\S]{0,600}return blockingFlagsOf\(record\)\.length === 0;/.test(query) && /review_status === "rejected" \|\| record\.review_status === "in_review"/.test(query), "clean = valid, no blocking flag, and no person's decision against it; review_required is re-judged like the promote does");
check(/case_type === "PARKED_CONTACT"\) return "DEFERRED"/.test(query), "a parked contact is DEFERRED, not an open case");
check(/return `order:\$\{record\.source_external_id \?\? record\.row_number\}`/.test(query), "a sheet service row is its own case, keyed by its order number");
check(/function isCleanSheetRecord/.test(query) && /function blockingFlagsOf/.test(query), "clean is decided by the blocking flags, the same rule the promote applies; nothing else is left out");

console.log(failures ? `FAIL (${failures})` : "PASS");
process.exit(failures ? 1 : 0);
