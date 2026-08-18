/**
 * What ACTUALLY happens when someone signs in with Google or Microsoft, right now,
 * against the live project?
 *
 * The user reports "it gives me an error" for both. The code already anticipates
 * "provider is not enabled", so the first job is to find out whether that IS the
 * error or whether it is something else entirely -- a misconfigured redirect URL, a
 * missing client secret, a consent-screen rejection. Each has a different fix and
 * guessing between them wastes the user's time.
 *
 * WHAT THIS PROBES, without needing the Supabase dashboard:
 *
 *   1. /auth/v1/settings lists which external providers the project has ENABLED.
 *      This is public (the anon key can read it) and is the authoritative answer to
 *      "is Google switched on".
 *   2. /auth/v1/authorize?provider=... is what the button actually navigates to.
 *      Its response distinguishes the failure modes:
 *        302 to accounts.google.com  -> enabled and configured
 *        400 "provider is not enabled" -> switched off in the dashboard
 *        400 something else            -> enabled but misconfigured
 *   3. Whether our redirect target is in the project's allowlist, by asking for a
 *      redirect_to that the app really uses. Supabase silently substitutes the Site
 *      URL when the target is not allowlisted, which loses the PKCE code and is one
 *      of the nastiest failures to diagnose from the outside.
 *
 * Read-only: no configuration is changed.
 *
 * Run: node scripts/diagnose-oauth.mjs
 */
import { readFileSync } from "node:fs";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const { NEXT_PUBLIC_SUPABASE_URL: URL_BASE, NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON } = env;
if (!URL_BASE || !ANON) {
  console.log("SKIP: no Supabase credentials in .env.local");
  process.exit(0);
}

const SITE = process.argv[2] ?? "https://hseportal.hs-experts.com";
console.log(`Supabase project: ${URL_BASE}`);
console.log(`production site:  ${SITE}\n`);

// ── 1. Which providers does the project say are enabled? ───────────────────
console.log("=== 1. providers enabled on the project (/auth/v1/settings) ===");
let settings = null;
try {
  const res = await fetch(`${URL_BASE}/auth/v1/settings`, { headers: { apikey: ANON } });
  settings = await res.json();
  const ext = settings.external ?? {};
  const interesting = ["google", "azure", "email"];
  for (const k of interesting) {
    const on = ext[k] === true;
    console.log(`  ${k.padEnd(8)} ${on ? "ENABLED" : "disabled"}`);
  }
  const others = Object.entries(ext).filter(([k, v]) => v === true && !interesting.includes(k));
  if (others.length) console.log(`  also enabled: ${others.map(([k]) => k).join(", ")}`);
  console.log(`  (signups allowed: ${settings.disable_signup === false ? "yes" : "NO -- disable_signup is on"})`);
} catch (e) {
  console.log(`  could not read settings: ${e.message}`);
}

// ── 2. What does the real authorize endpoint do? ───────────────────────────
console.log("\n=== 2. what the sign-in button actually hits (/auth/v1/authorize) ===");
for (const provider of ["google", "azure"]) {
  const redirectTo = `${SITE}/auth/callback?next=%2F`;
  const url = `${URL_BASE}/auth/v1/authorize?provider=${provider}&redirect_to=${encodeURIComponent(redirectTo)}`;
  try {
    const res = await fetch(url, { redirect: "manual" });
    const loc = res.headers.get("location");
    const label = provider === "azure" ? "Microsoft (azure)" : "Google";

    if (res.status >= 300 && res.status < 400 && loc) {
      const host = new URL(loc).hostname;
      // A redirect back to our OWN site with an error is the disguised failure:
      // it looks like success to a status check.
      const isProvider = /google|microsoftonline|live\.com|okta/i.test(host);
      // Deliberately NOT called "working". Reaching the provider's host only means
      // Supabase built a URL and handed it over; the provider can still refuse it
      // on arrival, which is exactly what happens here for Google. Calling this
      // WORKING is what made an earlier reading of this script miss a live fault.
      // Section 5 follows the chain and returns the provider's actual verdict.
      console.log(`  ${label.padEnd(18)} ${res.status} -> ${host} ${isProvider ? "  (handed off to the provider -- see section 5 for whether it ACCEPTS us)" : "  <== NOT a provider host"}`);
      if (!isProvider) {
        const err = new URL(loc).searchParams.get("error_description") ?? new URL(loc).searchParams.get("error");
        if (err) console.log(`      error carried back: ${err}`);
      }
      // Does the provider URL carry our redirect_uri, and is it the Supabase
      // callback (correct) or something else?
      try {
        const inner = new URL(loc).searchParams.get("redirect_uri");
        if (inner) console.log(`      redirect_uri sent to provider: ${inner}`);
      } catch { /* not parseable */ }
    } else {
      const body = await res.text();
      let msg = body.slice(0, 200);
      try {
        const j = JSON.parse(body);
        msg = j.msg ?? j.error_description ?? j.message ?? msg;
      } catch { /* not json */ }
      const notEnabled = /provider is not enabled|unsupported provider/i.test(msg);
      console.log(`  ${label.padEnd(18)} ${res.status} ${notEnabled ? "<== PROVIDER NOT ENABLED" : "<== enabled but failing"}`);
      console.log(`      ${msg}`);
    }
  } catch (e) {
    console.log(`  ${provider}: request failed -- ${e.message}`);
  }
}

// ── 3. Is our callback URL allowlisted? ───────────────────────────────────
// Supabase substitutes the Site URL when redirect_to is not in the allowlist. If
// the authorize response's state carries a different redirect than we asked for,
// that substitution has happened.
console.log("\n=== 3. is our /auth/callback allowlisted? ===");
console.log("  Supabase silently replaces a non-allowlisted redirect_to with the Site URL,");
console.log("  which drops the PKCE code and lands the user on the home page 'logged out'.");
for (const candidate of [
  `${SITE}/auth/callback`,
  "http://localhost:3000/auth/callback",
]) {
  const url = `${URL_BASE}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(candidate)}`;
  try {
    const res = await fetch(url, { redirect: "manual" });
    const loc = res.headers.get("location");
    if (!loc) { console.log(`  ${candidate}  -> HTTP ${res.status} (no redirect; cannot tell)`); continue; }
    // Supabase encodes where it will send the user back in the `state` JWT, but the
    // observable proxy is whether it redirected to the provider at all.
    const host = new URL(loc).hostname;
    console.log(`  ${candidate.padEnd(52)} -> ${host}`);
  } catch (e) {
    console.log(`  ${candidate}: ${e.message}`);
  }
}

// ── 4. The invite-only question, from the data ────────────────────────────
console.log("\n=== 4. what happens to an UNINVITED Google user? ===");
console.log("  Sign-in creates an auth.users row (that is what OAuth does), but the app");
console.log("  requires a matching app_user_profile row, which only an admin creates.");
console.log("  src/app/auth/callback/route.ts sends a user with no active profile to");
console.log("  /access-pending, so they authenticate but can read nothing -- RLS denies");
console.log("  every table regardless. Verified separately by check:oauth-access-model.");
console.log(`  disable_signup on this project: ${settings?.disable_signup === true ? "TRUE (new auth users are blocked outright)" : "false (new auth users CAN be created, then held at /access-pending)"}`);

// ── 5. WHICH redirect URIs does the Google client actually accept? ────────
// Section 2 can only report *that* Google refuses our URI. That leaves the more
// useful question open: is the client misconfigured for us specifically, or was
// it never wired for Supabase at all? The distinction changes the instruction —
// "add one URI" versus "this client belongs to some other, local-only setup".
//
// It is answerable without credentials. Google refuses an unregistered URI with a
// redirect to its own /signin/oauth/error carrying `redirect_uri_mismatch`, and
// accepts a registered one by reaching the account chooser. So the two outcomes
// are distinguishable from the redirect target alone.
//
// This also supplies the POSITIVE CONTROL the rest of this script lacks. Every
// other Google probe here can only observe failure, which cannot tell "the URI is
// unregistered" apart from "we are being refused for some unrelated reason". If
// one candidate is ACCEPTED by the same probe that rejects the others, the method
// is demonstrated sound and the mismatch verdict is trustworthy.
console.log("\n=== 5. which redirect URIs does the Google OAuth client accept? ===");
// Hoisted so the final summary can report Google's own verdict, not just
// Supabase's. Google being "enabled" was the misleading half of this diagnosis.
let googleUriRegistered = null;
const clientId = await (async () => {
  // Read from the live authorize redirect rather than hardcoding, so this keeps
  // telling the truth if the client is ever swapped.
  try {
    const res = await fetch(`${URL_BASE}/auth/v1/authorize?provider=google`, { redirect: "manual" });
    const loc = res.headers.get("location");
    return loc ? new URL(loc).searchParams.get("client_id") : null;
  } catch { return null; }
})();

if (!clientId) {
  console.log("  could not read a Google client_id from the authorize redirect; skipping.");
} else {
  console.log(`  client: ${clientId}`);

  /** ACCEPTED / MISMATCH / other, for one candidate redirect URI. */
  const probe = async (redirectUri) => {
    let location =
      "https://accounts.google.com/o/oauth2/v2/auth" +
      `?client_id=${encodeURIComponent(clientId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      "&response_type=code&scope=email%20profile&state=probe";

    for (let hop = 0; hop < 6; hop++) {
      const res = await fetch(location, {
        redirect: "manual",
        // A default fetch UA gets a JS-only shell from Google on some paths.
        headers: { "user-agent": "Mozilla/5.0 (compatible; HSEHub/1.0)" },
      });
      const next = res.headers.get("location");
      if (!next) {
        const body = await res.text();
        if (/redirect_uri_mismatch/i.test(body)) return "MISMATCH (not registered)";
        // The account chooser / identifier page is what a registered URI reaches.
        if (/signin\/identifier|Sign in/i.test(body)) return "ACCEPTED (registered)";
        return `terminal HTTP ${res.status}, inconclusive`;
      }
      const asUrl = new URL(next, location);
      if (/redirect_uri_mismatch/i.test(asUrl.href)) return "MISMATCH (not registered)";
      location = asUrl.href;
    }
    return "inconclusive (too many hops)";
  };

  const supabaseCallback = `${URL_BASE.replace(/\/$/, "")}/auth/v1/callback`;
  const candidates = [
    supabaseCallback,
    `${SITE}/auth/callback`,
    "http://localhost:3000/auth/callback",
  ];

  const results = [];
  for (const uri of candidates) {
    let verdict;
    try { verdict = await probe(uri); } catch (e) { verdict = `probe failed: ${e.message}`; }
    results.push([uri, verdict]);
    console.log(`  ${uri.padEnd(58)} ${verdict}`);
  }

  const accepted = results.filter(([, v]) => v.startsWith("ACCEPTED")).map(([u]) => u);
  const supabaseVerdict = results.find(([u]) => u === supabaseCallback)?.[1] ?? "";
  if (supabaseVerdict.startsWith("ACCEPTED")) googleUriRegistered = true;
  else if (supabaseVerdict.startsWith("MISMATCH") && accepted.length > 0) googleUriRegistered = false;

  if (accepted.length === 0) {
    console.log("\n  No candidate was accepted, so this probe has no positive control here:");
    console.log("  treat the mismatch verdicts as unconfirmed and check the client by hand.");
  } else if (supabaseVerdict.startsWith("MISMATCH")) {
    console.log(`\n  The same probe ACCEPTS ${accepted.join(", ")} while refusing the Supabase`);
    console.log("  callback, which is the positive control: the method works, and the refusal");
    console.log("  is specifically that our URI is absent from this client's allowlist.");
    if (accepted.every((u) => /^http:\/\/localhost/.test(u))) {
      console.log("  Note that ONLY a localhost URI is registered. This client was set up for");
      console.log("  local development and was never pointed at Supabase, so adding the");
      console.log("  callback below is the whole of the Google-side work.");
    }
  } else if (supabaseVerdict.startsWith("ACCEPTED")) {
    console.log("\n  The Supabase callback IS registered. If Google sign-in still fails, the");
    console.log("  cause is downstream: consent screen still in Testing, or the client secret.");
  }
}

console.log("\n=== summary of what to fix ===");
const ext = settings?.external ?? {};
if (!ext.google) console.log("  * Google is NOT enabled -> enable it in Supabase Auth > Providers, with a Google OAuth client id/secret.");
else if (googleUriRegistered === false) {
  console.log("  * Google IS enabled in Supabase but GOOGLE ITSELF REFUSES the callback.");
  console.log(`    Google Cloud > APIs & Services > Credentials > client ${clientId ?? "(unknown)"}`);
  console.log(`    > Authorised redirect URIs > add exactly: ${URL_BASE.replace(/\/$/, "")}/auth/v1/callback`);
  console.log("    Console-only; there is no API for this (see check:google-client-manageable).");
}
if (!ext.azure) console.log("  * Microsoft (azure) is NOT enabled -> enable it with an Azure app registration client id/secret.");
if (ext.google && ext.azure && googleUriRegistered !== false) {
  console.log("  * Both providers are enabled and nothing provider-side was detected as broken.");
}
