/**
 * Verify both reported UI fixes in a real browser, against production.
 *
 *  1. /people -- the roster column shows ten people, not all nineteen, with a
 *     working way to see the rest.
 *  2. /time/dashboard -- the filter bar scrolls away instead of staying parked.
 *
 * Geometry and rendered text, not class names: `sticky` does nothing inside an
 * `overflow: hidden` ancestor, and a class list proves nothing about what a person
 * actually sees.
 */
import { chromium } from "playwright";
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
  cookies.push({ name: `sb-${ref}-auth-token.${n}`, value: encoded.slice(i, i + CHUNK) });
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addCookies(cookies.map((c) => ({ ...c, domain: new URL(SITE).hostname, path: "/" })));
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

try {
  // ── 1. The people list ────────────────────────────────────────────────
  await page.goto(`${SITE}/people`, { waitUntil: "networkidle", timeout: 90_000 });

  // Count roster rows by their distinguishing shape: a button whose text ENDS in a
  // percentage or "n/a" (the billable cell). Scoped by climbing from the search box
  // rather than from the "People" heading -- my first attempt guessed at the
  // heading's ancestor depth and silently returned 0, which reads like a broken
  // page rather than a broken selector.
  const rosterCount = async () =>
    await page.evaluate(() => {
      const input = document.querySelector('input[placeholder*="Search name"]');
      let column = input?.parentElement ?? null;
      // Climb until the subtree contains several candidate rows: that is the column.
      const rowsIn = (el) =>
        [...el.querySelectorAll("button")].filter((b) => /(\d+%|n\/a)$/.test((b.textContent ?? "").trim()));
      while (column && rowsIn(column).length === 0 && column !== document.body) {
        column = column.parentElement;
      }
      return column ? rowsIn(column).length : -1;
    });

  const shown = await rosterCount();
  check("the roster shows ten people, not the whole list", shown === 10, `rendered ${shown} rows`);

  const countLabel = await page
    .locator('span:text-matches("^\\\\d+ OF \\\\d+")').first().innerText().catch(() => "(not found)");
  check("the count states what is visible over the total", /^10 OF 19/.test(countLabel), `label reads "${countLabel}"`);

  /*
   * PAGED, NOT APPENDED -- and this check used to demand the opposite.
   *
   * The roster's first fix WAS a SHOW n MORE control. The user reported that
   * shape as the problem on Projects (clicking it grows the document, so the
   * control moves away from you), so it was replaced by the shared fixed-height
   * Pager, and check-page-length.mjs now asserts that no appending "Show N
   * more" survives anywhere. This check kept demanding the deleted control, so
   * two gates contradicted each other and this one failed on correct
   * behaviour.
   *
   * The property is the same as before: the reader must be able to reach the
   * rest of the roster, and the column must not grow while they do it.
   */
  const appending = page.locator('button:has-text("SHOW ")').filter({ hasText: "MORE" });
  check(
    "no appending SHOW n MORE control survives (it grows the document)",
    (await appending.count()) === 0,
    await appending.first().innerText().catch(() => "absent"),
  );

  const next = page.locator('button:text-is("NEXT →")').first();
  check("a NEXT control is offered to reach the rest of the roster", (await next.count()) > 0);

  const columnHeightBefore = await page.evaluate(() => {
    const input = document.querySelector('input[placeholder*="Search name"]');
    let column = input?.parentElement ?? null;
    while (column && column !== document.body && column.clientHeight < 200) column = column.parentElement;
    return column?.clientHeight ?? -1;
  });

  await next.click();
  await page.waitForTimeout(700);

  const afterPage = await rosterCount();
  check(
    "advancing shows the remaining people (19 total, so page 2 holds 9)",
    afterPage === 9,
    `rendered ${afterPage} rows on page 2`,
  );
  const columnHeightAfter = await page.evaluate(() => {
    const input = document.querySelector('input[placeholder*="Search name"]');
    let column = input?.parentElement ?? null;
    while (column && column !== document.body && column.clientHeight < 200) column = column.parentElement;
    return column?.clientHeight ?? -1;
  });
  check(
    "paging does not grow the roster column",
    columnHeightAfter <= columnHeightBefore + 40,
    `${columnHeightBefore}px -> ${columnHeightAfter}px`,
  );

  const prev = page.locator('button:text-is("← PREV")').first();
  check("PREV is offered once past page 1", (await prev.count()) > 0);
  await prev.click();
  await page.waitForTimeout(600);
  check("returning to page 1 shows ten again", (await rosterCount()) === 10);

  /*
   * Searching must RESET TO PAGE ONE. Driven from page 2 deliberately: that is
   * the case PeopleDirectory's pager reset key exists for ("searching while on
   * page 2 could leave you looking at an empty column when the match is on
   * page 1"), and it is the only arrangement where a missing reset is visible.
   */
  await next.click();
  await page.waitForTimeout(600);
  await page.getByPlaceholder(/Search name/i).fill("stephan");
  await page.waitForTimeout(700);
  const searched = await rosterCount();
  const searchLabel = await page.locator('span:text-matches("^\\\\d+ OF \\\\d+")').first().innerText();
  check(
    "searching narrows the list and the count agrees",
    searched > 0 && searched <= 10 && searchLabel.startsWith(`${searched} OF ${searched}`),
    `${searched} rows, label "${searchLabel}"`,
  );

  // ── 2. The dashboard filter bar ──────────────────────────────────────
  await page.goto(`${SITE}/time/dashboard?preset=this_month&group=project`, {
    waitUntil: "networkidle",
    timeout: 90_000,
  });
  const box = async () =>
    await page.evaluate(() => {
      const el = document.querySelector('[data-filter-bar="1"]');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height) };
    });

  const atTop = await box();
  check("the filter bar is present and visible at the top", atTop !== null && atTop.bottom > 0, JSON.stringify(atTop));

  await page.evaluate(() => window.scrollTo(0, 1600));
  await page.waitForTimeout(600);
  const afterScroll = await box();
  check(
    "the filter bar scrolls away instead of covering the page",
    afterScroll !== null && afterScroll.bottom <= 0,
    `after a 1600px scroll: ${JSON.stringify(afterScroll)} (bottom must be <= 0)`,
  );

  // And it comes back, so the filters are not lost -- just not permanent.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
  const backAtTop = await box();
  check("scrolling back up returns the filters", backAtTop !== null && backAtTop.bottom > 0, JSON.stringify(backAtTop));

  check("no client-side errors on either page", errors.length === 0, errors.join(" | "));
  await page.screenshot({ path: "tmp-verify-fixes.png", fullPage: false });
} finally {
  await browser.close();
}

console.log(failed === 0 ? "\nUI FIXES: all checks passed" : `\n${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
