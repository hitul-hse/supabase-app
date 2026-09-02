/**
 * Gate for the OAuth sign-in surface: does a broken provider produce an EXPLANATION
 * rather than a dead end?
 *
 * WHAT WENT WRONG, and why a gate is warranted. Both sign-in buttons were reported as
 * "gives me an error". Measured against the live project:
 *
 *   - Microsoft (azure) is genuinely NOT ENABLED in Supabase. The button handled this
 *     case already.
 *   - Google IS ENABLED, builds a valid authorize URL, and is then REFUSED BY GOOGLE
 *     with `redirect_uri_mismatch`, because the Supabase callback URI is not
 *     registered on the Google OAuth client.
 *
 * The second is the one the code could not see. The pre-flight probe only looked for
 * HTTP 400 from Supabase; Google's refusal arrives as a 302 to its own error page, so
 * the browser was handed over and the user landed on Google's error screen with no
 * route back to the working email form. An unexplained dead end.
 *
 * So this asserts the DIAGNOSIS, not just the plumbing:
 *   1. /auth/provider-status is reachable without a session (it runs on the login
 *      page, where nobody has one) and returns JSON, not an HTML login redirect.
 *   2. It reports a disabled provider as such, with a hint naming what to switch on.
 *   3. It reports a provider-side refusal as such, with a hint naming the exact
 *      callback URI to register.
 *   4. It FAILS OPEN for anything it cannot classify, so a diagnostic can never be
 *      the reason a working sign-in is blocked.
 *   5. The login page still offers email sign-in when OAuth is broken, which is the
 *      actual escape hatch.
 *
 * Requires live Supabase credentials and a production build.
 *
 * Run: node scripts/check-oauth-diagnosis.mjs
 */
import { readFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
if (!env.NEXT_PUBLIC_SUPABASE_URL) {
  console.log("SKIP: no Supabase credentials");
  process.exit(0);
}
const REF = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
const EXPECTED_CALLBACK = `https://${REF}.supabase.co/auth/v1/callback`;

let failed = false;
const check = (label, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${detail ? `\n        ${detail}` : ""}`);
  if (!ok) failed = true;
};

const PORT = 3133;
const app = spawn("npx", ["next", "start", "--port", String(PORT)], {
  env: process.env, shell: true, stdio: "pipe",
});
let log = "";
app.stdout.on("data", (d) => (log += d));
app.stderr.on("data", (d) => (log += d));
const cleanup = () => {
  try {
    if (process.platform === "win32" && app.pid) {
      spawnSync("taskkill", ["/PID", String(app.pid), "/T", "/F"], { stdio: "ignore" });
    } else app.kill("SIGKILL");
  } catch { /* gone */ }
};

let up = false;
for (let i = 0; i < 120; i++) {
  if (app.exitCode !== null) break;
  try { await fetch(`http://localhost:${PORT}/auth/login`); up = true; break; }
  catch { await new Promise((r) => setTimeout(r, 500)); }
}
if (!up) {
  console.log("FAIL: server never started -- run `npm run build` first");
  console.log(`  exit code: ${app.exitCode}`);
  console.log(log.slice(-2500) || "(no output captured)");
  cleanup();
  process.exit(1);
}

try {
  const ask = async (provider) => {
    const res = await fetch(`http://localhost:${PORT}/auth/provider-status?provider=${provider}`, {
      redirect: "manual",
      cache: "no-store",
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, json, text };
  };

  // 1. Reachable anonymously, and answers JSON.
  const google = await ask("google");
  check(
    "the probe is reachable without a session and returns JSON",
    google.status === 200 && google.json !== null,
    `HTTP ${google.status}, ${google.json ? "parsed as JSON" : `body starts "${google.text.slice(0, 60)}"`} -- an HTML login redirect here would silently disable the diagnostic on the one page that uses it`,
  );

  // 2+3. The two real failures, each with an actionable hint.
  console.log(`\n  google verdict: ${JSON.stringify(google.json)}`);
  if (google.json?.ok === false) {
    check(
      "a provider-side refusal is reported with a reason",
      typeof google.json.reason === "string" && google.json.reason.length > 0,
      `reason = ${google.json.reason}`,
    );
    check(
      "the hint names something actionable, not just the failure",
      typeof google.json.hint === "string" && google.json.hint.length > 30,
      google.json.hint ?? "(no hint)",
    );
    if (google.json.reason === "redirect_uri_mismatch") {
      check(
        "a redirect_uri_mismatch hint quotes the EXACT callback URI to register",
        String(google.json.hint).includes(EXPECTED_CALLBACK),
        `hint must contain ${EXPECTED_CALLBACK} so an administrator can copy it verbatim`,
      );
    }
  } else {
    console.log("  (Google currently reports OK -- the provider-side fix has been applied.)");
    check("a healthy provider reports ok:true", google.json?.ok === true, JSON.stringify(google.json));
  }

  const azure = await ask("azure");
  console.log(`\n  azure verdict: ${JSON.stringify(azure.json)}`);
  if (azure.json?.ok === false) {
    check(
      "a disabled provider is reported as not enabled, not as a generic error",
      azure.json.reason === "provider_not_enabled",
      `reason = ${azure.json.reason}`,
    );
    check(
      "the disabled-provider hint tells an administrator what to do",
      /enable|switch/i.test(String(azure.json.hint)),
      azure.json.hint ?? "(no hint)",
    );
  } else {
    console.log("  (Microsoft currently reports OK -- it has been enabled.)");
  }

  // 4. Fails open on anything unclassifiable.
  const bogus = await ask("not-a-provider");
  check(
    "an unrecognised provider fails OPEN, so the check can never block a sign-in",
    bogus.json?.ok === true,
    JSON.stringify(bogus.json),
  );

  /**
   * 5. The escape hatch: email sign-in is still available.
   *
   * Checked IN A BROWSER, not by grepping the server HTML. The login form is a
   * Client Component, so the inputs are not in the initial markup -- an earlier
   * version of this gate grepped for type="password", found nothing, and reported
   * the form missing while it was on screen and working. Asserting on rendered DOM
   * is the only honest way to check a client-rendered form.
   */
  const { launchChromium } = await import("./lib/launch-chromium.mjs");
  const browser = await launchChromium();
  try {
    const page = await browser.newPage();
    const consoleErrors = [];
    page.on("pageerror", (e) => consoleErrors.push(String(e)));
    await page.goto(`http://localhost:${PORT}/auth/login`, { waitUntil: "domcontentloaded", timeout: 60_000 });

    /**
     * WAIT FOR HYDRATION before counting inputs. The whole page is a Client
     * Component wrapped in <Suspense>, so at domcontentloaded the form genuinely is
     * not in the DOM yet -- an earlier version of this gate counted zero inputs and
     * reported the login form missing while it rendered fine a moment later. The
     * password field is the last thing to appear, so waiting on it is the signal
     * that the form is really there.
     */
    await page
      .locator('input[type="password"]')
      .first()
      .waitFor({ state: "visible", timeout: 30_000 })
      .catch(() => {});

    const emailInputs = await page.locator('input[type="email"], input[name="email"]').count();
    const passwordInputs = await page.locator('input[type="password"]').count();
    check(
      "the login page offers email + password when OAuth is broken",
      emailInputs > 0 && passwordInputs > 0,
      `${emailInputs} email and ${passwordInputs} password input(s) rendered -- an OAuth failure must never be the only way in`,
    );

    /**
     * Google must stay VISIBLE even though it currently fails.
     *
     * This is the distinction worth holding onto. Google is fully configured and
     * refused only by one missing entry in the Google console, so hiding it would
     * leave a colleague wondering whether it ever existed -- explaining it in
     * place is better. Microsoft is a different case: no Azure app registration
     * exists, so it cannot succeed for anyone, and it is deliberately not offered
     * (NEXT_PUBLIC_ENABLE_MICROSOFT_SIGNIN). An unusable control is worse than an
     * absent one; a temporarily-broken but real one is not.
     *
     * So the assertion is about Google specifically, not about button count.
     */
    const googleBtn = await page.getByRole("button", { name: /Continue with Google/i }).count();
    const msBtn = await page.getByRole("button", { name: /Continue with Microsoft/i }).count();
    const microsoftExpected = process.env.NEXT_PUBLIC_ENABLE_MICROSOFT_SIGNIN === "true";
    check(
      "the failing-but-configured Google button is still rendered, not hidden",
      googleBtn > 0,
      `google=${googleBtn} -- hiding it would leave a colleague wondering whether it ever existed; explaining it in place is better`,
    );
    check(
      "Microsoft is offered only when it could actually work",
      microsoftExpected ? msBtn > 0 : msBtn === 0,
      `microsoft=${msBtn}, flag=${microsoftExpected} -- Azure has no app registration yet, so offering it would be a guaranteed dead end`,
    );

    /**
     * Clicking Google must never leave the user stranded. What "not stranded"
     * means depends on whether Google currently accepts us, and both cases need
     * asserting -- dropping either one would leave this check passing vacuously.
     *
     *  - REFUSED (the original bug): the failure must be explained ON THIS PAGE.
     *    Navigating to the provider's error screen is the dead end this whole
     *    change exists to remove.
     *  - ACCEPTED (the state since the console fix): the click must actually hand
     *    off to accounts.google.com. Staying put with an error would mean the
     *    pre-flight diagnostic had become the thing blocking a working sign-in,
     *    which is exactly the failure mode `provider-status` fails open to avoid.
     *
     * Which branch applies is taken from the probe's own verdict above rather
     * than hardcoded, so this check keeps testing the right thing before and
     * after the Google console change.
     */
    const googleHealthy = google.json?.ok === true;
    const before = page.url();
    await page.getByRole("button", { name: /Continue with Google/i }).click();

    if (googleHealthy) {
      const handedOff = await page
        .waitForURL(/accounts\.google\.com/, { timeout: 30_000 })
        .then(() => true)
        .catch(() => false);
      check(
        "a WORKING provider actually hands off, rather than being blocked by our own pre-flight check",
        handedOff,
        handedOff
          ? `reached ${new URL(page.url()).hostname}`
          : `still at ${page.url()} -- a diagnostic must never stop a sign-in that would have worked`,
      );
      // And it must be the real consent screen, not Google's error page.
      check(
        "the handoff lands on Google's sign-in, not its error page",
        !/\/signin\/oauth\/error/.test(page.url()),
        page.url().slice(0, 120),
      );
    } else {
      // Give the pre-flight checks time to run and render.
      const notice = page.locator("text=/isn't switched on|not finished being set up|not working yet/i");
      const explained = await notice
        .first()
        .waitFor({ state: "visible", timeout: 25_000 })
        .then(() => true)
        .catch(() => false);
      const stayed = page.url().startsWith(before.split("?")[0]);
      check(
        "clicking a broken provider explains itself IN PLACE instead of navigating away",
        explained && stayed,
        explained
          ? `stayed on ${new URL(page.url()).pathname} and showed: "${(await notice.first().innerText()).slice(0, 120)}"`
          : `no explanation appeared; browser is now at ${page.url()} -- if that is accounts.google.com the user has hit the dead end this change exists to remove`,
      );
    }
    check(
      "no uncaught client error while handling the provider",
      consoleErrors.length === 0,
      consoleErrors.slice(0, 2).join(" | ") || "none",
    );
  } finally {
    await browser.close();
  }
} finally {
  cleanup();
}

console.log(
  failed
    ? "\nOAUTH DIAGNOSIS: a provider is mishandled -- either a failure dead-ends, or a working one is blocked\n"
    : "\nOAUTH DIAGNOSIS: working providers hand off, broken ones explain themselves in place\n",
);
process.exit(failed ? 1 : 0);
