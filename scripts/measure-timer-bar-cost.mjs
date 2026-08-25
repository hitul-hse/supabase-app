// The timer strip has produced 1 entry out of 5,351. Measure what that costs in
// screen space, especially on a phone where vertical room is the scarce thing.
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
    body: JSON.stringify({ type: "magiclink", email: "bjoern.schoenemann@hs-experts.com", options: { redirect_to: `${SITE}/auth/callback` } }),
  });
  const b = await r.json();
  return b?.properties?.hashed_token ?? b?.hashed_token;
};

const browser = await chromium.launch();

for (const [label, vp] of [["desktop 1440x900", { width: 1440, height: 900 }],
                           ["mobile 390x844", { width: 390, height: 844 }]]) {
  const ctx = await browser.newContext({ viewport: vp, isMobile: vp.width < 500, hasTouch: vp.width < 500 });
  const page = await ctx.newPage();
  await page.goto(`${SITE}/auth/callback?token_hash=${await mint()}&type=magiclink&next=%2F`, { waitUntil: "networkidle", timeout: 120000 });
  if (/auth\/login|error=/.test(page.url())) {
    await page.goto(`${SITE}/auth/callback?token_hash=${await mint()}&type=magiclink&next=%2F`, { waitUntil: "networkidle", timeout: 120000 });
  }

  await page.goto(`${SITE}/my-work`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(900);

  const m = await page.evaluate(() => {
    // Find the strip by its distinctive input, then walk up to the bar itself.
    const input = [...document.querySelectorAll("input")]
      .find((i) => /working on/i.test(i.placeholder ?? ""));
    if (!input) return { found: false };
    let bar = input;
    for (let i = 0; i < 4 && bar.parentElement; i++) {
      bar = bar.parentElement;
      const r = bar.getBoundingClientRect();
      if (r.width > window.innerWidth * 0.8) break;
    }
    const r = bar.getBoundingClientRect();
    const vh = window.innerHeight;
    return {
      found: true,
      h: Math.round(r.height),
      pctOfViewport: +((r.height / vh) * 100).toFixed(1),
      top: Math.round(r.top),
      sticky: getComputedStyle(bar).position,
      // What is directly under it - i.e. what the user came for
      firstHeading: (document.querySelector("h1")?.textContent ?? "").trim().slice(0, 40),
      h1Top: Math.round(document.querySelector("h1")?.getBoundingClientRect().top ?? -1),
    };
  });

  console.log(`\n${label}`);
  if (!m.found) { console.log("   timer strip not found"); await ctx.close(); continue; }
  console.log(`   strip height      : ${m.h}px  (${m.pctOfViewport}% of the viewport)`);
  console.log(`   position          : ${m.sticky}`);
  console.log(`   page h1 "${m.firstHeading}" starts at y=${m.h1Top}px`);
  console.log(`   so the user reads ${m.h1Top}px of chrome before the page's own title`);

  await ctx.close();
}

await browser.close();
