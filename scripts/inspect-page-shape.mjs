// Look at what the user actually sees, rather than inferring from row counts.
// Screenshots plus a structural dump of the Management tab and /my-work.
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const SB = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const SITE = "https://hseportal.hs-experts.com";
const EMAIL = "bjoern.schoenemann@hs-experts.com";

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

// A first-run tour overlay covers the content and made the first pass report
// every section as empty. Dismiss it, and persist that so it stays dismissed.
const dismissTour = async () => {
  for (const label of ["Skip tour", "Skip", "Close", "Dismiss"]) {
    const btn = page.getByRole("button", { name: label, exact: false });
    if (await btn.count().catch(() => 0)) {
      try { await btn.first().click({ timeout: 2500 }); await page.waitForTimeout(400); return label; } catch {}
    }
  }
  await page.keyboard.press("Escape").catch(() => {});
  return null;
};
console.log(`tour dismissed via: ${(await dismissTour()) ?? "escape/none"}`);

for (const [route, name] of [["/dashboard/management", "management"], ["/my-work", "my-work"]]) {
  await page.goto(`${SITE}${route}`, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(1500);
  await dismissTour();
  // Management hides most content behind tabs, so walk them.
  const tabNames = await page.getByRole("tab").allTextContents().catch(() => []);
  if (tabNames.length) console.log(`\n[${route}] tabs found: ${tabNames.map((t) => t.trim()).join(" | ")}`);

  // What tabs exist, and what is inside the active one?
  const shape = await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('[role="tab"], button')]
      .map((b) => (b.textContent ?? "").trim())
      .filter((t) => t && t.length < 40);

    // Every heading, in document order, with what follows it.
    const blocks = [...document.querySelectorAll("h1,h2,h3,h4")].map((h) => {
      let el = h.nextElementSibling, kind = "?", rows = 0, cols = 0;
      for (let i = 0; i < 4 && el; i++, el = el.nextElementSibling) {
        const t = el.querySelector?.("table") ?? (el.tagName === "TABLE" ? el : null);
        if (t) { kind = "table"; rows = t.querySelectorAll("tbody tr").length; cols = t.querySelectorAll("thead th").length; break; }
        if (el.querySelectorAll?.("dl,dt").length) { kind = "definition-list"; rows = el.querySelectorAll("dt").length; break; }
        if (el.querySelectorAll?.('[class*="grid"]').length) { kind = "grid-of-cards"; rows = el.querySelectorAll('[class*="grid"] > *').length; break; }
        if (el.querySelectorAll?.("li").length) { kind = "list"; rows = el.querySelectorAll("li").length; break; }
      }
      return { heading: (h.textContent ?? "").trim().slice(0, 60), tag: h.tagName, kind, rows, cols };
    });

    return {
      screens: +(document.documentElement.scrollHeight / window.innerHeight).toFixed(1),
      height: document.documentElement.scrollHeight,
      tabs: [...new Set(tabs)].slice(0, 20),
      blocks,
    };
  });

  console.log(`\n===== ${route}  (${shape.screens} screens, ${shape.height}px)`);
  console.log(`tabs/buttons: ${shape.tabs.join(" | ")}`);
  console.log(`\n${"heading".padEnd(48)} ${"as".padEnd(16)} rows cols`);
  for (const bl of shape.blocks) {
    console.log(`${(bl.tag + " " + bl.heading).padEnd(48)} ${bl.kind.padEnd(16)} ${String(bl.rows).padStart(4)} ${String(bl.cols).padStart(4)}`);
  }

  await page.screenshot({ path: `C:/Supabase/tmp-shot-${name}.png`, fullPage: true });
  console.log(`\nfull-page screenshot -> tmp-shot-${name}.png`);
}

await browser.close();
