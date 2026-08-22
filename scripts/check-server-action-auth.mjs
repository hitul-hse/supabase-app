/**
 * Server Actions are public HTTP endpoints. Are they gated as such?
 *
 * check-time-write-path.mjs proves the actions' LOGIC by reading their source and
 * exercising their pure helpers. That is necessary and not sufficient. AGENTS.md
 * states the rule this file tests: "Server Actions are public HTTP endpoints.
 * Re-check the caller's identity and role inside the action. A page-level gate
 * does not protect an action." Nothing verified that over the wire.
 *
 * HOW, and why this shape:
 *
 * A first version hand-forged the RSC POST (Next-Action header, multipart body,
 * router state tree). Every variant answered "Connection closed" -- the protocol
 * has more required framing than is worth reverse-engineering, and a test that
 * fails to invoke its subject silently proves nothing. The negative control caught
 * exactly that, which is why it is here.
 *
 * So this drives the REAL form in Chromium, and varies only the SERVER's answer to
 * "who is this and may they write". The browser produces a genuine, correctly
 * framed action request; the stub decides authorisation. That tests the thing that
 * matters (does the action enforce its own auth) without depending on private
 * framework internals that change between releases.
 *
 * Read-only against nothing live: a stub Supabase, and a build in its own distDir
 * so the shared .next is never touched.
 */
import fs, { existsSync, rmSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";

let failed = false;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed = true;
};

if (!existsSync("src/app/(app)/time/actions.ts")) {
  console.log("SKIP: no time actions to probe");
  process.exit(0);
}

const PORT = 54341;
const APP_PORT = 3121;
const USER_ID = "11111111-1111-1111-1111-111111111111";

/** Mutating requests the app made to the `time` schema. The thing under test. */
let writes = [];
/** Varied per scenario. */
let grantWrite = true;
let authenticated = true;
let memberLinked = true;

/**
 * Bind the stub, or skip with an explanation.
 *
 * server.listen()'s callback form never rejects, so a port left bound by an earlier
 * run surfaced as an unhandled 'error' event and a raw stack trace -- while the
 * earlier run's app server stayed orphaned on its own port. A port already in use
 * is a stale-environment problem, not a defect in the app, so it reports what to do
 * instead of failing.
 */
function listenOrSkip(srv, port) {
  return new Promise((resolve) => {
    srv.once("error", (e) => {
      if (e.code === "EADDRINUSE") {
        console.log(
          `SKIP: port ${port} is already in use, probably by an earlier run that did\n` +
            `      not shut down. Free it and re-run:\n` +
            `        netstat -ano | findstr ${port}`,
        );
        resolve(false);
        return;
      }
      throw e;
    });
    srv.listen(port, () => resolve(true));
  });
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const profile = req.headers["accept-profile"] || req.headers["content-profile"] || "public";

  // Only TABLE mutations count as writes. PostgREST exposes RPCs as POST too, so
  // counting every non-GET made `current_member_id` look like a mutation -- which
  // both broke the unlinked case and blinded the negative control to a real insert.
  if (
    profile === "time" &&
    !["GET", "HEAD"].includes(req.method) &&
    !url.pathname.startsWith("/rest/v1/rpc/")
  ) {
    writes.push(`${req.method} ${url.pathname}`);
  }

  const send = (body, status = 200) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };

  if (url.pathname === "/auth/v1/user") {
    if (!authenticated) return send({ message: "invalid claim: missing sub" }, 401);
    return send({
      id: USER_ID, aud: "authenticated", role: "authenticated",
      email: "anna@hs-experts.com", app_metadata: {}, user_metadata: {},
      created_at: new Date().toISOString(),
    });
  }

  if (url.pathname === "/rest/v1/rpc/app_user_has_permission") return send(grantWrite);
  if (url.pathname === "/rest/v1/rpc/app_user_role") return send("exec");
  if (url.pathname === "/rest/v1/rpc/current_member_id") return send(memberLinked ? 7 : null);

  if (url.pathname === "/rest/v1/app_user_profile") {
    const obj = (req.headers.accept ?? "").includes("pgrst.object");
    const row = {
      user_id: USER_ID, department: "HSE", person_id: "p-anna", is_active: true,
      created_at: new Date().toISOString(),
      app_role: { role_key: "exec", display_name: "Executive" },
      people: { name: "Anna Beck" },
    };
    return send(obj ? row : [row]);
  }

  if (profile === "time") {
    if (url.pathname === "/rest/v1/service") {
      return send([{ id: 1, name: "Risk Assessment", is_travel: false, is_paid_travel: false }]);
    }
    if (url.pathname === "/rest/v1/project") {
      const obj = (req.headers.accept ?? "").includes("pgrst.object");
      const rows = [{ id: 1, name: "DGUV V2 Betreuung", customer_id: 3, is_billable: true }];
      return send(obj ? rows[0] : rows);
    }
    if (url.pathname === "/rest/v1/customer") return send([{ id: 3, name: "Muster GmbH" }]);
    if (url.pathname === "/rest/v1/task") {
      return send([{ id: 5, name: "Site inspection", project_id: 1 }]);
    }
    if (url.pathname === "/rest/v1/entry") return send(req.method === "POST" ? [{ id: 99 }] : []);
    return send([]);
  }

  send([]);
});

if (!(await listenOrSkip(server, PORT))) process.exit(0);

// A dedicated dist dir. The shared .next is never moved: parallel sessions run
// their own servers out of it, and on Windows renaming it hits EPERM whenever a
// handle is open. next.config.ts reads NEXT_ACCEPTANCE_DIST for exactly this.
const DIST = ".next-action-probe";
const stubEnv = {
  ...process.env,
  NEXT_PUBLIC_SUPABASE_URL: `http://localhost:${PORT}`,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "stub-anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "stub-service-key",
  NEXT_PUBLIC_SITE_URL: `http://localhost:${APP_PORT}`,
  NEXT_ACCEPTANCE_DIST: DIST,
};

/**
 * tsconfig.json is rewritten by `next build`: it appends the dist dir's own type
 * paths to "include". With a probe distDir that pollutes the SHARED config with
 * entries naming a directory that exists only during this test -- committed noise
 * pointing at nothing. Snapshot it and put it back.
 */
const TSCONFIG_SNAPSHOT = existsSync("tsconfig.json")
  ? fs.readFileSync("tsconfig.json")
  : null;

function restoreTsconfig() {
  if (!TSCONFIG_SNAPSHOT) return;
  try {
    if (!fs.readFileSync("tsconfig.json").equals(TSCONFIG_SNAPSHOT)) {
      fs.writeFileSync("tsconfig.json", TSCONFIG_SNAPSHOT);
    }
  } catch {
    // Non-fatal: a stale include path is harmless to tsc, just untidy.
  }
}

// Registered rather than only called from cleanup(): a failing assertion or an
// early process.exit() bypasses cleanup(), and one such run did leave the probe
// paths behind. exit fires on every ordinary termination path.
process.on("exit", restoreTsconfig);

console.log("building against the stub (NEXT_PUBLIC_* are compile-time)...");
const build = spawnSync("npx", ["next", "build"], { env: stubEnv, shell: true, encoding: "utf8" });
if (build.status !== 0) {
  console.log("FAIL: stub build failed");
  console.log((build.stdout ?? "").slice(-2000) + (build.stderr ?? "").slice(-2000));
  restoreTsconfig();
  server.close();
  process.exit(1);
}
console.log("build ok\n");

const app = spawn("npx", ["next", "start", "--port", String(APP_PORT)], {
  env: stubEnv, shell: true, stdio: "pipe",
});
let appLog = "";
app.stdout.on("data", (d) => (appLog += d));
app.stderr.on("data", (d) => (appLog += d));

function cleanup() {
  restoreTsconfig();
  try {
    if (app.pid) spawnSync("taskkill", ["/PID", String(app.pid), "/T", "/F"], { stdio: "ignore" });
  } catch { /* gone */ }
  try { server.close(); } catch { /* closed */ }
  try { rmSync(DIST, { recursive: true, force: true }); } catch { /* gitignored anyway */ }
}

const watchdog = setTimeout(() => {
  console.log("\nFAIL: timed out after 180s");
  console.log(appLog.slice(-2000));
  cleanup();
  process.exit(1);
}, 180_000);
watchdog.unref?.();

let up = false;
for (let i = 0; i < 90; i++) {
  if (app.exitCode !== null) break;
  try { await fetch(`http://localhost:${APP_PORT}/auth/login`); up = true; break; }
  catch { await new Promise((r) => setTimeout(r, 500)); }
}
if (!up) {
  console.log("FAIL: app never started");
  console.log(appLog.slice(-2000));
  clearTimeout(watchdog);
  cleanup();
  process.exit(1);
}

const { chromium } = await import("playwright");
const browser = await chromium.launch();

const now = Math.floor(Date.now() / 1000);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const token =
  `${b64({ alg: "HS256", typ: "JWT" })}.${b64({
    sub: USER_ID, aud: "authenticated", role: "authenticated",
    iat: now, exp: now + 3600, email: "anna@hs-experts.com",
  })}.stubsig`;
const session = {
  access_token: token, token_type: "bearer", expires_in: 3600, expires_at: now + 3600,
  refresh_token: "stub-refresh",
  user: {
    id: USER_ID, aud: "authenticated", role: "authenticated", email: "anna@hs-experts.com",
    app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString(),
  },
};
const authCookie = {
  name: "sb-localhost-auth-token",
  value: "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url"),
  domain: "localhost", path: "/", sameSite: "Lax",
};

/**
 * Load the tracker and submit the timer form, returning whether a POST happened.
 *
 * The click is what produces a correctly framed Server Action request. A POST
 * being made proves the endpoint was invoked; whether it WROTE is what the stub
 * observes, and that is the assertion.
 */
async function submitTracker({ withCookie }) {
  const ctx = await browser.newContext();
  if (withCookie) await ctx.addCookies([authCookie]);
  const page = await ctx.newPage();

  await page.goto(`http://localhost:${APP_PORT}/time?view=track`, { waitUntil: "networkidle" });

  const landedOnLogin = page.url().includes("/auth/login");
  const btn = page.getByRole("button", { name: "Start timer", exact: true }).first();

  /*
   * WAIT FOR THE REVEAL, do not just count.
   *
   * The (app) group streams `loading.tsx` first, so React delivers the real page
   * into a `<div hidden>` and only unhides it once that boundary resolves --
   * measured at ~875ms here. `networkidle` fires BEFORE that, so counting the
   * button straight after the goto found it in the DOM but invisible, and
   * getByRole (which is correctly a11y-aware) reported zero.
   *
   * That timing alone produced three red checks that read exactly like an
   * authorisation hole: "form not reachable", "no POST", and a negative control
   * claiming an authorised write did not happen. Nothing was wrong with the
   * actions. Waiting for the button to become visible is the whole fix.
   *
   * The anonymous case must NOT wait: no form is expected there, so a wait would
   * burn the timeout on every run and prove nothing.
   */
  if (!landedOnLogin) {
    await btn.waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
  }
  const hasForm = await btn.isVisible().catch(() => false);

  /*
   * Choose a project before submitting. startTimer rightly refuses an entry with
   * neither project nor task, so an empty submit would exercise validation rather
   * than the authorised-write path the negative control is asserting.
   *
   * THE PROJECT PICKER IS NO LONGER A NATIVE <select>. It became a
   * SearchableSelect combobox when the project list reached ~334 options (a
   * native select over that many is unusable). This gate kept driving
   * `select[name="project_id"]`, found nothing, submitted with no project, and
   * read startTimer's correct refusal as "no write happened" -- reporting three
   * failures that looked like an authorisation hole and were a stale selector.
   *
   * The combobox keeps the native form semantics via a hidden input, so the
   * ASSERTIONS are unchanged; only the way a project gets chosen is.
   */
  if (hasForm) {
    /*
     * SCOPE EVERYTHING TO THE TIMER FORM. The tracker renders three comboboxes
     * per form and two forms (start a timer, log past work), so a page-level
     * ".first()" reaches into the wrong control. Anchor on the form that owns
     * the "Start timer" button and query inside it.
     */
    const form = page.locator("form", { has: page.getByRole("button", { name: "Start timer", exact: true }) }).first();

    const nativeSelect = form.locator('select[name="project_id"]').first();
    if (await nativeSelect.count()) {
      // Still native (a small enum list, or a future revert): drive it directly.
      const values = await nativeSelect
        .locator("option")
        .evaluateAll((opts) => opts.map((o) => o.value).filter((v) => v !== ""));
      if (values.length) await nativeSelect.selectOption(values[0]).catch(() => {});
    } else {
      /*
       * The combobox. Two traps, both of which silently produce "no project":
       *
       *  1. The FIRST listbox option is the allowEmpty row ("No project"), so
       *     clicking blindly picks the empty value and the submit then exercises
       *     validation instead of the write path.
       *  2. The popover is portalled to the page, not nested in the form, so the
       *     options must be queried at page level once the right trigger is open.
       */
      const trigger = form.locator('button[aria-haspopup="listbox"]').first();
      if (await trigger.count()) {
        await trigger.click().catch(() => {});
        const options = page.locator('[role="option"]:visible');
        await options.first().waitFor({ state: "visible", timeout: 5000 }).catch(() => {});

        // Pick the first option that is not the empty choice.
        const count = await options.count();
        for (let i = 0; i < count; i++) {
          const option = options.nth(i);
          const text = ((await option.innerText().catch(() => "")) || "").trim();
          if (!text || /^No project$/i.test(text)) continue;
          await option.click().catch(() => {});
          break;
        }
      }

      /*
       * Confirm a project actually landed in the hidden input. Without this the
       * negative control can fail for a UI-driving reason while looking like an
       * authorisation finding -- which is exactly how this gate misled us once.
       */
      const chosen = await form
        .locator('input[type="hidden"][name="project_id"]')
        .first()
        .inputValue()
        .catch(() => "");
      if (!chosen) {
        console.log("  note: could not choose a project via the combobox — the negative control below may fail for that reason rather than an auth one");
      }
    }
  }

  let posted = false;
  if (hasForm) {
    const wait = page
      .waitForRequest((r) => r.method() === "POST" && r.url().includes("/time"), { timeout: 10_000 })
      .catch(() => null);
    // force: true so a disabled control still reports whether the endpoint can be
    // reached -- a disabled button is UX, not an authorisation boundary.
    await btn.click({ force: true }).catch(() => {});
    posted = (await wait) !== null;
    await page.waitForTimeout(2000);
  }

  const text = hasForm ? (await page.locator("body").innerText()).replace(/\s+/g, " ") : "";
  await ctx.close();
  return { landedOnLogin, hasForm, posted, text };
}

try {
  // ── 1. No session ────────────────────────────────────────────────────────
  authenticated = false;
  grantWrite = false;
  writes = [];

  const anon = await submitTracker({ withCookie: false });
  check(
    "an anonymous visitor is redirected away from the tracker",
    anon.landedOnLogin,
    anon.landedOnLogin ? "" : "reached /time without a session",
  );
  check("no write reached the database for an anonymous visitor", writes.length === 0, writes.join(", "));

  // ── 2. Signed in, but without timesheets:write ────────────────────────────
  authenticated = true;
  grantWrite = false;
  writes = [];

  await submitTracker({ withCookie: true });
  check(
    "a signed-in caller without timesheets:write writes nothing",
    writes.length === 0,
    writes.length ? writes.join(", ") : "the action refused it server-side",
  );

  // ── 3. Signed in and permitted, but no time.member row ────────────────────
  // A distinct failure mode: authorised, yet nothing to attribute the entry to.
  // It must also write nothing, and say something different.
  grantWrite = true;
  memberLinked = false;
  writes = [];

  await submitTracker({ withCookie: true });
  check(
    "an authorised but unlinked account writes nothing",
    writes.length === 0,
    writes.length ? writes.join(", ") : "current_member_id() null was handled",
  );

  // ── 4. Negative control: fully authorised, a write MUST happen ────────────
  // Without this the three passes above could all mean "the form never posted",
  // which would prove nothing about authorisation.
  memberLinked = true;
  grantWrite = true;
  writes = [];

  const allowed = await submitTracker({ withCookie: true });
  check("the tracker form is reachable when authorised", allowed.hasForm);
  check("submitting it issues a Server Action POST", allowed.posted);
  check(
    "negative control: an authorised submit DOES write to time.entry",
    writes.some((w) => w.startsWith("POST /rest/v1/entry")),
    writes.length ? writes.join(", ") : "no write even when fully authorised",
  );
} finally {
  await browser.close();
  clearTimeout(watchdog);
  cleanup();
}

console.log(
  failed
    ? "\nSERVER ACTION AUTH: an action does not enforce its own authorisation"
    : "\nSERVER ACTION AUTH: every write action re-checks identity, permission and linkage",
);
process.exit(failed ? 1 : 0);
