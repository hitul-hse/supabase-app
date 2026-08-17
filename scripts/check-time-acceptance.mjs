/**
 * Acceptance test: does a signed-in user actually SEE their tracked hours on
 * /time, in a real browser, served by the real Next.js server?
 *
 * Everything before this stopped short of the thing that matters. The render gate
 * calls components directly. The data gate queries Postgres. The integration gate
 * proves the empty path. None of them exercise the whole stack -- auth cookie ->
 * middleware -> Server Component -> Supabase client -> HTML -> browser -- with
 * actual hours in it, which is the only sequence that answers "does this work".
 *
 * The live project cannot answer it: `time` is not exposed there, so it can only
 * ever produce the empty state. Instead this stands up a stub that speaks the two
 * protocols the app talks:
 *
 *   - Supabase Auth: /auth/v1/user and /auth/v1/token, enough for @supabase/ssr
 *     to consider a cookie-carried session valid.
 *   - PostgREST: /rest/v1/... including Accept-Profile: time, answering with
 *     seeded rows.
 *
 * A stub is a real trade-off and worth naming: it proves the app's own wiring,
 * not Supabase's. What makes it worth having anyway is that every failure it can
 * catch is in OUR code -- a wrong unit, a broken join alias, a Server Component
 * that throws on real data, an auth gate that rejects a valid session. Those are
 * exactly the bugs the other gates cannot see.
 */
import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";

let failed = false;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed = true;
};

if (!existsSync(".next")) {
  console.log("SKIP: no production build — run `npm run build` first");
  process.exit(0);
}

// NEXT_PUBLIC_* are compile-time constants, not runtime configuration.
//
// This cost an hour and is the single most important thing in this file. Passing
// NEXT_PUBLIC_SUPABASE_URL in the spawn env has NO effect on an existing build:
// the value is inlined into the server chunks at build time (verified -- the live
// project URL appears verbatim in .next/server/chunks/*.js). The app therefore
// kept talking to the real project, the stub logged zero requests, and the proxy
// failed closed and redirected to /auth/login. Every symptom pointed at the
// cookie, which was fine all along.
//
// So the app has to be REBUILT against the stub URL. That is slow, which is why
// this check is opt-in rather than part of test:db.
const REBUILD = process.env.ACCEPTANCE_REBUILD !== "0";


/**
 * Remove the probe build. Nothing shared is ever moved, so there is nothing to
 * restore -- this only stops a gitignored scratch directory accumulating.
 */
function cleanupBuild() {
  try {
    rmSync(DIST, { recursive: true, force: true });
  } catch {
    // Windows can hold a handle on a just-stopped server; a leftover gitignored
    // directory is not worth failing the gate over.
  }
}

// ── Seed data: the same hand-checkable figures the other gates use ─────────
// 2h billable + 30m non-billable + 1h calendar = 3h30m logged.
const USER_ID = "11111111-1111-1111-1111-111111111111";
const MEMBER_ID = 7;
const monday = (() => {
  const d = new Date();
  const dow = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - (dow === 0 ? 6 : dow - 1));
  return d.toISOString().slice(0, 10);
})();

const entries = [
  {
    id: 1, member_id: MEMBER_ID,
    started_at: `${monday}T08:00:00+00:00`, ended_at: `${monday}T10:00:00+00:00`,
    duration_seconds: 7200, is_billable: true, is_billed: false, is_calendar: false,
    notes: "Inspection walkthrough",
    member: { display_name: "Anna Beck" },
    task: { name: "Site inspection" },
    project: { name: "DGUV V2 Betreuung" },
    customer: { name: "Muster GmbH" },
    service: { name: "Risk Assessment" },
  },
  {
    id: 2, member_id: MEMBER_ID,
    started_at: `${monday}T13:00:00+00:00`, ended_at: `${monday}T13:30:00+00:00`,
    duration_seconds: 1800, is_billable: false, is_billed: false, is_calendar: false,
    notes: null,
    member: { display_name: "Anna Beck" },
    task: { name: "Admin" },
    project: null, customer: null, service: null,
  },
  {
    id: 3, member_id: MEMBER_ID,
    started_at: `${monday}T15:00:00+00:00`, ended_at: `${monday}T16:00:00+00:00`,
    duration_seconds: 3600, is_billable: false, is_billed: false, is_calendar: true,
    notes: "Team sync",
    member: { display_name: "Anna Beck" },
    task: null, project: null, customer: null, service: null,
  },
];

const weekSummary = [{
  member_id: MEMBER_ID, display_name: "Anna Beck", hub_person_id: "p-anna",
  week_start: monday, total_seconds: 12600, billable_seconds: 7200,
  calendar_seconds: 3600, contracted_seconds: 144000, entry_count: 3,
}];

// The tracker's pickers. Seeded because an unpopulated <select> is the failure
// mode that looks perfectly fine in a screenshot -- the form renders, the
// labels are right, and there is simply nothing to choose, so no time can be
// logged. Without these the stub's catch-all returns [] and the tracker would
// pass every text assertion while being unusable.
const customers = [
  { id: 1, name: "Muster GmbH" },
  { id: 2, name: "Beispiel AG" },
];

const projects = [
  { id: 10, name: "DGUV V2 Betreuung", customer_id: 1, is_billable: true },
  { id: 11, name: "SiGeKo Neubau", customer_id: 2, is_billable: true },
];

// One travel service with is_paid_travel false, so the "(unpaid)" suffix the
// tracker adds is exercised rather than assumed. The vendor hides that
// distinction inside the label text, and it is a real commercial one.
const services = [
  { id: 20, name: "DGUV V2: Sifa / Safety Engeineer", is_travel: false, is_paid_travel: false },
  { id: 21, name: "Anfahrt & Abfahrt / Travelltime (unpayed)", is_travel: true, is_paid_travel: false },
];

const tasks = [
  { id: 30, name: "Site inspection", project_id: 10 },
  { id: 31, name: "Report writing", project_id: 10 },
];

const PROFILE = {
  user_id: USER_ID,
  department: "HSE",
  person_id: "p-anna",
  is_active: true,
  created_at: new Date().toISOString(),
  // Embedded relations, exactly as PostgREST returns them for
  // "app_role(role_key, display_name), people(name)".
  app_role: { role_key: "exec", display_name: "Executive" },
  people: { name: "Anna Beck" },
};

// ── The stub ───────────────────────────────────────────────────────────────
const PORT = 54329;
const requests = [];

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const profile = req.headers["accept-profile"] || req.headers["content-profile"] || "public";
  requests.push(`${req.method} ${profile}:${url.pathname}${url.search}`);

  const send = (body, status = 200, extra = {}) => {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      ...extra,
    });
    res.end(JSON.stringify(body));
  };

  // Auth: any request with our token is Anna.
  if (url.pathname === "/auth/v1/user") return send({
    id: USER_ID, aud: "authenticated", role: "authenticated",
    email: "anna@hs-experts.com", email_confirmed_at: new Date().toISOString(),
    app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString(),
  });

  if (url.pathname === "/auth/v1/token") return send({
    access_token: "stub-access", token_type: "bearer", expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "stub-refresh",
    user: { id: USER_ID, email: "anna@hs-experts.com", aud: "authenticated", role: "authenticated" },
  });

  // PostgREST, `time` schema.
  if (profile === "time") {
    if (url.pathname === "/rest/v1/entry") {
      // A single-row lookup (the running-timer probe) asks for maybeSingle.
      if (url.searchParams.has("ended_at")) return send(null);
      return send(entries);
    }
    if (url.pathname === "/rest/v1/week_summary") return send(weekSummary);
    if (url.pathname === "/rest/v1/rpc/current_member_id") return send(MEMBER_ID);
    // The tracker's lookups. Listed explicitly rather than left to the
    // catch-all below, which would answer [] and leave every picker empty.
    if (url.pathname === "/rest/v1/customer") return send(customers);
    if (url.pathname === "/rest/v1/project") return send(projects);
    if (url.pathname === "/rest/v1/service") return send(services);
    if (url.pathname === "/rest/v1/task") return send(tasks);
    if (url.pathname.startsWith("/rest/v1/")) return send([]);
  }

  // public schema: just enough for requirePermission() to succeed.
  if (url.pathname === "/rest/v1/app_user_profile") {
    // .maybeSingle() asks for a single object via the Accept header; anything
    // else is a list query.
    const wantsObject = (req.headers.accept ?? "").includes("pgrst.object");
    return send(wantsObject ? PROFILE : [PROFILE]);
  }
  if (url.pathname === "/rest/v1/rpc/app_user_has_permission") return send(true);
  if (url.pathname === "/rest/v1/rpc/app_user_role") return send("exec");
  if (url.pathname === "/rest/v1/rpc/app_user_modules") return send([]);
  if (url.pathname === "/rest/v1/people") return send([{ id: "p-anna", name: "Anna Beck" }]);
  if (url.pathname === "/rest/v1/sync_sources") return send([]);
  if (url.pathname.startsWith("/rest/v1/")) return send([]);

  send({}, 404);
});

await new Promise((r) => server.listen(PORT, r));
console.log(`stub Supabase on http://localhost:${PORT}`);

// ── The real Next.js server, built and run against the stub ────────────────
const APP_PORT = 3111;
const stubEnv = {
  ...process.env,
  NEXT_PUBLIC_SUPABASE_URL: `http://localhost:${PORT}`,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "stub-anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "stub-service-key",
  NEXT_PUBLIC_SITE_URL: `http://localhost:${APP_PORT}`,
};

const DIST = ".next-acceptance";

if (REBUILD) {
  // A dedicated build directory, via next.config.ts's NEXT_ACCEPTANCE_DIST.
  //
  // The previous version moved .next aside and restored it. That failed with EPERM
  // on Windows whenever a handle was still open on the directory, and it is unsafe
  // even when it works: parallel agent sessions run their own servers out of .next,
  // so swapping it can destroy another session's build. One run did leave the stub
  // build in .next and it had to be rebuilt by hand. A separate dist dir touches
  // nothing shared, so there is nothing to restore.
  console.log("building against the stub (NEXT_PUBLIC_* are compile-time)...");
  const build = spawnSync("npx", ["next", "build"], {
    env: { ...stubEnv, NEXT_ACCEPTANCE_DIST: DIST },
    shell: true,
    encoding: "utf8",
  });
  if (build.status !== 0) {
    console.log("FAIL: build against the stub failed");
    console.log((build.stdout ?? "") + (build.stderr ?? ""));
    server.close();
    process.exit(1);
  }
  console.log("build ok\n");
}


const app = spawn("npx", ["next", "start", "--port", String(APP_PORT)], {
  env: { ...stubEnv, NEXT_ACCEPTANCE_DIST: REBUILD ? DIST : ".next" },
  shell: true,
  stdio: "pipe",
});

let appLog = "";
app.stdout.on("data", (d) => (appLog += d));
app.stderr.on("data", (d) => (appLog += d));

const cleanup = () => {
  clearTimeout(watchdog);
  // `npm run start` under a shell spawns a grandchild (next-server) that owns the
  // port. Killing only the npm wrapper leaves that grandchild listening -- it
  // did, and it had to be killed by hand afterwards. taskkill /T kills the tree.
  try {
    if (process.platform === "win32" && app.pid) {
      spawnSync("taskkill", ["/PID", String(app.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      app.kill("SIGKILL");
    }
  } catch { /* already gone */ }
  try { server.close(); } catch { /* already closed */ }
  cleanupBuild();
};

// A watchdog, because the first version of this script hung for ten minutes with
// no output: the readiness loop polled a server that had already failed to start
// and nothing ever printed the reason. Any hang now dies loudly with the app's
// own log attached.
const WATCHDOG_MS = 120_000;
const watchdog = setTimeout(() => {
  console.log(`\nFAIL: timed out after ${WATCHDOG_MS / 1000}s`);
  console.log("--- app log (last 3000 chars) ---");
  console.log(appLog.slice(-3000) || "(nothing)");
  console.log("--- stub requests ---");
  console.log(requests.join("\n") || "(none)");
  cleanup();
  process.exit(1);
}, WATCHDOG_MS);
watchdog.unref?.();



let up = false;
for (let i = 0; i < 60; i++) {
  // If the child died, stop polling and say so rather than waiting out the loop.
  if (app.exitCode !== null) {
    console.log(`FAIL: app server exited with code ${app.exitCode} before listening`);
    console.log(appLog.slice(-3000));
    cleanup();
    process.exit(1);
  }
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
  console.log(appLog.slice(-3000));
  cleanup();
  process.exit(1);
}
console.log(`app on http://localhost:${APP_PORT}\n`);

// ── Drive it in a real browser ─────────────────────────────────────────────
const { chromium } = await import("playwright");
const browser = await chromium.launch();
let text = "";

try {
  const ctx = await browser.newContext();

  // The session cookie @supabase/ssr expects.
  //
  // Two details had to be discovered rather than guessed, and both silently
  // caused a redirect to /auth/login when wrong:
  //
  //  - the cookie NAME is `sb-${hostname.split(".")[0]}-auth-token`, per
  //    supabase-js's own defaultStorageKey, so a stub on localhost means
  //    `sb-localhost-auth-token`.
  //  - `access_token` must be a structurally valid JWT (three base64url parts
  //    with sub/aud/role/exp in the payload). The library parses it locally
  //    before it will even call /auth/v1/user; an opaque string is dropped and
  //    the request never happens. The signature is never checked here, which is
  //    why an unsigned token works against the stub.
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const accessToken =
    `${b64({ alg: "HS256", typ: "JWT" })}.` +
    `${b64({
      sub: USER_ID,
      aud: "authenticated",
      role: "authenticated",
      iat: now,
      exp: now + 3600,
      email: "anna@hs-experts.com",
    })}.stubsig`;

  const user = {
    id: USER_ID, aud: "authenticated", role: "authenticated",
    email: "anna@hs-experts.com", app_metadata: {}, user_metadata: {},
    created_at: new Date().toISOString(),
  };

  const session = {
    access_token: accessToken, token_type: "bearer", expires_in: 3600,
    expires_at: now + 3600, refresh_token: "stub-refresh", user,
  };

  await ctx.addCookies([{
    name: "sb-localhost-auth-token",
    value: "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url"),
    domain: "localhost", path: "/", httpOnly: false, secure: false, sameSite: "Lax",
  }]);

  const page = await ctx.newPage();
  // ?view=records explicitly. /time defaults to the tracker now that the module
  // has a write path, and every assertion below is about the read-only week
  // list — the totals strip, the entry list and the week summary table. Landing
  // on the default would fail them all while the page was working perfectly,
  // which is the most misleading shape a failing gate can take.
  const resp = await page.goto(`http://localhost:${APP_PORT}/time?view=records`, {
    waitUntil: "domcontentloaded",
  });
  // Wait for content, not just for the document. innerText read straight after
  // domcontentloaded came back empty and failed every assertion below -- and only
  // sometimes, which is the worst kind of test.
  await page.locator("h1").first().waitFor({ state: "visible", timeout: 15_000 }).catch(() => {});

  check("GET /time returns 200 for a signed-in user", resp?.status() === 200, `status ${resp?.status()}`);
  check("the browser was not bounced to /auth/login", !page.url().includes("/auth/login"), page.url());

  text = (await page.locator("body").innerText()).replace(/\s+/g, " ");

  // The figures a person would read.
  check("the page shows 3:30 logged", text.includes("3:30"), "");
  check("the page shows 2:00 billable", text.includes("2:00"));
  check("the page shows 1:00 calendar", text.includes("1:00"));
  check("the page shows 3.50 decimal hours", text.includes("3.50"));
  check("the page shows 57% billable share", text.includes("57%"));

  // The rows.
  check("the task name appears", text.includes("Site inspection"));
  check("the customer appears", text.includes("Muster GmbH"));
  check("the project appears", text.includes("DGUV V2 Betreuung"));
  check("an untagged entry reads 'No customer'", text.includes("No customer"));

  // The week summary.
  check("the member appears in the week summary", text.includes("Anna Beck"));
  check("utilisation shows 9% of a 40h contract", text.includes("9%"));
  check("the 40:00 contract appears", text.includes("40:00"));

  // And the empty state must NOT be showing.
  check(
    "the 'no record linked' empty state is absent",
    !text.includes("No time-tracking record linked"),
  );
  check("the 'nothing tracked' empty state is absent", !text.includes("Nothing tracked this week"));

  // The unit bug this whole module guards against.
  check(
    "no seconds-as-minutes artefact (210:00) anywhere on the page",
    !text.includes("210:00"),
  );

  // It really went through the `time` schema rather than falling back.
  const timeCalls = requests.filter((r) => r.startsWith("GET time:"));
  check(
    "the app queried the `time` schema over HTTP",
    timeCalls.length > 0,
    `${timeCalls.length} calls, e.g. ${timeCalls[0] ?? "none"}`,
  );

  // ── The tracker (the module's write surface) ───────────────────────────────
  // Same browser, same session. The assertions above prove a user can READ
  // their hours; these prove the surface that lets them LOG hours actually
  // renders, with its pickers populated from the `time` schema rather than
  // empty. An empty <select> is the failure mode that looks fine in a
  // screenshot and makes the form unusable.
  await page.goto(`http://localhost:${APP_PORT}/time?view=track`, {
    waitUntil: "domcontentloaded",
  });
  await page.locator("h1").first().waitFor({ state: "visible", timeout: 15_000 }).catch(() => {});
  const track = (await page.locator("body").innerText()).replace(/\s+/g, " ");

  check("the tracker renders a start-timer form", track.includes("START A TIMER"));
  check("the tracker offers manual entry", track.includes("LOG TIME MANUALLY"));
  check(
    "the header reports no timer running",
    track.includes("NO TIMER RUNNING"),
    "the meta line is how a user knows whether the clock is going",
  );
  check(
    "the UTC convention is stated on the manual form",
    track.includes("Times are read in UTC"),
    "a user off UTC needs to know which clock the fields are on before typing, not after",
  );
  check(
    "today's entries are listed with a delete control",
    track.includes("TODAY") && track.includes("Delete"),
  );

  // The pickers must be populated. Counted in the DOM rather than the text,
  // because a <select> with only its placeholder still reads as "No project".
  const projectOptions = await page.locator("#timer-project option").count();
  check(
    "the project picker is populated from the time schema",
    projectOptions > 1,
    `${projectOptions} options — 1 means only the "No project" placeholder rendered`,
  );
  const serviceOptions = await page.locator("#timer-service option").count();
  check(
    "the service picker is populated",
    serviceOptions > 1,
    `${serviceOptions} options`,
  );
  check(
    "unpaid travel is marked in the service picker",
    track.includes("(unpaid)"),
    "the vendor hides paid-vs-unpaid travel inside two near-identical labels; unmarked, the wrong one gets billed",
  );

  // The tracker must never show somebody else's time: it is always the
  // signed-in member's own day, so the scope switch has no meaning here.
  check(
    "the tracker does not offer a team scope switch",
    !/Track Records My time Team/.test(track),
    "offering 'Team' on the tracker would imply you can start a timer for a colleague",
  );
} finally {
  await browser.close();
  cleanup();
}

if (failed) {
  console.log("\n--- page text ---\n" + text.slice(0, 1500));
  console.log("\n--- requests ---\n" + requests.join("\n"));
}

console.log(
  failed
    ? "\nTIME ACCEPTANCE: a signed-in user would NOT see correct hours"
    : "\nTIME ACCEPTANCE: a signed-in user sees their real tracked hours, end to end",
);
process.exit(failed ? 1 : 0);
