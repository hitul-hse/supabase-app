// Prove the notes actually render, and that each sits next to the figure it
// describes. A description committed but not displayed is worse than none: it
// looks handled in review and is invisible in use.
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

// The distinctive opening words of each note, and where it must appear.
const EXPECT = [
  ["/", "Billable hours as a share of all tracked hours"],
  ["/", "Tracked hours against a nominal 40-hour week"],
  ["/projects", "Projects by budget burn"],
  ["/projects", "The ten projects with the most hours logged"],
  ["/projects", "Hours logged against the estimate"],
  ["/projects", "Each customer's share of delivered hours"],
  ["/team-lead", "Hours logged by the whole team each week"],
  ["/team-lead", "People by hours logged in the last completed week"],
  ["/team-lead", "Left: hours logged per week by this team"],
  ["/time/dashboard", "Tracked time split by the billable flag"],
];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto(`${SITE}/auth/callback?token_hash=${await mint()}&type=magiclink&next=%2F`, { waitUntil: "networkidle", timeout: 120000 });

const byRoute = new Map();
for (const [route, text] of EXPECT) {
  if (!byRoute.has(route)) byRoute.set(route, []);
  byRoute.get(route).push(text);
}

let missing = 0;
for (const [route, texts] of byRoute) {
  await page.goto(`${SITE}${route}`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1200);
  const body = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
  console.log(`\n${route}`);
  for (const t of texts) {
    const found = body.includes(t.replace(/\s+/g, " "));
    if (!found) missing++;
    console.log(`   ${found ? "shown  " : "MISSING"}  "${t}"`);
  }
}

// A note that renders but is invisible (zero height, clipped) is still missing.
await page.goto(`${SITE}/projects`, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(1000);
const geom = await page.evaluate(() => {
  const ps = [...document.querySelectorAll("p")].filter((p) => /budget burn|hours logged|delivered hours/i.test(p.textContent ?? ""));
  return ps.map((p) => {
    const r = p.getBoundingClientRect();
    const cs = getComputedStyle(p);
    return { text: (p.textContent ?? "").trim().slice(0, 34), h: Math.round(r.height), size: cs.fontSize, colour: cs.color, visible: r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" };
  });
});
console.log("\ngeometry on /projects:");
for (const g of geom) console.log(`   visible=${g.visible} h=${g.h}px ${g.size} ${g.colour}  "${g.text}…"`);

await browser.close();
console.log(missing === 0 ? "\nALL NOTES RENDER" : `\n${missing} NOTE(S) MISSING`);
process.exit(missing === 0 ? 0 : 1);
