/**
 * No page grows without bound, and paging does not make it taller.
 *
 * THE REPORTED BUG. Projects rendered ~30 rows with a "Show 30 more" that APPENDED, plus a
 * "Show all" beside it. Every click made the document longer, so the reader had to scroll
 * further to reach the control and scroll further again after using it. Measured against
 * live data the ledger is 334 projects, about 13 screens fully expanded.
 *
 * WHY THIS IS MEASURED IN PIXELS, not by looking for a class or a component. The complaint
 * is about the height of a document, so the assertion has to be the height of the document.
 * A source check would pass on a pager that renders correctly and still lets the page grow.
 *
 * WHAT IS ASSERTED
 *   1. Each long surface starts within a sane number of screens.
 *   2. Advancing a page does NOT increase document height -- the property the old control
 *      violated, and the one that actually matters.
 *   3. Advancing a page CHANGES the rows, so the pager is not inert. A pager that keeps the
 *      height constant by doing nothing would satisfy (2) on its own.
 *   4. The reader is told where they are, so a fixed-height list does not read as a
 *      truncated one.
 */
import { readFileSync } from "node:fs";
import { launchChromium } from "./lib/launch-chromium.mjs";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const SITE = process.env.SITE ?? "https://hseportal.hs-experts.com";
if (!env.SUPABASE_SERVICE_ROLE_KEY) { console.log("SKIP: no service-role key"); process.exit(0); }

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

const VIEWPORT_H = 900;
/**
 * The ceiling, in screens.
 *
 * Six is deliberately generous: these pages carry a header, a filter row, KPI tiles and a
 * chart before any rows, and the point is to catch unbounded growth rather than to police
 * layout. The ledger measured about 13 screens before this work.
 */
const MAX_SCREENS = 6;

const browser = await launchChromium();
const ctx = await browser.newContext({ viewport: { width: 1440, height: VIEWPORT_H } });
await ctx.addCookies(cookies);
const page = await ctx.newPage();

const docHeight = () => page.evaluate(() => document.documentElement.scrollHeight);
/**
 * A fingerprint of the rows currently rendered, to prove a page change did something.
 *
 * Deliberately generic: the first version fingerprinted only /projects/ links, which is
 * empty on the People and dashboard surfaces -- so before === after ("" === "") and the
 * check failed while the pager was working. It now hashes the visible text of the row-like
 * elements each surface actually renders.
 */
const rowFingerprint = () =>
  page.evaluate(() => {
    /*
     * PREFER AN EXPLICIT ROW HOOK. The generic selector below matches every
     * link to a project route -- and on /projects the FIRST TEN of those are
     * inside the "Where the hours go" insight card, five panels above the
     * ledger, whose content correctly does not change when the ledger pages.
     * Measured against production: the readout advanced from "1-30 OF 334" to
     * "31-60 OF 334" while this fingerprint stayed byte-identical, so the check
     * reported an inert pager on a working one.
     *
     * Surfaces that mark their paged rows (data-ledger-row) are fingerprinted
     * on those alone. The others keep the generic selector.
     */
    const hooked = [...document.querySelectorAll("[data-ledger-row]")];
    const candidates = hooked.length
      ? hooked
      : [
          ...document.querySelectorAll(
            'a[href^="/projects/"], a[href^="/time/dashboard?"], tbody tr, [data-task-row], button[class*="border-l-2"]',
          ),
        ];
    return candidates
      .slice(0, 10)
      .map((el) => (el.textContent ?? "").trim().slice(0, 60))
      .filter(Boolean)
      .join("|");
  });

try {
  for (const { path, label } of [
    { path: "/projects", label: "Projects ledger (334 rows)" },
    { path: "/people", label: "People directory" },
    { path: "/time/dashboard?preset=this_month&group=project", label: "Dashboard grouped by project" },
  ]) {
    await page.goto(`${SITE}${path}`, { waitUntil: "networkidle", timeout: 120_000 });
    await page.waitForTimeout(1200);

    const initial = await docHeight();
    check(
      `${label}: opens within ${MAX_SCREENS} screens`,
      initial <= VIEWPORT_H * MAX_SCREENS,
      `${initial}px = ${(initial / VIEWPORT_H).toFixed(1)} screens`,
    );

    // The count line, so a fixed-height list is not mistaken for a truncated one.
    const body = await page.locator("body").innerText();
    check(
      `${label}: states what is on screen out of the total`,
      /\d+[–-]\d+ OF [\d,]+|ALL [\d,]+|\d+ \/ \d+/i.test(body),
      (body.match(/\d+[–-]\d+ OF [\d,]+[A-Z ]*/i) ?? body.match(/\d+ \/ \d+/) ?? ["not found"])[0],
    );

    // Advancing a page must not make the document taller, and must change the rows.
    const next = page.getByRole("button", { name: /\bNEXT\b/ }).first();
    if ((await next.count()) > 0 && await next.isEnabled()) {
      const before = await rowFingerprint();
      await next.click();
      await page.waitForTimeout(900);
      const after = await docHeight();
      const afterRows = await rowFingerprint();

      check(
        `${label}: advancing a page does NOT make the document taller`,
        after <= initial + 40,
        `${initial}px -> ${after}px (the old control appended rows and grew the page)`,
      );
      check(
        `${label}: advancing a page actually changes the rows`,
        before !== afterRows && afterRows.length > 0,
        "a pager that keeps the height constant by doing nothing would pass the check above",
      );
    } else {
      console.log(`SKIP: ${label} has only one page at this size`);
    }
  }

  // The specific control the user objected to must be gone.
  await page.goto(`${SITE}/projects`, { waitUntil: "networkidle", timeout: 120_000 });
  await page.waitForTimeout(800);
  const projectsBody = await page.locator("body").innerText();
  check(
    "Projects no longer offers an appending 'Show N more'",
    !/show \d+ more/i.test(projectsBody),
    (projectsBody.match(/show \d+ more/i) ?? ["absent"])[0],
  );

  // ALL must still be reachable: some readers want one long list on purpose.
  const allBtn = page.locator('button:text-is("ALL")').first();
  check("but ALL is still offered for anyone who wants the whole list", (await allBtn.count()) > 0);
} finally {
  await browser.close();
}

console.log(failed === 0 ? "\nPAGE LENGTH: all checks passed" : `\n${failed} check(s) failed`);
process.exitCode = failed === 0 ? 0 : 1;
