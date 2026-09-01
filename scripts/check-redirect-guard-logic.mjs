// The HTTP probe passed, but every request died at token verification before
// reaching the redirect decision, so it never actually exercised the guard.
// A test that passes for the wrong reason is worse than no test.
//
// This pulls the REAL guard function out of the route source and applies it to
// hostile inputs, which is the decision that would run on a SUCCESSFUL
// verification - the only case where `next` is used.
//
// History: the first version of this file mirrored an inline
// `requestedNext.startsWith("/") && !requestedNext.startsWith("//")` expression
// by hand. 81ac22f moved that logic into `safeNext(raw, fallback)`, tightened it
// to also reject "/\" and made the fallback flow-dependent, and this gate kept
// failing its own "is the guard still there?" anchor for the old spelling. Now
// the function body is extracted and executed as-is, so the gate follows the
// guard's behaviour rather than a copy of it -- and a silent loosening of the
// real function fails here instead of passing against a stale mirror.
import { readFileSync } from "node:fs";

const src = readFileSync("src/app/auth/callback/route.ts", "utf8");

// Confirm the guard still looks the way this test assumes. If the route is
// rewritten, this must fail loudly rather than silently testing a stale copy.
//
// Three anchors, and every one has to hold:
//   1. the helper exists with the signature the extraction below relies on;
//   2. it is applied to the raw `next` query param, with the flow-dependent
//      fallback (set-password for invites, root for OAuth);
//   3. the final redirect is built from the guarded value, not from the raw one.
const fnMatch = src.match(
  /function safeNext\(raw: string \| null, fallback: string\): string \{\n([\s\S]*?)\n\}/,
);
const appliedToQuery =
  /const next = safeNext\(searchParams\.get\("next"\), isEmailFlow \? "\/auth\/set-password" : "\/"\)/.test(
    src,
  );
const redirectsGuardedValue = /NextResponse\.redirect\(`\$\{origin\}\$\{next\}`\)/.test(src);
const guardPresent = Boolean(fnMatch) && appliedToQuery && redirectsGuardedValue;
console.log(`guard found in source: ${guardPresent}`);
if (!guardPresent) {
  console.log(
    `FAIL: the redirect guard no longer matches what this test checks (safeNext: ${Boolean(fnMatch)}, applied to ?next: ${appliedToQuery}, redirect uses guarded value: ${redirectsGuardedValue}).`,
  );
  process.exit(1);
}

// The real function, executed. The body is plain JS (types live only in the
// signature), so it runs unchanged.
const safeNext = new Function("raw", "fallback", fnMatch[1]);

const ORIGIN = "https://hse-hub.example.com";
const EMAIL_FALLBACK = "/auth/set-password";
const OAUTH_FALLBACK = "/";

const HOSTILE = [
  "https://evil.example.com",
  "//evil.example.com",
  "https:/evil.example.com",
  "/\\evil.example.com",
  "\\\\evil.example.com",
  "http://evil.example.com/path",
  "//google.com",
  "javascript:alert(1)",
  "data:text/html,<script>alert(1)</script>",
  "///evil.example.com",
  "/%09/evil.example.com",
];

let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failed++;
};

console.log("\nApplying the guard to the value that WOULD be used on success:\n");

for (const raw of HOSTILE) {
  for (const fallback of [EMAIL_FALLBACK, OAUTH_FALLBACK]) {
    const next = safeNext(raw, fallback);
    const final = `${ORIGIN}${next}`;
    let off = false;
    try {
      off = new URL(final).origin !== ORIGIN;
    } catch {
      off = true;
    }
    check(`${raw.slice(0, 32).padEnd(32)} -> ${next.slice(0, 26).padEnd(26)} (fallback ${fallback})`, !off);
  }
}

console.log("\nlegitimate values must pass through unchanged:\n");
for (const ok of ["/people", "/admin/users", "/timesheets", "/time?week=2026-W36"]) {
  check(`${ok.padEnd(32)} preserved`, safeNext(ok, EMAIL_FALLBACK) === ok);
}

console.log("\nabsent or empty values must land on the flow's own fallback:\n");
check("null   -> email fallback", safeNext(null, EMAIL_FALLBACK) === EMAIL_FALLBACK);
check("null   -> oauth fallback", safeNext(null, OAUTH_FALLBACK) === OAUTH_FALLBACK);
check('""     -> email fallback', safeNext("", EMAIL_FALLBACK) === EMAIL_FALLBACK);
check('"people" (no leading slash) -> fallback', safeNext("people", OAUTH_FALLBACK) === OAUTH_FALLBACK);

// The known-sharp edge: "/\evil.com" is same-origin per the URL parser but some
// browsers historically treated backslash as a slash. The old inline guard let
// it through (it starts with "/") and this file merely noted where it landed;
// safeNext rejects it outright. That is now asserted, so a future edit that
// drops the "/\\" clause fails here rather than quietly reopening the edge.
check(
  '"/\\evil.example.com" is rejected, not merely kept on-origin',
  safeNext("/\\evil.example.com", OAUTH_FALLBACK) === OAUTH_FALLBACK,
);
check(
  '"//evil.example.com" is rejected under both fallbacks',
  safeNext("//evil.example.com", EMAIL_FALLBACK) === EMAIL_FALLBACK &&
    safeNext("//evil.example.com", OAUTH_FALLBACK) === OAUTH_FALLBACK,
);

console.log(
  failed
    ? `\n${failed} hostile value(s) would redirect off-origin.`
    : `\nGuard verified directly: no hostile value escapes the origin.`,
);
process.exit(failed ? 1 : 0);
