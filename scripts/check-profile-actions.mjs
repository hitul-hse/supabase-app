/**
 * The profile actions enforce their own limits, not the browser's.
 *
 * The upload UI resizes and filters before sending, which is a convenience.
 * A Server Action is a public HTTP endpoint and receives whatever the caller
 * sends, so the same three limits have to hold when the client is skipped
 * entirely. This reads the action source and asserts the checks are present
 * and server-side; Task 8 drives them over the wire.
 *
 * MAX_AVATAR_BYTES and ALLOWED_AVATAR_TYPES live in ./constants.ts, not in
 * actions.ts -- a module carrying "use server" may only export async
 * functions, so the limits are asserted against the constants file while the
 * enforcement checks (which reference the imported names) are asserted
 * against the actions file.
 *
 * Fix round 1 findings addressed here:
 *  - Comments are stripped before any regex runs, so an assertion can never
 *    be satisfied by prose (a docblock mentioning "char_length" used to be
 *    enough to pass the display-name check even with the real check deleted).
 *  - The display-name assertion now targets MAX_DISPLAY_NAME, the constant
 *    the code actually uses, instead of magic numbers that never matched.
 *  - Identity/scoping checks are asserted PER ACTION (each of the three
 *    functions is sliced out and checked on its own), not once anywhere in
 *    the file -- a file-wide check is satisfied by one function's copy even
 *    if another function's guard is deleted entirely.
 *  - The MIME check asserts the literal negation `!ALLOWED_AVATAR_TYPES
 *    .includes(file.type)`, not just `includes(file.type)` -- the bare form
 *    is still present if the `!` is removed, which would silently invert an
 *    allow-list into a deny-list.
 */
import { readFileSync } from "node:fs";

/** Block comments then line comments -- in that order, so a `//` inside a
 * `/* ... *\/` block isn't left dangling after the block is removed. */
function stripComments(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const rawSrc = readFileSync("src/app/(app)/profile/actions.ts", "utf8");
const rawConstants = readFileSync("src/app/(app)/profile/constants.ts", "utf8");
const src = stripComments(rawSrc);
const constants = stripComments(rawConstants);

let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures++;
};

/**
 * Slice out one `export async function NAME(...) { ... }` body by scanning
 * braces from its opening `{`, so nested braces inside the function don't
 * truncate the slice early.
 */
function functionBody(name) {
  const start = src.indexOf(`export async function ${name}`);
  if (start === -1) return null;
  const openBrace = src.indexOf("{", start);
  if (openBrace === -1) return null;
  let depth = 0;
  for (let i = openBrace; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(openBrace, i + 1);
    }
  }
  return null;
}

check(rawSrc.startsWith('"use server"'), "actions file is server-only");
check(!/user_id\s*:\s*formData/.test(src), "no action takes a user id from the form");
check(/MAX_AVATAR_BYTES/.test(constants), "MAX_AVATAR_BYTES is defined in constants.ts");
check(/ALLOWED_AVATAR_TYPES/.test(constants), "ALLOWED_AVATAR_TYPES is defined in constants.ts");
check(/MAX_DISPLAY_NAME\s*=\s*60/.test(src), "MAX_DISPLAY_NAME is defined and set to 60");

const ACTIONS = ["updateDisplayName", "uploadAvatar", "removeAvatar", "updatePreferences"];
const bodies = Object.fromEntries(ACTIONS.map((name) => [name, functionBody(name)]));

for (const name of ACTIONS) {
  check(bodies[name] !== null, `${name} is present as an exported function`);
}

// Per-action, not per-file: a file-wide grep is satisfied by one function's
// copy of a check even when another function's copy has been deleted.
for (const name of ACTIONS) {
  const body = bodies[name] ?? "";
  check(/getUser\(\)/.test(body), `${name} re-checks identity via getUser()`);
  check(/if\s*\(\s*!user\s*\)/.test(body), `${name} refuses to proceed when there is no user`);
  check(/\.eq\("user_id",\s*user\.id\)/.test(body), `${name} scopes its write to the caller's own row`);
}

check(
  (src.match(/getUser\(\)/g) ?? []).length >= 4,
  "getUser() is called independently in all four actions (>= 4 occurrences)",
);

check(
  /\.length\s*>\s*MAX_DISPLAY_NAME/.test(bodies.updateDisplayName ?? ""),
  "display name length is bounded against MAX_DISPLAY_NAME server-side",
);

check(
  /\.size\s*>\s*MAX_AVATAR_BYTES/.test(bodies.uploadAvatar ?? ""),
  "size limit enforced server-side in uploadAvatar",
);

// Asserts the NEGATION literally -- `includes(file.type)` alone still matches
// if the leading `!` were removed, which would flip the allow-list into a
// deny-list and still pass a check that only looked for `includes(file.type)`.
check(
  /!ALLOWED_AVATAR_TYPES\.includes\(file\.type\)/.test(bodies.uploadAvatar ?? ""),
  "MIME allow-list enforced server-side in uploadAvatar (as a rejection, not merely present)",
);

// changePassword: a Server Action is a public HTTP endpoint reachable without
// the page's own gate, so identity is re-checked here exactly like the other
// three actions, and the current password must be verified against Supabase
// (signInWithPassword) before the new one is ever written (updateUser).
const changePasswordBody = functionBody("changePassword");
check(changePasswordBody !== null, "changePassword is present as an exported function");

{
  const body = changePasswordBody ?? "";

  check(/getUser\(\)/.test(body), "changePassword re-checks identity via getUser()");
  check(/if\s*\(\s*!user\s*\)/.test(body), "changePassword refuses to proceed when there is no user");

  check(/signInWithPassword/.test(body), "password change verifies the CURRENT password first");
  check(/auth\.updateUser\(\s*\{\s*password/.test(body), "password change calls updateUser");

  const verifyIdx = body.indexOf("signInWithPassword");
  const updateIdx = body.indexOf("updateUser");
  check(
    verifyIdx !== -1 && updateIdx !== -1 && verifyIdx < updateIdx,
    "verification happens before the update, not after",
  );

  // Matches the sanitisation pattern in the other three actions: a Supabase
  // error is logged server-side and a short human message goes to the
  // client, never the raw error text (which can carry auth-internal detail).
  check(
    !/message:\s*\w*[Ee]rror\.message/.test(body),
    "changePassword does not return raw Supabase error text to the client",
  );
}

// updatePreferences: LANDING_PAGES and LOCALES must live in constants.ts, not
// actions.ts -- a module carrying "use server" may only export async
// functions, and a client component (PreferencesCard) needs to import these
// plain arrays to render its <select> options. This also asserts they are NOT
// merely re-declared in actions.ts, which would let the two copies drift from
// the live check constraints independently.
check(/LANDING_PAGES\s*=\s*\[/.test(constants), "LANDING_PAGES is defined in constants.ts");
check(/LOCALES\s*=\s*\[/.test(constants), "LOCALES is defined in constants.ts");
check(
  !/export const LANDING_PAGES/.test(src) && !/export const LOCALES/.test(src),
  "LANDING_PAGES/LOCALES are not re-declared in actions.ts (single source of truth)",
);

{
  const body = bodies.updatePreferences ?? "";

  // Enumerated-value validation: the two lists imported from constants.ts
  // must actually gate the write, not just be imported. A value that passes
  // here but fails the live check constraint would otherwise surface to the
  // user as a raw Postgres error instead of a readable message.
  check(
    /LANDING_PAGES\.some\(/.test(body) || /LANDING_PAGES\.includes\(/.test(body),
    "updatePreferences validates pref_landing_page against LANDING_PAGES server-side",
  );
  check(
    /LOCALES\.some\(/.test(body) || /LOCALES\.includes\(/.test(body),
    "updatePreferences validates pref_locale against LOCALES server-side",
  );

  // An unchecked HTML checkbox submits no field at all, so
  // formData.get("pref_sidebar_collapsed") is null, not "off". The only
  // correct read is an equality check against the checked-state sentinel
  // ("on"), which is false for both null and "off" -- anything looser (e.g.
  // testing !== "off") would leave the preference stuck on forever.
  check(
    /pref_sidebar_collapsed"\)\s*===\s*"on"/.test(body),
    "pref_sidebar_collapsed is read as === \"on\", so a missing (unchecked) field resolves to false",
  );

  check(
    !/message:\s*\w*[Ee]rror\.message/.test(body),
    "updatePreferences does not return raw Supabase error text to the client",
  );
}

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
