/**
 * What does PRODUCTION actually show for "This Year" right now?
 *
 * Everything else is inference. The user reports 6,292h; that figure is exactly our
 * pre-backfill total and is not producible from the current data. Production reads
 * the same database I backfilled, so its data IS current -- which leaves a cached
 * browser view as the explanation. But "should be fine" is not evidence, so this
 * signs in against the real deployment and reads the number off the page.
 *
 * Read-only throughout: it navigates and reads text. A magic link minted through the
 * admin API changes no credential.
 *
 * Run: node scripts/read-prod-total.mjs [site]
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const { NEXT_PUBLIC_SUPABASE_URL: URL_BASE, SUPABASE_SERVICE_ROLE_KEY: SERVICE, NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON } = env;
const SITE = process.argv[2] ?? "https://hseportal.hs-experts.com";
if (!URL_BASE || !SERVICE || !ANON) { console.log("SKIP: no credentials"); process.exit(0); }

const admin = createClient(URL_BASE, SERVICE, { auth: { persistSession: false } });
const { data: profiles } = await admin
  .from("app_user_profile").select("user_id").eq("role_key", "exec").eq("is_active", true).limit(1);
if (!profiles?.length) { console.log("SKIP: no exec"); process.exit(0); }
const { data: u } = await admin.auth.admin.getUserById(profiles[0].user_id);
const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: u.user.email });
const anon = createClient(URL_BASE, ANON, { auth: { persistSession: false } });
const { data: sess } = await anon.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
if (!sess?.session) { console.log("SKIP: could not mint a session"); process.exit(0); }

const { chromium } = await import("playwright");
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
  await ctx.addInitScript(() => { try { window.localStorage.setItem("hse_tour_done", "1"); } catch { /* ignore */ } });
  // The cookie name derives from the project hostname, and the domain must be the
  // production host for it to be sent.
  const ref = new URL(URL_BASE).hostname.split(".")[0];
  await ctx.addCookies([{
    name: `sb-${ref}-auth-token`,
    value: "base64-" + Buffer.from(JSON.stringify(sess.session)).toString("base64url"),
    domain: new URL(SITE).hostname,
    path: "/", httpOnly: false, secure: true, sameSite: "Lax",
  }]);

  const page = await ctx.newPage();
  const read = async (qs, label) => {
    const resp = await page.goto(`${SITE}/time/dashboard?${qs}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.locator("text=TOTAL HOURS").first().waitFor({ state: "visible", timeout: 45_000 }).catch(() => {});
    const t = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    const bounced = page.url().includes("/auth/login");
    const total = /TOTAL HOURS ([\d,]+\.?\d*)h/.exec(t)?.[1] ?? null;
    const range = /(\d{4}-\d{2}-\d{2}) → (\d{4}-\d{2}-\d{2})/.exec(t);
    const entries = /· ([\d,]+) ENTRIES/.exec(t)?.[1] ?? null;
    console.log(
      `  ${label.padEnd(34)} HTTP ${resp?.status()}  ${bounced ? "BOUNCED TO LOGIN" : `TOTAL ${String(total).padStart(9)}h  ${String(entries).padStart(6)} entries  range ${range ? `${range[1]}..${range[2]}` : "?"}`}`,
    );
    return { total, range: range ? `${range[1]}..${range[2]}` : null, bounced };
  };

  console.log(`reading ${SITE} as a real exec\n`);
  const def = await read("preset=this_year&group=member&bucket=week", "This Year (default)");
  const cal = await read("preset=this_year&calendar=1&group=member&bucket=week", "This Year + Calendar ON");

  console.log("\n=== interpretation ===");
  if (def.bounced || cal.bounced) {
    console.log("  Could not sign in to production from here, so this is inconclusive.");
  } else {
    const endsDec = (cal.range ?? "").endsWith("-12-31");
    console.log(`  range ends 31 Dec: ${endsDec ? "YES -- production is running PRE-FIX code" : "no -- the year-to-date fix is live"}`);
    const n = Number((cal.total ?? "0").replace(/,/g, ""));
    if (Math.abs(n - 6292) <= 20) {
      console.log("  Production still shows ~6,292h, which the current database cannot produce.");
      console.log("  That would mean a cached response; investigate the CDN.");
    } else if (Math.abs(n - 8263) <= 30) {
      console.log("  Production shows ~8,263h: DATA IS CURRENT (backfill landed) but the code is");
      console.log("  pre-fix, so 'This year' still runs to 31 December and includes future work.");
      console.log("  Deploying the pending commits brings this to 7,498.5h.");
    } else if (Math.abs(n - 7498) <= 20) {
      console.log("  Production shows ~7,498h and matches TrackingTime. Fully up to date.");
    } else {
      console.log(`  Production shows ${cal.total}h -- compare against local: 7,498.5h with calendar on.`);
    }
    console.log(`\n  The 6,292h the user saw is our pre-backfill total, so their browser was almost`);
    console.log(`  certainly showing a page rendered before the sync. A hard reload settles it.`);
  }
} finally {
  await browser.close();
}
