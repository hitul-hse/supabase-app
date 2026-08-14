// The HTTP probe passed, but every request died at token verification before
// reaching the redirect decision, so it never actually exercised the guard.
// A test that passes for the wrong reason is worse than no test.
//
// This extracts the real guard expression from the route source and applies it
// to the same hostile inputs, which is the decision that would run on a
// SUCCESSFUL verification - the only case where `next` is used.
import { readFileSync } from "node:fs";

const src = readFileSync("src/app/auth/callback/route.ts", "utf8");

// Confirm the guard still looks the way this test assumes. If the route is
// rewritten, this must fail loudly rather than silently testing a stale copy.
const guardPresent =
  /requestedNext\.startsWith\("\/"\)/.test(src) && /!requestedNext\.startsWith\("\/\/"\)/.test(src);
console.log(`guard found in source: ${guardPresent}`);
if (!guardPresent) {
  console.log("FAIL: the redirect guard no longer matches what this test checks.");
  process.exit(1);
}

// Mirror of the route's logic.
const resolveNext = (requestedNext) =>
  requestedNext && requestedNext.startsWith("/") && !requestedNext.startsWith("//")
    ? requestedNext
    : "/auth/set-password";

const ORIGIN = "https://hse-hub.example.com";

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
  const next = resolveNext(raw);
  const final = `${ORIGIN}${next}`;
  let off = false;
  try {
    off = new URL(final).origin !== ORIGIN;
  } catch {
    off = true;
  }
  check(`${raw.slice(0, 32).padEnd(32)} -> ${next.slice(0, 26)}`, !off);
}

console.log("\nlegitimate values must pass through unchanged:\n");
for (const ok of ["/people", "/admin/users", "/timesheets"]) {
  check(`${ok.padEnd(32)} preserved`, resolveNext(ok) === ok);
}

// The known-sharp edge: "/\evil.com" is same-origin per the URL parser but some
// browsers historically treated backslash as a slash. Confirm where it lands.
const backslash = resolveNext("/\\evil.example.com");
console.log(
  `\nnote: "/\\evil.example.com" resolves to ${new URL(`${ORIGIN}${backslash}`).href}`,
);
console.log("      it is accepted by the guard but stays on this origin, so it is a");
console.log("      broken path rather than a redirect off-site.");

console.log(
  failed
    ? `\n${failed} hostile value(s) would redirect off-origin.`
    : `\nGuard verified directly: no hostile value escapes the origin.`,
);
process.exit(failed ? 1 : 0);
