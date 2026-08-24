// Widen the gate's key regex to allow an underscore in the module segment, and
// record why. CRLF-safe, so it edits by content rather than literal block.
import { readFileSync, writeFileSync } from "node:fs";

const path = "C:/Supabase/scripts/check-permissions-rls.mjs";
const src = readFileSync(path, "utf8");
const eol = src.includes("\r\n") ? "\r\n" : "\n";

const OLD = '/"([a-z]+:[a-z_:]+)"/g';
const NEW = '/"([a-z_]+:[a-z_:]+)"/g';

if (!src.includes(OLD)) {
  console.log(src.includes(NEW) ? "already widened" : "pattern not found");
  process.exit(src.includes(NEW) ? 0 : 1);
}

const note = [
  "//",
  "// The module segment allows an underscore. It did not, and `my_work:read_own`",
  "// was therefore invisible to this regex: the gate counted 36 keys where the",
  "// file declares 37, then reported the database as holding one the code \"does",
  "// not know about\" -- a real permission, granted to all four roles, hidden by",
  "// the gate's own pattern. A scanner that silently skips what it cannot parse",
  "// states a falsehood confidently, which is worse than failing.",
].join(eol);

let out = src.replace(OLD, NEW);
// Put the note directly above the const it explains.
out = out.replace(/(\r?\n)(const codeKeys = new Set\()/, `$1${note}$1$2`);

writeFileSync(path, out, "utf8");
console.log("widened regex and recorded the reason");
