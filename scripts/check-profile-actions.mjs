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
 */
import { readFileSync } from "node:fs";

const src = readFileSync("src/app/(app)/profile/actions.ts", "utf8");
const constants = readFileSync("src/app/(app)/profile/constants.ts", "utf8");

let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures++;
};

check(src.startsWith('"use server"'), "actions file is server-only");
check(/getUser\(\)/.test(src), "identity is re-checked inside the actions");
check(!/user_id\s*:\s*formData/.test(src), "no action takes a user id from the form");
check(/MAX_AVATAR_BYTES/.test(constants) && /\.size\s*>\s*MAX_AVATAR_BYTES/.test(src), "size limit enforced server-side");
check(/ALLOWED_AVATAR_TYPES/.test(constants) && /includes\(file\.type\)/.test(src), "MIME allow-list enforced server-side");
check(/char_length|\.length\s*>\s*60|slice\(0,\s*60\)/.test(src), "display name length bounded server-side");
check(/\.eq\("user_id",\s*user\.id\)/.test(src), "writes are scoped to the caller's own row");

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
