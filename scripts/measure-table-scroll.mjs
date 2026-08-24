// The honest measurement: drive a real browser, then ask the DOM how tall each
// page is and how many rows each table renders after hydration. Server HTML
// undercounts badly because most of these tables are client components.
//
// "Scrolling a lot" = scrollHeight / viewportHeight. That is the number to beat.
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const SB = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const SITE = process.env.SITE ?? "https://hseportal.hs-experts.com";
const EMAIL = process.argv[2] ?? "bjoern.schoenemann@hs-experts.com";

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

await page.goto(`${SITE}/auth/callback?token_hash=${hashed}&type=magiclink&next=%2F`, { waitUntil: "networkidle" });
console.log(`signed in as ${EMAIL}, landed on ${page.url()}\n`);

const routes = ["/", "/my-work", "/projects", "/people", "/timesheets",
                "/dashboard/management", "/time/dashboard", "/team-lead", "/admin/roles"];

const results = [];
for (const r of routes) {
  try {
    await page.goto(`${SITE}${r}`, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForTimeout(1200); // let client tables settle

    const m = await page.evaluate(() => {
      const vh = window.innerHeight;
      const sh = document.documentElement.scrollHeight;
      const tables = [...document.querySelectorAll("table")].map((t) => ({
        rows: t.querySelectorAll("tbody tr").length,
        cols: t.querySelectorAll("thead th").length,
        h: Math.round(t.getBoundingClientRect().height),
        stickyHead: [...t.querySelectorAll("thead th")].some((th) => getComputedStyle(th).position === "sticky"),
      }));
      return {
        vh, sh,
        screens: +(sh / vh).toFixed(1),
        tables: tables.length,
        totalRows: tables.reduce((a, t) => a + t.rows, 0),
        biggest: tables.reduce((a, t) => Math.max(a, t.rows), 0),
        widest: tables.reduce((a, t) => Math.max(a, t.cols), 0),
        anySticky: tables.some((t) => t.stickyHead),
      };
    });
    results.push({ route: r, ...m });
  } catch (e) {
    results.push({ route: r, err: e.message.split("\n")[0].slice(0, 60) });
  }
}

console.log("route".padEnd(24), "screens".padStart(8), "tables".padStart(7), "rows".padStart(6), "biggest".padStart(8), "cols".padStart(5), "sticky");
for (const r of results) {
  if (r.err) { console.log(`${r.route.padEnd(24)}  ERR ${r.err}`); continue; }
  console.log(
    r.route.padEnd(24),
    String(r.screens).padStart(8),
    String(r.tables).padStart(7),
    String(r.totalRows).padStart(6),
    String(r.biggest).padStart(8),
    String(r.widest).padStart(5),
    r.anySticky ? "  Y" : "  .",
  );
}

const worst = results.filter((r) => !r.err).sort((a, b) => b.screens - a.screens);
console.log(`\nworst offenders by scroll depth:`);
for (const r of worst.slice(0, 5)) console.log(`   ${r.screens} screens tall  ${r.route}  (${r.totalRows} rows in ${r.tables} tables)`);

await browser.close();
