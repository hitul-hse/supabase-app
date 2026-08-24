// PRODUCT.md claims "Web (desktop primary, mobile responsive)". Every
// measurement this project has ever taken was at 1440px. Check the claim.
//
// The specific failure to look for is horizontal overflow: a page wider than
// the viewport forces sideways scrolling, which on a phone makes a table
// unusable and often hides a column entirely.
import { readFileSync } from "node:fs";
import { chromium, devices } from "playwright";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const SB = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const SITE = process.env.SITE ?? "https://hseportal.hs-experts.com";
const EMAIL = "bjoern.schoenemann@hs-experts.com";

const mint = async () => {
  const r = await fetch(`${SB}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "magiclink", email: EMAIL, options: { redirect_to: `${SITE}/auth/callback` } }),
  });
  const b = await r.json();
  return b?.properties?.hashed_token ?? b?.hashed_token;
};

const ROUTES = ["/", "/my-work", "/projects", "/people", "/timesheets",
  "/dashboard/management?tab=customers", "/team-lead", "/admin/roles"];

const browser = await chromium.launch();

for (const [label, vp] of [["iPhone 12 (390x844)", { width: 390, height: 844 }],
                           ["iPad (820x1180)", { width: 820, height: 1180 }]]) {
  const ctx = await browser.newContext({ viewport: vp, isMobile: vp.width < 500, hasTouch: vp.width < 500 });
  const page = await ctx.newPage();

  await page.goto(`${SITE}/auth/callback?token_hash=${await mint()}&type=magiclink&next=%2F`, { waitUntil: "networkidle", timeout: 120000 });
  if (/auth\/login|error=/.test(page.url())) {
    await page.goto(`${SITE}/auth/callback?token_hash=${await mint()}&type=magiclink&next=%2F`, { waitUntil: "networkidle", timeout: 120000 });
  }
  if (/auth\/login|error=/.test(page.url())) { console.log(`${label}: could not sign in`); await ctx.close(); continue; }

  console.log(`\n===== ${label}`);
  console.log("route".padEnd(38), "screens".padStart(8), "overflow".padStart(9), "widest element");

  for (const r of ROUTES) {
    try {
      await page.goto(`${SITE}${r}`, { waitUntil: "networkidle", timeout: 60000 });
      await page.waitForTimeout(900);
      const m = await page.evaluate(() => {
        const de = document.documentElement;
        const overflow = de.scrollWidth - de.clientWidth;
        // Which element is actually sticking out?
        let worst = { tag: "", w: 0 };
        for (const el of document.querySelectorAll("body *")) {
          const r = el.getBoundingClientRect();
          if (r.width > worst.w && r.right > de.clientWidth + 2) {
            worst = { tag: el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.split(" ")[0] : ""), w: Math.round(r.width) };
          }
        }
        // Is the sidebar eating the screen?
        const nav = document.querySelector("nav,aside");
        return {
          screens: +(de.scrollHeight / window.innerHeight).toFixed(1),
          overflow,
          worst: worst.tag ? `${worst.tag} ${worst.w}px` : "-",
          navW: nav ? Math.round(nav.getBoundingClientRect().width) : 0,
          tables: document.querySelectorAll("table").length,
        };
      });
      console.log(
        r.padEnd(38),
        String(m.screens).padStart(8),
        (m.overflow > 2 ? `${m.overflow}px` : "ok").padStart(9),
        ` ${m.worst}`,
      );
    } catch (e) { console.log(`${r.padEnd(38)}  ERR ${e.message.split("\n")[0].slice(0, 40)}`); }
  }

  if (vp.width === 390) {
    await page.goto(`${SITE}/dashboard/management?tab=customers`, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: "C:/Supabase/tmp-mobile-customers.png", fullPage: false });
    await page.goto(`${SITE}/my-work`, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: "C:/Supabase/tmp-mobile-mywork.png", fullPage: false });
    console.log("\nscreenshots: tmp-mobile-customers.png, tmp-mobile-mywork.png");
  }
  await ctx.close();
}

await browser.close();
