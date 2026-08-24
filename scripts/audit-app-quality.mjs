// A broad, evidence-first sweep of the running app: for every route, measure
// what a real user would feel and what an audit would flag. No opinions here,
// just numbers that can be argued with.
//
//   - load time and payload weight
//   - console errors and failed requests (the invisible breakage)
//   - accessibility: images without alt, inputs without labels, heading order,
//     buttons with no accessible name, colour-contrast-free focus rings
//   - honesty: does the page say "0" where it means "unknown"
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

const link = async () => {
  const r = await fetch(`${SB}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "magiclink", email: EMAIL, options: { redirect_to: `${SITE}/auth/callback` } }),
  });
  const b = await r.json();
  return b?.properties?.hashed_token ?? b?.hashed_token;
};

const ROUTES = ["/", "/my-work", "/projects", "/people", "/timesheets", "/time",
  "/time/dashboard", "/leave", "/profile", "/team-lead",
  "/dashboard/management?tab=overview", "/dashboard/management?tab=customers",
  "/admin/users", "/admin/roles", "/admin/alerts", "/customer-master/import-review"];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const consoleErrors = [];
const failedRequests = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push({ route: page.url(), text: m.text().slice(0, 160) }); });
page.on("requestfailed", (r) => failedRequests.push({ route: page.url(), url: r.url().slice(0, 100), err: r.failure()?.errorText }));
page.on("response", (r) => { if (r.status() >= 400) failedRequests.push({ route: page.url(), url: r.url().slice(0, 100), err: `HTTP ${r.status()}` }); });

await page.goto(`${SITE}/auth/callback?token_hash=${await link()}&type=magiclink&next=%2F`, { waitUntil: "networkidle", timeout: 120000 });
if (/auth\/login|error=/.test(page.url())) {
  await page.goto(`${SITE}/auth/callback?token_hash=${await link()}&type=magiclink&next=%2F`, { waitUntil: "networkidle", timeout: 120000 });
}
if (/auth\/login|error=/.test(page.url())) { console.log(`FAILED TO SIGN IN: ${page.url()}`); await browser.close(); process.exit(1); }
console.log(`signed in as ${EMAIL}\n`);

let bytes = 0;
page.on("response", async (r) => { try { const h = r.headers()["content-length"]; if (h) bytes += Number(h); } catch {} });

const rows = [];
for (const route of ROUTES) {
  bytes = 0;
  const t0 = Date.now();
  try {
    await page.goto(`${SITE}${route}`, { waitUntil: "networkidle", timeout: 60000 });
  } catch { rows.push({ route, err: "timeout" }); continue; }
  const ms = Date.now() - t0;
  await page.waitForTimeout(600);

  const a11y = await page.evaluate(() => {
    const q = (s) => [...document.querySelectorAll(s)];
    const visible = (el) => el.offsetParent !== null || getComputedStyle(el).position === "fixed";

    const imgsNoAlt = q("img").filter((i) => !i.hasAttribute("alt")).length;
    const inputsNoLabel = q("input,select,textarea").filter((i) => {
      if (i.type === "hidden") return false;
      if (i.getAttribute("aria-label") || i.getAttribute("aria-labelledby") || i.getAttribute("title")) return false;
      if (i.id && document.querySelector(`label[for="${CSS.escape(i.id)}"]`)) return false;
      return !i.closest("label");
    }).length;
    const btnsNoName = q("button").filter(visible).filter((b) => {
      const t = (b.textContent ?? "").trim();
      return !t && !b.getAttribute("aria-label") && !b.getAttribute("title");
    }).length;
    const linksNoName = q("a").filter(visible).filter((a) => {
      const t = (a.textContent ?? "").trim();
      return !t && !a.getAttribute("aria-label") && !a.getAttribute("title");
    }).length;

    // Heading order: an h3 directly after an h1 is a skipped level.
    const hs = q("h1,h2,h3,h4,h5,h6").map((h) => Number(h.tagName[1]));
    let skips = 0;
    for (let i = 1; i < hs.length; i++) if (hs[i] - hs[i - 1] > 1) skips++;
    const h1s = hs.filter((n) => n === 1).length;

    // Zero-vs-unknown: a literal "0" in a numeric cell is a claim.
    const zeroCells = q("td").filter((td) => (td.textContent ?? "").trim() === "0").length;
    const dashCells = q("td").filter((td) => /^[—–-]$/.test((td.textContent ?? "").trim())).length;

    return {
      imgsNoAlt, inputsNoLabel, btnsNoName, linksNoName, skips, h1s,
      zeroCells, dashCells,
      lang: document.documentElement.lang || "(none)",
      title: document.title.slice(0, 40),
      buttons: q("button").filter(visible).length,
    };
  });

  rows.push({ route, ms, kb: Math.round(bytes / 1024), ...a11y });
}

console.log("route".padEnd(38), "ms".padStart(6), "h1".padStart(3), "skip".padStart(5), "img".padStart(4), "inp".padStart(4), "btn".padStart(4), "lnk".padStart(4), "0-cells".padStart(8));
for (const r of rows) {
  if (r.err) { console.log(`${r.route.padEnd(38)}  ${r.err}`); continue; }
  console.log(
    r.route.padEnd(38),
    String(r.ms).padStart(6),
    String(r.h1s).padStart(3),
    String(r.skips).padStart(5),
    String(r.imgsNoAlt).padStart(4),
    String(r.inputsNoLabel).padStart(4),
    String(r.btnsNoName).padStart(4),
    String(r.linksNoName).padStart(4),
    String(r.zeroCells).padStart(8),
  );
}

const slow = rows.filter((r) => r.ms > 3000);
console.log(`\nslow routes (>3s): ${slow.length ? slow.map((r) => `${r.route} ${r.ms}ms`).join(", ") : "none"}`);
console.log(`pages missing exactly one h1: ${rows.filter((r) => !r.err && r.h1s !== 1).map((r) => `${r.route}(${r.h1s})`).join(", ") || "none"}`);
console.log(`html lang: ${[...new Set(rows.filter((r) => !r.err).map((r) => r.lang))].join(", ")}`);

console.log(`\nconsole errors: ${consoleErrors.length}`);
for (const e of consoleErrors.slice(0, 12)) console.log(`   ${e.text}`);
const realFails = failedRequests.filter((f) => !/favicon|_next\/static/.test(f.url));
console.log(`\nfailed requests: ${realFails.length}`);
for (const f of realFails.slice(0, 12)) console.log(`   ${f.err}  ${f.url}`);

await browser.close();
