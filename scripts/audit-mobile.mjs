/**
 * PRODUCT.md claims "Web (desktop primary, mobile responsive)". Every
 * measurement this project has ever taken was at 1440px. Check the claim.
 *
 * TWO FAILURES ARE LOOKED FOR, and they are not the same defect.
 *
 * 1. HORIZONTAL OVERFLOW: a page wider than the viewport forces sideways
 *    scrolling, which on a phone makes a table unusable and often hides a
 *    column entirely. Measured as documentElement.scrollWidth - clientWidth,
 *    with the widest offending element named so the fix has an address.
 *    Current verdict: clean on every route -- the sidebar collapses to a
 *    hamburger and wide tables scroll inside their own card. Do not "fix" it.
 *
 * 2. VERTICAL LENGTH: the same DESIGN.md rule-8 complaint the desktop gate
 *    owns ("too much scrolling"), except that at 390px a two- or three-column
 *    grid stacks into ONE column, so a layout that is 3 screens on a desktop is
 *    silently 7 on a phone. Paging is NOT the lever here: /projects and / render
 *    zero tables at 390px, so their height is cards and charts stacking, and the
 *    only honest fix is the layout.
 *
 * WHY THE PER-BLOCK BREAKDOWN EXISTS (--blocks, on by default at 390px).
 * "7.1 screens" names a symptom and no cause, and the first three attempts at a
 * fix would be guesses at which section is tall. So this reports, per route, the
 * tallest blocks with their pixel heights and their headings -- the way
 * scripts/measure-management-tabs.mjs reports per-card heights at 1440px. The
 * partition is described at blockBreakdown() below.
 *
 * Run: node scripts/audit-mobile.mjs
 *      SITE=http://localhost:3000 node scripts/audit-mobile.mjs
 */
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

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

/**
 * How many blocks to print per route, and the floor under which a block is not
 * worth naming. 140px is about one card header plus a line: below that the block
 * is furniture, and listing it buries the two panels that actually cost screens.
 */
const TOP_BLOCKS = 6;
const BLOCK_FLOOR = 140;

/**
 * Partition the document into the blocks a reader would name, and measure each.
 *
 * THE PROBLEM WITH THE OBVIOUS APPROACHES. "Every element over 400px" reports a
 * nest of twelve wrappers that are all the same 900px panel. "Direct children of
 * main" reports one block per page, because these routes wrap everything in a
 * single flex column. Neither tells you which panel to collapse.
 *
 * SO: descend from the content root while a node is a PASS-THROUGH wrapper -- one
 * whose tallest child accounts for >= 92% of its own height, i.e. a container that
 * adds nothing but padding. The moment a node's height is genuinely split across
 * several children, those children ARE the blocks, and recursion stops there.
 * That is exactly the level at which a human says "the analysis panel" or "the
 * ledger", because it is the level where the page stops being a single column of
 * one thing.
 *
 * Each block is labelled by its own nearest heading (h1-h4 or a [data-block-label]),
 * falling back to the tag plus first class, plus the count of table rows inside it,
 * because a tall block with rows and a tall block with a chart need opposite fixes.
 */
const blockBreakdown = ([floor, top]) => {
  const root =
    document.querySelector("main") ??
    document.querySelector("[data-page-shell]") ??
    document.body;

  const heightOf = (el) => el.getBoundingClientRect().height;
  const kidsOf = (el) =>
    [...el.children].filter((c) => {
      if (!(c instanceof HTMLElement)) return false;
      const s = getComputedStyle(c);
      if (s.display === "none" || s.visibility === "hidden") return false;
      // Anything lifted out of flow (popovers, sticky overlays, the tour) does
      // not contribute to document height, so it must not be reported as if it did.
      if (s.position === "fixed" || s.position === "absolute") return false;
      return heightOf(c) > 0;
    });

  const blocks = [];
  const visit = (el, depth) => {
    const h = heightOf(el);
    const kids = kidsOf(el);
    if (depth < 12 && kids.length) {
      const tallest = kids.reduce((a, c) => Math.max(a, heightOf(c)), 0);
      // A pass-through wrapper: one child IS this element's height. Keep going.
      if (kids.length === 1 || tallest >= h * 0.92) {
        for (const c of kids) visit(c, depth + 1);
        return;
      }
      // Height is genuinely shared: these children are the blocks.
      for (const c of kids) {
        const ch = heightOf(c);
        if (ch >= floor) blocks.push(c);
        else if (ch > 0) blocks.push(c); // still counted, filtered when printing
      }
      return;
    }
    blocks.push(el);
  };
  visit(root, 0);

  const describe = (el) => {
    const label =
      el.getAttribute?.("data-block-label") ??
      (el.querySelector("h1,h2,h3,h4")?.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
    const cls =
      typeof el.className === "string" && el.className
        ? "." + el.className.split(" ").filter(Boolean)[0].slice(0, 22)
        : "";
    return label || `${el.tagName.toLowerCase()}${cls}`;
  };

  const measured = blocks
    .map((el) => ({
      label: describe(el),
      px: Math.round(heightOf(el)),
      rows: el.querySelectorAll("tbody tr").length,
      charts: el.querySelectorAll("svg,canvas").length,
    }))
    .filter((b) => b.px >= floor)
    .sort((a, b) => b.px - a.px);

  return {
    total: document.documentElement.scrollHeight,
    vh: window.innerHeight,
    // Everything the top-N does not account for, so the numbers reconcile
    // instead of leaving the reader wondering where the rest of the page went.
    accountedPx: measured.slice(0, top).reduce((a, b) => a + b.px, 0),
    blocks: measured.slice(0, top),
    blockCount: measured.length,
  };
};

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

  /** Per-route block breakdowns, printed after the summary table. */
  const breakdowns = [];

  for (const r of ROUTES) {
    try {
      // networkidle on a page that holds a websocket or a poll open never
      // settles, and the route then reports ERR and measures nothing. Fall back
      // to domcontentloaded plus a settle wait, which still measures a hydrated
      // page -- an unmeasured route is a silent hole in the audit.
      try {
        await page.goto(`${SITE}${r}`, { waitUntil: "networkidle", timeout: 45000 });
      } catch {
        await page.goto(`${SITE}${r}`, { waitUntil: "domcontentloaded", timeout: 45000 });
        await page.waitForTimeout(2500);
      }
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

      // The cause, not just the symptom. Only at phone width, where the
      // stacking happens and where the fix has to land.
      if (vp.width === 390) {
        breakdowns.push({
          route: r,
          ...(await page.evaluate(blockBreakdown, [BLOCK_FLOOR, TOP_BLOCKS])),
        });
      }
    } catch (e) { console.log(`${r.padEnd(38)}  ERR ${e.message.split("\n")[0].slice(0, 40)}`); }
  }

  /* ── where the height actually is, per route ─────────────────────────── */
  if (breakdowns.length) {
    console.log(`\n----- ${label}: tallest blocks per route (>=${BLOCK_FLOOR}px)`);
    for (const b of breakdowns) {
      const screens = (b.total / b.vh).toFixed(1);
      console.log(
        `\n  ${b.route}   ${b.total}px = ${screens} screens   ` +
          `(top ${b.blocks.length} of ${b.blockCount} blocks = ${b.accountedPx}px)`,
      );
      console.log(`    ${"block".padEnd(42)} ${"px".padStart(6)} ${"screens".padStart(8)}  rows charts`);
      for (const blk of b.blocks) {
        console.log(
          `    ${blk.label.padEnd(42)} ${String(blk.px).padStart(6)} ${(blk.px / b.vh).toFixed(1).padStart(8)}  ${String(blk.rows).padStart(4)} ${String(blk.charts).padStart(6)}`,
        );
      }
    }
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
