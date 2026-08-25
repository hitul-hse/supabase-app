// The two accessors are defined but never called, so the zeros should not reach
// a user. Verify that against the running app rather than trusting the grep:
// check the screens where budget and billable value WOULD naturally appear, and
// confirm the numbers shown there come from somewhere real.
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const SB = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const SITE = process.env.SITE ?? "http://localhost:3000";

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
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

// Watch what the page asks PostgREST for. If it never requests the dead views,
// that is proof they are unreachable rather than an inference from grep.
const asked = new Set();
page.on("request", (r) => {
  const u = r.url();
  const m = u.match(/\/rest\/v1\/([a-z_]+)/);
  if (m) asked.add(m[1]);
});

await page.goto(`${SITE}/auth/callback?token_hash=${await mint()}&type=magiclink&next=%2F`, { waitUntil: "networkidle", timeout: 120000 });

for (const r of ["/", "/people", "/projects", "/time/dashboard", "/dashboard/management?tab=overview"]) {
  await page.goto(`${SITE}${r}`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(800);
}

console.log("tables/views the app requested over PostgREST during that walk:");
for (const t of [...asked].sort()) console.log(`   ${t}`);
console.log(`\nrequested billable_value_by_person? ${asked.has("billable_value_by_person")}`);
console.log(`requested project_budget_status?    ${asked.has("project_budget_status")}`);
console.log(`requested timesheet_entries?        ${asked.has("timesheet_entries")}`);

// Where does the Overview's billable figure actually come from?
await page.goto(`${SITE}/`, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(900);
const tiles = await page.evaluate(() =>
  [...document.querySelectorAll("dl div, [class*='stat'], [data-metric]")]
    .map((e) => (e.textContent ?? "").replace(/\s+/g, " ").trim())
    .filter((t) => t && t.length < 70)
    .slice(0, 12));
console.log("\nOverview tiles as rendered:");
for (const t of tiles) console.log(`   ${t}`);

await browser.close();
