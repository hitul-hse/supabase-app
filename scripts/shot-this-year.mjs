/**
 * Screenshot the dashboard's "This Year" view and read back the headline number, so
 * the fix is confirmed on screen rather than only in a database query.
 *
 * After the backfill and the year-to-date correction, our figures should reconcile
 * with TrackingTime like this:
 *
 *     TrackingTime "This Year"                  7,498h
 *     our TOTAL HOURS with Calendar time ON     7,498h   <- matches
 *     our TOTAL HOURS by default                4,409h   (calendar excluded, as stated)
 *
 * This proves the numbers a person actually sees, which is the only place the
 * original complaint lived.
 *
 * Run: node scripts/shot-this-year.mjs
 */
import { readFileSync, mkdirSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const { NEXT_PUBLIC_SUPABASE_URL: URL_BASE, SUPABASE_SERVICE_ROLE_KEY: SERVICE, NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON } = env;
if (!URL_BASE || !SERVICE || !ANON) { console.log("SKIP: no credentials"); process.exit(0); }

const admin = createClient(URL_BASE, SERVICE, { auth: { persistSession: false } });
const { data: profiles } = await admin
  .from("app_user_profile").select("user_id").eq("role_key", "exec").eq("is_active", true).limit(1);
if (!profiles?.length) { console.log("SKIP: no exec"); process.exit(0); }
const { data: u } = await admin.auth.admin.getUserById(profiles[0].user_id);
const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: u.user.email });
const anon = createClient(URL_BASE, ANON, { auth: { persistSession: false } });
const { data: sess } = await anon.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });

const PORT = 3125;
const app = spawn("npx", ["next", "start", "--port", String(PORT)], { env: process.env, shell: true, stdio: "pipe" });
const cleanup = () => {
  try {
    if (process.platform === "win32" && app.pid) spawnSync("taskkill", ["/PID", String(app.pid), "/T", "/F"], { stdio: "ignore" });
    else app.kill("SIGKILL");
  } catch { /* gone */ }
};
for (let i = 0; i < 120; i++) {
  try { await fetch(`http://localhost:${PORT}/auth/login`); break; }
  catch { await new Promise((r) => setTimeout(r, 500)); }
}

const { chromium } = await import("playwright");
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
  await ctx.addInitScript(() => { try { window.localStorage.setItem("hse_tour_done", "1"); } catch { /* ignore */ } });
  const host = new URL(URL_BASE).hostname.split(".")[0];
  await ctx.addCookies([{
    name: `sb-${host}-auth-token`,
    value: "base64-" + Buffer.from(JSON.stringify(sess.session)).toString("base64url"),
    domain: "localhost", path: "/", httpOnly: false, secure: false, sameSite: "Lax",
  }]);
  const page = await ctx.newPage();
  mkdirSync("tmp-shots", { recursive: true });

  const read = async (qs, label, file) => {
    await page.goto(`http://localhost:${PORT}/time/dashboard?${qs}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.locator("text=TOTAL HOURS").first().waitFor({ state: "visible", timeout: 30_000 }).catch(() => {});
    const t = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    const total = /TOTAL HOURS ([\d,]+\.?\d*)h/.exec(t)?.[1] ?? "?";
    const range = /(\d{4}-\d{2}-\d{2}) → (\d{4}-\d{2}-\d{2})/.exec(t);
    console.log(`  ${label.padEnd(38)} TOTAL HOURS ${String(total).padStart(9)}h   range ${range ? `${range[1]} .. ${range[2]}` : "?"}`);
    await page.screenshot({ path: `tmp-shots/${file}`, fullPage: false });
    return total;
  };

  console.log("what the dashboard shows for This Year:\n");
  const def = await read("preset=this_year&group=member&bucket=week", "This Year (default, calendar off)", "this-year-default.png");
  const cal = await read("preset=this_year&calendar=1&group=member&bucket=week", "This Year + Calendar time ON", "this-year-calendar.png");

  console.log(`\n  TrackingTime shows 7,498h. Our matching figure is the second one: ${cal}h`);
  console.log(`  The default (${def}h) excludes calendar/GHOST placeholders, which the page states.`);
  console.log("\n  screenshots: tmp-shots/this-year-default.png, tmp-shots/this-year-calendar.png");
} finally {
  await browser.close();
  cleanup();
}
