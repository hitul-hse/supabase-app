// Verify the bottom sheet against a real phone viewport: does it render as
// glass, is it reachable, does it dismiss, and is the geometry actually the tab
// bar's rather than merely described as such.
import { readFileSync } from "node:fs";
import { launchChromium } from "./lib/launch-chromium.mjs";

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
    body: JSON.stringify({ type: "magiclink", email: "mathias@hs-experts.com", options: { redirect_to: `${SITE}/auth/callback` } }),
  });
  const b = await r.json();
  return b?.properties?.hashed_token ?? b?.hashed_token;
};

let failed = false;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed = true;
};

const browser = await launchChromium();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
const page = await ctx.newPage();
await page.goto(`${SITE}/auth/callback?token_hash=${await mint()}&type=magiclink&next=%2Fmy-work`, { waitUntil: "networkidle", timeout: 120000 });
await page.waitForTimeout(1200);
for (const n of ["Skip tour", "Skip", "Close"]) {
  const b = page.getByRole("button", { name: n, exact: false });
  if (await b.count().catch(() => 0)) { try { await b.first().click({ timeout: 2000 }); break; } catch {} }
}
await page.waitForTimeout(600);
await page.evaluate(() => window.scrollBy(0, 600));
await page.waitForTimeout(400);

// Closed: the sheet must exist but be off-screen, not merely invisible - an
// off-screen dialog that still catches taps is a phantom hit target.
const closed = await page.evaluate(() => {
  const s = document.querySelector('[data-testid="mobile-sheet"]');
  if (!s) return null;
  const r = s.getBoundingClientRect();
  const cs = getComputedStyle(s);
  return {
    top: Math.round(r.top), vh: window.innerHeight,
    pe: cs.pointerEvents,
    // Tailwind v4 uses the standalone `translate` property, not `transform`.
    // Assert the OUTCOME (off-screen, untouchable) rather than the mechanism,
    // so a framework that achieves it differently still passes.
    //
    // TIGHTENED back to the real bottom edge. While the sheet floated 84px up,
    // translate-y-full parked its top at y=760 on an 844px screen -- ON the
    // tab bar, not past it -- so this had to tolerate `vh - 120`. That slack is
    // exactly what let an invisible-but-hit-testable panel sit over the button
    // that opens it. Flush to the edge, "closed" means genuinely gone.
    displaced: Math.round(r.top) >= window.innerHeight - 2,
    inert: cs.pointerEvents === "none" && s.getAttribute("aria-hidden") === "true",
    translate: cs.translate,
  };
});
check("sheet exists in the DOM", closed !== null);
check("closed sheet clears the viewport entirely and cannot be touched", closed && closed.displaced && closed.inert,
  closed ? `top=${closed.top} vh=${closed.vh} displaced=${closed.displaced} pointerEvents=${closed.pe} ariaHidden=${closed.inert} translate=${closed.translate}` : "");

// Open it from the pill, the way a person would.
await page.locator('[data-testid="mobile-tab-bar"] button').last().click();
await page.waitForTimeout(700);

const open = await page.evaluate(() => {
  const s = document.querySelector('[data-testid="mobile-sheet"]');
  const bar = document.querySelector('[data-testid="mobile-tab-bar"]');
  const rs = s.getBoundingClientRect(), rb = bar.getBoundingClientRect();
  const cs = getComputedStyle(s), cb = getComputedStyle(bar);
  const handle = s.querySelector("div[aria-hidden] > div, div[aria-hidden]");
  return {
    sheet: {
      x: Math.round(rs.x), w: Math.round(rs.width), top: Math.round(rs.top), h: Math.round(rs.height),
      bottom: Math.round(rs.bottom),
      radius: cs.borderTopLeftRadius, bg: cs.backgroundColor,
      // The four values that decide "edge-anchored sheet" vs "floating card".
      radiusBottom: cs.borderBottomLeftRadius,
      bw: {
        t: Math.round(parseFloat(cs.borderTopWidth)),
        r: Math.round(parseFloat(cs.borderRightWidth)),
        b: Math.round(parseFloat(cs.borderBottomWidth)),
        l: Math.round(parseFloat(cs.borderLeftWidth)),
      },
      backdrop: cs.backdropFilter || cs.webkitBackdropFilter, border: cs.borderColor,
      shadow: cs.boxShadow.slice(0, 40),
    },
    bar: { x: Math.round(rb.x), w: Math.round(rb.width), bg: cb.backgroundColor, backdrop: cb.backdropFilter || cb.webkitBackdropFilter },
    vh: window.innerHeight,
    links: s.querySelectorAll("a").length,
    closeBtn: (() => { const b = s.querySelector('button[aria-label="Close navigation"]'); if (!b) return null; const r = b.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })(),
  };
});

console.log("\nsheet as rendered:", JSON.stringify(open.sheet, null, 1));

check("sheet is on screen when open", open.sheet.top < open.vh - 100, `top=${open.sheet.top}`);
check("sheet is frosted, not opaque", /blur/.test(open.sheet.backdrop), `backdrop-filter: ${open.sheet.backdrop}`);
check("sheet uses the SAME glass as the tab bar", open.sheet.backdrop === open.bar.backdrop && open.sheet.bg === open.bar.bg,
  `sheet ${open.sheet.bg} / ${open.sheet.backdrop} vs bar ${open.bar.bg} / ${open.bar.backdrop}`);
/*
  THE REPORTED BUG, inverted into an assertion. The sheet was `mx-2` with all
  four corners at 28px, floating 84px off the bottom: a ~374x520 rounded card
  adrift in the middle of a 390x844 screen. That is a free-floating widget, and
  it is the shape the floating PILL was deliberately reworked away from -- worse
  at this size, because a 58px pill reads as a control while a 520px card reads
  as a second window.

  An edge-anchored sheet is the OS grammar (iOS action sheets, Android Material
  bottom sheets): edge contact is the cue that says "this came from there and
  goes back there". These four checks are what "anchored" actually means, and
  each one is a way the widget could come back.
*/
check("sheet is FLUSH to both side edges (not a floating card)",
  open.sheet.x === 0 && open.sheet.w === 390, `x=${open.sheet.x} w=${open.sheet.w}`);
check("sheet is FLUSH to the bottom edge", open.sheet.bottom >= open.vh - 1,
  `bottom=${open.sheet.bottom} vh=${open.vh}`);
check("sheet has rounded TOP corners", parseFloat(open.sheet.radius) >= 20, `radius ${open.sheet.radius}`);
/* Square bottom corners are not cosmetic: a radius on an edge that touches the
   screen leaves two slivers of page showing through the corners, which is the
   single tell that turns an anchored sheet back into a floating one. */
check("sheet has SQUARE bottom corners (it meets the edge)",
  parseFloat(open.sheet.radiusBottom) <= 1, `bottom radius ${open.sheet.radiusBottom}`);
/* Hairline on the top edge only. On the three flush edges a border renders as a
   stray line against the screen bezel, and on the bottom it sits under the home
   indicator. */
check("sheet borders its TOP edge only",
  open.sheet.bw.t >= 1 && open.sheet.bw.r === 0 && open.sheet.bw.b === 0 && open.sheet.bw.l === 0,
  `t=${open.sheet.bw.t} r=${open.sheet.bw.r} b=${open.sheet.bw.b} l=${open.sheet.bw.l}`);
check("sheet leaves the page visible behind it", open.sheet.h <= open.vh * 0.78, `${open.sheet.h}px of ${open.vh}px`);
check("close button meets the 44px target floor", open.closeBtn && open.closeBtn.w >= 44 && open.closeBtn.h >= 44, JSON.stringify(open.closeBtn));
check("every nav route is still reachable", open.links >= 6, `${open.links} links`);

// The two the screenshot caught and the geometry did not.
const layering = await page.evaluate(() => {
  const s = document.querySelector('[data-testid="mobile-sheet"]');
  const bar = document.querySelector('[data-testid="mobile-tab-bar"]');
  const rs = s.getBoundingClientRect(), rb = bar.getBoundingClientRect();
  // Blank space between the last thing in the sheet and the sheet's own bottom.
  const kids = [...s.querySelectorAll("*")].map((e) => e.getBoundingClientRect().bottom);
  const lastInk = kids.length ? Math.max(...kids.filter((b) => b <= rs.bottom + 1)) : rs.bottom;
  return {
    sheetBottom: Math.round(rs.bottom),
    barTop: Math.round(rb.top),
    overlap: Math.round(rs.bottom - rb.top),
    deadSpace: Math.round(rs.bottom - lastInk),
  };
});

/*
  INVERTED, deliberately. This used to assert the sheet did NOT cover the tab
  bar, which is what forced the 84px offset and hence the detached-card shape:
  a real visual cost paid to keep a "More is active" indicator lit while the
  panel it refers to is already filling the screen. Covering the bar is the
  standard behaviour for a modal bottom sheet, and it is what lets the sheet
  meet the edge at all.

  The requirement that replaces it is the one that actually matters: there must
  still be a way out. Asserted below via the backdrop tap, and by the 44px
  close button above.
*/
check("sheet layers OVER the tab bar (edge-anchored, not floated above it)",
  layering.overlap > 0, `sheet bottom ${layering.sheetBottom} vs bar top ${layering.barTop} (overlap ${layering.overlap}px)`);
check("sheet has no dead space below its content", layering.deadSpace <= 24,
  `${layering.deadSpace}px of blank sheet below the last element`);

await page.screenshot({ path: "C:/Supabase/tmp-sheet-open.png" });

// It must close again, and by tapping the backdrop as well as the button.
await page.mouse.click(195, 80);
await page.waitForTimeout(600);
const after = await page.evaluate(() => {
  const s = document.querySelector('[data-testid="mobile-sheet"]');
  const r = s.getBoundingClientRect();
  return {
    top: Math.round(r.top),
    vh: window.innerHeight,
    // Same rule as the closed-state check above: displaced out of the way and
    // no longer taking taps. Not "below the viewport" -- the sheet parks over
    // the tab bar now, so its resting top is ~760 on a 844px screen.
    displaced: Math.round(r.top) >= window.innerHeight - 2,
    untouchable: getComputedStyle(s).pointerEvents === "none",
  };
});
check("tapping the backdrop closes it", after.displaced && after.untouchable,
  `top=${after.top} displaced=${after.displaced} pointerEvents=${after.untouchable}`);

await browser.close();
console.log(failed ? "\nFAILED" : "\nALL CHECKS PASSED");
process.exit(failed ? 1 : 0);
