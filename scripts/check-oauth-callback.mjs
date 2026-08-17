/**
 * The OAuth callback must not become an open redirect.
 *
 * /auth/callback takes a `next` query param and redirects there after
 * establishing a session. That is the same shape as the bug already fixed on the
 * login page, and it is worse here: this route runs *after* the credential has
 * been exchanged, so a visitor sent off-site at this point has a live session and
 * every reason to trust the page they land on.
 *
 * The check extracts the real safeNext() from the route source and runs it, so it
 * cannot pass against a copy that has drifted from what ships. It also asserts
 * the flow-dependent default, because sending an OAuth user to /auth/set-password
 * strands them on a form for a password they will never have.
 */
import { readFileSync } from "node:fs";

const SOURCE = "src/app/auth/callback/route.ts";
const src = readFileSync(SOURCE, "utf8");

let failed = false;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed = true;
};

const fn = src.match(/function safeNext\(raw: string \| null, fallback: string\): string \{[\s\S]*?\n\}/);
if (!fn) {
  console.log(`FAIL: no safeNext() found in ${SOURCE} — the OAuth redirect is unguarded`);
  process.exit(1);
}

// Strip the TypeScript annotations; the body is plain JavaScript.
const safeNext = new Function(
  "raw",
  "fallback",
  fn[0]
    .replace(/^function safeNext\(raw: string \| null, fallback: string\): string \{/, "")
    .replace(/\}$/, ""),
);

const FALLBACK = "/";

// Same-site paths must survive: these are what the login page actually generates.
for (const path of ["/", "/time", "/timesheets", "/admin/users", "/time?scope=team"]) {
  const got = safeNext(path, FALLBACK);
  check(`same-site path preserved: ${path}`, got === path, `got ${got}`);
}

// Every one of these is a real bypass shape, not a hypothetical.
const hostile = [
  ["https://evil.com", "absolute URL to another origin"],
  ["http://evil.com/login", "plain-http absolute URL"],
  ["//evil.com", "protocol-relative — starts with / but leaves the origin"],
  ["//evil.com/path", "protocol-relative with a path"],
  ["/\\evil.com", "backslash form some browsers normalise to protocol-relative"],
  ["javascript:alert(1)", "javascript: scheme"],
  ["data:text/html,<script>alert(1)</script>", "data: URL"],
  ["evil.com", "bare host with no leading slash"],
];

for (const [input, why] of hostile) {
  const got = safeNext(input, FALLBACK);
  check(`refuses ${why}`, got === FALLBACK, `${JSON.stringify(input)} -> ${JSON.stringify(got)}`);
}

check("null falls back", safeNext(null, FALLBACK) === FALLBACK);
check("empty string falls back", safeNext("", FALLBACK) === FALLBACK);

// The fallback is honoured as given, which is what lets the route choose a
// different default per flow.
check(
  "the caller's fallback is used, not a hardcoded one",
  safeNext(null, "/auth/set-password") === "/auth/set-password",
);

// Negative control: the naive version must fail this suite, or the suite is not
// testing the vulnerability.
const naive = (raw, fallback) => raw || fallback;
const leaks = hostile.filter(([input]) => naive(input, FALLBACK) !== FALLBACK);
check(
  "negative control: a naive implementation DOES leak",
  leaks.length > 0,
  `${leaks.length} of ${hostile.length} hostile inputs would pass through`,
);

// ── The flow-dependent default ─────────────────────────────────────────────
// An OAuth user has no password and never will. Defaulting them to
// set-password is a dead end, so the route must branch on the email-flow shape.
check(
  "the route distinguishes email flows from OAuth when choosing a default",
  /isEmailFlow/.test(src) && /Boolean\(tokenHash && type\)/.test(src),
);
check(
  "an email flow defaults to /auth/set-password",
  /isEmailFlow \? "\/auth\/set-password" : "\/"/.test(src),
);

// ── Provider-reported refusals ─────────────────────────────────────────────
// A denied consent screen comes back with error_description and no code. Without
// handling it the visitor sees "missing its verification token", which is both
// wrong and unhelpful.
check(
  "a provider error_description is surfaced rather than swallowed",
  /error_description/.test(src),
);
check(
  "provider errors are checked BEFORE the missing-code branch",
  src.indexOf("if (providerError)") < src.indexOf("if (!code && !isEmailFlow)"),
);

// ── The button's pending state ──────────────────────────────────────────────
// Asserted at the source rather than in a browser: supabase-js assigns
// window.location in the same tick as the call, so the page is already navigating
// before React paints and Playwright loses its execution context. Testing it
// through a browser would test Playwright, not this behaviour.
const buttons = readFileSync("src/components/OAuthButtons.tsx", "utf8");

const iSet = buttons.indexOf("setPending(provider)");
const iCall = buttons.indexOf("signInWithOAuth");
check(
  "pending is set before the OAuth call, not after",
  iSet > 0 && iCall > 0 && iSet < iCall,
  `setPending@${iSet} < signInWithOAuth@${iCall}`,
);

check(
  "both provider buttons are disabled while any one is pending (no double submit)",
  (buttons.match(/disabled=\{disabled \|\| pending !== null\}/g) || []).length === 2,
);

// Every early return must clear pending, or the button stays dead and the user
// has to reload. Counting the two together rather than asserting a fixed number:
// the count legitimately grows when a new failure branch is added (it went from
// 2 to 3 when the disabled-provider probe arrived, and this check correctly went
// red), so what matters is that no `return` leaves pending set.
const returnsInSignIn = (buttons.match(/\n\s+return;/g) || []).length;
const clears = (buttons.match(/setPending\(null\)/g) || []).length;
check(
  "every failure path clears pending so the user can retry",
  clears >= returnsInSignIn && clears >= 2,
  `${clears} clears for ${returnsInSignIn} early returns`,
);

// The success path must NOT clear it: the browser is navigating away and a
// re-enabled button invites a second OAuth flow.
check(
  "the success path leaves pending set while the redirect happens",
  /pending deliberately stays set|leave the\s*\n?\s*\* pending state set/i.test(buttons) ||
    /not be clickable during the redirect/.test(buttons),
);

check(
  "Microsoft is requested as the `azure` provider, which is what Supabase calls it",
  /"google" \| "azure"/.test(buttons) && /signIn\("azure"\)/.test(buttons),
);

console.log(
  failed
    ? "\nOAUTH CALLBACK: redirect handling is unsafe or incomplete"
    : "\nOAUTH CALLBACK: all checks passed",
);
process.exit(failed ? 1 : 0);
