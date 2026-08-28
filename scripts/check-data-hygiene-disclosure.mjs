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
 *     390px, because it is the OTHER shell's node. Panel visibility is measured
 *     as `getClientRects().length` plus a real height, on the element the
 *     trigger names.
 *
 *  3. The first-run tour overlay and the mobile tab bar both intercept pointer
 *     events, so `click()` retried for 30s and timed out on a button that was
 *     visible and enabled. The trigger is activated through its own DOM handler
 *     instead, because the question is "does the disclosure work", not "is this
 *     button unobstructed at its centre point".
 *
 * A separate note on the magic link: minting one INVALIDATES the previous one,
 * so each viewport gets its own. Reusing a single token signed in the first
 * context and silently left the second on /auth/login, where the page has no
 * rows at all -- which read exactly like "the desktop lost its content".
 */

import { chromium } from "playwright";
import { loadEnv } from "./lib/gate-env.mjs";

const env = loadEnv();

const SITE = process.env.SITE ?? "http://localhost:3100";
let failures = 0;
const ok = (pass, label, detail = "") => {
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
  const body = await res.json();
  return body?.properties?.hashed_token ?? body?.hashed_token ?? null;
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
  return {
    trigger: true,
    expanded: btn.getAttribute("aria-expanded"),
    label: btn.innerText.replace(/\s+/g, " "),
    panelVisible: panel ? panel.getClientRects().length > 0 : false,
    panelHeight: panel ? Math.round(panel.getBoundingClientRect().height) : 0,
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
  const hashed = await mintLink();
  if (!hashed) return null;
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

const browser = await chromium.launch();
try {
  /* ---------------------------------------------------------- phone ------- */
  const phone = await openPage(browser, 390, 844);
  if (!phone) {
    console.log("SKIP: could not mint a login link");
    process.exit(0);
  }
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
  ok(before.expanded === "false" && !before.panelVisible,
    "the panel starts shut, and says so via aria-expanded",
    `expanded=${before.expanded} panelVisible=${before.panelVisible}`);

  ok(await phone.page.evaluate(activate), "the visible trigger could be activated");
  await phone.page.waitForTimeout(500);
  const after = await phone.page.evaluate(probe);

  ok(after.expanded === "true", "aria-expanded flips to true",
    `still ${after.expanded}: the state did not change`);
  ok(after.panelVisible && after.panelHeight > 100,
    `the panel it controls becomes visible (${before.panelHeight}px -> ${after.panelHeight}px)`,
    "the panel collapsed but will not open, so its content is unreachable on a phone");
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
