/*
 * Fixture for house/no-machine-absolute-path.
 *
 * The drive letters here deliberately avoid `C:/Users` and `C:/Supabase`:
 * scripts/check-no-absolute-paths.mjs scans every .mjs under scripts/ for
 * exactly those two fragments, and a fixture that turned an unrelated gate red
 * would be a fixture nobody keeps.
 *
 * Never executed. No eslint-disable: that would switch off the rule under test.
 */

import { readFileSync } from "node:fs";

const file = "schema.sql";

/* ── must be flagged ─────────────────────────────────────────────────────── */

export function windowsDriveInAString() {
  return readFileSync("C:/hse-hub/supabase/schema.sql", "utf8"); // VIOLATION
}

// The form a codemod that only matched quoted strings missed, and which failed
// on the very next CI run.
export function windowsDriveInATemplate() {
  return readFileSync(`C:/hse-hub/scripts/${file}`, "utf8"); // VIOLATION
}

// The same defect written from WSL. The existing gate's regex does not match
// this one at all.
export function wslHomeInAString() {
  return readFileSync("/home/hitul/code/supabase-app/package.json", "utf8"); // VIOLATION
}

/* ── must NOT be flagged ─────────────────────────────────────────────────── */

// The fix: resolve from the file's own location.
export function resolvesFromItsOwnLocation(repoRoot) {
  return readFileSync(`${repoRoot}/supabase/schema.sql`, "utf8");
}

// A repo-relative path is fine on every machine.
export function repoRelative() {
  return readFileSync("supabase/schema.sql", "utf8");
}

// A URL scheme is not a drive letter. check-open-redirect.mjs really does hold
// "https:/evil.example.com" as a fixture, and the first version of this rule
// flagged it.
export const REDIRECT_PROBES = ["https:/evil.example.com", "http:/other.example.com"];

// A newline escape in a template is not a path separator. The first version of
// this rule read the RAW template text, where `\n` is a backslash followed by
// an `n`, and produced fourteen findings of this shape.
export function printsAPolicy(policy) {
  return `current policy:\n  ${policy}\n`;
}

// A POSIX route or absolute URL path that is not a home directory.
export const ROUTES = ["/projects", "/admin/system-health"];
