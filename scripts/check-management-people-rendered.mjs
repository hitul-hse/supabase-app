/**
 * Does the DEPLOYED management page actually list all nine people?
 *
 * I verified the query returns Björn and Rency, and I verified the deploy
 * reached Ready. Neither of those is the thing the user asked about: they asked
 * why Björn is not on the page. So read the rendered page and look for the
 * names.
 *
 * Uses domcontentloaded rather than networkidle: production keeps long-lived
 * connections open, so networkidle never settles and the probe times out on a
 * page that is in fact fine.
 */
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const SITE = process.env.SITE ?? "https://hseportal.hs-experts.com";
const EXPECTED = ["Thorsten", "Mathias", "Ousmane", "Hendryk", "Stephan", "Serhii", "Mustafa", "Rency", "Björn"];

const gen = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/generate_link`, {
  method: "POST",
  headers: {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    type: "magiclink",
    email: "bjoern.schoenemann@hs-experts.com",
    options: { redirect_to: `${SITE}/auth/callback` },
  }),
});
const b = await gen.json();
const hashed = b?.properties?.hashed_token ?? b?.hashed_token;
if (!hashed) { console.log("could not mint a magic link:", JSON.stringify(b).slice(0, 300)); process.exit(2); }

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

await page.goto(`${SITE}/auth/callback?token_hash=${hashed}&type=magiclink&next=%2F`,
  { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForTimeout(3000);
console.log("signed in, landed on:", page.url());

await page.goto(`${SITE}/dashboard/management?tab=employees`,
  { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForTimeout(6000);

const text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
console.log(`\npage: ${page.url()}`);
console.log(`rendered ${text.length} chars\n`);

const failures = [];
for (const name of EXPECTED) {
  const present = text.includes(name);
  console.log(`  ${present ? "ok  " : "MISS"} ${name}`);
  if (!present) failures.push(name);
}

// The two numbers the fix was supposed to surface.
for (const marker of ["125,6", "125.6", "114,1", "114.1", "Kapazitätsrisiko"]) {
  if (text.includes(marker)) console.log(`  found  "${marker}"`);
}

// Show the employee table region so a human can eyeball it.
const idx = text.indexOf("REPLACEMENT");
if (idx >= 0) console.log(`\ntable excerpt:\n  ${text.slice(Math.max(0, idx - 320), idx + 460)}`);

console.log(`\n${failures.length === 0 ? "PASS: all nine people render on the deployed page" : `FAIL: missing ${failures.join(", ")}`}`);
await browser.close();
process.exit(failures.length ? 1 : 0);
