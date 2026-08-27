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

const SITE = process.env.SITE ?? "http://localhost:3179";
const LINKED = "10110_00358_104_01";   // stored 552.4h vs live 390.4h
const ORPHAN = "10765_00316_701_01";   // no TrackingTime link at all

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

/*
 * The magic link is rate-limited on the Supabase side, and a refused one lands
 * the browser on /auth/login. That does NOT throw: every content assertion
 * below then fails against the sign-in page and reports a broken route where the
 * route is fine. So the session is established with backoff and then PROVEN by a
 * positive signal before anything is measured.
 */
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

async function signIn() {
  for (let attempt = 1; attempt <= 6; attempt++) {
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
    if (hashed) {
      await page.goto(`${SITE}/auth/callback?token_hash=${hashed}&type=magiclink&next=%2F`, { waitUntil: "networkidle" });
      // The positive signal: the app shell only renders its nav for a real
      // session, and /auth/login never does.
      if (!/\/auth\/login/.test(page.url()) && (await page.locator("nav").count()) > 0) return;
    }
    await new Promise((r) => setTimeout(r, attempt * 4000));
  }
  throw new Error(`could not establish a session after 6 attempts (last url ${page.url()})`);
}
await signIn();

async function load(id) {
  const res = await page.goto(`${SITE}/orders/${id}`, { waitUntil: "networkidle" });
  if (/\/auth\/login/.test(page.url())) throw new Error(`session dropped while loading ${id}`);
  const text0 = await page.evaluate(() => document.body.innerText);
  /*
   * The app's error boundary ("This page couldn't load") is an INFRASTRUCTURE
   * failure, not a content failure. Left unchecked it renders every assertion
   * below as a red line about hours and provenance, which points the reader at
   * the page when the real cause was a stale .next served by a server started
   * before a concurrent rebuild. Measured: it cost a full debugging detour.
   */
  if (/This page couldn.{0,3}t load/.test(text0))
    throw new Error(`the app error boundary rendered for ${id} — the served build is broken or stale, not the assertions`);
  /*
   * `networkidle` is not "the DOM has settled". On the FIRST navigation into
   * this route the streamed copy and the resolved copy are both briefly in the
   * document, so a raw querySelectorAll count reads 2 where the reader sees 1.
   * Only ONE of them is ever rendered (offsetParent !== null); the other is
   * inert leftover markup. Counting VISIBLE nodes is both the stable measure
   * and the honest one -- the claim being tested is "the reader sees this panel
   * once", not "the DOM holds one node".
   */
  await page.waitForFunction(
    () => {
      const all = [...document.querySelectorAll("[data-hours-disagree]")];
      return all.length === 0 || all.some((n) => n.offsetParent !== null);
    },
    null,
    { timeout: 10000 },
  ).catch(() => {});
  return { status: res.status(), text: await page.evaluate(() => document.body.innerText) };
}

/*
 * notFound() in this app shell renders the 404 BODY inside the authenticated
 * layout and still answers HTTP 200 — verified identical on the pre-existing
 * /projects/abc, so it is the app's behaviour and not this route's. The
 * assertion therefore tests what the reader sees.
 */
const is404 = (t) => t.includes("This page could not be found");

/** Only what the reader can actually SEE. See the note in load(). */
const visibleDisagreePanels = () =>
  page.evaluate(() =>
    [...document.querySelectorAll("[data-hours-disagree]")].filter((n) => n.offsetParent !== null).length,
  );

// --- the linked order, whose two hour figures disagree -------------------
const linked = await load(LINKED);
check("a linked order renders", linked.status === 200 && !is404(linked.text), `HTTP ${linked.status}`);
check("the masterdata id is on the page", linked.text.includes(LINKED));
const disagreeNodes = await visibleDisagreePanels();
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
  (await visibleDisagreePanels()) === 0);

// --- guards --------------------------------------------------------------
const numeric = await load("412");
check("a bare TrackingTime bigint 404s here (wrong world)", is404(numeric.text));
const junk = await load("not-an-order");
check("junk 404s rather than reaching PostgREST", is404(junk.text));
const unknown = await load("99999_99999_999_99");
check("a well-shaped but unknown id 404s", is404(unknown.text));

/*
 * The awkward real record. One live order id is `10905_00357__01`, with an EMPTY
 * middle segment, so a tidy `\d+_\d+_\d+_\d+` guard would 404 a genuine order to
 * satisfy a format nobody promised. This is the regression test for that guard
 * staying loose.
 */
const awkward = await load("10905_00357__01");
check("the malformed-but-real id 10905_00357__01 still resolves", !is404(awkward.text));

// --- mobile --------------------------------------------------------------
await page.setViewportSize({ width: 390, height: 844 });
await load(LINKED);
const mobile = await page.evaluate(() => document.documentElement.scrollHeight / 844);
check("under 4 screens at 390x844", mobile < 4, `${mobile.toFixed(2)} screens`);

await browser.close();
console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
