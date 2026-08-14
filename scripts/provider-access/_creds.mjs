// Shared helpers for the provider-access probes.
//
// The gemini-cli OAuth client id/secret are deliberately NOT committed. They
// are a published constant of the open-source gemini-cli, but GitHub's push
// protection correctly flags them as a Google OAuth Client Secret, and it was
// right to: committing anything credential-shaped is a liability even when the
// value is public. They come from the environment instead.
//
// Usage:
//   set GEMINI_OAUTH_CLIENT_ID=...
//   set GEMINI_OAUTH_CLIENT_SECRET=...
//   node scripts/provider-access/<probe>.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const CRED_PATH = path.join(os.homedir(), ".gemini", "oauth_creds.json");

export function loadStoredCreds() {
  if (!fs.existsSync(CRED_PATH)) {
    console.log(`No stored Gemini credential at ${CRED_PATH}`);
    process.exit(0);
  }
  return JSON.parse(fs.readFileSync(CRED_PATH, "utf8"));
}

function oauthClient() {
  const id = process.env.GEMINI_OAUTH_CLIENT_ID;
  const secret = process.env.GEMINI_OAUTH_CLIENT_SECRET;
  if (!id || !secret) {
    console.log(
      "Set GEMINI_OAUTH_CLIENT_ID and GEMINI_OAUTH_CLIENT_SECRET first.\n" +
        "These are the gemini-cli OAuth client credentials, kept out of the repo\n" +
        "because a committed credential-shaped string is a liability even when public.",
    );
    process.exit(0);
  }
  return { id, secret };
}

/** Exchange the stored refresh_token for a fresh access token. */
export async function freshAccessToken() {
  const creds = loadStoredCreds();
  const { id, secret } = oauthClient();
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: id,
      client_secret: secret,
      refresh_token: creds.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const j = await res.json();
  return { status: res.status, token: j.access_token || null, expiresIn: j.expires_in, raw: j, creds };
}

export const DEFAULT_PROJECT = "gen-lang-client-0654198490";
