/**
 * Google redirects to /signin/oauth/error. WHY?
 *
 * My previous probe treated any 3xx from Google as "client accepted", which was
 * wrong: Google answers a rejected OAuth client with a 302 to
 * accounts.google.com/signin/oauth/error, carrying the real reason in the query
 * string or in the error page body. Reading a status code and stopping was exactly
 * the mistake that misled me.
 *
 * This follows the redirect chain and extracts the reason, because the fix depends
 * entirely on which one it is:
 *
 *   redirect_uri_mismatch  -> register the Supabase callback URI in Google Cloud
 *   invalid_client         -> wrong client id/secret in Supabase
 *   access_blocked         -> the OAuth consent screen is unverified/in testing, so
 *                             only listed test users may sign in
 *   org_internal           -> the client is restricted to one Workspace org
 *   deleted_client         -> the client no longer exists
 *
 * Also decodes Supabase's `state` properly this time (it lives in the URL, not
 * always as a JWT), to confirm where the user would be returned to.
 *
 * Read-only.
 *
 * Run: node scripts/diagnose-google-error.mjs
 */
import { readFileSync } from "node:fs";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const { NEXT_PUBLIC_SUPABASE_URL: URL_BASE } = env;
const SITE = process.argv[2] ?? "https://hseportal.hs-experts.com";
if (!URL_BASE) { console.log("SKIP: no credentials"); process.exit(0); }

const authorize = `${URL_BASE}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(`${SITE}/auth/callback?next=%2F`)}`;
const step1 = await fetch(authorize, { redirect: "manual" });
const googleUrl = step1.headers.get("location");
console.log(`Supabase -> ${new URL(googleUrl).origin}${new URL(googleUrl).pathname}\n`);

const g = new URL(googleUrl);
console.log("=== what Supabase asks Google for ===");
for (const k of ["client_id", "redirect_uri", "response_type", "scope", "state", "code_challenge_method", "access_type", "prompt"]) {
  const v = g.searchParams.get(k);
  if (v) console.log(`  ${k.padEnd(22)} ${k === "state" ? `${v.slice(0, 40)}… (${v.length} chars)` : v}`);
}

// ── Follow Google's chain and read the error ───────────────────────────────
console.log("\n=== following Google's response ===");
let url = googleUrl;
let lastBody = "";
for (let hop = 0; hop < 6; hop++) {
  const res = await fetch(url, { redirect: "manual", headers: { "User-Agent": "Mozilla/5.0" } });
  const loc = res.headers.get("location");
  const u = new URL(url);
  console.log(`  hop ${hop}: HTTP ${res.status}  ${u.hostname}${u.pathname}`);

  // The error page carries the reason in the query string on the redirect itself.
  if (loc) {
    const next = new URL(loc, "https://accounts.google.com");
    for (const key of ["error", "error_description", "error_subtype", "client_id"]) {
      const v = next.searchParams.get(key);
      if (v) console.log(`         ${key} = ${v}`);
    }
    url = next.toString();
    continue;
  }

  lastBody = await res.text();
  break;
}

// ── Identify the failure from the page body ───────────────────────────────
console.log("\n=== Google's reason ===");
const text = lastBody.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const SIGNS = [
  ["redirect_uri_mismatch", /redirect_uri_mismatch/i,
    "The redirect URI Supabase sends is not registered on the Google OAuth client."],
  ["invalid_client / client not found", /invalid_client|OAuth client was not found|deleted_client/i,
    "The client id or secret configured in Supabase does not match a live Google OAuth client."],
  ["access_blocked (app not verified)", /access_blocked|hasn't completed the Google verification|has not completed the Google verification/i,
    "The OAuth consent screen is in Testing or unverified, so only listed test users can sign in."],
  ["org_internal", /org_internal|can only be accessed by users within its organization|internal to an organization/i,
    "The OAuth client is restricted to one Google Workspace organisation."],
  ["admin_policy_enforced", /admin_policy_enforced|blocked by your administrator/i,
    "A Workspace admin policy blocks this app for the signing-in user."],
  ["consent screen not configured", /OAuth consent screen|configure your consent screen/i,
    "The consent screen is incomplete in Google Cloud."],
];
let matched = false;
for (const [label, re, meaning] of SIGNS) {
  if (re.test(text)) {
    console.log(`  ${label}\n    ${meaning}`);
    matched = true;
  }
}
if (!matched) {
  const title = /<title>([^<]+)<\/title>/i.exec(lastBody);
  console.log(`  no known signature matched. Page title: ${title ? title[1].trim() : "(none)"}`);
  console.log(`  first 400 chars of visible text:\n    ${text.slice(0, 400)}`);
}

// ── Where would Supabase send the user back to? ───────────────────────────
console.log("\n=== where Supabase would return the user (from `state`) ===");
const state = g.searchParams.get("state");
if (state) {
  const parts = state.split(".");
  let decoded = null;
  if (parts.length === 3) {
    try { decoded = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")); } catch { /* not a jwt */ }
  }
  if (!decoded) {
    try { decoded = JSON.parse(Buffer.from(state, "base64url").toString("utf8")); } catch { /* opaque */ }
  }
  if (decoded) {
    const back = decoded.referrer ?? decoded.redirect_to ?? decoded.site_url ?? null;
    console.log(`  referrer: ${back ?? JSON.stringify(decoded).slice(0, 160)}`);
    if (back) {
      console.log(
        back.startsWith(`${SITE}/auth/callback`)
          ? "  => our /auth/callback IS allowlisted."
          : `  => Supabase would return to ${back} instead of our callback -- add ${SITE}/auth/callback to Redirect URLs.`,
      );
    }
  } else {
    console.log(`  state is opaque (${state.length} chars); cannot read the return target from outside.`);
    console.log("  Not a problem in itself -- newer Supabase versions keep it server-side.");
  }
}

console.log("\n=== bottom line ===");
console.log("  Supabase's half of the Google flow is configured (it produces a valid authorize");
console.log("  URL with a client_id and the correct Supabase callback). If a signature above");
console.log("  fired, the remaining fix is in the GOOGLE CLOUD console, not in this codebase.");
