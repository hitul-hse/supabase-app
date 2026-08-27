// The API key authenticates (200 from the credentials endpoint), but my gate
// expected an `owner_type` field that an API-key response apparently does not
// carry. Rather than guess the shape, print it -- with every value redacted, so
// the payload structure is visible without leaking anything.
//
// This is the "empirically determine the shape" step doc §10 Phase 0 asks for.
// READ-ONLY against the API. Nothing is written anywhere.
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const KEY = env.FACTORIAL_API_KEY ?? env.FACTORIAL_KEY ?? "";
if (!KEY) { console.log("No FACTORIAL_API_KEY in .env.local"); process.exit(2); }

const VERSION = "2026-07-01";
const BASE = "https://api.factorialhr.com";

const call = async (path) => {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "x-api-key": KEY, Accept: "application/json" },
  });
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
};

/*
 * Redact every leaf value. The point is to learn the SHAPE -- which keys exist,
 * what type each holds -- not to read anyone's data. An employee harvest under
 * GDPR needs the field allow-list designed against the real shape first, and
 * printing names and emails to a terminal to discover it would defeat that.
 */
const shape = (v, depth = 0) => {
  if (v === null) return "null";
  if (Array.isArray(v)) {
    if (!v.length) return "[]";
    return [`[ ${v.length} item(s), first item:`, shape(v[0], depth + 1), "]"].join(" ");
  }
  if (typeof v === "object") {
    const pad = "  ".repeat(depth + 1);
    return `{\n${Object.entries(v).map(([k, val]) => `${pad}${k}: ${shape(val, depth + 1)}`).join("\n")}\n${"  ".repeat(depth)}}`;
  }
  if (typeof v === "string") return `"<string len ${v.length}>"`;
  return `<${typeof v}>`;
};

console.log("=== GET api_public/credentials (shape only, values redacted) ===\n");
const creds = await call(`/api/${VERSION}/resources/api_public/credentials`);
console.log(`status ${creds.status}`);
console.log(shape(creds.body));

/*
 * The keys that decide whether this is a company or user credential. §1.5 says a
 * USER token dies on a 7-day cliff and would break a scheduled sync silently, so
 * knowing which we hold is not cosmetic.
 *
 * An API key is issued by an admin FOR THE COMPANY and never expires
 * (doc §1.1), so it has no user to attribute to -- an absent owner field is
 * consistent with that rather than a problem. Confirm it against the payload.
 */
const flat = (obj, prefix = "") => {
  const out = [];
  for (const [k, v] of Object.entries(obj ?? {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) out.push(...flat(v, key));
    else out.push(key);
  }
  return out;
};
const keys = flat(creds.body);
console.log(`\nall keys: ${keys.join(", ") || "(none)"}`);

const ownerish = keys.filter((k) => /owner|type|company|user|scope|expires/i.test(k));
console.log(`ownership/scope-related keys: ${ownerish.join(", ") || "NONE — consistent with an API key, which has no user to attribute"}`);

// Prove access actually works on a resource we need, without reading the data.
console.log("\n=== can we reach the resources we need? (counts only) ===\n");
for (const [label, path] of [
  ["employees", `/api/${VERSION}/resources/employees/employees?limit=1`],
  ["legal entities", `/api/${VERSION}/resources/companies/legal_entities?limit=1`],
  ["reference contracts", `/api/${VERSION}/resources/contracts/reference_contracts?limit=1`],
  ["teams", `/api/${VERSION}/resources/teams/teams?limit=1`],
]) {
  const r = await call(path);
  const n = Array.isArray(r.body?.data) ? r.body.data.length : null;
  const total = r.body?.meta?.total ?? "(no total)";
  console.log(`  ${String(r.status).padEnd(4)} ${label.padEnd(20)} rows in page: ${n ?? "n/a"}, total: ${total}`);
}

console.log("\nREAD-ONLY: no data was stored and no values were printed.");
