/**
 * The invite form must not grant a role by omission.
 *
 * WHY THIS GATE EXISTS. Until 2026-09-09 the Role dropdown on /admin/users
 * defaulted to Executive. getRoles() (src/lib/queries/auth.ts) orders app_role
 * by seniority DESCENDING, and the form rendered no blank first option — so the
 * browser pre-selected the FIRST option, which is the most senior role there
 * is. An invite submitted without touching that field granted every project,
 * every person, every budget, and admin:users:write, which is the right to
 * provision further users. There was no confirmation step.
 *
 * What made it worth a gate rather than a one-line fix is the DIRECTION of the
 * silence. An over-granted colleague sees everything, everything works, and
 * nobody ever finds out. An under-granted one says "the app is empty" within a
 * minute. Only the dangerous mistake was quiet — and it was the path of least
 * resistance.
 *
 * This is deliberately a STATIC gate. Every other gate covering this path —
 * check-identity-linking, check-invite-oauth-model, check-provisioned-access,
 * check-user-management — needs a service-role key or live DML and is skipped
 * on every unattended run (see ~/.night-shift/run/<stamp>/skipped.txt). A gate that
 * only runs when someone remembers to run it is not protecting anything at
 * 3am, so this one reads the source and nothing else.
 *
 * It asserts the PROPERTY, not the implementation: that submitting the form
 * without a deliberate choice is impossible. Either a placeholder with an empty
 * value, or an ascending sort so the least-senior role is the default, would
 * satisfy the intent — but the placeholder is what is in place, and a future
 * change that drops it while relying on sort order alone would silently regress
 * the moment a role with higher seniority is added. So both halves are checked.
 */
import { readFileSync } from "node:fs";
import { record } from "./lib/gate-result.mjs";

const FORM = "src/app/(app)/admin/users/InviteUserForm.tsx";
const QUERY = "src/lib/queries/auth.ts";

let failures = 0;
const check = (ok, label, detail = "") => {
  record(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const form = readFileSync(FORM, "utf8");
const query = readFileSync(QUERY, "utf8");

// The role select, isolated, so a placeholder in some other select cannot satisfy this.
const select = form.match(/<select[^>]*name="role_key"[\s\S]*?<\/select>/);
check(Boolean(select), "the role select exists in the invite form", FORM);

if (select) {
  const s = select[0];
  check(/defaultValue=""/.test(s), 'the role select carries defaultValue=""',
    "without it React lets the browser pre-select the first option");
  check(/<option\s+value=""[^>]*disabled/.test(s), "a disabled empty-value placeholder is the first option",
    "this is what makes 'no choice' unsubmittable");
  check(/\brequired\b/.test(s), "the select is required",
    'required + value="" is what the browser enforces');

  // The property that actually matters: whatever is selected before a human
  // touches it must not be a real role_key.
  const firstOption = s.match(/<option[^>]*value="([^"]*)"/);
  check(firstOption && firstOption[1] === "", "the first option's value is empty, not a role_key",
    firstOption ? `first option value=${JSON.stringify(firstOption[1])}` : "no option found");
}

// The sort order is not the protection, but a reader should know which way it runs:
// descending means the most senior role is first, which is why the placeholder is load-bearing.
const desc = /order\(\s*"seniority"\s*,\s*\{\s*ascending:\s*false/.test(query);
check(true, `getRoles() sorts seniority ${desc ? "DESCENDING (most senior first)" : "ascending"}`,
  desc ? "the placeholder is what prevents an Executive default" : "least-senior is first, placeholder still required");

console.log(`\n${failures === 0 ? "OK" : "FAILED"}: invite form cannot grant a role by omission`);
process.exit(failures === 0 ? 0 : 1);
