/**
 * Is our /auth/callback really on Supabase's redirect allowlist?
 *
 * WHY THIS IS WORTH A PROBE. A step-by-step guide that tells the reader to "also
 * check the allowlist" when the allowlist is already correct spends their
 * attention on the one screen where a wrong guess is expensive: a
 * non-allowlisted `redirect_to` is silently replaced by the bare Site URL, which
 * drops the PKCE code and looks exactly like "signed in, then signed out again".
 * The guide should state whether this is done, not ask.
 *
 * `diagnose:oauth` section 3 cannot answer it. It reports only that Supabase
 * redirected to accounts.google.com, which is equally true for an allowlisted
 * target and a substituted one -- the substitution is invisible at that hop.
 *
 * WHERE THE ANSWER ACTUALLY IS. Not in the authorize response. Its `redirect_to`
 * query parameter is the value we just sent, echoed back before any allowlist
 * check, so comparing against it always reports success. (That mistake is why
 * this file has a negative control: the first version of this probe read exactly
 * that field, declared a `https://evil.example.com/steal` target allowlisted, and
 * the control caught it.) The `state` is an opaque UUID and carries nothing.
 *
 * The decision is observable one hop later. Feeding that state back to
 * /auth/v1/callback with an error makes Supabase perform the return redirect
 * itself -- and it does so having applied the allowlist, so the Location header
 * is the target it genuinely honours. An allowlisted request comes back to our
 * own callback path; a refused one comes back to the bare Site URL.
 *
 * Read-only. It drives only the error path, so no code is exchanged and no
 * session is ever created.
 *
 * Run: npm run check:redirect-allowlist
 */
import { readFileSync } from "node:fs";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const URL_BASE = env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
if (!URL_BASE) {
  console.log("SKIP: no NEXT_PUBLIC_SUPABASE_URL in .env.local");
  process.exit(0);
}

const SITE = (process.argv[2] ?? "https://hseportal.hs-experts.com").replace(/\/$/, "");

/** The redirect Supabase actually honours for a requested target. */
async function honoured(requested) {
  const authorize =
    `${URL_BASE}/auth/v1/authorize?provider=google` +
    `&redirect_to=${encodeURIComponent(requested)}`;
  const res = await fetch(authorize, { redirect: "manual" });
  const loc = res.headers.get("location");
  if (!loc) return { error: `authorize gave no redirect (HTTP ${res.status})` };

  const state = new URL(loc).searchParams.get("state");
  if (!state) return { error: "authorize carried no state" };

  // The error path, deliberately: it makes Supabase resolve the return redirect
  // without any code to exchange, so nothing is authenticated.
  const cb = await fetch(
    `${URL_BASE}/auth/v1/callback?error=access_denied&error_description=allowlist_probe` +
      `&state=${encodeURIComponent(state)}`,
    { redirect: "manual" },
  );
  const back = cb.headers.get("location");
  if (!back) return { error: `callback gave no redirect (HTTP ${cb.status})` };
  return { value: back };
}

const cases = [
  { requested: `${SITE}/auth/callback`, expect: "honoured" },
  { requested: `${SITE}/auth/callback?next=%2Ftime`, expect: "honoured" },
  { requested: "http://localhost:3000/auth/callback", expect: "honoured" },
  // Negative control. This MUST be substituted. Without it, a probe that simply
  // always says "honoured" is indistinguishable from a correct allowlist.
  { requested: "https://evil.example.com/steal", expect: "substituted" },
];

console.log(`project: ${URL_BASE}`);
console.log(`site:    ${SITE}\n`);

let controlHeld = false;
const failures = [];

for (const { requested, expect } of cases) {
  const got = await honoured(requested);
  if (got.error) {
    console.log(`  ${requested.padEnd(52)} could not read: ${got.error}`);
    failures.push({ requested, why: got.error });
    continue;
  }

  // Supabase preserves the query string of an honoured target and appends its own
  // error params, so compare origin and path only.
  const same = (() => {
    try {
      const a = new URL(requested);
      const b = new URL(got.value);
      return a.origin === b.origin && a.pathname === b.pathname;
    } catch { return false; }
  })();

  const outcome = same ? "honoured" : "substituted";
  const ok = outcome === expect;
  if (expect === "substituted" && ok) controlHeld = true;
  if (!ok) failures.push({ requested, why: `expected ${expect}, got ${outcome}` });

  console.log(`  ${requested.padEnd(52)} ${outcome.toUpperCase()}${ok ? "" : "  <== UNEXPECTED"}`);
  if (!same) console.log(`      Supabase instead returns to: ${got.value.split("#")[0]}`);
}

console.log("");
if (!controlHeld) {
  console.log("NEGATIVE CONTROL FAILED: a bogus redirect target was NOT substituted.");
  console.log("Either the allowlist is genuinely wide open -- an open redirect, and a real");
  console.log("problem -- or this probe is no longer reading the value Supabase honours.");
  console.log("Either way the rows above are meaningless. Investigate before trusting them.");
  process.exit(1);
}

console.log("Negative control held: a bogus target IS replaced by the bare Site URL, so the");
console.log("rows above reflect a real allowlist decision rather than an echo of the request.");

if (failures.length === 0) {
  console.log("\nEvery callback the app uses is allowlisted. Nothing to change under");
  console.log("Authentication > URL Configuration > Redirect URLs.");
} else {
  console.log("\nNeeds fixing under Authentication > URL Configuration > Redirect URLs:");
  for (const f of failures) console.log(`  * ${f.requested} -- ${f.why}`);
  process.exit(1);
}
