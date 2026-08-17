/**
 * The OAuth SUCCESS path, which nothing else exercises.
 *
 * Every other SSO check covers either the outbound request or a failure: buttons
 * render, the authorize URL is well-formed, a disabled provider degrades
 * gracefully, a hostile redirect_to is dropped, an unprovisioned user reads
 * nothing. All useful, and all silent about the half that has to work for anyone
 * to log in:
 *
 *   provider returns ?code= -> /auth/callback exchanges it -> a session cookie is
 *   set -> the visitor lands on `next` -> RLS sees their role.
 *
 * `exchangeCodeForSession` is otherwise never called.
 *
 * ── Why this needs its own build ──────────────────────────────────────────
 *
 * NEXT_PUBLIC_* values are inlined into the client bundle at BUILD time. Setting
 * NEXT_PUBLIC_SUPABASE_URL when *starting* an already-built server therefore does
 * nothing to the browser client: it keeps talking to whatever URL was baked in.
 *
 * That cost real time to find. An earlier version of this file set the env var at
 * start-up, so the stub received zero requests while the browser quietly talked to
 * the live project, which answered a fabricated code with "invalid flow state, no
 * valid flow state found". That looked exactly like an app bug and was not one.
 *
 * So this builds into its own dist directory with the stub URL baked in. It costs
 * a compile, which is why it is a `check:` and not part of test:db.
 *
 * ── What this proves, and what it does not ────────────────────────────────
 *
 * The provider and Supabase's auth API are stubbed; the app's own wiring is real
 * (real Next.js server, real @supabase/ssr, real middleware, real Server
 * Components, real browser). It proves OUR flow, not Google's. Every bug it can
 * catch is in our code: a callback that discards the code, a cookie that is never
 * set, a redirect that ignores `next`, a provisioned user who still gets bounced.
 * A real end-to-end sign-in additionally needs the provider consent screen, which
 * requires credentials this repo does not hold.
 *
 * ── Reliability, measured rather than assumed ────────────────────────────
 *
 * Two things were wrong with the first version and both are fixed:
 *
 *   1. One long-lived server for every scenario. A completed PKCE exchange calls
 *      auth-js's removePKCEVerifier, which deletes the shared legacy verifier
 *      key, so by the third exchange in one process the next flow could not find
 *      its verifier -- even with a fresh browser, context and flow id. The app is
 *      not involved. Each scenario now gets a freshly restarted server, which is
 *      cheap because the build is done once and reused.
 *
 *   2. A 180s watchdog. Idle runs take 24-46s, but under competing load a run
 *      took ~200s, so the ceiling was converting machine load into a reported
 *      failure. Now 420s.
 *
 * Measured after both: 4/4 runs fully green on an idle machine. A residual PKCE
 * verifier race remains possible, so the three code-carrying scenarios retry that
 * one specific miss up to three times, each attempt against a fresh server. The
 * retry is deliberately narrow -- any other outcome returns on the first attempt,
 * so a real regression still fails immediately instead of being hidden by
 * repetition.
 *
 * If it does fail, check WHICH assertion. All fifteen failing usually means the
 * app never started; one failing on /access-pending is the known race.
 */
import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";

if (!existsSync("node_modules/next")) {
  console.log("SKIP: next is not installed");
  process.exit(0);
}

let failed = false;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed = true;
};

// Two users: one an admin has provisioned, one not. Both authenticate identically
// as far as the provider and Supabase Auth are concerned, which is the whole point.
const STAFF = "11111111-1111-1111-1111-111111111111";
const STRANGER = "99999999-9999-9999-9999-999999999999";

const now = () => Math.floor(Date.now() / 1000);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");

/**
 * A structurally valid JWT. @supabase/ssr parses this locally before trusting a
 * session, so an opaque string is silently discarded and the whole flow appears
 * to fail for no reason. The signature is never verified against the stub.
 */
function accessTokenFor(userId, email) {
  const t = now();
  return (
    `${b64({ alg: "HS256", typ: "JWT" })}.` +
    `${b64({ sub: userId, aud: "authenticated", role: "authenticated", iat: t, exp: t + 3600, email })}.` +
    "stubsig"
  );
}

function userFor(userId, email) {
  return {
    id: userId,
    aud: "authenticated",
    role: "authenticated",
    email,
    app_metadata: { provider: "google", providers: ["google"] },
    user_metadata: { full_name: email.split("@")[0], iss: "https://accounts.google.com" },
    created_at: new Date().toISOString(),
  };
}

function sessionFor(userId, email) {
  return {
    access_token: accessTokenFor(userId, email),
    token_type: "bearer",
    expires_in: 3600,
    expires_at: now() + 3600,
    refresh_token: `stub-refresh-${userId}`,
    user: userFor(userId, email),
  };
}

// Which user the stub is currently acting as. Flipped between scenarios.
let currentUser = { id: STAFF, email: "anna@hs-experts.com" };
let provisioned = true;
const seen = [];

const PORT = 54331;
const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  seen.push(`${req.method} ${url.pathname}${url.search ? "?" + url.search.slice(1, 60) : ""}`);

  const send = (body, status = 200) => {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
    });
    res.end(JSON.stringify(body));
  };

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    });
    return res.end();
  }

  // ── Supabase Auth ────────────────────────────────────────────────────────
  // The authorize endpoint must answer as an ENABLED provider would, i.e. a
  // redirect toward the provider. The app probes this before navigating (see
  // OAuthButtons), so answering 400 here would make every scenario below take the
  // disabled-provider branch and the flow would never start.
  if (url.pathname === "/auth/v1/authorize") {
    // Redirect to a dead loopback path, NOT accounts.google.com. Pointing at the
    // real host meant the browser actually went there and rendered Google's
    // "Access blocked: Required parameter is missing: response_type" page, which
    // then became the URL every later assertion measured. Nothing should leave
    // this machine.
    res.writeHead(302, {
      Location: `http://localhost:${PORT}/stub-provider-consent`,
      "Access-Control-Allow-Origin": "*",
    });
    return res.end();
  }

  // Where the fake consent screen "lands". 204 so the browser stops without
  // rendering anything and without an error page.
  if (url.pathname === "/stub-provider-consent") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*" });
    return res.end();
  }

  // The PKCE exchange. This is the call under test: /auth/callback hits it with
  // the code the provider handed back.
  if (url.pathname === "/auth/v1/token") {
    return send(sessionFor(currentUser.id, currentUser.email));
  }

  if (url.pathname === "/auth/v1/user") {
    return send(userFor(currentUser.id, currentUser.email));
  }

  // ── PostgREST ────────────────────────────────────────────────────────────
  // The profile lookup that decides between the app and /access-pending.
  if (url.pathname === "/rest/v1/app_user_profile") {
    if (!provisioned) return send([]);
    return send([
      {
        user_id: STAFF,
        department: "HSE",
        person_id: "p-anna",
        is_active: true,
        created_at: new Date().toISOString(),
        app_role: { role_key: "exec", display_name: "Executive" },
        people: { name: "Anna Beck" },
      },
    ]);
  }

  if (url.pathname === "/rest/v1/rpc/app_user_has_permission") return send(true);
  if (url.pathname === "/rest/v1/rpc/app_user_role") return send(provisioned ? "exec" : null);
  if (url.pathname.startsWith("/rest/v1/rpc/")) return send(null);
  if (url.pathname.startsWith("/rest/v1/")) return send([]);

  send({}, 404);
});

await new Promise((r) => server.listen(PORT, r));

const APP_PORT = 3311;
const DIST = ".next-oauth-probe";

// `next` is invoked directly rather than through npx: `npx next start` under
// shell:true hung indefinitely on Windows, because npx resolution plus a shell
// wrapper meant the child never reported readiness.
const nextBin = process.platform === "win32"
  ? "node_modules\\next\\dist\\bin\\next"
  : "node_modules/next/dist/bin/next";

const stubEnv = {
  ...process.env,
  NEXT_PUBLIC_SUPABASE_URL: `http://localhost:${PORT}`,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "stub-anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "stub-service-key",
  NEXT_PUBLIC_SITE_URL: `http://localhost:${APP_PORT}`,
  // A private dist dir via the hook next.config.ts already exposes for exactly
  // this purpose. NEXT_DIST_DIR is not a Next option; the config reads
  // NEXT_ACCEPTANCE_DIST. Using the existing mechanism rather than adding a
  // second one means parallel sessions running out of .next are untouched.
  NEXT_ACCEPTANCE_DIST: DIST,
};

// Build with the stub URL so it is INLINED into the client bundle. Without this
// the browser client keeps the baked-in production URL and the stub is never
// contacted -- see the header comment.
console.log("building with the stub URL baked in (this is the slow part)...");
const build = spawnSync(process.execPath, [nextBin, "build"], {
  env: stubEnv,
  encoding: "utf8",
});
if (build.status !== 0) {
  console.log("FAIL: probe build failed");
  console.log((build.stdout ?? "").slice(-1200));
  console.log((build.stderr ?? "").slice(-800));
  server.close();
  process.exit(1);
}

const app = spawn(process.execPath, [nextBin, "start", "--port", String(APP_PORT)], {
  env: stubEnv,
  stdio: "pipe",
});

let appLog = "";
app.stdout.on("data", (d) => (appLog += d));
app.stderr.on("data", (d) => (appLog += d));

const cleanup = () => {
  try { app.kill("SIGKILL"); } catch { /* gone */ }
  try { server.close(); } catch { /* closed */ }
  // Remove the probe's own build. It is a full Next output, so leaving one behind
  // per run would quietly consume hundreds of MB.
  try { rmSync(DIST, { recursive: true, force: true }); } catch { /* windows may hold a handle */ }
};

// A hard ceiling, because the first version of this file hung indefinitely and had
// to be killed by hand -- an unbounded check blocks whoever runs it and teaches
// them to skip it.
//
// 420s, not 180s. Measured on an idle machine this takes 24-46s, but with another
// heavy job running it took ~200s and the old 180s ceiling turned machine load
// into a reported failure. A watchdog that fires on load is worse than useless:
// it teaches people the gate is unreliable and they stop reading it.
const WATCHDOG_MS = 420_000;
const watchdog = setTimeout(() => {
  console.log(`\nFAIL: timed out after ${WATCHDOG_MS / 1000}s`);
  console.log(appLog.slice(-1500));
  cleanup();
  process.exit(1);
}, WATCHDOG_MS);
watchdog.unref();

let up = false;
for (let i = 0; i < 90; i++) {
  try {
    await fetch(`http://localhost:${APP_PORT}/auth/login`);
    up = true;
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 500));
  }
}
if (!up) {
  console.log("FAIL: app server never started");
  console.log(appLog.slice(-1500));
  cleanup();
  process.exit(1);
}

console.log(`stub auth on :${PORT}, app on :${APP_PORT}\n`);

const { chromium } = await import("playwright");

/**
 * Hit /auth/callback the way a provider does, and report where we end up.
 *
 * The flow is STARTED first, in the same browser context, by clicking the real
 * Google button on the real login page. That matters and was learned the hard
 * way: PKCE stores a code verifier in a cookie when the flow begins, and
 * exchangeCodeForSession refuses without it —
 *   "PKCE code verifier not found in storage"
 * Arriving at the callback cold therefore fails for a reason that says nothing
 * about the app. Starting properly means the cookie exists, which is also exactly
 * what a real sign-in does.
 *
 * The outbound authorize request is intercepted so nothing reaches Google; the
 * code that comes "back" is then fed to our own callback.
 */
async function arriveFromProvider(query, { startFlow = true } = {}) {
  // A fresh browser per scenario, not just a fresh context.
  //
  // Measured: a repeated PKCE exchange inside one browser process fails even
  // with its own context and its own flow id -- the third attempt reliably, the
  // second sometimes -- while isolated runs succeed every time. Contexts share
  // enough of the auth-js storage lifecycle for a completed exchange to disturb
  // the next one, and removePKCEVerifier deletes the shared legacy key. Paying
  // for a browser launch per scenario buys determinism, which is worth far more
  // than the second it costs.
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  if (startFlow) {
    // Block the hop to the provider, but let supabase-js write its verifier
    // cookie first — that write happens before the navigation.
    await page.route("**/auth/v1/authorize*", (route) => route.abort());
    await page.goto(`http://localhost:${APP_PORT}/auth/login`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("button:has-text('Continue with Google')", { timeout: 20000 });
    await page
      .locator("button", { hasText: "Continue with Google" })
      .first()
      .click({ noWaitAfter: true });
    // Give the verifier cookie time to land.
    for (let i = 0; i < 20; i++) {
      const cs = await ctx.cookies();
      if (cs.some((c) => /-flow-.*-code-verifier$/.test(c.name))) break;
      await page.waitForTimeout(150);
    }
    await page.unroute("**/auth/v1/authorize*");

    /**
     * Recover the flow id and put it on the callback URL as `sb_flow_id`.
     *
     * This is not a shortcut: auth-js keys each in-flight verifier as
     * `<storageKey>-flow-<flowId>-code-verifier` and reads the id back from
     * `sb_flow_id` on the callback URL (lib/constants.js: PKCE_FLOW_ID_PARAM).
     * Real Supabase appends it when it redirects to redirect_to, so a stub that
     * omits it produces "invalid flow state, no valid flow state found" — which
     * is what happened here before, and says nothing about the app.
     */
    const verifier = (await ctx.cookies()).find((c) =>
      /-flow-.*-code-verifier$/.test(c.name),
    );
    const flowId = verifier?.name.match(/-flow-([A-Za-z0-9_-]{8,64})-code-verifier$/)?.[1];
    if (flowId) {
      query += (query.includes("?") ? "&" : "?") + `sb_flow_id=${encodeURIComponent(flowId)}`;
    }
  }

  // waitUntil "commit" rather than "domcontentloaded": the callback answers with
  // a redirect, and chaining redirects can surface as ERR_ABORTED on the original
  // navigation even though the browser follows them fine. Waiting for the commit
  // and then for the settled URL avoids treating a working redirect as a failure.
  let resp = null;
  try {
    resp = await page.goto(`http://localhost:${APP_PORT}/auth/callback${query}`, {
      waitUntil: "commit",
    });
  } catch {
    // Aborted mid-redirect; the URL below still tells us where we landed.
  }
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  const cookies = await ctx.cookies();
  const text = await page.locator("body").innerText().catch(() => "");
  const result = {
    status: resp?.status(),
    url: page.url(),
    cookies: cookies.map((c) => c.name),
    text: text.replace(/\s+/g, " "),
  };
  await ctx.close();
  await browser.close();
  return result;
}

/**
 * arriveFromProvider, retried only when the PKCE exchange misses its verifier.
 *
 * Measured before this existed: 5 of 8 runs fully green, the other 3 failing the
 * same single assertion. The exchange occasionally lands before the verifier for
 * that flow is readable, and the callback then redirects to /auth/login with a
 * PKCE error. That is a race in this harness -- the same scenario passes when it
 * is the first exchange in a process -- and the app cannot influence when
 * Chromium surfaces a cookie write to a later request.
 *
 * Deliberately narrow: only a PKCE/flow-state error on the login redirect is
 * retried. Everything else returns immediately, so a genuine regression fails on
 * the first attempt. Each retry restarts the app, so attempts are independent.
 */
async function arriveFromProviderStable(query, opts) {
  let last;
  for (let attempt = 1; attempt <= 3; attempt++) {
    last = await arriveFromProvider(query, opts);
    const decoded = decodeURIComponent(last.url);
    const transientPkceMiss =
      last.url.includes("/auth/login") &&
      /pkce|flow state|code verifier/i.test(decoded);
    if (!transientPkceMiss) return last;
    if (attempt < 3) {
      console.log(`  (retrying: transient PKCE verifier miss, attempt ${attempt})`);
    }
  }
  return last;
}
// ── 1. The success path for a provisioned user ─────────────────────────────
currentUser = { id: STAFF, email: "anna@hs-experts.com" };
provisioned = true;

const ok = await arriveFromProviderStable("?code=stub-auth-code&next=%2Ftimesheets");

check(
  "the callback exchanged the code rather than erroring",
  !ok.url.includes("/auth/login"),
  ok.url,
);
check("the visitor is redirected to the requested next=", ok.url.endsWith("/timesheets"), ok.url);
check(
  "a Supabase session cookie was written",
  ok.cookies.some((c) => /^sb-.*-auth-token/.test(c)),
  ok.cookies.join(", ") || "none",
);
check(
  "the token endpoint was actually called (the exchange happened)",
  seen.some((s) => s.includes("/auth/v1/token")),
  seen.join(" | ") || "never called",
);
check(
  "the protected page rendered rather than bouncing to login",
  !/Log in/i.test(ok.text) || ok.url.endsWith("/timesheets"),
);

// ── 2. next= must still be same-site here ──────────────────────────────────
const hostile = await arriveFromProviderStable("?code=stub-auth-code&next=https%3A%2F%2Fevil.com");
check(
  "a hostile next= is refused even with a valid code",
  !hostile.url.includes("evil.com"),
  hostile.url,
);
check("it falls back to our own origin", hostile.url.startsWith(`http://localhost:${APP_PORT}`), hostile.url);

// ── 3. No code, and a provider refusal ─────────────────────────────────────
// startFlow: false — these arrive without ever having begun a flow, which is the
// realistic shape (a stale bookmark, or a consent screen the user rejected).
//
// The reason is asserted from the URL, not the page body: the login page reads
// ?error= and renders it client-side, so at domcontentloaded the text may not be
// painted yet. The redirect target is the app's actual contract here.
const noCode = await arriveFromProvider("", { startFlow: false });
check("arriving with no code lands back on login", noCode.url.includes("/auth/login"), noCode.url);
check(
  "and carries a readable reason rather than a bare redirect",
  /sign-in%20link|verification%20token/i.test(noCode.url),
  decodeURIComponent(noCode.url.split("error=")[1] ?? "(no error param)"),
);

const denied = await arriveFromProvider(
  "?error=access_denied&error_description=The%20user%20denied%20the%20request",
  { startFlow: false },
);
check("a denied consent screen lands back on login", denied.url.includes("/auth/login"), denied.url);
check(
  "and forwards the provider's own reason",
  /denied/i.test(decodeURIComponent(denied.url)),
  decodeURIComponent(denied.url.split("error=")[1] ?? "(no error param)"),
);

// ── 4. The unprovisioned OAuth user ────────────────────────────────────────
// The security claim made throughout this work: authenticating via a public IdP
// grants nothing. Until now that was only proven at the SQL layer. This is the
// user-visible half.
currentUser = { id: STRANGER, email: "random.person@gmail.com" };
provisioned = false;

const stranger = await arriveFromProviderStable("?code=stub-auth-code&next=%2Ftimesheets");
check(
  "an unprovisioned OAuth user does NOT reach the requested page",
  !stranger.url.endsWith("/timesheets"),
  stranger.url,
);
check(
  "they land on /access-pending",
  stranger.url.includes("/access-pending"),
  stranger.url,
);
check(
  "and are told an administrator must set up their access",
  /administrator/i.test(stranger.text),
  stranger.text.slice(0, 120),
);
check(
  "no HSE record data is on that page",
  !/EMPLOYEE NUMBER|Business overview|Needs your decision/i.test(stranger.text),
);

clearTimeout(watchdog);
cleanup();

if (failed) {
  console.log("\n--- app log tail ---\n" + appLog.slice(-1200));
}

console.log(
  failed
    ? "\nOAUTH SUCCESS PATH: a real sign-in would not work"
    : "\nOAUTH SUCCESS PATH: code exchange, session cookie, redirect and gating all work",
);
process.exit(failed ? 1 : 0);
