/**
 * Do the SSO buttons render, and does clicking one behave correctly?
 *
 * Runs a real browser against a running server, so the assertions are about what
 * a visitor receives rather than what the source says.
 *
 * Two things are checked, and which one applies depends on the live project:
 *
 *  - If a provider is ENABLED, the outbound authorize request must name the right
 *    provider and its `redirect_to` must be our own /auth/callback rather than the
 *    destination page. Getting that wrong is the most common way an OAuth
 *    integration fails, and it fails silently: Supabase substitutes the Site URL
 *    and the code is lost.
 *
 *  - If a provider is DISABLED, the user must stay here and be told so. This is
 *    not hypothetical politeness: supabase-js builds the authorize URL
 *    client-side without validating it, so before this was handled the browser
 *    navigated to Supabase and displayed
 *      {"code":400,...,"msg":"Unsupported provider: provider is not enabled"}
 *    as the entire page, with no way back and no email form.
 *
 * The provider request is intercepted, so nothing leaves the machine and no real
 * consent screen is involved.
 *
 * NOT asserted here: the pending button label. supabase-js navigates in the same
 * tick, so the page is already leaving before React can paint it. The ordering
 * that makes it correct is asserted in check-oauth-callback.mjs instead.
 */
import { existsSync } from "node:fs";
import { launchChromium } from "./lib/launch-chromium.mjs";
import { record, notRun } from "./lib/gate-result.mjs";

if (!existsSync(".next")) {
  console.log("SKIP: no production build — run `npm run build` first");
  notRun();
}

const BASE = process.env.SSO_UI_BASE ?? "http://localhost:3000";

// The server must already be running; starting one here would double-bind the
// port when this is run alongside the other live checks.
let reachable = false;
for (let i = 0; i < 10; i++) {
  try {
    await fetch(`${BASE}/auth/login`);
    reachable = true;
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 500));
  }
}
if (!reachable) {
  console.log(`SKIP: nothing serving ${BASE} — start it with \`npm run start\``);
  notRun();
}

let failed = false;
const check = (name, ok, detail = "") => {
  record(ok);
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed = true;
};

// Not a bare chromium.launch(): on this rig the default compositor's frame
// clock is erratic, and Playwright cannot click without one. See
// scripts/lib/launch-chromium.mjs for the measurements.
const browser = await launchChromium();

/**
 * Click a provider button and report what happened.
 *
 * Returns the authorize URL the app built, whether the browser was left on our
 * own page, and the visible text afterwards. A fresh page per case, because a
 * successful click navigates away.
 *
 * The route is fulfilled with a 400 that mimics a disabled provider rather than
 * aborted: an aborted request produces a network error the app cannot classify,
 * whereas this exercises the real branch and keeps the page mounted so its text
 * is readable. Either way nothing reaches Google or Microsoft.
 */
async function capture(buttonText, loginPath = "/auth/login") {
  const page = await browser.newPage();
  let captured = null;
  const offSite = [];
  page.on("framenavigated", (f) => {
    if (f === page.mainFrame() && !f.url().startsWith(BASE)) offSite.push(f.url());
  });

  await page.route("**/auth/v1/authorize*", async (route) => {
    captured ??= route.request().url();
    await route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({
        code: 400,
        error_code: "validation_failed",
        msg: "Unsupported provider: provider is not enabled",
      }),
    });
  });

  await page.goto(BASE + loginPath, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(`button:has-text("${buttonText}")`, { timeout: 20000 });
  await page.locator("button", { hasText: buttonText }).first().click({ noWaitAfter: true });

  // Wait for either the notice to appear or the request to be seen.
  let bodyText = "";
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(150);
    try {
      bodyText = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    } catch {
      break; // navigated away
    }
    if (/switched on/i.test(bodyText)) break;
  }

  const stayed = page.url().startsWith(BASE);
  await page.close();
  return { url: captured, bodyText, stayed, offSite };
}

// ── What the visitor sees ──────────────────────────────────────────────────
const first = await capture("Continue with Google");
const t = first.bodyText;

check("the Google button is rendered", t.includes("Continue with Google"));

/**
 * Microsoft was REMOVED from the product on 2026-09-08 (board ticket 37), so this
 * is now an unconditional assertion rather than one half of a flag.
 *
 * It is kept, not deleted, and the reason is the same one that made it conditional
 * before: the regression worth catching is a build that offers a provider nobody
 * finished. The old version could only catch that while the flag existed. Now the
 * flag is gone, so "Continue with Microsoft" appearing on this page at all means
 * either the removal was reverted without a decision, or a stale build is being
 * served — and both are worth a red gate.
 */
check(
  "the Microsoft button is absent",
  !t.includes("Continue with Microsoft"),
  "Microsoft sign-in was removed from the product; the page must not offer it",
);
check("the email/password form is still offered", t.includes("Password"));
check("a divider separates SSO from email sign-in", t.includes("OR WITH EMAIL"));
check(
  "the page explains that a role must be assigned before data is visible",
  /role assigned/i.test(t),
);

// ── A disabled provider is explained here, not shown as raw JSON ───────────
check("a disabled provider leaves the visitor on our login page", first.stayed);
check(
  "the browser never lands on Supabase's error document",
  first.offSite.length === 0,
  first.offSite.join(" ") || "no off-site navigation",
);
check(
  "the notice is plain English and names the provider",
  /Google sign-in isn't switched on for this app yet/.test(t),
);
check("the notice points at the email fallback", /email and password below/i.test(t));
check(
  "the raw \"Unsupported provider\" string is not shown to the user",
  !/Unsupported provider/i.test(t),
);

// ── The outbound flow ──────────────────────────────────────────────────────
check("clicking Google builds an authorize request", first.url !== null, first.url ?? "none seen");

if (first.url) {
  const u = new URL(first.url);
  check("provider=google", u.searchParams.get("provider") === "google");

  const rt = u.searchParams.get("redirect_to") ?? "";
  check("redirect_to targets /auth/callback, not the destination page", rt.includes("/auth/callback"), rt);
  check("redirect_to is same-origin", rt.startsWith(BASE + "/"), rt);
  check("the destination rides along as next=", /next=/.test(rt), rt);

  // PKCE, not implicit: the code challenge must be present, or the callback's
  // exchangeCodeForSession has nothing to exchange.
  check("the flow is PKCE (code_challenge present)", u.searchParams.has("code_challenge"));
  check("the challenge method is s256", u.searchParams.get("code_challenge_method") === "s256");
}

// The Microsoft authorize-wiring checks that used to live here went with the
// provider on 2026-09-08. There is no button to click, so there is nothing to
// assert about where it leads; the assertion that matters now is the absence
// check above, which runs on every build rather than only when a flag was set.

// ── The destination is carried, and cannot be hijacked ─────────────────────
const withNext = await capture("Continue with Google", "/auth/login?redirect_to=%2Ftime");
// The block below is guarded on the capture, so without this line an
// unobserved authorize request would skip every redirect_to assertion and the
// gate would still print a green summary. Absence is a failure, not a pass.
check(
  "clicking Google with a same-site redirect_to builds an authorize request",
  withNext.url !== null,
  withNext.url ?? "no authorize request observed within the poll window, so the next= forwarding was NOT checked",
);
if (withNext.url) {
  const rt = new URL(withNext.url).searchParams.get("redirect_to") ?? "";
  check(
    "a same-site redirect_to is forwarded as next=/time",
    /next=(%2F|\/)time/.test(rt),
    rt,
  );
}

// The login page's safeRedirect() must neutralise this before it can reach the
// callback, so the post-authentication redirect cannot be aimed off-site.
const hostile = await capture("Continue with Google", "/auth/login?redirect_to=https%3A%2F%2Fevil.com");
check(
  "clicking Google with a hostile redirect_to builds an authorize request",
  hostile.url !== null,
  hostile.url ?? "no authorize request observed within the poll window, so the open-redirect defence was NOT checked",
);
if (hostile.url) {
  const rt = new URL(hostile.url).searchParams.get("redirect_to") ?? "";
  check("a hostile redirect_to never reaches the provider", !rt.includes("evil.com"), rt);
  check("it falls back to the app root", /next=(%2F|\/)($|&)/.test(rt), rt);
}

await browser.close();

console.log(
  failed
    ? "\nSSO UI: the buttons are not wired correctly"
    : "\nSSO UI: buttons render and start a correct, same-origin PKCE flow",
);
process.exit(failed ? 1 : 0);
