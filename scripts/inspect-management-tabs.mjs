// Walk every Management tab and measure what is stacked inside it. The user's
// complaint is about the Kunden tab (Customer Portfolio, Multi-Service Matrix),
// so the per-tab shape is what matters, not the page default.
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const SB = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const SITE = "https://hseportal.hs-experts.com";

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
await page.goto(`${SITE}/auth/callback?token_hash=${hashed}&type=magiclink&next=%2Fdashboard%2Fmanagement`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);

// Find how the tabs are actually implemented before clicking blindly.
const probe = await page.evaluate(() => {
  const hits = [];
  for (const el of document.querySelectorAll("button,a,[role=tab],[role=button]")) {
    const t = (el.textContent ?? "").trim();
    if (/Auslastung|Mitarbeiter|Kunden|Risiken/.test(t) && t.length < 30) {
      hits.push({ tag: el.tagName, role: el.getAttribute("role"), href: el.getAttribute("href"), text: t });
    }
  }
  return hits;
});
console.log("tab controls found:");
for (const h of probe) console.log(`   <${h.tag}> role=${h.role} href=${h.href} "${h.text}"`);

const TABS = ["Auslastung", "Mitarbeiter", "Kunden", "Risiken & Qualität"];

for (const tab of TABS) {
  // Tabs may be buttons or links; try both, and fall back to plain text.
  let clicked = false;
  for (const loc of [
    page.getByRole("tab", { name: tab, exact: false }),
    page.getByRole("button", { name: tab, exact: false }),
    page.getByRole("link", { name: tab, exact: false }),
    page.locator(`text="${tab}"`),
  ]) {
    if (await loc.count().catch(() => 0)) {
      try { await loc.first().click({ timeout: 3000 }); clicked = true; break; } catch {}
    }
  }
  if (!clicked) { console.log(`\n### ${tab}: could not activate`); continue; }
  await page.waitForTimeout(1400);

  const m = await page.evaluate(() => {
    const vh = window.innerHeight;
    const sh = document.documentElement.scrollHeight;
    // Each card = a section with a heading followed by a table.
    const cards = [...document.querySelectorAll("section, div")]
      .filter((d) => d.querySelector(":scope > table, :scope > div > table"))
      .map((d) => {
        const t = d.querySelector("table");
        const h = d.querySelector("h2,h3,h4");
        return {
          title: (h?.textContent ?? "").trim().slice(0, 46),
          rows: t.querySelectorAll("tbody tr").length,
          cols: t.querySelectorAll("thead th").length,
          px: Math.round(d.getBoundingClientRect().height),
        };
      });
    const seen = new Set();
    const uniq = cards.filter((c) => { const k = c.title + c.rows + c.cols; if (seen.has(k)) return false; seen.add(k); return true; });
    return { screens: +(sh / vh).toFixed(1), px: sh, tables: document.querySelectorAll("table").length, cards: uniq };
  });

  console.log(`\n### ${tab}   ${m.screens} screens (${m.px}px), ${m.tables} tables`);
  console.log(`    ${"card".padEnd(48)} rows cols   px`);
  for (const c of m.cards) {
    console.log(`    ${(c.title || "(untitled)").padEnd(48)} ${String(c.rows).padStart(4)} ${String(c.cols).padStart(4)} ${String(c.px).padStart(5)}`);
  }

  await page.screenshot({ path: `C:/Supabase/tmp-tab-${tab.replace(/[^a-z]/gi, "")}.png`, fullPage: true });
}

await browser.close();
console.log("\nscreenshots: tmp-tab-*.png");
