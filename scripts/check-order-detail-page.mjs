/**
 * Does /orders/[id] actually RENDER, for both worlds and for a bad id?
 *
 * Kept beside the query-layer check deliberately: check-order-detail-live.mjs
 * proves getOrderDetail returns the right shape, which is not the same claim as
 * "the page states the hours disagreement instead of picking one". This drives
 * the real route with a real magic-link session, following probe-route.mjs.
 */
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const SITE = process.env.SITE ?? "http://localhost:3178";
const LINKED = "10110_00358_104_01";   // stored 552.4h vs live 390.4h
const ORPHAN = "10765_00316_701_01";   // no TrackingTime link at all

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

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
const body = await gen.json();
const hashed = body?.properties?.hashed_token ?? body?.hashed_token;
if (!hashed) throw new Error(`no magic link: ${JSON.stringify(body).slice(0, 300)}`);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto(`${SITE}/auth/callback?token_hash=${hashed}&type=magiclink&next=%2F`, { waitUntil: "networkidle" });
// A reused or rate-limited magic link lands on /auth/login, and every content
// assertion below would then fail for the wrong reason. Fail loudly instead.
if (/\/auth\/login/.test(page.url())) throw new Error(`login did not take: ${page.url()}`);

async function load(id) {
  const res = await page.goto(`${SITE}/orders/${id}`, { waitUntil: "networkidle" });
  return { status: res.status(), text: await page.evaluate(() => document.body.innerText) };
}

/*
 * notFound() in this app shell renders the 404 BODY inside the authenticated
 * layout and still answers HTTP 200 — verified identical on the pre-existing
 * /projects/abc, so it is the app's behaviour and not this route's. The
 * assertion therefore tests what the reader sees.
 */
const is404 = (t) => t.includes("This page could not be found");

// --- the linked order, whose two hour figures disagree -------------------
const linked = await load(LINKED);
check("a linked order renders", linked.status === 200 && !is404(linked.text), `HTTP ${linked.status}`);
check("the masterdata id is on the page", linked.text.includes(LINKED));
const disagreeNodes = await page.locator("[data-hours-disagree]").count();
check("the disagreement panel is rendered exactly once", disagreeNodes === 1, `${disagreeNodes} node(s)`);
check("BOTH figures are stated, not one", linked.text.includes("552.4") && linked.text.includes("390.4"),
  "stored 552.4 and live 390.4");
check("it names WHICH is which", /logged_hours/.test(linked.text) && /time\.entry/.test(linked.text));
check("it warns the snapshot can carry future-dated planned work", /zuk/i.test(linked.text));
check("it says the live figure is bounded at today", /heute/i.test(linked.text));
check("responsibility provenance is shown", /AUS STAMMDATEN|AUS FREIGEGEBENEM ANTRAG/.test(linked.text));
check("a 0% assignee is labelled as cover, never a bare 0%", 
  linked.text.includes("BENANNTE VERTRETUNG") && !/\b0%/.test(linked.text));
check("the customer's service mix is rendered", linked.text.includes("Services dieses Kunden"));
const screens = await page.evaluate(() => document.documentElement.scrollHeight / 900);
check("under 3 screens at 1440x900", screens < 3, `${screens.toFixed(2)} screens`);

// --- the orphan, which /projects/[id] structurally cannot show -----------
const orphan = await load(ORPHAN);
check("an ORPHAN order renders (the whole point of this route)", orphan.status === 200 && !is404(orphan.text), `HTTP ${orphan.status}`);
check("live hours are an honest n/a, never 0", orphan.text.includes("n/a"));
check("it does NOT print a 0.0 h logged figure for the orphan",
  !/GEBUCHT \(LIVE\)\s*\n?\s*0\.0/.test(orphan.text));
check("the missing link is named explicitly", /KEINE TRACKINGTIME/.test(orphan.text));
check("contract_type still names the service", /AUS VERTRAGSART/.test(orphan.text));
check("no disagreement is claimed where none can be measured",
  await page.locator("[data-hours-disagree]").count() === 0);

// --- guards --------------------------------------------------------------
const numeric = await load("412");
check("a bare TrackingTime bigint 404s here (wrong world)", is404(numeric.text));
const junk = await load("not-an-order");
check("junk 404s rather than reaching PostgREST", is404(junk.text));
const unknown = await load("99999_99999_999_99");
check("a well-shaped but unknown id 404s", is404(unknown.text));

// --- mobile --------------------------------------------------------------
await page.setViewportSize({ width: 390, height: 844 });
await load(LINKED);
const mobile = await page.evaluate(() => document.documentElement.scrollHeight / 844);
check("under 4 screens at 390x844", mobile < 4, `${mobile.toFixed(2)} screens`);

await browser.close();
console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
