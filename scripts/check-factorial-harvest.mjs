/**
 * Does the harvest keep ONLY what it is allowed to keep?
 *
 * check-factorial-auth has always told the reader this gate exists -- "The field
 * allow-list in scripts/lib/factorial.mjs is the compensating control until
 * then, and check-factorial-harvest asserts it." It did not, and neither did the
 * allow-list. A compensating control that is documented but absent is worse than
 * one never claimed, because the claim is what stops anyone checking.
 *
 * WHY IT MATTERS. The credential in use is an API key, and an API key cannot be
 * scope-limited: it grants total access, including payroll and bank details.
 * `employees_employee` carries 54 fields. Nothing at the transport layer stops a
 * harvest writing every one of them into the hub, so the projection is the only
 * thing that does -- and this gate is the only thing that proves the projection.
 *
 * NO PERSONAL DATA IS USED OR NEEDED. The employee below is synthetic: all 54
 * field names from the spec, each set to a sentinel string. That is deliberate.
 * The integration doc's position is that harvesting real employee records to
 * discover the shape of the API is not defensible under GDPR, and a gate that
 * did so would be an instance of exactly that. A sentinel proves the same thing,
 * and proves it offline.
 *
 * Run: node scripts/check-factorial-harvest.mjs
 */
import { loadEnv } from "./lib/gate-env.mjs";
import {
  EMPLOYEE_ALLOWED_FIELDS,
  EMPLOYEE_FORBIDDEN_FIELDS,
  projectEmployee,
  CONTRACT_ALLOWED_FIELDS,
  CONTRACT_FORBIDDEN_FIELDS,
  projectContract,
} from "./lib/factorial.mjs";

/*
 * The 54 field names of employees_employee, snapshotted from the OpenAPI spec
 * pinned at docs/factorial-oas-2026-07-01.sha256, read on 2026-08-28.
 *
 * Committed so the core of this gate runs with no network and no credential --
 * on CI, and on a laptop without a key. When a credential IS present the gate
 * additionally compares this list against the live spec, so it cannot drift
 * silently.
 */
const SPEC_FIELDS = [
  "access_id", "active", "address_line_1", "address_line_2", "age_number",
  "attendable", "bank_number", "bank_number_format", "birth_name", "birthday_on",
  "birthplace", "city", "communications_email", "company_id", "company_identifier",
  "contact_name", "contact_number", "country", "country_of_birth", "created_at",
  "default_work_area_id", "disability_percentage_cents", "email", "first_name",
  "full_name", "gender", "id", "identifier", "identifier_expiration_date",
  "identifier_type", "is_terminating", "last_name", "legal_entity_id",
  "location_id", "login_email", "manager_id", "nationality", "personal_email",
  "phone_number", "postal_code", "preferred_name", "pronouns",
  "seniority_calculation_date", "social_security_number", "state", "swift_bic",
  "terminated_on", "termination_observations", "termination_reason",
  "termination_reason_type", "termination_type_description", "timeoff_manager_id",
  "unconfirmed_communications_email", "updated_at",
];

let failed = 0;
const check = (ok, label, detail = "") => {
  if (!ok) failed += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

console.log("check-factorial-harvest\n");
console.log(`  spec snapshot: ${SPEC_FIELDS.length} fields on employees_employee`);
console.log(`  allow-list   : ${EMPLOYEE_ALLOWED_FIELDS.join(", ")}\n`);

// 1. The allow-list must not contradict itself.
const contradiction = EMPLOYEE_ALLOWED_FIELDS.filter((f) => EMPLOYEE_FORBIDDEN_FIELDS.includes(f));
check(contradiction.length === 0, "no field is both allowed and forbidden",
  contradiction.length ? contradiction.join(", ") : "the two lists are disjoint");

// A typo in the allow-list would drop a field the integration needs, and would
// look exactly like an API that had stopped returning it.
const unknown = EMPLOYEE_ALLOWED_FIELDS.filter((f) => !SPEC_FIELDS.includes(f));
check(unknown.length === 0, "every allow-listed field exists on employees_employee",
  unknown.length ? `not in the spec: ${unknown.join(", ")}` : "all resolve against the spec");

// 2. Projection keeps only the allow-list. Sentinels, not data.
const synthetic = Object.fromEntries(SPEC_FIELDS.map((f) => [f, `SENTINEL_${f}`]));
const projected = projectEmployee(synthetic);
const kept = Object.keys(projected);

check(kept.length === EMPLOYEE_ALLOWED_FIELDS.length,
  "projection keeps exactly the allow-listed field count",
  `kept ${kept.length}, allow-list has ${EMPLOYEE_ALLOWED_FIELDS.length}`);

const leaked = kept.filter((k) => !EMPLOYEE_ALLOWED_FIELDS.includes(k));
check(leaked.length === 0, "projection keeps nothing outside the allow-list",
  leaked.length ? `leaked: ${leaked.join(", ")}`
    : `dropped ${SPEC_FIELDS.length - kept.length} of ${SPEC_FIELDS.length}`);

/*
 * 3. Each named sensitive field, asserted individually.
 *
 * The allow-list already makes this true by construction, and that is precisely
 * why it is asserted a second way: two independent statements of the same rule
 * catch a typo in either, and a future edit that widens the allow-list fails
 * HERE, by name, instead of quietly succeeding.
 */
const survivors = EMPLOYEE_FORBIDDEN_FIELDS.filter((f) => projected[f] !== undefined);
check(survivors.length === 0,
  `all ${EMPLOYEE_FORBIDDEN_FIELDS.length} named sensitive fields are dropped`,
  survivors.length ? `SURVIVED: ${survivors.join(", ")}` : "none survived projection");

for (const f of ["bank_number", "social_security_number", "contact_name", "birthday_on", "personal_email"]) {
  check(projected[f] === undefined, `${f} is not kept`,
    projected[f] === undefined ? "" : `value survived: ${projected[f]}`);
}

/*
 * 4. A field the API has not invented yet is dropped by default.
 *
 * This is the entire reason the list is an allow-list. Under a deny-list this
 * assertion fails, and the hub starts storing an unknown field the day Factorial
 * ships it.
 */
const future = projectEmployee({ ...synthetic, iban_secondary: "DE99", medical_notes: "x" });
check(future.iban_secondary === undefined && future.medical_notes === undefined,
  "a field added by a future API version is dropped without a code change",
  "unknown fields do not survive");

/*
 * 5. Absence stays absence.
 *
 * classifyEmployee treats a missing login_email as 'unmatched'. Projection must
 * not turn that into an empty string, which matches nothing but reads as a value.
 */
const sparse = projectEmployee({ id: "1" });
check(sparse.login_email === undefined && sparse.active === undefined,
  "a missing allow-listed field stays undefined rather than becoming ''",
  "absence preserved");

/*
 * 6. The SAME harvest discipline for contracts/reference_contracts.
 *
 * This endpoint is documented (docs/factorial-api-integration.md §7.5) to
 * also carry salary_amount and salary_frequency -- the `contracts` scope
 * that is unavoidable for real working hours is ALSO the scope that unlocks
 * salary. There is no pinned OpenAPI field list committed for this schema
 * the way there is for employees_employee (SPEC_FIELDS above), so this
 * section proves the projection offline against a synthetic row carrying
 * every field this integration knows this endpoint can return, rather than
 * diffing against a live spec fetch.
 */
console.log("\ncontracts/reference_contracts\n");
console.log(`  allow-list   : ${CONTRACT_ALLOWED_FIELDS.join(", ")}`);
console.log(`  forbidden    : ${CONTRACT_FORBIDDEN_FIELDS.join(", ")}\n`);

const contractContradiction = CONTRACT_ALLOWED_FIELDS.filter((f) => CONTRACT_FORBIDDEN_FIELDS.includes(f));
check(contractContradiction.length === 0, "no contract field is both allowed and forbidden",
  contractContradiction.length ? contractContradiction.join(", ") : "the two lists are disjoint");

// Every documented field on this endpoint (docs §5 row 2, §5.2, §7.5), plus
// two Factorial has not been observed to send yet -- proving an unknown
// field is dropped by default, the same discipline as the employee test #4.
const CONTRACT_SYNTHETIC_ROW = {
  employee_id: "SENTINEL_employee_id",
  working_hours: "SENTINEL_working_hours",
  working_hours_frequency: "SENTINEL_working_hours_frequency",
  working_week_days: "SENTINEL_working_week_days",
  working_time_percentage_in_cents: "SENTINEL_working_time_percentage_in_cents",
  maximum_weekly_hours: "SENTINEL_maximum_weekly_hours",
  max_legal_yearly_hours: "SENTINEL_max_legal_yearly_hours",
  starts_on: "SENTINEL_starts_on",
  ends_on: "SENTINEL_ends_on",
  effective_on: "SENTINEL_effective_on",
  job_title: "SENTINEL_job_title",
  country: "SENTINEL_country",
  bank_holiday_treatment: "SENTINEL_bank_holiday_treatment",
  salary_amount: "SENTINEL_salary_amount",
  salary_frequency: "SENTINEL_salary_frequency",
};

const projectedContract = projectContract(CONTRACT_SYNTHETIC_ROW);
const contractKept = Object.keys(projectedContract);

check(contractKept.length === CONTRACT_ALLOWED_FIELDS.length,
  "contract projection keeps exactly the allow-listed field count",
  `kept ${contractKept.length}, allow-list has ${CONTRACT_ALLOWED_FIELDS.length}`);

const contractLeaked = contractKept.filter((k) => !CONTRACT_ALLOWED_FIELDS.includes(k));
check(contractLeaked.length === 0, "contract projection keeps nothing outside the allow-list",
  contractLeaked.length ? `leaked: ${contractLeaked.join(", ")}`
    : `dropped ${Object.keys(CONTRACT_SYNTHETIC_ROW).length - contractKept.length} of ${Object.keys(CONTRACT_SYNTHETIC_ROW).length}`);

const contractSurvivors = CONTRACT_FORBIDDEN_FIELDS.filter((f) => projectedContract[f] !== undefined);
check(contractSurvivors.length === 0,
  `all ${CONTRACT_FORBIDDEN_FIELDS.length} named sensitive contract field(s) are dropped`,
  contractSurvivors.length ? `SURVIVED: ${contractSurvivors.join(", ")}` : "none survived projection");

for (const f of ["salary_amount", "salary_frequency"]) {
  check(projectedContract[f] === undefined, `${f} is not kept`,
    projectedContract[f] === undefined ? "" : `value survived: ${projectedContract[f]}`);
}

// A field Factorial has not invented yet is dropped by default -- same as
// the employee test #4, and the whole reason this is an allow-list.
const futureContract = projectContract({ ...CONTRACT_SYNTHETIC_ROW, signing_bonus_cents: 500000, iban: "DE99" });
check(futureContract.signing_bonus_cents === undefined && futureContract.iban === undefined,
  "a future contract field is dropped without a code change",
  "unknown fields do not survive");

// Absence stays absence -- a missing employee_id must not become "" and
// silently join to nothing that looks like a real match failure.
const sparseContract = projectContract({ working_hours: 4000 });
check(sparseContract.employee_id === undefined && sparseContract.working_hours === 4000,
  "a missing allow-listed contract field stays undefined rather than becoming ''",
  "absence preserved");

// 7. Live spec drift -- only when a credential exists.
// Via the shared loader: process.env first (so CI secrets win), then a
// .env.local found by walking up from this file. The hardcoded C:/Supabase
// path this replaces could only ever resolve on one Windows machine, so the
// live half below was dead everywhere else -- silently, as a skip.
const env = loadEnv();
const KEY = env.FACTORIAL_API_KEY ?? env.FACTORIAL_KEY ?? "";
const BEARER = env.FACTORIAL_ACCESS_TOKEN ?? env.FACTORIAL_TOKEN ?? "";

if (!KEY && !BEARER) {
  console.log("\n  skip  live spec drift check — no Factorial credential (everything above needed none)");
} else {
  try {
    const res = await fetch("https://api.factorialhr.com/oas/?version=2026-07-01", {
      headers: KEY ? { "x-api-key": KEY } : { Authorization: `Bearer ${BEARER}` },
    });
    const oas = await res.json();
    const live = Object.keys(oas?.components?.schemas?.employees_employee?.properties ?? {}).sort();
    console.log("");
    check(live.length > 0, "the live spec still describes employees_employee", `${live.length} fields`);

    const added = live.filter((f) => !SPEC_FIELDS.includes(f));
    const removed = SPEC_FIELDS.filter((f) => !live.includes(f));
    check(added.length === 0 && removed.length === 0,
      "the live field set matches the committed snapshot",
      added.length || removed.length
        ? `added: [${added.join(", ")}] removed: [${removed.join(", ")}] — review the allow-list, then update SPEC_FIELDS`
        : "unchanged");

    // An added field is already dropped by the allow-list, so this is a prompt to
    // review rather than a breach. Say so, so nobody reads it as a leak.
    if (added.length) {
      console.log(`  note  the ${added.length} new field(s) are ALREADY dropped by the allow-list;`);
      console.log("  note  this is a prompt to decide whether any of them belongs, not a leak.");
    }
  } catch (e) {
    check(false, "the live spec was reachable", e.message);
  }
}

console.log(`\n${failed === 0 ? "HARVEST PROJECTION HOLDS: only the allow-list survives" : `FAIL (${failed})`}`);
/*
 * exitCode, not process.exit(): the live branch above leaves undici keep-alive
 * sockets open, and tearing the loop down on top of them trips the Windows libuv
 * assert that 0d02bd5 and 81fba50 each had to fix.
 */
process.exitCode = failed ? 1 : 0;
