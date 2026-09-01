/**
 * The theme system and the three tabs' new figures, verified on production.
 */
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "./lib/gate-env.mjs";

const env = loadEnv();
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.log("SKIP: need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(0);
}
const SITE = process.env.SITE ?? "https://hseportal.hs-experts.com";
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? `\n        ${detail}` : ""}`);
};

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
const cookies = [];
for (let i = 0, n = 0; i < encoded.length; i += CHUNK, n += 1) {
  cookies.push({ name: `sb-${ref}-auth-token.${n}`, value: encoded.slice(i, i + CHUNK), domain: new URL(SITE).hostname, path: "/" });
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1674, height: 971 }, colorScheme: "dark" });
await ctx.addCookies(cookies);
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

try {
  // ── Theme ────────────────────────────────────────────────────────────
  await page.goto(`${SITE}/`, { waitUntil: "networkidle", timeout: 120_000 });
  await page.waitForTimeout(1000);
  const skip = page.locator('button:has-text("Skip tour")');
  if (await skip.count()) { await skip.first().click().catch(() => {}); await page.waitForTimeout(400); }

  // TopBarChrome renders once per breakpoint (desktop bar and phone bar), so two
  // toggles exist in the DOM and one is display:none. Pick the visible one, or a
  // strict-mode locator throws before the first assertion runs.
  const toggle = page.locator('[data-testid="theme-toggle"]:visible').first();
  check("the theme toggle is in the top bar", (await toggle.count()) > 0);

  const darkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await toggle.click();
  await page.waitForTimeout(400);
  const lightState = await page.evaluate(() => ({
    bg: getComputedStyle(document.body).backgroundColor,
    attr: document.documentElement.dataset.theme ?? null,
    stored: localStorage.getItem("hse-hub-theme"),
  }));
  check("clicking it flips to the light theme", lightState.bg !== darkBg && lightState.attr === "light",
    `${darkBg} -> ${lightState.bg}`);
  check("the choice is persisted", lightState.stored === "light");

  // Survives a reload with no flash of the wrong theme in the final state.
  await page.reload({ waitUntil: "networkidle", timeout: 120_000 });
  await page.waitForTimeout(600);
  const afterReload = await page.evaluate(() => ({
    bg: getComputedStyle(document.body).backgroundColor,
    attr: document.documentElement.dataset.theme ?? null,
  }));
  check("the light theme survives a reload", afterReload.attr === "light" && afterReload.bg === lightState.bg,
    JSON.stringify(afterReload));

  // Back to dark for the remaining checks.
  await page.locator('[data-testid="theme-toggle"]').click();
  await page.waitForTimeout(400);
  check("and toggles back to dark", (await page.evaluate(() => document.documentElement.dataset.theme ?? null)) === null);

  // The hero gradient token is applied.
  const heroBg = await page.evaluate(() => {
    const hero = document.querySelector('[data-card="hero"]');
    return hero ? getComputedStyle(hero).backgroundImage : "(no hero)";
  });
  check("the hero card carries the gradient", heroBg.includes("linear-gradient"), heroBg.slice(0, 80));

  // ── Projects figures ─────────────────────────────────────────────────
  await page.goto(`${SITE}/projects`, { waitUntil: "networkidle", timeout: 120_000 });
  await page.waitForTimeout(1200);
  const projText = await page.locator("body").innerText();
  check("Projects: the portfolio health donut renders", /PORTFOLIO HEALTH|Portfolio health/i.test(projText) && /OVER BUDGET/i.test(projText));
  check("Projects: the top-10 hours ranking renders", /Where the hours go/i.test(projText) && /TOP 10 BY LOGGED HOURS/i.test(projText));
  const projBars = await page.locator('a[href^="/projects/"] div > div').count();
  check("Projects: the ranked bars are links to their projects", projBars >= 10, `${projBars} bar segments`);

  // ── Team lead figures ────────────────────────────────────────────────
  await page.goto(`${SITE}/team-lead`, { waitUntil: "networkidle", timeout: 120_000 });
  await page.waitForTimeout(1200);
  const tlText = await page.locator("body").innerText();
  check("Team Lead: the weekly area chart renders", /Team hours per week/i.test(tlText));
  check("Team Lead: the workload donut renders on the last completed week", /LAST COMPLETED WEEK/i.test(tlText) && /ON TRACK/i.test(tlText));

  // ── Dashboard donut ──────────────────────────────────────────────────
  await page.goto(`${SITE}/time/dashboard`, { waitUntil: "networkidle", timeout: 120_000 });
  await page.waitForTimeout(1200);
  const ttText = await page.locator("body").innerText();
  check("Dashboard: the billable split donut renders beside the trend", /BILLABLE SPLIT/i.test(ttText));
  check("Dashboard: its legend entries are drill-down links", (await page.locator('a[href*="billable=yes"]').count()) > 0);

  check("no client-side errors anywhere", errors.length === 0, errors.join(" | "));
} finally {
  await browser.close();
}

console.log(failed === 0 ? "\nTHEME + FIGURES: all checks passed" : `\n${failed} check(s) failed`);
process.exitCode = failed === 0 ? 0 : 1;
