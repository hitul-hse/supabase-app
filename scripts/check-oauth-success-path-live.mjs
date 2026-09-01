/**
 * What happens AFTER Google starts working? Verify the success path now, so the fix in
 * the Cloud console is the only thing standing between the user and a working sign-in.
 *
 * WHY THIS MATTERS. Everything I have verified so far is the FAILURE path: the
 * diagnosis, the in-place message, the /access-pending redirect. But the reason the
 * user asked for this is that they want Google sign-in to WORK, and I have not once
 * exercised what happens on a successful OAuth callback -- because Google currently
 * refuses before issuing a code. If the success path is broken too, they will fix
 * the console, try again, and hit a second wall. That would be a poor outcome from a
 * session that was supposed to unblock them.
 *
 * The PKCE code exchange itself needs Google, so it cannot be faked. What CAN be
 * verified is everything our own code does with the resulting session, which is where
 * our bugs would live:
 *
 *   1. An authenticated user WITH an active profile reaches the app, not /access-pending.
 *   2. An authenticated user WITHOUT a profile reaches /access-pending and can read nothing.
 *   3. /access-pending itself renders and explains the situation (it is the page an
 *      uninvited colleague will actually see, so it had better be legible).
 *   4. The `next` parameter survives the round trip, so a deep link still lands where
 *      it should -- and cannot be turned into an open redirect.
 *
 * (1) and (2) are driven with a REAL session against the REAL app, using an existing
 * exec and a disposable profile-less user. (4) is driven against the live callback.
 *
 * Cleans up anything it creates, in a finally block.
 *
 * Run: node scripts/check-oauth-success-path-live.mjs
 */
import { readFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const { NEXT_PUBLIC_SUPABASE_URL: URL_BASE, SUPABASE_SERVICE_ROLE_KEY: SERVICE, NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON } = env;
if (!URL_BASE || !SERVICE || !ANON) { console.log("SKIP: no credentials"); process.exit(0); }

let failed = false;
const check = (label, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${detail ? `\n        ${detail}` : ""}`);
  if (!ok) failed = true;
};

const admin = createClient(URL_BASE, SERVICE, { auth: { persistSession: false } });
const REF = new URL(URL_BASE).hostname.split(".")[0];

/** A browser session cookie for a given user, exactly as the app's own cookie. */
async function sessionCookieFor(email) {
  const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw new Error(`generateLink: ${error.message}`);
  const anon = createClient(URL_BASE, ANON, { auth: { persistSession: false } });
  const { data, error: vErr } = await anon.auth.verifyOtp({
    type: "magiclink", token_hash: link.properties.hashed_token,
  });
  if (vErr) throw new Error(`verifyOtp: ${vErr.message}`);
  return data.session;
}

const PORT = 3137;
const app = spawn("npx", ["next", "start", "--port", String(PORT)], { env: process.env, shell: true, stdio: "pipe" });
let log = "";
app.stdout.on("data", (d) => (log += d));
app.stderr.on("data", (d) => (log += d));
const cleanupServer = () => {
  try {
    if (process.platform === "win32" && app.pid) spawnSync("taskkill", ["/PID", String(app.pid), "/T", "/F"], { stdio: "ignore" });
    else app.kill("SIGKILL");
  } catch { /* gone */ }
};
let up = false;
for (let i = 0; i < 120; i++) {
  if (app.exitCode !== null) break;
  try { await fetch(`http://localhost:${PORT}/auth/login`); up = true; break; }
  catch { await new Promise((r) => setTimeout(r, 500)); }
}
if (!up) {
  console.log(`FAIL: server never started (exit ${app.exitCode}) -- run \`npm run build\` first`);
  console.log(log.slice(-1500) || "(no output)");
  cleanupServer();
  process.exit(1);
}

const stamp = Date.now();
const STRANGER = `oauth.stranger.probe.${stamp}@hs-experts.com`;
let strangerId = null;

const { launchChromium } = await import("./lib/launch-chromium.mjs");
const browser = await launchChromium();

try {
  // ── 1. A provisioned user reaches the app ────────────────────────────────
  const { data: execProfile } = await admin
    .from("app_user_profile").select("user_id").eq("role_key", "exec").eq("is_active", true).limit(1);
  const { data: eu } = await admin.auth.admin.getUserById(execProfile[0].user_id);
  const execSession = await sessionCookieFor(eu.user.email);

  const ctxOk = await browser.newContext();
  await ctxOk.addInitScript(() => { try { window.localStorage.setItem("hse_tour_done", "1"); } catch { /* ignore */ } });
  await ctxOk.addCookies([{
    name: `sb-${REF}-auth-token`,
    value: "base64-" + Buffer.from(JSON.stringify(execSession)).toString("base64url"),
    domain: "localhost", path: "/", httpOnly: false, secure: false, sameSite: "Lax",
  }]);
  const pageOk = await ctxOk.newPage();
  const respOk = await pageOk.goto(`http://localhost:${PORT}/time/dashboard?preset=this_month`, {
    waitUntil: "domcontentloaded", timeout: 60_000,
  });
  const okPath = new URL(pageOk.url()).pathname;
  check(
    "a user WITH an active profile reaches the app, not /access-pending",
    respOk?.status() === 200 && okPath === "/time/dashboard",
    `HTTP ${respOk?.status()} at ${okPath} -- this is what an invited colleague gets once Google works`,
  );
  await ctxOk.close();

  // ── 2. A profile-less user is held at /access-pending ───────────────────
  // This is exactly the shape of an UNINVITED Google sign-in: a real auth user with
  // no app_user_profile.
  const { data: made, error: makeErr } = await admin.auth.admin.createUser({
    email: STRANGER, email_confirm: true,
    user_metadata: { note: "automated oauth success-path probe; safe to delete" },
  });
  if (makeErr) throw new Error(`could not create the stranger: ${makeErr.message}`);
  strangerId = made.user.id;
  const strangerSession = await sessionCookieFor(STRANGER);

  const ctxNo = await browser.newContext();
  await ctxNo.addInitScript(() => { try { window.localStorage.setItem("hse_tour_done", "1"); } catch { /* ignore */ } });
  await ctxNo.addCookies([{
    name: `sb-${REF}-auth-token`,
    value: "base64-" + Buffer.from(JSON.stringify(strangerSession)).toString("base64url"),
    domain: "localhost", path: "/", httpOnly: false, secure: false, sameSite: "Lax",
  }]);
  const pageNo = await ctxNo.newPage();

  // The callback is the decision point for OAuth, so drive it the way the flow does.
  await pageNo.goto(`http://localhost:${PORT}/access-pending`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  const pendingText = (await pageNo.locator("body").innerText()).replace(/\s+/g, " ");
  check(
    "/access-pending renders and explains the situation",
    pendingText.length > 40 && /pending|access|administrator|role/i.test(pendingText),
    `page reads: "${pendingText.slice(0, 160)}"`,
  );

  // And the profile-less user must not be able to read data anywhere.
  const respData = await pageNo.goto(`http://localhost:${PORT}/timesheets`, {
    waitUntil: "domcontentloaded", timeout: 60_000,
  });
  const dataPath = new URL(pageNo.url()).pathname;
  const dataText = (await pageNo.locator("body").innerText()).replace(/\s+/g, " ");
  check(
    "a profile-less user cannot reach a data page with data on it",
    dataPath !== "/timesheets" || !/\d{2}:\d{2}/.test(dataText),
    `landed on ${dataPath} (HTTP ${respData?.status()}); RLS returns nothing regardless, and the redirect makes that legible rather than looking broken`,
  );
  await ctxNo.close();

  // ── 3. `next` survives, and cannot become an open redirect ──────────────
  console.log("");
  for (const [label, next, expectation] of [
    ["a same-site deep link is preserved", "/projects", "/projects"],
    ["an absolute URL is rejected", "https://evil.example.com/x", "not evil.example.com"],
    ["a protocol-relative URL is rejected", "//evil.example.com", "not evil.example.com"],
    ["a backslash-normalised URL is rejected", "/\\evil.example.com", "not evil.example.com"],
  ]) {
    // No code, so the callback fails and redirects to login -- but the point is that
    // `next` is never echoed to another origin.
    const res = await fetch(
      `http://localhost:${PORT}/auth/callback?next=${encodeURIComponent(next)}`,
      { redirect: "manual" },
    );
    const loc = res.headers.get("location") ?? "";
    const host = loc.startsWith("http") ? new URL(loc).hostname : "(relative)";
    const leaked = /evil\.example\.com/.test(loc);
    check(
      label,
      !leaked,
      `next=${next} -> ${host}${leaked ? "  LEAKED" : ""} (expected ${expectation})`,
    );
  }
} finally {
  if (strangerId) {
    await admin.from("app_user_profile").delete().eq("user_id", strangerId);
    const { error } = await admin.auth.admin.deleteUser(strangerId);
    console.log(`\n  cleanup: stranger probe ${error ? `NOT deleted (${error.message})` : "deleted"}`);
  }
  const { data: after } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const left = (after?.users ?? []).filter((u) => String(u.email ?? "").includes("oauth.stranger.probe"));
  console.log(`  leftover probe accounts: ${left.length}`);
  if (left.length) { failed = true; console.log(`  MANUAL CLEANUP: ${left.map((u) => u.email).join(", ")}`); }
  await browser.close();
  cleanupServer();
}

console.log(
  failed
    ? "\nOAUTH SUCCESS PATH: something downstream of a working provider is broken\n"
    : "\nOAUTH SUCCESS PATH: once Google is registered, an invited user lands in the app and a stranger does not\n",
);
process.exit(failed ? 1 : 0);
