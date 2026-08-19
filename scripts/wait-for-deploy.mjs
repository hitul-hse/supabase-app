/**
 * Wait until a given path actually serves markup containing a marker.
 *
 * Fixed sleeps have now cost me two false failures in this session: a COPY button and a
 * whole tab row both reported missing when the previous deployment was simply still
 * serving. A false failure that looks like a real one is worse than the wait.
 *
 * The marker must be UNCONDITIONAL markup -- my earlier attempt polled for text that only
 * appears after a click, so it could never have matched. `role="tablist"` with the records
 * label renders on every load of the new build.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const SITE = process.env.SITE ?? "https://hseportal.hs-experts.com";
const PATH = process.env.WAIT_PATH ?? "/time/dashboard";
const MARKER = process.env.MARKER ?? 'aria-label="Records view"';
const MAX_WAIT_MS = Number(process.env.MAX_WAIT_MS ?? 480_000);

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: "hitul@hs-experts.com" });
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const { data: verified } = await anon.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
const encoded = `base64-${Buffer.from(JSON.stringify({
  access_token: verified.session.access_token,
  refresh_token: verified.session.refresh_token,
  expires_at: verified.session.expires_at,
  expires_in: verified.session.expires_in,
  token_type: "bearer",
  user: verified.user,
})).toString("base64")}`;
const CHUNK = 3180;
const parts = [];
for (let i = 0, n = 0; i < encoded.length; i += CHUNK, n += 1) {
  parts.push(`sb-${ref}-auth-token.${n}=${encoded.slice(i, i + CHUNK)}`);
}
const cookie = parts.join("; ");

const started = Date.now();
for (let attempt = 1; ; attempt += 1) {
  let html = "";
  try {
    const res = await fetch(`${SITE}${PATH}`, { headers: { cookie }, redirect: "manual" });
    html = await res.text();
  } catch {
    /* transient during a deployment swap; retried below */
  }
  if (html.includes(MARKER)) {
    console.log(`deployed after ${Math.round((Date.now() - started) / 1000)}s (attempt ${attempt})`);
    process.exit(0);
  }
  if (Date.now() - started > MAX_WAIT_MS) {
    console.log(`gave up after ${Math.round((Date.now() - started) / 1000)}s: ${PATH} does not contain ${MARKER}`);
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 15_000));
}
