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
      console.log(`  ${label.padEnd(18)} ${res.status} -> ${host} ${isProvider ? "  (provider consent screen: WORKING)" : "  <== NOT a provider host"}`);
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

console.log("\n=== summary of what to fix ===");
const ext = settings?.external ?? {};
if (!ext.google) console.log("  * Google is NOT enabled -> enable it in Supabase Auth > Providers, with a Google OAuth client id/secret.");
if (!ext.azure) console.log("  * Microsoft (azure) is NOT enabled -> enable it with an Azure app registration client id/secret.");
if (ext.google && ext.azure) console.log("  * Both providers are enabled; if sign-in still errors the cause is downstream (redirect allowlist or provider-side config).");
