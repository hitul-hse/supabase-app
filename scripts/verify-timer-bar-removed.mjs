// Confirm the strip is gone and measure what that gave back. The number that
// matters is where the page's own h1 now starts: that is how much chrome a user
// reads before the thing they navigated for.
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const SB = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const SITE = process.env.SITE ?? "http://localhost:3000";

const mint = async () => {
  const r = await fetch(`${SB}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "magiclink", email: "mathias@hs-experts.com", options: { redirect_to: `${SITE}/auth/callback` } }),
  });
  const b = await r.json();
  return b?.properties?.hashed_token ?? b?.hashed_token;
};

// Before, measured on production with the strip present:
const BEFORE = { desktop: { strip: 32, h1Top: 61 }, mobile: { strip: 70, h1Top: 147 } };

const browser = await chromium.launch();

for (const [key, label, vp] of [["desktop", "desktop 1440x900", { width: 1440, height: 900 }],
                                ["mobile", "mobile 390x844", { width: 390, height: 844 }]]) {
  const ctx = await browser.newContext({ viewport: vp, isMobile: vp.width < 500, hasTouch: vp.width < 500 });
  const page = await ctx.newPage();
  await page.goto(`${SITE}/auth/callback?token_hash=${await mint()}&type=magiclink&next=%2Fmy-work`, { waitUntil: "networkidle", timeout: 120000 });
  await page.waitForTimeout(1000);

  const m = await page.evaluate(() => {
    const strip = [...document.querySelectorAll("input")].some((i) => /working on/i.test(i.placeholder ?? ""));
    const h1 = document.querySelector("h1");
    return {
      stripPresent: strip,
      h1: (h1?.textContent ?? "").trim().slice(0, 40),
      h1Top: Math.round(h1?.getBoundingClientRect().top ?? -1),
      screens: +(document.documentElement.scrollHeight / window.innerHeight).toFixed(2),
    };
  });

  const b = BEFORE[key];
  console.log(`\n${label}`);
  console.log(`   timer strip present : ${m.stripPresent ? "STILL THERE" : "gone"}`);
  console.log(`   h1 "${m.h1}" now at y=${m.h1Top}px  (was ${b.h1Top}px)`);
  console.log(`   reclaimed           : ${b.h1Top - m.h1Top}px`);
  console.log(`   page height         : ${m.screens} screens`);
  await ctx.close();
}

// And the tracker must still work where it belongs.
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto(`${SITE}/auth/callback?token_hash=${await mint()}&type=magiclink&next=%2Ftime`, { waitUntil: "networkidle", timeout: 120000 });
await page.waitForTimeout(1200);
const t = await page.evaluate(() => ({
  url: location.pathname,
  hasTracker: /start|timer/i.test(document.body.innerText),
  buttons: [...document.querySelectorAll("button")].map((b) => (b.textContent ?? "").trim()).filter((x) => /start|stop|log/i.test(x)).slice(0, 6),
}));
console.log(`\n/time still has its tracker: ${t.hasTracker}  controls: ${t.buttons.join(", ") || "(none found)"}`);

await browser.close();
