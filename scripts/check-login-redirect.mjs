/**
 * The post-login redirect must not leave this origin.
 *
 * `redirect_to` is attacker-controlled: the login page reads it from the URL and
 * navigates there after a successful sign-in. Unvalidated, that is an open
 * redirect at the worst possible moment -- the user has just proved they trust
 * this app, and lands on a page of somebody else's choosing that can ask for the
 * credential again.
 *
 * This gate re-implements nothing. It extracts the real safeRedirect() from the
 * page source and executes it, so the check cannot pass against a copy that has
 * drifted from what ships. It also carries a negative control proving the naive
 * version it replaced would have failed, because a test that passes for both the
 * bug and the fix proves nothing.
 */
import { readFileSync } from "node:fs";

const SOURCE = "src/app/auth/login/page.tsx";
const src = readFileSync(SOURCE, "utf8");

const fn = src.match(/function safeRedirect\(raw: string \| null\): string \{[\s\S]*?\n\}/);
if (!fn) {
  console.log(`FAIL: no safeRedirect() found in ${SOURCE} — the login redirect is unguarded`);
  process.exit(1);
}

// Strip the TypeScript annotations; the body is plain JavaScript otherwise.
const safeRedirect = new Function(
  "raw",
  fn[0]
    .replace(/^function safeRedirect\(raw: string \| null\): string \{/, "")
    .replace(/\}$/, ""),
);

// The naive implementation this replaced, kept as the negative control.
const naive = (raw) => raw || "/";

let failed = false;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed = true;
};

// Paths that must survive: these are what requireUser() actually generates.
for (const path of [
  "/",
  "/time",
  "/timesheets",
  "/admin/users",
  "/projects",
  "/time?week=2026-08-17&scope=team",
]) {
  const got = safeRedirect(path);
  check(`same-site path is preserved: ${path}`, got === path, `got ${got}`);
}

// Everything that must be refused. Each of these would navigate off-origin, and
// every one is a real bypass shape rather than a hypothetical.
const hostile = [
  ["https://evil.com", "absolute URL to another origin"],
  ["http://evil.com/login", "plain-http absolute URL"],
  ["//evil.com", "protocol-relative URL — starts with / but leaves the origin"],
  ["//evil.com/path", "protocol-relative URL with a path"],
  ["/\\evil.com", "backslash form some browsers normalise to protocol-relative"],
  ["javascript:alert(1)", "javascript: scheme"],
  ["data:text/html,<script>alert(1)</script>", "data: URL"],
  ["evil.com", "bare host, no leading slash"],
];

for (const [input, why] of hostile) {
  const got = safeRedirect(input);
  check(`refuses ${why}`, got === "/", `${JSON.stringify(input)} -> ${JSON.stringify(got)}`);
}

// Absent or empty input falls back to the app root rather than "" (which
// router.push("") does not treat as the home page).
check("null falls back to /", safeRedirect(null) === "/");
check("empty string falls back to /", safeRedirect("") === "/");

// Negative control: the implementation this replaced must fail the same suite,
// which is what proves the suite is testing the vulnerability and not just
// asserting that some function exists.
const naiveLeaks = hostile.filter(([input]) => naive(input) !== "/");
check(
  "negative control: the previous naive version DOES leak",
  naiveLeaks.length > 0,
  `${naiveLeaks.length} of ${hostile.length} hostile inputs pass through unvalidated`,
);

console.log(
  failed
    ? "\nLOGIN REDIRECT: open-redirect protection is missing or incomplete"
    : "\nLOGIN REDIRECT: all checks passed",
);
process.exit(failed ? 1 : 0);
