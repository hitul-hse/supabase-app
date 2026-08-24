// Insert the my_work:read_own declaration after OVERVIEW_EXPORT, preserving the
// file's existing line endings (CRLF here, which is why a literal edit failed).
import { readFileSync, writeFileSync } from "node:fs";

const path = "C:/Supabase/src/lib/permissions.ts";
const src = readFileSync(path, "utf8");

if (src.includes("my_work:read_own")) {
  console.log("already present, nothing to do");
  process.exit(0);
}

const eol = src.includes("\r\n") ? "\r\n" : "\n";
const anchor = /(\n|\r\n)([ \t]*OVERVIEW_EXPORT:\s*"overview:export",)/;
const m = src.match(anchor);
if (!m) { console.log("anchor not found"); process.exit(1); }

const block = [
  "",
  "  // My Work",
  "  //",
  "  // Held by every role including employee, because /my-work is the one page",
  "  // that is always about the person asking. Declared here rather than left",
  "  // implicit so the admin Role Permissions screen can show and manage it:",
  "  // that screen renders from THIS list, so a permission the database enforces",
  "  // but this file does not name is real power nobody can see or revoke.",
  '  MY_WORK_READ_OWN:        "my_work:read_own",',
].join(eol);

const out = src.replace(anchor, `$1$2${eol}${block}`);
writeFileSync(path, out, "utf8");

const keys = [...out.matchAll(/"([a-z_]+:[a-z_:]+)"/g)].map((x) => x[1]);
console.log(`inserted. permissions.ts now declares ${new Set(keys).size} keys`);
console.log(`my_work present: ${out.includes("my_work:read_own")}`);
