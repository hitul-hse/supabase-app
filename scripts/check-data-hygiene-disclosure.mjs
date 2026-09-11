/**
 * Does the collapsed panel actually open when tapped?
 *
 * The scroll gate proves the page is 1.95 screens on a phone. It does NOT prove
 * the hidden content is reachable, and those are different claims: a panel that
 * collapses and then refuses to open is a shorter page that has LOST its
 * content, which is worse than the tall page it replaced.
 *
 * So: at 390px, count the visible rows, tap a collapsed panel's trigger, and
 * require more rows visible afterwards. Then check the summary states its count
 * while shut, because a collapsed panel with no figure is indistinguishable from
 * an empty one (DESIGN.md rule 7).
 *
 * Also asserts the desktop is NOT collapsed at 1440px. The whole point of the
 * CSS-gated primitive is that the desktop tree is unchanged; a JS-gated version
 * would collapse there too, and that is the regression this catches.
 *
 * THREE MEASUREMENT TRAPS, all of which produced wrong answers here first:
 *
 *  1. The app renders the page content TWICE -- once in the desktop shell, once
 *     in the mobile one -- with one hidden by CSS. So counting
 *     `[data-hygiene-row]` document-wide mixes two copies and moves with neither
 *     viewport: it read 38 at BOTH 390px and 1440px while the visible page
 *     clearly differed. Everything below is anchored to the ONE trigger a user
 *     can actually see, and follows its `aria-controls` to the panel it owns.
 *
 *  2. Playwright's `:visible` disagrees with `getClientRects()` on this tree,
 *     and `getComputedStyle(...).display` lies for the same reason as (1): the
 *     desktop copy of a `hidden sm:block` node computes to `block` even at
 *     390px, because it is the OTHER shell's node. The panel is measured on the
 *     element the trigger NAMES, by its real height and by whether anything
 *     inside it passes checkVisibility() -- never document-wide, never by a
 *     selector that both shells match.
 *
 *  3. The first-run tour overlay and the mobile tab bar both intercept pointer
 *     events, so `click()` retried for 30s and timed out on a button that was
 *     visible and enabled. The trigger is activated through its own DOM handler
 *     instead, because the question is "does the disclosure work", not "is this
 *     button unobstructed at its centre point".
 *
 * WHY THIS GATE ASSERTED NOTHING FOR FOUR DAYS (found 2026-09-10)
 * --------------------------------------------------------------
 * Two independent defects, both in the gate, neither in the page:
 *
 *  1. SITE defaulted to http://localhost:3100 -- a port nothing in this repo
 *     ever serves (the dev server is :3000, and every other browser gate here
 *     defaults to the deployed site). So the first navigation timed out at
 *     module scope, the gate died before its first ok(), and its RESULT line
 *     read `pass=0 fail=0 notrun=0`: the line a gate prints when it checked
 *     NOTHING, which run-all-gates.mjs calls RED and is right to. It now
 *     defaults to production like its siblings, and an unreachable SITE is
 *     reported as NOT RUN with the URL and the reason -- an absent dependency
 *     is not a verdict about the disclosure.
 *
 *  2. The shut-panel assertion was measuring a mechanism the component no
 *     longer uses. It was written against `hidden sm:block`, i.e. `display:
 *     none`, where a shut panel has NO layout box and `getClientRects().length`
 *     is 0. On 2026-09-06 the motion pass replaced that with `.disclose`
 *     (`grid-template-rows: 0fr`, the inner box clipped and `visibility:
 *     hidden` -- globals.css). A zero-height box still HAS a client rect, so
 *     `panelVisible` reads true on a correctly shut panel and the gate would
 *     have failed the page for being right. Extent is now measured as a real
 *     height, and "shut" is measured as what shut is for a reader: nothing
 *     inside the panel passes checkVisibility() on VISIBILITY -- so it is out
 *     of the tab order and out of the accessibility tree. Deliberately not on
 *     opacity: the panel fades and hides together, and counting the fade would
 *     let the assertion stay green after the `visibility: hidden` that does
 *     the actual work went missing. See the probe.
 *
 * A separate note on the magic link: minting one INVALIDATES the previous one,
 * so each viewport gets its own. Reusing a single token signed in the first
 * context and silently left the second on /auth/login, where the page has no
 * rows at all -- which read exactly like "the desktop lost its content".
 */

import { loadEnv } from "./lib/gate-env.mjs";
import { record, notRunInChain } from "./lib/gate-result.mjs";

const env = loadEnv();
// The guard has to sit above the browser launch. The only skip path used to be
// inside openPage(), which runs after the browser is already up -- so with no
// service-role key (CI, and any laptop without one) this gate did not skip, it
// crashed, and it took the whole `npm run test:db` chain down with it.
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  notRunInChain("no NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in the environment or in"
    + " a .env.local, so no session can be minted for this exec-gated page");
}

// Playwright is absent on CI and on any machine that has never run a browser
// gate. A static import there is a module-resolution crash with zero assertions,
// which is the failure this whole file is being repaired for. Same guard as
// check-table-scroll-budget.mjs.
let launchChromium;
try {
  ({ launchChromium } = await import("./lib/launch-chromium.mjs"));
} catch {
  notRunInChain("playwright is not installed in this environment");
}

/*
 * The deployed site, like every other browser gate here (check-page-length,
 * check-table-scroll-budget, check-charts-ui...). It used to be
 * http://localhost:3100, which nothing in this repo serves on any machine --
 * see defect 1 in the header. Override with SITE=... to measure a dev server.
 */
const SITE = process.env.SITE ?? "https://hseportal.hs-experts.com";

/*
 * NOTHING SERVING SITE IS "DID NOT RUN", NOT A VERDICT.
 *
 * Whether a collapsed panel opens is unknowable without a page to open it on,
 * so the honest answer is to name the URL and stop. Checked BEFORE the browser
 * launches: a 30-second Playwright navigation timeout deep in openPage() is the
 * same absent dependency reported as a crash.
 */
const reach = await fetch(SITE, { redirect: "manual", signal: AbortSignal.timeout(20000) })
  .then((r) => r.status)
  // `e.cause` first: undici reports every connection failure as the bare string
  // "fetch failed", and the cause is where ECONNREFUSED / ENOTFOUND / the port
  // actually appears. A reason that does not name the failure is half a reason.
  .catch((e) => String(e?.cause?.message ?? e?.message ?? e).split("\n")[0]);
if (typeof reach !== "number") {
  notRunInChain(`nothing is serving ${SITE}, so there is no page to collapse or open`
    + ` — ${reach}. Set SITE to a running app if you meant a local one.`);
}
let failures = 0;
const ok = (pass, label, detail = "") => {
  record(pass);
  console.log(`${pass ? "PASS" : "FAIL"}: ${label}`);
  if (!pass) { if (detail) console.log(`        ${detail}`); failures += 1; }
};

/**
 * A fresh login link per browser context. Minting one invalidates the previous,
 * so sharing a token across contexts leaves the later ones signed out.
 */
async function mintLink() {
  const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    // Bjoern is the exec; the page is exec-gated.
    body: JSON.stringify({
      type: "magiclink",
      email: "bjoern.schoenemann@hs-experts.com",
      options: { redirect_to: `${SITE}/auth/callback` },
    }),
  });
  const body = await res.json().catch(() => null);
  // The status travels with the token: a refused mint has to be reportable as a
  // reason, not as a bare null that reads like "the page has no rows".
  return { hashed: body?.properties?.hashed_token ?? body?.hashed_token ?? null, status: res.status };
}

/**
 * Anchored to the ONE trigger a user can see, then follows its `aria-controls`
 * to the panel it owns. Document-wide counts are useless here: the app renders
 * the page in both shells, so they read the same at every viewport.
 */
const probe = () => {
  const btn = [...document.querySelectorAll("[data-mobile-disclosure] button")]
    .find((e) => e.getClientRects().length > 0);
  const docHeight = document.documentElement.scrollHeight;
  if (!btn) return { trigger: false, docHeight };
  const panel = document.getElementById(btn.getAttribute("aria-controls") ?? "");
  /*
   * CAN A READER GET AT ANYTHING IN HERE? -- not "does this box exist".
   *
   * `getClientRects().length` was the old measure and it answers the wrong
   * question now: `.disclose` shuts by collapsing a grid row to 0fr, and a
   * zero-height box still returns one client rect, so the old check called a
   * correctly shut panel open. checkVisibility() is the reader's question:
   * false for display:none and for visibility:hidden, the two ways this
   * component has shut a panel across its two implementations. Asked of the
   * DESCENDANTS, because the wrapper itself stays visible while its clipped
   * child is the part that hides.
   *
   * TWO MEASURES, AND `opacityProperty` IS THE DIFFERENCE BETWEEN THEM.
   * The shut panel carries `opacity: 0` AND `visibility: hidden` together
   * (globals.css `.disclose > *`), and only the second one is load-bearing:
   * `visibility: hidden` is what takes the content out of the tab order and
   * out of the accessibility tree, while `opacity: 0` merely stops it being
   * painted -- transparent content is still focusable and still read aloud.
   * So `opacityProperty: true` on the SHUT check would let the fade alone
   * satisfy it, and the assertion would stay green while a keyboard user tabs
   * into an invisible panel: precisely the regression globals.css says it is
   * preventing ("SHUT MEANS SHUT, not merely zero-height"). Measured on the
   * deployed page: with `visibility: visible` forced back on and the fade
   * left in place, the opacity-aware measure still reports nothing reachable
   * and the gate passes 14/14; the visibility-only measure below reports the
   * content reachable and fails. So:
   *
   *   contentReachable -- visibility only. What the tab order and the screen
   *                       reader can get at. This is the shut-state claim.
   *   contentPainted   -- visibility AND opacity. What an eye can see. Only
   *                       ever used to make the OPEN assertion stricter,
   *                       where a stricter test costs nothing: a panel that
   *                       opened to full height while still transparent has
   *                       not revealed anything.
   */
  const visible = (e, opacity) => (typeof e.checkVisibility === "function"
    ? e.checkVisibility({ visibilityProperty: true, opacityProperty: opacity, contentVisibilityAuto: true })
    : (() => {
      const st = getComputedStyle(e);
      return st.display !== "none" && st.visibility !== "hidden" && (!opacity || Number(st.opacity) > 0);
    })());
  const kids = panel ? [...panel.querySelectorAll("*")] : [];
  return {
    trigger: true,
    expanded: btn.getAttribute("aria-expanded"),
    label: btn.innerText.replace(/\s+/g, " "),
    panelHeight: panel ? Math.round(panel.getBoundingClientRect().height) : 0,
    contentReachable: kids.some((e) => visible(e, false)),
    contentPainted: kids.some((e) => visible(e, true)),
    contentNodes: kids.length,
    docHeight,
  };
};

/** Activate the visible trigger via its own handler, bypassing overlays. */
const activate = () => {
  const btn = [...document.querySelectorAll("[data-mobile-disclosure] button")]
    .find((e) => e.getClientRects().length > 0);
  if (!btn) return false;
  btn.click();
  return true;
};

async function openPage(browser, width, height) {
  const { hashed, status } = await mintLink();
  // A refused mint is an absent dependency, not a verdict on the disclosure.
  if (!hashed) notRunInChain(`could not mint a magic link for the exec at ${width}px`
    + ` (HTTP ${status}), so the page cannot be read as the reader it is gated to`);
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  await page.goto(`${SITE}/auth/callback?token_hash=${hashed}&type=magiclink&next=%2F`, { waitUntil: "networkidle" });
  await page.goto(`${SITE}/data-hygiene`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1200);
  // If auth failed we are on the login page, and every measurement would be of
  // that instead -- which reads exactly like "the page lost its content".
  const path = new URL(page.url()).pathname;
  return { ctx, page, path };
}

const browser = await launchChromium();
try {
  /* ---------------------------------------------------------- phone ------- */
  const phone = await openPage(browser, 390, 844);
  ok(phone.path === "/data-hygiene", `phone reached the page (on ${phone.path})`,
    "not signed in, so every measurement below would be of the login page");

  const before = await phone.page.evaluate(probe);
  ok(before.trigger, "a disclosure trigger is visible on a phone",
    "nothing collapsed: either the disclosure is not wired or the page has one panel");

  // Rule 7: the figure must be readable WHILE SHUT.
  ok(/\d+\s+cases?/.test(before.label ?? ""), "a collapsed panel states its case count",
    `trigger read: ${JSON.stringify((before.label ?? "").slice(0, 90))}`);
  ok(/PROVEN|WORTH A LOOK/.test(before.label ?? ""),
    "a collapsed panel states whether it is proven or a suspicion",
    `trigger read: ${JSON.stringify((before.label ?? "").slice(0, 90))}`);
  /*
   * TWO CLAIMS, DELIBERATELY SEPARATE, because they fail apart: a panel can be
   * flat with its content still in the tab order (`overflow: hidden` and
   * nothing else), and it can be inert while still occupying height. The first
   * is what the reader sees; the second is what a keyboard reaches.
   */
  ok(before.expanded === "false" && before.panelHeight === 0,
    "the panel starts shut: aria-expanded says so, and it takes no height",
    `expanded=${before.expanded} height=${before.panelHeight}px`);
  ok(before.contentNodes > 0 && !before.contentReachable,
    "while shut, nothing inside the panel is reachable (tab order, screen reader)",
    `${before.contentNodes} node(s) inside, contentReachable=${before.contentReachable}`
    + " (visibility only — a fade to opacity:0 does NOT satisfy this, because"
    + " transparent content is still focusable and still read aloud)"
    + " — a flat panel whose content is still focusable drops keyboard focus into an invisible box");

  ok(await phone.page.evaluate(activate), "the visible trigger could be activated");
  await phone.page.waitForTimeout(500);
  const after = await phone.page.evaluate(probe);

  ok(after.expanded === "true", "aria-expanded flips to true",
    `still ${after.expanded}: the state did not change`);
  // `contentPainted`, not `contentReachable`: opening has to make the content
  // visible to an eye as well as to a screen reader, and here the stricter of
  // the two measures costs nothing (see the probe). A panel that reached full
  // height while still transparent has revealed nothing.
  ok(after.panelHeight > 100 && after.contentPainted,
    `the panel it controls becomes visible (${before.panelHeight}px -> ${after.panelHeight}px)`,
    `height=${after.panelHeight}px contentPainted=${after.contentPainted}`
    + " — the panel collapsed but will not open, so its content is unreachable on a phone");
  ok(after.docHeight > before.docHeight,
    `the page grows when it opens (${before.docHeight}px -> ${after.docHeight}px)`,
    "nothing was added to the layout, so no content was actually revealed");
  ok(/HIDE/.test(after.label ?? ""), "the trigger now offers to hide it again",
    `trigger read: ${JSON.stringify((after.label ?? "").slice(0, 60))}`);
  await phone.ctx.close();

  /* --------------------------------------------------------- desktop ------ */
  const desk = await openPage(browser, 1440, 900);
  ok(desk.path === "/data-hygiene", `desktop reached the page (on ${desk.path})`);
  const deskState = await desk.page.evaluate(probe);

  /*
   * The primitive is CSS-gated: at 1440px the trigger has no layout box at all,
   * so there is nothing for a reader to open and nothing to collapse. That is
   * the whole claim -- a JS-gated version would render the trigger and hide the
   * content here too.
   */
  ok(!deskState.trigger, "no disclosure trigger is visible on the desktop",
    "a trigger leaked into the desktop layout, so the desktop tree is NOT unchanged");
  ok(deskState.docHeight > 1500,
    `the desktop still renders its full content (${deskState.docHeight}px)`,
    "the desktop lost content to the mobile disclosure -- the exact bug CSS gating prevents");

  await desk.ctx.close();
} finally {
  await browser.close();
}

console.log(failures === 0
  ? "\nHYGIENE DISCLOSURE WORKS: shut on a phone with its count stated, opens on activation, desktop untouched"
  : `\n${failures} check(s) failed`);
// exitCode, not process.exit(): the Supabase/Playwright clients leave sockets
// open, and exiting on top of them trips a Windows libuv assert under
// contention. See check-data-hygiene-page.mjs for the measured numbers.
process.exitCode = failures === 0 ? 0 : 1;
