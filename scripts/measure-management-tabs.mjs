// The Management tabs are plain links carrying ?tab=..., so measure each by
// navigating to its URL rather than clicking. This is the real per-tab shape.
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const SB = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const SITE = process.env.SITE ?? "https://hseportal.hs-experts.com";

const gen = await fetch(`${SB}/auth/v1/admin/generate_link`, {
  method: "POST",
  headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" },
  body: JSON.stringify({ type: "magiclink", email: "bjoern.schoenemann@hs-experts.com", options: { redirect_to: `${SITE}/auth/callback` } }),
});
const b = await gen.json();
const hashed = b?.properties?.hashed_token ?? b?.hashed_token;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto(`${SITE}/auth/callback?token_hash=${hashed}&type=magiclink&next=%2F`, { waitUntil: "networkidle" });

const TABS = [["overview", "Auslastung"], ["employees", "Mitarbeiter"], ["customers", "Kunden"], ["risks", "Risiken & Qualität"]];

const shapeOf = () => ({
  screens: +(document.documentElement.scrollHeight / window.innerHeight).toFixed(1),
  px: document.documentElement.scrollHeight,
  tables: [...document.querySelectorAll("table")].map((t) => {
    // Nearest preceding heading names the card.
    let n = t, title = "";
    while (n && !title) {
      n = n.parentElement;
      const h = n?.querySelector?.("h2,h3,h4");
      if (h) title = (h.textContent ?? "").trim().slice(0, 44);
      if (n === document.body) break;
    }
    const wrap = t.closest('[class*="overflow"]');
    return {
      title,
      rows: t.querySelectorAll("tbody tr").length,
      cols: t.querySelectorAll("thead th").length,
      px: Math.round(t.getBoundingClientRect().height),
      wide: t.scrollWidth > (wrap?.clientWidth ?? t.clientWidth) + 4,
      sticky: [...t.querySelectorAll("thead th")].some((th) => getComputedStyle(th).position === "sticky"),
    };
  }),
});

for (const [slug, label] of TABS) {
  await page.goto(`${SITE}/dashboard/management?tab=${slug}`, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(1600);
  const m = await page.evaluate(shapeOf);

  const rows = m.tables.reduce((a, t) => a + t.rows, 0);
  console.log(`\n### ${label}  (?tab=${slug})   ${m.screens} screens / ${m.px}px   ${m.tables.length} tables, ${rows} rows`);
  console.log(`    ${"table".padEnd(46)} rows cols    px  wide sticky`);
  for (const t of m.tables) {
    console.log(`    ${(t.title || "(untitled)").padEnd(46)} ${String(t.rows).padStart(4)} ${String(t.cols).padStart(4)} ${String(t.px).padStart(5)}  ${t.wide ? " Y " : " . "}   ${t.sticky ? "Y" : "."}`);
  }
  await page.screenshot({ path: `C:/Supabase/tmp-mtab-${slug}.png`, fullPage: true });
}

await browser.close();
