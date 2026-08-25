// `translate-y-full` is on the element yet getComputedStyle reports
// transform: none. Find out why rather than working around it: if the sheet is
// genuinely not translating, it is sitting at its open position and hidden ONLY
// by pointer-events, which means any future change that drops that class puts an
// invisible panel back over the tab bar.
//
// Two candidates: (a) `inert` suppressing it, (b) Tailwind v4 needing the
// translate utility paired with a transform, as with the shadow bug this
// codebase already hit once.
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const SB = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const SITE = "http://localhost:3000";

const r = await fetch(`${SB}/auth/v1/admin/generate_link`, {
  method: "POST",
  headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" },
  body: JSON.stringify({ type: "magiclink", email: "mathias@hs-experts.com", options: { redirect_to: `${SITE}/auth/callback` } }),
});
const b = await r.json();

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
await page.goto(`${SITE}/auth/callback?token_hash=${b?.properties?.hashed_token ?? b?.hashed_token}&type=magiclink&next=%2Fmy-work`, { waitUntil: "networkidle", timeout: 120000 });
await page.waitForTimeout(1200);

const d = await page.evaluate(() => {
  const s = document.querySelector('[data-testid="mobile-sheet"]');
  const cs = getComputedStyle(s);
  const out = {
    classes: s.className.split(" ").filter((c) => /translate|transform|pointer/.test(c)),
    transform: cs.transform,
    translate: cs.translate,
    hasInert: s.hasAttribute("inert"),
    ariaHidden: s.getAttribute("aria-hidden"),
    top: Math.round(s.getBoundingClientRect().top),
  };

  // Does removing inert bring the transform back?
  s.removeAttribute("inert");
  const cs2 = getComputedStyle(s);
  out.transformWithoutInert = cs2.transform;
  out.topWithoutInert = Math.round(s.getBoundingClientRect().top);

  // Is the utility emitting a rule at all? Check the raw declaration.
  const sheetRules = [];
  for (const ss of document.styleSheets) {
    try {
      for (const rule of ss.cssRules) {
        if (rule.selectorText && /translate-y-full/.test(rule.selectorText)) sheetRules.push(rule.cssText.slice(0, 120));
      }
    } catch {}
  }
  out.rulesForTranslateYFull = sheetRules.slice(0, 3);
  return out;
});

console.log(JSON.stringify(d, null, 2));
await browser.close();
