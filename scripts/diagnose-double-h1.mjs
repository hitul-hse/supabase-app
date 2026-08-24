// /now renders TWO h1 elements where every other route renders one. Find both,
// with their text and which component emitted them, before changing anything.
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const SB = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const SITE = process.env.SITE ?? "http://localhost:3000";

const r = await fetch(`${SB}/auth/v1/admin/generate_link`, {
  method: "POST",
  headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" },
  body: JSON.stringify({ type: "magiclink", email: "bjoern.schoenemann@hs-experts.com", options: { redirect_to: `${SITE}/auth/callback` } }),
});
const b = await r.json();
const hashed = b?.properties?.hashed_token ?? b?.hashed_token;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto(`${SITE}/auth/callback?token_hash=${hashed}&type=magiclink&next=%2F`, { waitUntil: "networkidle", timeout: 120000 });

for (const [w, h, label] of [[1440, 900, "desktop"], [390, 844, "mobile"]]) {
  await page.setViewportSize({ width: w, height: h });
  await page.goto(`${SITE}/`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(900);
  const hs = await page.evaluate(() =>
    [...document.querySelectorAll("h1")].map((h) => ({
      text: (h.textContent ?? "").trim().slice(0, 44),
      cls: (typeof h.className === "string" ? h.className : "").slice(0, 60),
      visible: h.offsetParent !== null,
      w: Math.round(h.getBoundingClientRect().width),
    })));
  console.log(`\n${label} ${w}px: ${hs.length} h1`);
  for (const x of hs) console.log(`   visible=${x.visible} w=${x.w}  "${x.text}"  [${x.cls}]`);
}

await browser.close();
