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
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
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

  const more = page.locator('button:has-text("SHOW ")').filter({ hasText: "MORE" }).first();
  check("a SHOW n MORE control is offered", (await more.count()) > 0, await more.innerText().catch(() => "absent"));

  await more.click();
  await page.waitForTimeout(600);
  const expanded = await rosterCount();
  check("expanding reveals the rest of the roster", expanded === 19, `rendered ${expanded} rows after expanding`);

  const fewer = page.locator('button:has-text("SHOW FEWER")').first();
  check("SHOW FEWER is offered once expanded", (await fewer.count()) > 0);
  await fewer.click();
  await page.waitForTimeout(500);
  check("collapsing returns to ten", (await rosterCount()) === 10);

  // Searching must reset the page, or a match could sit outside the first ten.
  await more.click();
  await page.waitForTimeout(400);
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
