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

const ACTIONS = ["updateDisplayName", "uploadAvatar", "removeAvatar"];
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
  (src.match(/getUser\(\)/g) ?? []).length >= 3,
  "getUser() is called independently in all three actions (>= 3 occurrences)",
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

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
