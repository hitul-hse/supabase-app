// The employees endpoint returned NO working_hours, so the fake uniform 40h week
// cannot be fixed from it. Doc §5 says contract hours live on
// contracts/reference_contracts, not on the employee record - and the earlier
// probe showed 43 reference contracts exist.
//
// So: which endpoint actually carries the hours, and what does it call them?
// Answering this from the API rather than the doc, because the doc's own field
// table is marked "not documented" in places.
//
// Same GDPR posture: field allow-list on arrival, nothing written, nothing
// printed that identifies a person. A reference contract is exactly where salary
// lives, so the allow-list matters more here than anywhere else.
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const KEY = env.FACTORIAL_API_KEY ?? env.FACTORIAL_KEY ?? "";
const VERSION = "2026-07-01";
const BASE = "https://api.factorialhr.com";

const call = async (path) => {
  const res = await fetch(`${BASE}${path}`, { headers: { "x-api-key": KEY, Accept: "application/json" } });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
};

const FORBIDDEN = /salary|bank|swift|iban|social_security|disability|termination_reason|compensation|tax|nationality|birth|address|phone|gender|marital|amount|cents|currency/i;

/*
 * Print the SHAPE of one record, with every value redacted and every forbidden
 * key dropped entirely. The goal is to find the hours field name, which needs
 * the key list and nothing else.
 */
const shapeOf = (row) => {
  const kept = [];
  const dropped = [];
  for (const [k, v] of Object.entries(row ?? {})) {
    if (FORBIDDEN.test(k)) { dropped.push(k); continue; }
    const t = v === null ? "null" : Array.isArray(v) ? `[${v.length}]` : typeof v === "object" ? "{...}" : typeof v;
    kept.push(`${k}: ${t}`);
  }
  return { kept, dropped };
};

console.log("Where do contract hours actually live?\n");

for (const [label, resource] of [
  ["contracts/reference_contracts", "contracts/reference_contracts"],
  ["contracts/contract_versions", "contracts/contract_versions"],
  ["attendance/worked_times", "attendance/worked_times"],
  ["attendance/estimated_times", "attendance/estimated_times"],
]) {
  const r = await call(`/api/${VERSION}/resources/${resource}?limit=1`);
  if (r.status !== 200) { console.log(`  ${r.status}  ${label}  (not reachable)`); continue; }
  const row = Array.isArray(r.body?.data) ? r.body.data[0] : null;
  const total = r.body?.meta?.total ?? "?";
  if (!row) { console.log(`  200  ${label}  total ${total}, but no rows returned`); continue; }

  const { kept, dropped } = shapeOf(row);
  const hourKeys = Object.keys(row).filter((k) => /hour|working|week|fte|schedule|minutes/i.test(k) && !FORBIDDEN.test(k));

  console.log(`\n  === ${label}  (total ${total}) ===`);
  console.log(`  hours-related keys: ${hourKeys.length ? hourKeys.join(", ") : "NONE"}`);
  if (hourKeys.length) {
    // Values here are hours-per-week style numbers, not personal data, so the
    // actual value is safe and necessary to print: a null field would look
    // identical to a populated one otherwise.
    for (const k of hourKeys) console.log(`      ${k} = ${JSON.stringify(row[k])}`);
  }
  console.log(`  all safe keys: ${kept.map((s) => s.split(":")[0]).join(", ")}`);
  if (dropped.length) console.log(`  DROPPED as sensitive (never read): ${dropped.join(", ")}`);
}

/*
 * If reference_contracts carries the hours, check COVERAGE across all of them --
 * one populated record proves the field exists, not that it is usable.
 */
console.log("\n\nCoverage across every reference contract:\n");
const rows = [];
let cursor = null;
for (let p = 0; p < 20; p += 1) {
  const qs = new URLSearchParams({ limit: "100" });
  if (cursor) qs.set("after_id", cursor);
  const r = await call(`/api/${VERSION}/resources/contracts/reference_contracts?${qs}`);
  if (r.status !== 200 || !Array.isArray(r.body?.data)) break;
  rows.push(...r.body.data);
  if (!r.body.meta?.has_next_page) break;
  const next = r.body.meta.end_cursor;
  if (!next || next === cursor) break;
  cursor = next;
}

if (!rows.length) { console.log("  no reference contracts readable"); process.exit(0); }

const candidateFields = [...new Set(rows.flatMap((r) => Object.keys(r)))]
  .filter((k) => /hour|working|week|fte|minutes/i.test(k) && !FORBIDDEN.test(k));

console.log(`  ${rows.length} contracts, candidate hour fields: ${candidateFields.join(", ") || "NONE"}`);
for (const f of candidateFields) {
  const populated = rows.filter((r) => r[f] !== null && r[f] !== undefined && r[f] !== "");
  const distinct = [...new Set(populated.map((r) => JSON.stringify(r[f])))];
  console.log(`    ${f.padEnd(30)} populated on ${populated.length}/${rows.length}` +
    (distinct.length <= 8 ? `, values: ${distinct.join(", ")}` : `, ${distinct.length} distinct values`));
}

// The whole point: does this beat the fabricated uniform 40?
const weekly = candidateFields.find((f) => /working_hours$|weekly/i.test(f));
if (weekly) {
  const vals = rows.map((r) => Number(r[weekly])).filter((n) => Number.isFinite(n) && n > 0);
  const distinct = [...new Set(vals)].sort((a, b) => a - b);
  console.log(`\n  VERDICT on the fake 40h week:`);
  console.log(`    ${vals.length} contracts carry a usable ${weekly}`);
  console.log(`    distinct values: ${distinct.join(", ")}`);
  console.log(`    ${distinct.length > 1
    ? "REAL VARIATION -> utilisation can stop assuming 40 for everyone"
    : "every contract says the same thing, so this is no better than the assumption"}`);
}

console.log("\nREAD-ONLY: nothing written, no personal field read.");
