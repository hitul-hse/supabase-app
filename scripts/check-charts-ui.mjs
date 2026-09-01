/**
 * The redesigned figures, verified on the deployed production site.
 *
 * The reported defects, each asserted by geometry or presence:
 *  1. The hero chart no longer leaves dead space: the figure fills most of its card.
 *  2. Chart variety exists: an area (SVG path with gradient), a donut, a gauge.
 *  3. The dashboard trend renders the area, not week-wide bar slabs.
 *  4. The interactions survived: focusable points with accessible names.
 */
import { launchChromium } from "./lib/launch-chromium.mjs";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "./lib/gate-env.mjs";

const env = loadEnv();
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.log("SKIP: need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(0);
}
const SITE = process.env.SITE ?? "https://hseportal.hs-experts.com";
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? `\n        ${detail}` : ""}`);
};

const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: "hitul@hs-experts.com" });
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const { data: verified } = await anon.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
const encoded = `base64-${Buffer.from(JSON.stringify({
  access_token: verified.session.access_token,
  refresh_token: verified.session.refresh_token,
  expires_at: verified.session.expires_at,
  expires_in: verified.session.expires_in,
  token_type: "bearer",
  user: verified.user,
})).toString("base64")}`;
const CHUNK = 3180;
const cookies = [];
for (let i = 0, n = 0; i < encoded.length; i += CHUNK, n += 1) {
  cookies.push({ name: `sb-${ref}-auth-token.${n}`, value: encoded.slice(i, i + CHUNK), domain: new URL(SITE).hostname, path: "/" });
}

const browser = await launchChromium();
const ctx = await browser.newContext({ viewport: { width: 1674, height: 971 } });
await ctx.addCookies(cookies);
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

try {
  // ── Overview ─────────────────────────────────────────────────────────
  await page.goto(`${SITE}/`, { waitUntil: "networkidle", timeout: 120_000 });
  await page.waitForTimeout(1200);
  const skip = page.locator('button:has-text("Skip tour")');
  if (await skip.count()) { await skip.first().click().catch(() => {}); await page.waitForTimeout(400); }

  // 1. The dead-space bug, by geometry: the figure's share of the hero card.
  const hero = await page.evaluate(() => {
    const card = [...document.querySelectorAll('[data-card="hero"]')][0];
    if (!card) return null;
    const svg = card.querySelector("svg");
    if (!svg) return { card: card.getBoundingClientRect().height, svg: 0 };
    return {
      card: Math.round(card.getBoundingClientRect().height),
      svg: Math.round(svg.getBoundingClientRect().height),
    };
  });
  check("the hero card renders an SVG figure", hero !== null && hero.svg > 0, JSON.stringify(hero));
  check(
    "the figure fills the card instead of leaving dead space (>=45% of card height)",
    hero !== null && hero.svg / hero.card >= 0.45,
    `svg ${hero?.svg}px of ${hero?.card}px card = ${hero ? Math.round((hero.svg / hero.card) * 100) : 0}% (the old bar strip was ~25%)`,
  );

  // 2. Chart variety, by presence of the three shapes.
  const shapes = await page.evaluate(() => ({
    gradients: document.querySelectorAll("svg linearGradient").length,
    // The donut: circles used as stroked arcs with a dasharray.
    donutArcs: [...document.querySelectorAll("svg circle")].filter((c) => c.getAttribute("stroke-dasharray")).length,
    // The gauge: an arc path with a rounded linecap.
    gaugePaths: [...document.querySelectorAll("svg path")].filter((p) => (p.getAttribute("d") ?? "").includes("A ")).length,
  }));
  check("an area gradient renders", shapes.gradients >= 1, `${shapes.gradients} gradient(s)`);
  check("a donut renders (stroked arc segments)", shapes.donutArcs >= 2, `${shapes.donutArcs} arc(s)`);
  check("a gauge renders (arc paths)", shapes.gaugePaths >= 2, `${shapes.gaugePaths} arc path(s)`);

  const bodyText = await page.locator("body").innerText();
  check("the donut states its centre figure", /%\s*\n?\s*BILLABLE/i.test(bodyText) || /BILLABLE SPLIT/i.test(bodyText));
  check("the gauge states its basis", /OF A 40H WEEK/i.test(bodyText));

  // 4. Keyboard reachability: focus a chart point and read the aria-label.
  const point = page.locator('[data-card="hero"] button[aria-label*="billable"]').first();
  check("chart points are focusable buttons with real names", (await point.count()) > 0,
    await point.getAttribute("aria-label").catch(() => "none"));

  // ── Dashboard trend ──────────────────────────────────────────────────
  await page.goto(`${SITE}/time/dashboard`, { waitUntil: "networkidle", timeout: 120_000 });
  await page.waitForTimeout(1200);
  const trend = await page.evaluate(() => {
    const fill = document.querySelector("#tt-trend-fill");
    const svg = fill?.closest("svg");
    return {
      hasGradient: Boolean(fill),
      paths: svg ? svg.querySelectorAll("path").length : 0,
    };
  });
  check("the dashboard trend renders the area figure", trend.hasGradient, JSON.stringify(trend));
  check("with the billable line, the total line and the fill", trend.paths >= 3, `${trend.paths} path(s)`);
  check(
    "the week-slab bars are gone",
    await page.evaluate(() => ![...document.querySelectorAll("section div")].some((d) => d.className.includes("items-end gap-[3px]"))),
  );

  check("no client-side errors on either page", errors.length === 0, errors.join(" | "));

  await page.screenshot({ path: "tmp-verify-charts.png" });
} finally {
  await browser.close();
}

console.log(failed === 0 ? "\nCHART REDESIGN: all checks passed" : `\n${failed} check(s) failed`);
process.exitCode = failed === 0 ? 0 : 1;
