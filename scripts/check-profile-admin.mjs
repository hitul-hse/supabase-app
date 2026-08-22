/**
 * The profile-admin write path, checked as SECURITY rather than as a feature.
 *
 * These actions take a target user id from the REQUEST, so unlike the
 * self-service ones in profile/actions.ts they can reach another person's
 * record. That makes them the highest-risk surface added in this change, and a
 * Server Action is a public HTTP endpoint — hiding a button proves nothing.
 *
 * Asserted on the SHIPPED source, because the failure modes here are omissions
 * (a missing check, a field that should not be writable) and an omission cannot
 * be caught by exercising the happy path.
 */
import { readFileSync } from "node:fs";

let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? `\n        ${detail}` : ""}`);
};

const F = "src/app/(app)/admin/users/profile-actions.ts";
const src = readFileSync(F, "utf8");
// Comments explain the rules; asserting on them would pass on a file that only
// TALKS about checking permissions.
const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const actions = [
  "adminUpdateProfile",
  "adminUpdateWeeklyHours",
  "adminUpdateEntry",
  "adminDeleteEntry",
];

/* ------------------------------------------- every action is gated, server-side */

for (const name of actions) {
  const start = code.indexOf(`export async function ${name}`);
  check(`${name} exists`, start !== -1);
  if (start === -1) continue;
  // The body up to the next export, so a check belonging to a neighbour cannot
  // be miscredited to this one.
  const next = code.indexOf("export async function", start + 10);
  const body = code.slice(start, next === -1 ? undefined : next);

  check(
    `${name} calls authorise() before doing anything`,
    /const auth = await authorise\(/.test(body),
  );
  check(
    `${name} returns on refusal rather than continuing`,
    /if \(!auth\.ok\) return auth\.result;/.test(body),
  );
  // The gate must be the FIRST statement: a check after a write is decoration.
  const authIndex = body.indexOf("await authorise(");
  const writeIndex = Math.min(
    ...[".update(", ".delete(", ".insert("]
      .map((op) => body.indexOf(op))
      .filter((i) => i !== -1)
      .concat([Number.MAX_SAFE_INTEGER]),
  );
  check(
    `${name} authorises BEFORE any write`,
    authIndex !== -1 && authIndex < writeIndex,
    `authorise at ${authIndex}, first write at ${writeIndex}`,
  );
}

/* ------------------------------------------------ the right key for the right act */

const profileBody = code.slice(
  code.indexOf("export async function adminUpdateProfile"),
  code.indexOf("export async function adminUpdateWeeklyHours"),
);
check(
  "editing a profile requires ADMIN_PROFILES_WRITE",
  profileBody.includes("PERMISSIONS.ADMIN_PROFILES_WRITE"),
);

const entryBody = code.slice(
  code.indexOf("export async function adminUpdateEntry"),
  code.indexOf("export async function adminDeleteEntry"),
);
check(
  "editing a time entry requires the SEPARATE ADMIN_ENTRIES_WRITE key",
  entryBody.includes("PERMISSIONS.ADMIN_ENTRIES_WRITE") &&
    !entryBody.includes("PERMISSIONS.ADMIN_PROFILES_WRITE"),
  "rewriting invoiceable hours must not ride on a profile-edit grant",
);
const deleteBody = code.slice(code.indexOf("export async function adminDeleteEntry"));
check(
  "deleting a time entry requires ADMIN_ENTRIES_WRITE",
  deleteBody.includes("PERMISSIONS.ADMIN_ENTRIES_WRITE"),
);

/* ------------------------------------------- the permission comes from the DB */

check(
  "the permission is asked of the database, not compared to a role string",
  code.includes('rpc("app_user_has_permission"') &&
    !/role(Key)?\s*===\s*["'](exec|hr)["']/.test(code),
  "a hardcoded role would ignore a grant made in /admin/roles",
);

/* --------------------------------------------------- invoiced hours are locked */

for (const [name, body] of [["adminUpdateEntry", entryBody], ["adminDeleteEntry", deleteBody]]) {
  check(
    `${name} refuses an INVOICED entry`,
    /is_billed/.test(body) && /return\s*\{\s*\n?\s*ok: false/.test(body),
  );
  check(
    `${name} reads is_billed BEFORE writing`,
    body.indexOf("is_billed") < Math.min(
      ...[".update(", ".delete("].map((op) => body.indexOf(op)).filter((i) => i !== -1).concat([Number.MAX_SAFE_INTEGER]),
    ),
  );
  check(
    `${name} names the remedy (a credit note), not just "no"`,
    /credit note/i.test(body),
  );
}

/* ------------------------------------------------- fields that must NOT be writable */

check(
  "an entry's member_id is never reassigned (that is not a correction)",
  !/member_id:/.test(entryBody),
  "moving an entry between people rewrites two utilisation figures at once",
);
check(
  "is_billed is never set from a form",
  !/is_billed:\s*(true|false|isBilled|formData)/.test(code),
  "marking time as invoiced is a finance act, not an admin toggle",
);
check(
  "role_key is not writable here (that is /admin/users' own action)",
  !/role_key:/.test(code),
  "two places writing a role means two places to get an escalation wrong",
);

/* --------------------------------------------------- no self-editing via this path */

check(
  "editing your OWN record through this path is refused",
  /userId === auth\.callerId/.test(code),
  "self-service exists for that, and exposes a deliberately smaller field set",
);

/* ------------------------------------------------------------ input validation */

check(
  "contracted hours are bounded, not stored as given",
  /hours <= 0 \|\| hours > 80/.test(code),
  "an absurd value here poisons every utilisation ratio in the app",
);
check(
  "an entry's duration is bounded to a real day",
  /hours <= 0 \|\| hours > 24/.test(entryBody),
);
check(
  "the display name length is checked before the DB constraint fires",
  /length > 60/.test(profileBody),
  "so the user gets a sentence, not a constraint violation",
);

/* ---------------------------------------------------------------- freshness */

check(
  "writes revalidate the pages that display them",
  code.includes("revalidatePath"),
);
check(
  "changing contracted hours refreshes the utilisation surfaces it changes",
  /revalidatePath\("\/team-lead"\)/.test(code) && /revalidatePath\("\/time\/dashboard"\)/.test(code),
  "utilisation is computed against weekly_hours on both",
);

console.log(
  failed === 0
    ? "\nPROFILE ADMIN: every write is permission-gated and invoiced hours are locked"
    : `\n${failed} check(s) failed`,
);
process.exit(failed === 0 ? 0 : 1);
