// Security probe for the new /auth/callback route (commit 7eb4ad4).
//
// The route takes a `next` parameter and redirects to it. That is a classic
// open-redirect surface: if an attacker can put an absolute URL there, a link
// that looks like it points at this app sends the victim elsewhere, which is
// exactly how credential-phishing links get laundered through a trusted domain.
//
// The author guarded it. This verifies the guard actually holds against the
// usual bypasses rather than trusting the comment.
const BASE = "http://localhost:3000";

const HOSTILE = [
  "https://evil.example.com",
  "//evil.example.com",
  "https:/evil.example.com",
  "/\\evil.example.com",
  "\\\\evil.example.com",
  "http://evil.example.com/path",
  "//google.com",
  "/%2f%2fevil.example.com",
  "javascript:alert(1)",
  "data:text/html,<script>alert(1)</script>",
];

let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failed++;
};

console.log("OPEN-REDIRECT PROBE: /auth/callback?next=...\n");

for (const next of HOSTILE) {
  // Include a token so the handler proceeds past its missing-token guard and
  // actually reaches the redirect decision.
  const url = `${BASE}/auth/callback?token_hash=fake&type=invite&next=${encodeURIComponent(next)}`;
  const res = await fetch(url, { redirect: "manual" });
  const loc = res.headers.get("location") || "";

  // Whatever happens, the visitor must never be sent off-origin.
  let offOrigin = false;
  try {
    offOrigin = Boolean(loc) && new URL(loc, BASE).origin !== new URL(BASE).origin;
  } catch {
    offOrigin = false;
  }
  const dangerousScheme = /^(javascript|data):/i.test(loc.trim());

  check(
    `next=${next.slice(0, 34).padEnd(34)} stays on-origin`,
    !offOrigin && !dangerousScheme,
    `-> ${loc.slice(0, 70) || "(no redirect)"}`,
  );
}

console.log("\nlegitimate relative paths should still work:");
for (const next of ["/people", "/admin/users"]) {
  const url = `${BASE}/auth/callback?token_hash=fake&type=invite&next=${encodeURIComponent(next)}`;
  const res = await fetch(url, { redirect: "manual" });
  const loc = res.headers.get("location") || "";
  // A fake token fails verification, so the expected landing spot is the login
  // page with an error. The point is that it is on-origin, not off.
  const onOrigin = loc.startsWith(BASE);
  check(`next=${next.padEnd(34)} handled on-origin`, onOrigin, `-> ${loc.slice(0, 70)}`);
}

console.log(
  failed
    ? `\n${failed} OPEN REDIRECT(S) — an attacker could bounce users off-site via a link on this domain.`
    : `\nNo open redirect: every hostile 'next' value stayed on-origin.`,
);
process.exit(failed ? 1 : 0);
