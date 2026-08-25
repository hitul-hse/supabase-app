// The tour overlay dims the whole page, so the first capture told us nothing
// about how the bar reads against real content. Dismiss it, scroll so there is
// content behind the pill (a blur over blank space is invisible), and capture a
// tight crop of the bar itself in both themes.
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
  viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3,
});
const page = await ctx.newPage();
await page.goto(`${SITE}/auth/callback?token_hash=${await mint()}&type=magiclink&next=%2Fmy-work`, { waitUntil: "networkidle", timeout: 120000 });
await page.waitForTimeout(1200);

// Dismiss the tour, and remember that choice so later shots are clean.
for (const name of ["Skip tour", "Skip", "Close"]) {
  const b = page.getByRole("button", { name, exact: false });
  if (await b.count().catch(() => 0)) { try { await b.first().click({ timeout: 2500 }); break; } catch {} }
}
await page.waitForTimeout(800);

// Scroll into the table so the pill has dense content behind it.
await page.evaluate(() => window.scrollBy(0, 700));
await page.waitForTimeout(600);

const clip = await page.evaluate(() => {
  const nav = document.querySelector('[data-testid="mobile-tab-bar"]');
  const r = nav.getBoundingClientRect();
  return { x: 0, y: Math.max(0, r.y - 120), width: window.innerWidth, height: Math.min(window.innerHeight - Math.max(0, r.y - 120), r.height + 140) };
});

await page.screenshot({ path: "C:/Supabase/tmp-nav-crop.png", clip });
await page.screenshot({ path: "C:/Supabase/tmp-nav-full.png" });

// Open the More drawer and capture that too - it is the other half of the nav.
const moreBtn = page.locator('[data-testid="mobile-tab-bar"] button').last();
if (await moreBtn.count()) {
  await moreBtn.click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: "C:/Supabase/tmp-nav-drawer.png" });

  const d = await page.evaluate(() => {
    // Whatever is now on top and covering a meaningful area.
    const candidates = [...document.querySelectorAll("div,aside,nav,section")]
      .map((e) => ({ e, r: e.getBoundingClientRect(), cs: getComputedStyle(e) }))
      .filter((x) => x.r.height > 200 && x.r.width > 200 && Number(x.cs.zIndex) > 10);
    const top = candidates.sort((a, b) => Number(b.cs.zIndex) - Number(a.cs.zIndex))[0];
    if (!top) return null;
    return {
      tag: top.e.tagName.toLowerCase(),
      w: Math.round(top.r.width), h: Math.round(top.r.height),
      x: Math.round(top.r.x), y: Math.round(top.r.y),
      radius: top.cs.borderRadius, bg: top.cs.backgroundColor,
      backdrop: top.cs.backdropFilter || top.cs.webkitBackdropFilter,
      z: top.cs.zIndex,
    };
  });
  console.log("More drawer as rendered:");
  console.log(JSON.stringify(d, null, 2));
}

await browser.close();
console.log("\nshots: tmp-nav-crop.png, tmp-nav-full.png, tmp-nav-drawer.png");
