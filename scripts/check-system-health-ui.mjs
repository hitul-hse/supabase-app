/**
 * The developer health portal must tell the truth, at a glance, on a phone.
 *
 * WHY THIS GATE EXISTS. /admin/system-health is the page people open when they
 * suspect something else on the site is lying to them (see the page's own
 * doc-comment). A health page that itself renders "NaN", silently redirects
 * to /auth/login, throws a console error nobody notices, or shows a drill-down
 * whose rows do not add up to the headline is the single worst failure mode
 * this app has -- it is exactly the surface where nobody double-checks.
 *
 * WHAT IS ASSERTED, per viewport (1280x900 desktop, 375x812 phone):
 *   1. The page loads (HTTP 200) without a bounce to /auth/login.
 *   2. Every data-section the page is supposed to draw is present.
 *   3. No literal "NaN" / "undefined" / "[object Object]" / "Infinity" leaks
 *      into rendered text -- the exact symptom of a number computed on bad input.
 *   4. No page error and no unexpected console error fired.
 *   5. No horizontal scroll (a fixed-width chart or a long query string
 *      overflowing the viewport reads as broken, not "just wide").
 *   6. The page fits DESIGN.md rule 8's 3-screen budget at 1280 -- reported as
 *      a number, not a class name, because the original complaint was pixels.
 *   7. n/a HONESTY: every "n/a" is followed by a reason (the "n/a — text"
 *      pattern from src/app/(app)/admin/system-health/bits.tsx's Reason
 *      component) -- a bare "n/a" is a dead end. And the reverse: a tile that
 *      shows a real number must not ALSO claim n/a, which would be a
 *      contradiction nobody could resolve by looking harder.
 *   8. DRILL RECONCILIATION, the one law of src/components/DrillDialog.tsx:
 *      every [data-drill-trigger]'s rows must sum, count, or average to the
 *      headline it opened from, walking every page. A drill that cannot
 *      reconcile itself is decoration, not evidence.
 *
 * WHY A REAL BROWSER SESSION. Every figure on this page is server-rendered
 * per request behind requirePermission(ADMIN_ROLES_WRITE) -- there is no
 * public fixture to hit. This logs in as the review account exactly the way
 * a developer would, then reads the DOM the way a reader does.
 *
 * Run: BASE=https://... npm run check:system-health-ui (or against the local
 * dev server, the default below).
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { launchChromium } from "./lib/launch-chromium.mjs";

const BASE = process.env.BASE ?? "http://localhost:3002";
const PATH_UNDER_TEST = "/admin/system-health";
const EMAIL = process.env.REVIEW_EMAIL;
const PASSWORD = process.env.REVIEW_PW;
if (!EMAIL || !PASSWORD) {
  console.error(
    "FAIL: REVIEW_EMAIL and REVIEW_PW must be set (the local runner sources ~/.night-shift/env.sh). " +
      "Refusing to guess a login -- this gate never prints the password.",
  );
  process.exit(2);
}
const OUT = process.env.OUT ?? fs.mkdtempSync(path.join(os.tmpdir(), "check-system-health-ui-"));
fs.mkdirSync(OUT, { recursive: true });

/** The fixed data-section ids the page is documented to draw (page.tsx + the five panels). */
const REQUIRED_SECTIONS = ["score", "freshness", "efficiency", "security", "consumption"];

/** DESIGN.md rule 8: "No page exceeds 3 screens on first load." Measured at 1280, the desktop viewport. */
const MAX_SCREENS_AT_1280 = 3;

/**
 * Known, harmless noise from the Next.js dev overlay / dev-mode React, never
 * from this page's own code. Kept as an explicit, justified allowlist rather
 * than "ignore everything with 'warning' in it", so a real regression here
 * still fails the gate. Empty today -- a clean run needs nothing on it, and
 * anything added later must say why in this comment.
 */
const ALLOWED_CONSOLE_PATTERNS = [];

let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? `\n        ${detail}` : ""}`);
};

const VIEWPORTS = [
  { name: "1280x900", width: 1280, height: 900 },
  { name: "375x812", width: 375, height: 812 },
];

const browser = await launchChromium();
const ctx = await browser.newContext();
// Set once, before any script on any page runs, so the onboarding tour never
// mounts and never has to be raced with a click.
await ctx.addInitScript(() => window.localStorage.setItem("hse_tour_done", "1"));
const page = await ctx.newPage();

const drillTable = [];

try {
  // ─── Log in as the review account ─────────────────────────────────────────
  await page.goto(`${BASE}/auth/login`, { waitUntil: "networkidle", timeout: 60_000 });
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.press("#password", "Enter");
  await page.waitForURL((u) => !u.pathname.startsWith("/auth/login"), { timeout: 30_000 });
  check("logged in as the review account", true);

  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });

    const errors = [];
    const onPageError = (e) => errors.push(`pageerror: ${e}`);
    const onConsole = (m) => {
      if (m.type() === "error") errors.push(`console: ${m.text()}`);
    };
    page.on("pageerror", onPageError);
    page.on("console", onConsole);

    const response = await page.goto(`${BASE}${PATH_UNDER_TEST}`, { waitUntil: "networkidle", timeout: 60_000 });
    await page.waitForTimeout(800); // settle the stagger-in animation before measuring

    check(`${vp.name}: HTTP 200`, response !== null && response.status() === 200, `status ${response?.status()}`);
    check(
      `${vp.name}: did not redirect to /auth/login`,
      !new URL(page.url()).pathname.startsWith("/auth/login"),
      page.url(),
    );

    const sectionIds = await page.$$eval("[data-section]", (els) => els.map((e) => e.getAttribute("data-section")));
    const missingSections = REQUIRED_SECTIONS.filter((s) => !sectionIds.includes(s));
    check(
      `${vp.name}: every required data-section is present`,
      missingSections.length === 0,
      missingSections.length ? `missing: ${missingSections.join(", ")}` : sectionIds.join(", "),
    );

    const mainText = await page.evaluate(() => document.querySelector("main")?.innerText ?? document.body.innerText);
    for (const bad of ["NaN", "undefined", "[object Object]", "Infinity"]) {
      check(`${vp.name}: main text contains no "${bad}"`, !mainText.includes(bad));
    }

    const unexpected = errors.filter((e) => !ALLOWED_CONSOLE_PATTERNS.some((re) => re.test(e)));
    check(
      `${vp.name}: no page errors or unexpected console errors`,
      unexpected.length === 0,
      unexpected.slice(0, 5).join(" | "),
    );

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    check(`${vp.name}: no horizontal page scroll`, scrollWidth <= clientWidth + 1, `${scrollWidth}px vs ${clientWidth}px`);

    if (vp.width === 1280) {
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      const screens = height / vp.height;
      check(
        `${vp.name}: page fits the ${MAX_SCREENS_AT_1280}-screen budget (DESIGN.md rule 8)`,
        screens <= MAX_SCREENS_AT_1280,
        `${height}px = ${screens.toFixed(2)} screens`,
      );
    }

    // ─── n/a honesty ─────────────────────────────────────────────────────────
    // Every line carrying a bare "n/a" must also carry its reason on that same
    // line, in the house "n/a — reason" shape (bits.tsx's Reason component).
    const bareNa = mainText
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && /n\/a/i.test(l) && !/n\/a\s*[—-]\s*\S/i.test(l));
    check(`${vp.name}: every "n/a" states a reason on the same line`, bareNa.length === 0, bareNa.slice(0, 8).join(" | "));

    // The reverse: a tile that shows a real figure must not also say a BARE
    // n/a. An "n/a — reason" inside a tile describes a sub-figure (the DB
    // round-trip tile carries its live value beside "n/a — no history on this
    // host" on Vercel) and is the honest shape, not a contradiction.
    const contradictions = await page.$$eval("[data-metric]", (els) =>
      els
        .map((e) => ({ id: e.getAttribute("data-metric"), text: (e.textContent ?? "").trim() }))
        .filter((t) => /n\/a(?!\s*[—-]\s*\S)/i.test(t.text) && /\d/.test(t.text.replace(/n\/a/gi, "")))
        .map((t) => `${t.id}: "${t.text.slice(0, 80)}"`),
    );
    check(`${vp.name}: no data-metric tile shows both a value and n/a`, contradictions.length === 0, contradictions.join(" | "));

    // ─── Screenshots ───────────────────────────────────────────────────────
    await page.screenshot({ path: `${OUT}/full-${vp.name}.png`, fullPage: true, animations: "disabled", timeout: 60_000 });
    console.log(`      wrote ${OUT}/full-${vp.name}.png`);
    for (const id of sectionIds) {
      const el = page.locator(`[data-section="${id}"]`).first();
      await el.scrollIntoViewIfNeeded();
      await page.waitForTimeout(200);
      await el.screenshot({ path: `${OUT}/${id}-${vp.name}.png`, animations: "disabled", timeout: 60_000 }).catch(() => {});
      console.log(`      wrote ${OUT}/${id}-${vp.name}.png`);
    }

    page.off("pageerror", onPageError);
    page.off("console", onConsole);
  }

  // ─── Drill reconciliation, once, at 1280 ────────────────────────────────
  // DrillDialog's one law: the rows carry the same relation the headline
  // claims (data-check: sum/count/mean), walked across every page.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE}${PATH_UNDER_TEST}`, { waitUntil: "networkidle", timeout: 60_000 });
  await page.waitForTimeout(800);

  const triggerCount = await page.locator("[data-drill-trigger]").count();
  check("at least one [data-drill-trigger] found on the page", triggerCount > 0, `${triggerCount} trigger(s)`);

  for (let i = 0; i < triggerCount; i += 1) {
    const trigger = page.locator("[data-drill-trigger]").nth(i);
    const triggerId = (await trigger.getAttribute("data-drill-trigger")) ?? `#${i}`;
    await trigger.scrollIntoViewIfNeeded();
    await trigger.click({ timeout: 15_000 });

    const dialog = page.locator("[data-drill-dialog]");
    await dialog.waitFor({ state: "visible", timeout: 15_000 });

    const checkKind = await dialog.getAttribute("data-check");
    const headlineAttr = await dialog.locator("[data-drill-headline]").getAttribute("data-value");
    const headlineValue = headlineAttr === null || headlineAttr === "" ? null : Number(headlineAttr);

    let rowValues = [];
    let pages = 1;
    if (checkKind && headlineValue !== null && !Number.isNaN(headlineValue)) {
      // Walk every page of rows via [data-drill-next], collecting [data-drill-row].
      for (;;) {
        const pageRows = await dialog.locator("[data-drill-row]").evaluateAll((els) =>
          els.map((e) => Number(e.getAttribute("data-value"))),
        );
        rowValues.push(...pageRows);
        const next = dialog.locator("[data-drill-next]");
        if ((await next.count()) === 0) break;
        if (!(await next.isEnabled())) break;
        // Wait for the pager to actually advance before reading rows again: a
        // fixed sleep re-read page 1 twice on a busy rig and double-counted.
        const before = await dialog.locator("[data-drill-page]").getAttribute("data-drill-page");
        await next.click({ timeout: 10_000 });
        await dialog.locator(`[data-drill-page]:not([data-drill-page="${before}"])`).waitFor({ timeout: 10_000 });
        pages += 1;
      }
    }

    let ok;
    let detail;
    if (!checkKind || headlineValue === null || Number.isNaN(headlineValue)) {
      ok = "SKIP";
      detail = "n/a drill (no check/headline to reconcile)";
    } else if (checkKind === "count") {
      ok = rowValues.length === headlineValue;
      detail = `${rowValues.length} rows vs headline ${headlineValue}`;
    } else if (checkKind === "mean") {
      const mean = rowValues.length ? rowValues.reduce((a, b) => a + b, 0) / rowValues.length : NaN;
      ok = Math.abs(mean - headlineValue) <= 0.5;
      detail = `mean(rows)=${mean.toFixed(2)} vs headline ${headlineValue}`;
    } else {
      // "sum" (also the default for anything unrecognised, so a typo in a
      // future drill's `check` still gets reconciled rather than skipped).
      const sum = rowValues.reduce((a, b) => a + b, 0);
      ok = Math.abs(sum - headlineValue) <= 0.5;
      detail = `sum(rows)=${sum.toFixed(2)} vs headline ${headlineValue}`;
    }

    if (ok !== "SKIP") check(`drill "${triggerId}" (${checkKind}): rows reconcile with the headline`, ok, detail);
    else console.log(`SKIP: drill "${triggerId}" -- ${detail}`);

    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden", timeout: 5_000 });
    check(`drill "${triggerId}": Escape closes the dialog`, true);

    drillTable.push({
      trigger: triggerId,
      check: checkKind ?? "(none)",
      headline: headlineValue ?? "n/a",
      rows: rowValues.length,
      pages,
      ok: ok === "SKIP" ? "SKIP" : ok ? "OK" : "FAIL",
    });
  }
} finally {
  await browser.close();
}

// ─── Report ─────────────────────────────────────────────────────────────────
console.log("\nDRILL RECONCILIATION");
console.log("trigger".padEnd(28) + "check".padEnd(8) + "headline".padEnd(12) + "rows".padEnd(6) + "pages".padEnd(7) + "ok");
for (const r of drillTable) {
  console.log(
    String(r.trigger).padEnd(28) +
      String(r.check).padEnd(8) +
      String(r.headline).padEnd(12) +
      String(r.rows).padEnd(6) +
      String(r.pages).padEnd(7) +
      r.ok,
  );
}

console.log(`\nScreenshots: ${OUT}`);
console.log(failed === 0 ? "\nSYSTEM HEALTH UI: all checks passed" : `\n${failed} check(s) failed`);
process.exitCode = failed === 0 ? 0 : 1;
