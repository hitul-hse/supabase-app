/**
 * What is actually on the page? A one-route probe for when the scroll gate
 * reports a suspiciously short document and the question is whether the route
 * rendered its content, an empty state, or a permission wall.
 */
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const SITE = process.env.SITE ?? "http://localhost:3100";
const route = process.argv[2] ?? "/projects";

const gen = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/generate_link`, {
  method: "POST",
  headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({ type: "magiclink", email: "bjoern.schoenemann@hs-experts.com", options: { redirect_to: `${SITE}/auth/callback` } }),
});
const b = await gen.json();
const hashed = b?.properties?.hashed_token ?? b?.hashed_token;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto(`${SITE}/auth/callback?token_hash=${hashed}&type=magiclink&next=%2F`, { waitUntil: "networkidle" });
console.log("after sign-in:", page.url());

await page.goto(`${SITE}${route}`, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(1800);
const info = await page.evaluate(() => ({
  url: location.pathname + location.search,
  height: document.documentElement.scrollHeight,
  text: document.body.innerText.replace(/\s+/g, " ").slice(0, 700),
}));
console.log(JSON.stringify(info, null, 2));
await browser.close();
