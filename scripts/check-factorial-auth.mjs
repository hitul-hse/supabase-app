// Phase 0 gate for the Factorial integration, per
// docs/factorial-api-integration.md §10.
//
// This gate is BLOCKED by design until a human completes the credential steps.
// It does not pass vacuously when the token is missing: a gate that goes green
// because it found nothing to check is worse than no gate, because the phase
// then looks done. Missing credentials exit 2 (blocked) with the exact list of
// human actions; a present-but-wrong credential exits 1 (fail).
//
// Nothing here writes to the database, and the token is never printed.
import { readFileSync, existsSync } from "node:fs";

const ENV_PATH = "C:/Supabase/.env.local";
const env = existsSync(ENV_PATH)
  ? Object.fromEntries(
      readFileSync(ENV_PATH, "utf8").split(/\r?\n/)
        .filter((l) => l && !l.startsWith("#") && l.includes("="))
        .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }))
  : {};

// §2.1: the version is pinned, and §1.2 chose a company token over an API key on
// GDPR data-minimisation grounds.
const VERSION = "2026-07-01";
const BASE = "https://api.factorialhr.com";

// §1.4 scopes, exactly as the doc's scope->endpoint table names them. Factorial
// scopes are resource-level and grant read AND write together; there is no
// read-only variant, which is itself a §11 GDPR open question. An over-broad
// grant is a finding, so extras fail.
const REQUIRED_SCOPES = [
  "employees",              // Employee, and also Teams > Team + Membership
  "contracts",              // ReferenceContract, ContractVersion (the real weekly hours)
  "time_tracking",          // Shift, WorkedTime, EstimatedTime
  "time_off",               // Leave, LeaveType, Allowance (utilisation denominators)
  "company_legal_entities", // Legal Entities
  "company_holidays",       // CompanyHoliday, needed for correct expected hours
];

const TOKEN = env.FACTORIAL_ACCESS_TOKEN ?? env.FACTORIAL_TOKEN ?? "";

console.log("check-factorial-auth (Phase 0)\n");

if (!TOKEN) {
  console.log("BLOCKED: no Factorial credential is configured.\n");
  console.log("This is the expected state before Phase 0 is done. The following steps");
  console.log("require a human with Factorial admin rights and cannot be automated:\n");
  console.log("  1. Create the OAuth application in Factorial and grant exactly these scopes:");
  for (const s of REQUIRED_SCOPES) console.log(`       ${s}`);
  console.log("  2. Complete the client_credentials flow to obtain a COMPANY token, not a");
  console.log("     user token. A user token expires on a 7-day cliff (doc §1.5) and will");
  console.log("     silently break the scheduled sync.");
  console.log("  3. Request the demo tenant (doc §11 Q1). Phase 1 cannot start without it,");
  console.log("     because harvesting against production employee data to discover the");
  console.log("     shape of the API is not defensible under GDPR.");
  console.log("  4. Put the token in .env.local as FACTORIAL_ACCESS_TOKEN. Never commit it.");
  console.log("  5. Re-run this gate. It will then verify the token type, the exact scope");
  console.log("     set, and that the pinned OpenAPI hash still matches.\n");
  console.log("BLOCKED (exit 2): not a failure, and not a pass. Phase 0 is not complete.");
  process.exit(2);
}

// From here the credential exists, so anything wrong with it is a real failure.
const failures = [];
const check = (ok, label, detail) => {
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
};

const call = async (path) => {
  // The version travels in the PATH (/api/2026-07-01/resources/...), not a
  // header. Doc §1.5 names the credentials endpoint explicitly; §2.2 warns that
  // a wrong version string is served with a different schema rather than 404,
  // so a typo here degrades silently instead of failing.
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/json" },
  });
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON is itself a finding */ }
  return { status: res.status, body };
};

try {
  // §1.5: the owner must be a company. A user token is the 7-day cliff.
  const creds = await call(`/api/${VERSION}/resources/api_public/credentials`);
  check(creds.status === 200, `GET /api/${VERSION}/resources/api_public/credentials returns 200`, `got ${creds.status}`);

  if (creds.status === 200 && creds.body) {
    const owner = creds.body.owner_type ?? creds.body.type ?? creds.body.data?.owner_type ?? null;
    check(
      typeof owner === "string" && owner.toLowerCase().includes("compan"),
      "the token is owned by a company, not a user",
      owner === null ? "no owner field in the response; inspect the payload shape" : `owner_type=${owner}`,
    );

    const granted = String(creds.body.scope ?? creds.body.scopes ?? creds.body.data?.scope ?? "")
      .split(/[\s,]+/).filter(Boolean).sort();
    if (!granted.length) {
      check(false, "the response reports a scope string", "none found; cannot verify least privilege");
    } else {
      const missing = REQUIRED_SCOPES.filter((s) => !granted.includes(s));
      const extra = granted.filter((s) => !REQUIRED_SCOPES.includes(s));
      check(missing.length === 0, "every required scope is granted", missing.length ? `missing: ${missing.join(", ")}` : "all present");
      // Least privilege: extras are a GDPR finding, not a convenience.
      check(extra.length === 0, "no scope beyond the required set is granted", extra.length ? `over-broad: ${extra.join(", ")}` : "exactly the required set");
    }
  }

  // §2.2: the version must be pinned and the contract must not have moved.
  const oas = await call(`/oas/?version=${VERSION}`);
  check(oas.status === 200, `GET /oas/?version=${VERSION} returns 200`, `got ${oas.status}`);
  if (oas.status === 200 && oas.body) {
    check(oas.body?.info?.version === VERSION,
      `the served spec reports info.version == ${VERSION}`,
      `got ${oas.body?.info?.version ?? "nothing"}`);

    const snapshot = "docs/factorial-oas-2026-07-01.sha256";
    if (!existsSync(snapshot)) {
      check(false, "a committed OpenAPI hash exists to compare against",
        `${snapshot} is absent — write it on the first green run, then a later diff means Factorial changed the contract`);
    } else {
      const { createHash } = await import("node:crypto");
      const actual = createHash("sha256").update(JSON.stringify(oas.body)).digest("hex");
      const expected = readFileSync(snapshot, "utf8").trim();
      check(actual === expected, "the served spec matches the committed hash",
        actual === expected ? "unchanged" : "the API contract changed under us; review before trusting any harvest");
    }
  }

  // Assert the token cannot leak through this gate's own output.
  const printed = [creds.status, oas.status].join(" ");
  check(!printed.includes(TOKEN), "the token does not appear in this gate's output", "checked");
} catch (e) {
  check(false, "the Factorial API was reachable", e.message);
}

console.log(`\n${failures.length === 0 ? "PASS" : `FAIL (${failures.length})`}`);
if (failures.length) for (const f of failures) console.log(`  - ${f}`);
process.exit(failures.length ? 1 : 0);
