// Verify the bottom sheet against a real phone viewport: does it render as
// glass, is it reachable, does it dismiss, and is the geometry actually the tab
// bar's rather than merely described as such.
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

const browser = await chromium.launch();
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
    displaced: Math.round(r.top) >= window.innerHeight - 120,
    inert: cs.pointerEvents === "none" && s.getAttribute("aria-hidden") === "true",
    translate: cs.translate,
  };
});
check("sheet exists in the DOM", closed !== null);
// Not "top >= vh": the sheet floats above the tab bar now, so when closed it
// is translated over the bar rather than past the bottom of the screen. What
// matters is that it cannot be seen OR touched.
check("closed sheet is displaced and cannot be touched", closed && closed.displaced && closed.inert,
  closed ? `top=${closed.top} displaced=${closed.displaced} pointerEvents=${closed.pe} ariaHidden=${closed.inert} translate=${closed.translate}` : "");

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
      radius: cs.borderTopLeftRadius, bg: cs.backgroundColor,
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
check("sheet floats: inset from both side edges", open.sheet.x >= 4 && open.sheet.w <= 390 - 8, `x=${open.sheet.x} w=${open.sheet.w}`);
check("sheet has rounded top corners", parseFloat(open.sheet.radius) >= 20, `radius ${open.sheet.radius}`);
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

check("sheet does not cover the tab bar it opened from", layering.overlap <= 0,
  `sheet bottom ${layering.sheetBottom} vs bar top ${layering.barTop} (overlap ${layering.overlap}px)`);
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
    displaced: Math.round(r.top) >= window.innerHeight - 120,
    untouchable: getComputedStyle(s).pointerEvents === "none",
  };
});
check("tapping the backdrop closes it", after.displaced && after.untouchable,
  `top=${after.top} displaced=${after.displaced} pointerEvents=${after.untouchable}`);

await browser.close();
console.log(failed ? "\nFAILED" : "\nALL CHECKS PASSED");
process.exit(failed ? 1 : 0);
