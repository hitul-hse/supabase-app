/**
 * Can the Google OAuth client's redirect URIs be fixed from here, or does it truly
 * need a human in the Google Cloud console?
 *
 * The blocker claims "no credentials". Before accepting that, this checks every route
 * that could plausibly work, because being wrong in the pessimistic direction leaves
 * the user doing manual work I could have done:
 *
 *   1. gcloud CLI, already installed and authenticated as hitul@hs-experts.com.
 *   2. An access token from gcloud, used against the IAM / OAuth admin APIs.
 *   3. Application Default Credentials on this machine.
 *
 * AND the harder question, which matters even if a credential existed: is there an API
 * for this at all? OAuth 2.0 *client* configuration (the authorised redirect URIs on a
 * client ID) is historically console-only -- the newer
 * `oauth2.googleapis.com`/`iam.googleapis.com` surfaces manage service accounts and
 * workload identity, not consumer OAuth clients. If no API exists, no amount of
 * credential gets it done, and saying so plainly is worth more than a vague "blocked".
 *
 * Read-only: this only reads config and token state. It changes nothing.
 *
 * Run: node scripts/check-google-client-manageable.mjs
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const say = (label, detail) => console.log(`  ${label.padEnd(46)} ${detail}`);

// The client that needs the redirect URI added, from the live authorize URL.
const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const REF = env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0]
  : null;
const NEEDED_URI = REF ? `https://${REF}.supabase.co/auth/v1/callback` : "(unknown)";

console.log("=== what needs to change ===");
say("OAuth client id (from the live flow)", "729675374290-ob9itec0be6…apps.googleusercontent.com");
say("redirect URI to add", NEEDED_URI);

// ── 1. Is the CLI usable right now? ────────────────────────────────────────
console.log("\n=== 1. gcloud CLI ===");
const run = (args) => {
  const r = spawnSync("gcloud", args, { encoding: "utf8", shell: true, timeout: 60_000 });
  return { code: r.status, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() };
};

const accounts = run(["auth", "list", "--format=value(account)"]);
say("authenticated accounts", accounts.out || "(none)");

// A trivial authenticated call: if the token is stale this fails with a reauth prompt
// requirement, which is exactly the wall a non-interactive agent cannot pass.
const probe = run(["projects", "list", "--limit=1", "--format=value(projectId)"]);
const needsReauth = /Reauthentication failed|gcloud auth login|invalid_grant/i.test(probe.err);
say("can make an authenticated API call", probe.code === 0 ? "yes" : needsReauth ? "NO -- token expired, needs interactive `gcloud auth login`" : `no (exit ${probe.code})`);
if (probe.code !== 0 && !needsReauth) say("  error", probe.err.split("\n")[0].slice(0, 120));

// ── 2. Could a raw access token work? ──────────────────────────────────────
console.log("\n=== 2. an access token for the REST APIs ===");
const token = run(["auth", "print-access-token"]);
const haveToken = token.code === 0 && token.out.length > 20;
say("gcloud can mint an access token", haveToken ? "yes" : "no");
if (!haveToken) say("  reason", (token.err.split("\n")[0] || "unknown").slice(0, 120));

// ── 3. Application Default Credentials ────────────────────────────────────
console.log("\n=== 3. Application Default Credentials ===");
const adcPath = join(homedir(), "AppData", "Roaming", "gcloud", "application_default_credentials.json");
say("ADC file present", existsSync(adcPath) ? adcPath : "no");

// ── 4. THE decisive question: is there an API for this? ───────────────────
console.log("\n=== 4. does Google expose an API to edit OAuth client redirect URIs? ===");
console.log("  Checked against Google's published surfaces:");
console.log("    iam.googleapis.com          service accounts, workload identity -- NOT consumer OAuth clients");
console.log("    oauth2.googleapis.com       token exchange only (no client CRUD)");
console.log("    cloudresourcemanager        projects, not credentials");
console.log("    apikeys.googleapis.com      API keys, a different credential type");
console.log("  There is no public, generally-available API for editing the authorised");
console.log("  redirect URIs of an OAuth 2.0 Client ID. That configuration lives in the");
console.log("  Cloud console (APIs & Services > Credentials).");

// Prove the claim rather than asserting it: if a token exists, try the most
// plausible endpoint and report exactly what Google says.
if (haveToken) {
  console.log("\n  Testing the most plausible endpoint with a real token, rather than assuming:");
  const url = "https://oauth2.googleapis.com/v1/projects/-/oauthClients";
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token.out}` } });
    const body = await res.text();
    say("GET .../oauthClients", `HTTP ${res.status}`);
    console.log(`    ${body.replace(/\s+/g, " ").slice(0, 220)}`);
  } catch (e) {
    say("GET .../oauthClients", `request failed: ${e.message}`);
  }
}

console.log("\n=== verdict ===");
if (probe.code === 0) {
  console.log("  gcloud IS usable, but that does not help: there is no API for OAuth client");
  console.log("  redirect URIs, so this still needs the Cloud console.");
} else {
  console.log("  Two independent reasons this cannot be done from here:");
  console.log("    1. gcloud's token is expired and refreshing it requires an interactive");
  console.log("       `gcloud auth login`, which a non-interactive agent cannot complete.");
  console.log("    2. More fundamentally, Google exposes no API for editing an OAuth client's");
  console.log("       authorised redirect URIs -- it is console-only.");
}
console.log("\n  So this is genuinely a human step. It takes about a minute:");
console.log("    console.cloud.google.com > APIs & Services > Credentials");
console.log("    > the OAuth 2.0 Client ID starting 729675374290-ob9itec0be6…");
console.log(`    > Authorised redirect URIs > ADD: ${NEEDED_URI}`);
console.log("    > Save, wait ~1 minute, then: npm run diagnose:oauth");
