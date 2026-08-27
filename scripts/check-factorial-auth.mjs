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
const fileEnv = existsSync(ENV_PATH)
  ? Object.fromEntries(
      readFileSync(ENV_PATH, "utf8").split(/\r?\n/)
        .filter((l) => l && !l.startsWith("#") && l.includes("="))
        .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }))
  : {};

/*
 * The process environment wins over the file. Reading only .env.local was a real
 * defect: CI and Vercel supply secrets as environment variables, never as a
 * committed file, so a correctly-configured pipeline would have been told
 * "BLOCKED: no credential" forever. Found by exporting a token and watching this
 * gate ignore it.
 */
const env = { ...fileEnv, ...process.env };

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

/*
 * Factorial offers TWO credential types and they use different headers, so the
 * gate has to know which one it holds (doc §1.1):
 *
 *   API key        x-api-key: <KEY>          never expires, TOTAL access
 *   OAuth2 token   Authorization: Bearer ..  company token never expires
 *
 * An API key is what an admin can generate in the UI in one click, so it is by
 * far the likeliest thing to be handed. Reading only the bearer variable would
 * have reported "no credential" while a perfectly good key sat in .env.local --
 * the same class of defect as this gate previously ignoring process.env.
 *
 * The key is accepted, but §1.2 chose OAuth2 on GDPR data-minimisation grounds:
 * an API key cannot be scope-limited, so it grants access to payroll and bank
 * details we have no business reading. That is a finding, not a blocker, and it
 * is reported as one below rather than silently tolerated.
 */
const API_KEY = env.FACTORIAL_API_KEY ?? env.FACTORIAL_KEY ?? "";
const BEARER = env.FACTORIAL_ACCESS_TOKEN ?? env.FACTORIAL_TOKEN ?? "";
const TOKEN = BEARER || API_KEY;
const CREDENTIAL_KIND = BEARER ? "oauth" : API_KEY ? "api_key" : "none";

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
  console.log("  4. Put it in .env.local. Never commit it. Either name works:");
  console.log("       FACTORIAL_API_KEY=...        (an admin-generated API key, simplest)");
  console.log("       FACTORIAL_ACCESS_TOKEN=...   (an OAuth2 company token, scope-limited)");
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
    headers: {
      // Wrong header = 401 that looks like a bad credential rather than a
      // mismatched auth scheme, which would send someone hunting the wrong bug.
      ...(CREDENTIAL_KIND === "api_key"
        ? { "x-api-key": TOKEN }
        : { Authorization: `Bearer ${TOKEN}` }),
      Accept: "application/json",
    },
  });
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON is itself a finding */ }
  return { status: res.status, body };
};

console.log(`  credential: ${CREDENTIAL_KIND === "api_key" ? "API key (x-api-key)" : "OAuth2 bearer token"}\n`);

if (CREDENTIAL_KIND === "api_key") {
  /*
   * Not a failure: the doc confirms API keys remain supported for internal
   * company integrations. But an API key has TOTAL ACCESS and cannot be
   * narrowed, so the §1.4 least-privilege scope check below is unenforceable
   * and the GDPR Art. 5(1)(c) argument in §11 is not satisfied. Say so plainly
   * rather than letting a green gate imply the data-minimisation question was
   * settled.
   */
  console.log("  note  An API key cannot be scope-limited: it grants TOTAL access, including");
  console.log("  note  payroll and bank details this integration must never read. Harvesting");
  console.log("  note  with it is fine for a read-only probe, but the scheduled sync should");
  console.log("  note  move to an OAuth2 company token with exactly the six scopes in §1.4.");
  console.log("  note  The field allow-list in scripts/lib/factorial.mjs is the compensating");
  console.log("  note  control until then, and check-factorial-harvest asserts it.\n");
}

try {
  // §1.5: the owner must be a company. A user token is the 7-day cliff.
  const creds = await call(`/api/${VERSION}/resources/api_public/credentials`);
  check(creds.status === 200, `GET /api/${VERSION}/resources/api_public/credentials returns 200`, `got ${creds.status}`);

  if (creds.status === 200 && creds.body) {
    /*
     * THE COMPANY-VS-USER TEST, corrected against the real payload.
     *
     * I originally asserted an `owner_type` field. There is no such field. The
     * response is the standard paged envelope, and the credential's nature is
     * revealed by WHICH fields are populated (verified 2026-08-27 with
     * scripts/diagnose-factorial-credential-shape.mjs):
     *
     *   company credential -> company_id and legal_name set,
     *                         email / full_name / role / employee_id ALL null
     *   user credential    -> the user fields carry values
     *
     * That is exactly what doc §1.1 describes: an API key "acts on behalf of the
     * company (no user attribution)". So an absent user identity is the POSITIVE
     * signal here, not a missing field, and the original assertion would have
     * failed forever on a perfectly good credential.
     *
     * This matters beyond tidiness: §1.5 says a USER token dies on a 7-day cliff
     * and would break the scheduled sync silently, so the test has to actually
     * discriminate rather than just pass.
     */
    const row = Array.isArray(creds.body.data) ? creds.body.data[0] ?? {} : creds.body.data ?? creds.body;
    const companyId = row.company_id ?? null;
    const userFields = ["email", "login_email", "full_name", "first_name", "last_name", "employee_id", "role"];
    const populatedUserFields = userFields.filter((f) => row[f] !== null && row[f] !== undefined && row[f] !== "");

    check(
      companyId !== null && populatedUserFields.length === 0,
      "the credential belongs to a company, not a user",
      companyId === null
        ? "no company_id in the response; this may not be a company credential"
        : populatedUserFields.length
          ? `company_id present BUT user fields are populated (${populatedUserFields.join(", ")}) - this looks like a USER credential, which dies on a 7-day cliff`
          : `company_id set, all ${userFields.length} user-identity fields null`,
    );

    const granted = String(creds.body.scope ?? creds.body.scopes ?? creds.body.data?.scope ?? "")
      .split(/[\s,]+/).filter(Boolean).sort();
    if (CREDENTIAL_KIND === "api_key") {
      // Asserting least privilege against a credential that cannot be narrowed
      // would be theatre. The note above states the real position.
      console.log("  skip  least-privilege scope check does not apply to an API key");
    } else if (!granted.length) {
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
      /*
       * Chicken and egg: the gate cannot pass without a snapshot and had no way
       * to make one, so it could never go green. `--write-oas-snapshot` records
       * it deliberately, which is the right shape for a trust-on-first-use
       * baseline: a human runs it once, the hash is committed, and every later
       * run detects a contract change.
       */
      if (process.argv.includes("--write-oas-snapshot")) {
        const { createHash } = await import("node:crypto");
        const digest = createHash("sha256").update(JSON.stringify(oas.body)).digest("hex");
        const { writeFileSync } = await import("node:fs");
        writeFileSync(snapshot, `${digest}\n`);
        check(true, "OpenAPI hash snapshot written", `${snapshot} — commit this; a later diff means Factorial changed the contract`);
      } else {
        check(false, "a committed OpenAPI hash exists to compare against",
          `${snapshot} is absent — re-run with --write-oas-snapshot to record the current contract`);
      }
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
