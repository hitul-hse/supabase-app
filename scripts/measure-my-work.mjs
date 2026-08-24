// /my-work as MATHIAS, who actually has 54 projects across 43 customers.
// Measuring it as Björn (an exec with no personal assignments) showed one empty
// screen and told us nothing about the user's complaint.
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const SB = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const SITE = process.env.SITE ?? "https://hseportal.hs-experts.com";
const EMAIL = process.argv[2] ?? "mathias@hs-experts.com";

const gen = await fetch(`${SB}/auth/v1/admin/generate_link`, {
  method: "POST",
  headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" },
  body: JSON.stringify({ type: "magiclink", email: EMAIL, options: { redirect_to: `${SITE}/auth/callback` } }),
});
const b = await gen.json();
const hashed = b?.properties?.hashed_token ?? b?.hashed_token;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto(`${SITE}/auth/callback?token_hash=${hashed}&type=magiclink&next=%2Fmy-work`, { waitUntil: "networkidle" });
await page.waitForTimeout(1800);

const m = await page.evaluate(() => {
  const vh = window.innerHeight;
  const sh = document.documentElement.scrollHeight;
  const tables = [...document.querySelectorAll("table")].map((t) => {
    let n = t, title = "";
    while (n && !title && n !== document.body) { n = n.parentElement; const h = n?.querySelector?.("h2,h3,h4"); if (h) title = (h.textContent ?? "").trim().slice(0, 44); }
    return { title, rows: t.querySelectorAll("tbody tr").length, cols: t.querySelectorAll("thead th").length, px: Math.round(t.getBoundingClientRect().height) };
  });
  return {
    screens: +(sh / vh).toFixed(1), px: sh,
    tables, totalRows: tables.reduce((a, t) => a + t.rows, 0),
    headings: [...document.querySelectorAll("h1,h2,h3")].map((h) => (h.textContent ?? "").trim().slice(0, 50)),
  };
});

console.log(`/my-work as ${EMAIL}: ${m.screens} screens / ${m.px}px`);
console.log(`${m.tables.length} tables, ${m.totalRows} rows\n`);
console.log(`${"card".padEnd(46)} rows cols    px`);
for (const t of m.tables) console.log(`${(t.title || "(untitled)").padEnd(46)} ${String(t.rows).padStart(4)} ${String(t.cols).padStart(4)} ${String(t.px).padStart(5)}`);
console.log(`\nheadings: ${m.headings.slice(0, 12).join(" | ")}`);

await page.screenshot({ path: "C:/Supabase/tmp-mywork-mathias.png", fullPage: true });
console.log("\nscreenshot -> tmp-mywork-mathias.png");
await browser.close();
