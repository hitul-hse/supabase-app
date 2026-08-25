// Look at the mobile navigation as it stands, on production, before proposing
// anything. The user asked for a "popped" floating layout with frosted glass,
// citing three Dribbble shots; V3Code has already landed a floating frosted
// pill. So the question is not "build it" but "what is still missing against
// those references".
//
// Capture the bar in both themes, on a content-heavy page (so the blur has
// something to blur), and with the More drawer open.
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const SB = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const SITE = process.env.SITE ?? "https://hseportal.hs-experts.com";

const mint = async () => {
  const r = await fetch(`${SB}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "magiclink", email: "mathias@hs-experts.com", options: { redirect_to: `${SITE}/auth/callback` } }),
  });
  const b = await r.json();
  return b?.properties?.hashed_token ?? b?.hashed_token;
};

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true, hasTouch: true, deviceScaleFactor: 3,
});
const page = await ctx.newPage();
await page.goto(`${SITE}/auth/callback?token_hash=${await mint()}&type=magiclink&next=%2Fmy-work`, { waitUntil: "networkidle", timeout: 120000 });
await page.waitForTimeout(1500);

// Measure the bar as rendered, rather than reading the classes and hoping.
const bar = await page.evaluate(() => {
  const nav = document.querySelector('[data-testid="mobile-tab-bar"]');
  if (!nav) return null;
  const r = nav.getBoundingClientRect();
  const cs = getComputedStyle(nav);
  const tabs = [...nav.querySelectorAll("a,button")].map((t) => {
    const tr = t.getBoundingClientRect();
    return { label: (t.textContent ?? "").trim().slice(0, 14), w: Math.round(tr.width), h: Math.round(tr.height) };
  });
  return {
    x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
    fromBottom: Math.round(window.innerHeight - r.bottom),
    radius: cs.borderRadius,
    background: cs.backgroundColor,
    backdrop: cs.backdropFilter || cs.webkitBackdropFilter,
    border: cs.borderColor,
    shadow: cs.boxShadow.slice(0, 70),
    tabs,
  };
});
console.log("tab bar as rendered at 390x844:");
console.log(JSON.stringify(bar, null, 2));

await page.screenshot({ path: "C:/Supabase/tmp-nav-dark.png" });

// Light theme, where the contrast maths is tightest.
const toggled = await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => /theme|light|dark/i.test(b.getAttribute("aria-label") ?? b.title ?? ""));
  if (btn) { btn.click(); return true; }
  return false;
});
await page.waitForTimeout(700);
console.log(`\ntheme toggle found: ${toggled}`);
await page.screenshot({ path: "C:/Supabase/tmp-nav-light.png" });

// The More drawer, which is the other half of "mobile navigation".
await page.evaluate(() => {
  const more = document.querySelector('[data-testid="mobile-tab-bar"] button');
  more?.click();
});
await page.waitForTimeout(800);
await page.screenshot({ path: "C:/Supabase/tmp-nav-more.png" });

const drawer = await page.evaluate(() => {
  const d = document.querySelector("[data-testid='mobile-drawer'], aside, [role='dialog']");
  if (!d) return null;
  const r = d.getBoundingClientRect();
  const cs = getComputedStyle(d);
  return { w: Math.round(r.width), h: Math.round(r.height), radius: cs.borderRadius, bg: cs.backgroundColor, backdrop: cs.backdropFilter || cs.webkitBackdropFilter };
});
console.log("\ndrawer as rendered:");
console.log(JSON.stringify(drawer, null, 2));

await browser.close();
console.log("\nshots: tmp-nav-dark.png, tmp-nav-light.png, tmp-nav-more.png");
