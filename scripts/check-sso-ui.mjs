/**
 * Do the SSO buttons render, and does clicking one start a correct OAuth flow?
 *
 * Runs a real browser against `npm run start`, so the assertions are about what a
 * visitor receives rather than what the source says. The valuable part is the
 * outbound authorize request: it must name the right provider, and its
 * `redirect_to` must be our own /auth/callback rather than the destination page.
 * Getting that wrong is the single most common way an OAuth integration fails,
 * and it fails silently — Supabase substitutes the Site URL and the code is lost.
 *
 * The provider request is intercepted and aborted, so nothing leaves the machine
 * and no real Google/Microsoft consent screen is involved.
 *
 * NOT asserted here: the pending button label. supabase-js assigns
 * window.location in the same tick as the call, so the page is already navigating
 * before React can paint it and Playwright's execution context is destroyed.
 * Verifying it through the browser tests Playwright rather than the app; the
 * ordering that makes it correct is asserted in check-oauth-callback.mjs instead.
 */
import { existsSync } from "node:fs";

if (!existsSync(".next")) {
  console.log("SKIP: no production build — run `npm run build` first");
  process.exit(0);
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
  process.exit(0);
}

let failed = false;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed = true;
};

const { chromium } = await import("playwright");
const browser = await chromium.launch();

/**
 * Click a provider button and return the authorize URL it tried to reach.
 * A fresh page per case: the click navigates, so a page cannot be reused.
 */
async function capture(buttonText, loginPath = "/auth/login") {
  const page = await browser.newPage();
  let captured = null;
  await page.route("**/auth/v1/authorize*", async (route) => {
    captured = route.request().url();
    await route.abort();
  });

  await page.goto(BASE + loginPath, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(`button:has-text("${buttonText}")`);
  const bodyText = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  await page.locator("button", { hasText: buttonText }).first().click({ noWaitAfter: true });

  for (let i = 0; i < 20 && !captured; i++) await page.waitForTimeout(150);

  await page.close();
  return { url: captured, bodyText };
}

// ── What the visitor sees ──────────────────────────────────────────────────
const first = await capture("Continue with Google");
const t = first.bodyText;

check("the Google button is rendered", t.includes("Continue with Google"));
check("the Microsoft button is rendered", t.includes("Continue with Microsoft"));
check("the email/password form is still offered", t.includes("Password"));
check("a divider separates SSO from email sign-in", t.includes("OR WITH EMAIL"));
check(
  "the page explains that a role must be assigned before data is visible",
  /role assigned/i.test(t),
);

// ── The outbound flow ──────────────────────────────────────────────────────
check("clicking Google starts an authorize request", first.url !== null, first.url ?? "none seen");

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

// Microsoft is the `azure` provider in Supabase's vocabulary — an easy and
// silent thing to get wrong.
const ms = await capture("Continue with Microsoft");
check("clicking Microsoft starts an authorize request", ms.url !== null, ms.url ?? "none seen");
if (ms.url) {
  const u = new URL(ms.url);
  check("Microsoft uses provider=azure", u.searchParams.get("provider") === "azure", u.searchParams.get("provider") ?? "");
  check(
    "profile scopes are requested for Azure (it returns no name/email otherwise)",
    (u.searchParams.get("scopes") ?? "").includes("email"),
    u.searchParams.get("scopes") ?? "none",
  );
}

// ── The destination is carried, and cannot be hijacked ─────────────────────
const withNext = await capture("Continue with Google", "/auth/login?redirect_to=%2Ftime");
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
