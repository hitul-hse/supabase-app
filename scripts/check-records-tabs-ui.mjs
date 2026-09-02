/**
 * The tab row, in a real browser, on the deployed site.
 *
 * The source gate (check-records-tabs.mjs) proves the code says the right things. This
 * proves a person can see and use them -- which is the half that mattered in this
 * session, since the bug being fixed was a control that existed in the source and was
 * absent on screen.
 *
 * Deliberately checks the DEPLOYED build, because "present locally, missing in
 * production" is precisely the failure mode being closed out.
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

const sessionCookies = async (email) => {
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email });
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
  const out = [];
  for (let i = 0, n = 0; i < encoded.length; i += CHUNK, n += 1) {
    out.push({
      name: `sb-${ref}-auth-token.${n}`,
      value: encoded.slice(i, i + CHUNK),
      domain: new URL(SITE).hostname,
      path: "/",
    });
  }
  return out;
};

const browser = await launchChromium();

/**
 * Read the tab row: labels, which is selected, and whether it is genuinely visible.
 *
 * Waits for the row to have real height first. PageTransition (framer-motion) animates the
 * page subtree in, so an immediate measurement can catch it at height 0 with the ancestor
 * still at opacity 0.7 -- which happened on /timesheets and produced a failure that
 * described a working page. Measured: 0px immediately, 36px once settled.
 */
const readTabs = async (page) => {
  const list = page.locator('[role="tablist"][aria-label="Records view"]');
  try {
    // Playwright's visibility wait already requires a non-empty box, so this both
    // settles the animation and asserts the thing the check is about.
    await list.first().waitFor({ state: "visible", timeout: 20_000 });
  } catch {
    return null;
  }
  return page.evaluate(() => {
    const el = document.querySelector('[role="tablist"][aria-label="Records view"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      visible: r.height > 0 && r.width > 0,
      height: Math.round(r.height),
      tabs: [...el.querySelectorAll('[role="tab"]')].map((t) => ({
        label: (t.textContent ?? "").trim(),
        href: t.getAttribute("href"),
        selected: t.getAttribute("aria-selected") === "true",
      })),
    };
  });
};

try {
  // ── As an exec, who holds timesheets:read_all ────────────────────────
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addCookies(await sessionCookies("hitul@hs-experts.com"));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

  for (const [path, expectSelected] of [
    ["/timesheets", "Timesheets"],
    ["/time", "TrackingTime"],
    ["/time/dashboard", "TrackingTime Dashboard"],
  ]) {
    await page.goto(`${SITE}${path}`, { waitUntil: "networkidle", timeout: 120_000 });
    const t = await readTabs(page);
    check(`${path}: the tab row is present and visible`, Boolean(t?.visible), JSON.stringify(t?.tabs ?? null));
    if (!t) continue;

    check(
      `${path}: all three tabs are offered to an exec`,
      t.tabs.length === 3,
      t.tabs.map((x) => x.label).join(" | "),
    );
    const selected = t.tabs.filter((x) => x.selected);
    check(
      `${path}: exactly one tab is marked current`,
      selected.length === 1,
      `selected: ${selected.map((x) => x.label).join(", ") || "none"}`,
    );
    check(
      `${path}: the current tab is ${expectSelected}`,
      selected[0]?.label === expectSelected,
      `got ${selected[0]?.label ?? "none"}`,
    );
  }

  // The button must be gone from the dashboard header.
  await page.goto(`${SITE}/time/dashboard`, { waitUntil: "networkidle", timeout: 120_000 });
  const headerText = await page.locator("header").first().innerText();
  check(
    "the dashboard header no longer shows a My time tracker button",
    !/my time tracker/i.test(headerText),
    headerText.replace(/\s+/g, " ").slice(0, 120),
  );

  // And the tab must actually navigate -- the whole point of replacing the button.
  await page.locator('[role="tab"]:text-is("TrackingTime")').first().click();
  await page.waitForURL(/\/time(\?|$)/, { timeout: 60_000 });
  check("clicking the TrackingTime tab reaches the personal tracker", /\/time(\?|$)/.test(new URL(page.url()).pathname + (new URL(page.url()).search ? "?" : "")), page.url());
  const afterNav = await readTabs(page);
  check(
    "and the TrackingTime tab is then the current one",
    afterNav?.tabs.find((x) => x.selected)?.label === "TrackingTime",
    afterNav?.tabs.find((x) => x.selected)?.label ?? "none",
  );

  check("no client-side errors on any of the three surfaces", errors.length === 0, errors.join(" | "));
  await ctx.close();

  // ── As an employee, who does NOT hold timesheets:read_all ────────────
  // The dashboard tab must be absent: /time/dashboard redirects them back to /time, so
  // offering it would be a link that returns them to where they already are.
  const { data: empProfile } = await admin
    .from("app_user_profile").select("user_id").eq("role_key", "employee").eq("is_active", true).limit(1).maybeSingle();
  if (empProfile) {
    const { data: empUser } = await admin.auth.admin.getUserById(empProfile.user_id);
    const email = empUser?.user?.email;
    if (email) {
      const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      await ctx2.addCookies(await sessionCookies(email));
      const page2 = await ctx2.newPage();
      await page2.goto(`${SITE}/time`, { waitUntil: "networkidle", timeout: 120_000 });
      const t2 = await readTabs(page2);
      check(
        "an employee sees the tab row",
        Boolean(t2?.visible),
        JSON.stringify(t2?.tabs ?? null),
      );
      check(
        "and is NOT offered the dashboard tab they would be redirected away from",
        !(t2?.tabs ?? []).some((x) => x.label === "TrackingTime Dashboard"),
        (t2?.tabs ?? []).map((x) => x.label).join(" | "),
      );
      await ctx2.close();
    }
  } else {
    console.log("SKIP: no active employee to check the gated tab");
  }
} finally {
  await browser.close();
}

console.log(failed === 0 ? "\nRECORDS TABS UI: all checks passed" : `\n${failed} check(s) failed`);
process.exitCode = failed === 0 ? 0 : 1;
