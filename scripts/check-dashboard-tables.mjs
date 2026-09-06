/**
 * Acceptance gate for the TrackingTime Dashboard's data-access surface.
 *
 * THE BUG THIS EXISTS TO PREVENT COMING BACK
 * ------------------------------------------
 * Every table on the dashboard used to render `rows.slice(0, 40)` (25 for budget
 * and entries). On live data that is 334 projects, so grouping by project showed
 * 40 and left 294 unreachable from anywhere on the page. The panel hint said "top
 * 40 of 334", so nothing looked broken -- and that is exactly why a build, a
 * typecheck and every existing gate passed while the report could not answer a
 * question about most of the company's projects.
 *
 * A regression here is invisible to all of those checks. It is only visible by
 * counting rendered rows against a seed big enough to exceed the old cap, which
 * is what this does: 60 projects, so 40-row truncation is unmistakable, driven in
 * a real browser against the real Next.js server.
 *
 * WHY A STUB SUPABASE, and what that costs: the live project does not expose the
 * `time` schema, so against it this page can only ever produce its empty state.
 * The stub speaks the two protocols the app talks (Supabase Auth well enough for
 * @supabase/ssr to accept a cookie session, and PostgREST including
 * Accept-Profile: time). It proves OUR wiring, not Supabase's -- and every
 * failure it can catch is in our code: a reinstated slice, a sort comparator that
 * puts nulls first, a search box that filters nothing, a CSV that exports the
 * wrong rows.
 *
 * Run: node scripts/check-dashboard-tables.mjs
 * Reuse an existing build (much faster, only safe when the app has not changed):
 *      ACCEPTANCE_REBUILD=0 node scripts/check-dashboard-tables.mjs
 */
import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import fs, { existsSync, rmSync } from "node:fs";

// `next build` appends its dist dir's type paths to tsconfig.json's "include".
// With a probe distDir that pollutes the SHARED config with entries naming a
// directory that exists only during this run. Snapshot it and put it back.
const TSCONFIG_SNAPSHOT = existsSync("tsconfig.json") ? fs.readFileSync("tsconfig.json") : null;

function restoreTsconfig() {
  if (!TSCONFIG_SNAPSHOT) return;
  try {
    if (!fs.readFileSync("tsconfig.json").equals(TSCONFIG_SNAPSHOT)) {
      fs.writeFileSync("tsconfig.json", TSCONFIG_SNAPSHOT);
    }
  } catch {
    // A stale include path is harmless to tsc, just untidy.
  }
}
// Registered rather than only called from cleanup(): a failing assertion or an
// early exit bypasses cleanup(), and that did leave the probe paths behind once.
process.on("exit", restoreTsconfig);

let failed = false;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed = true;
};

const USER_ID = "11111111-1111-1111-1111-111111111111";
const MEMBER_ID = 7;

// ── Seed ───────────────────────────────────────────────────────────────────
// 60 projects, deliberately more than the old 40-row breakdown cap and well past
// the 25-row budget/entry caps, each with a hand-computable duration so a
// rendered total can be checked rather than merely observed to exist.
//
// Project i logs (i + 1) * 600 seconds, so hours are 0.17 … 10.0 and every row
// is distinct -- a sort assertion over tied values proves nothing.
const PROJECT_COUNT = 60;
const projects = [];
const customers = [];
const entries = [];

for (let i = 0; i < PROJECT_COUNT; i++) {
  const id = 100 + i;
  // Names are zero-padded so a lexical sort and a numeric sort agree, and the
  // assertions can name an exact expected first row.
  const name = `Projekt ${String(i).padStart(2, "0")} Betreuung`;
  const customerId = 1 + (i % 5);
  projects.push({
    id,
    name,
    customer_id: customerId,
    is_billable: true,
    // Two thirds carry an estimate; the rest have none, so the "omitted, not
    // shown at 0%" rule has something to omit and the budget count is checkable.
    estimated_hours: i % 3 === 0 ? null : 5,
    customer: { name: `Kunde ${customerId}` },
  });
}

for (let c = 1; c <= 5; c++) customers.push({ id: c, name: `Kunde ${c}` });

// Dates spread across the current month so a month preset contains them all.
const monthStart = (() => {
  const d = new Date();
  return `${d.toISOString().slice(0, 7)}-01`;
})();

for (let i = 0; i < PROJECT_COUNT; i++) {
  const p = projects[i];
  const day = String((i % 27) + 1).padStart(2, "0");
  entries.push({
    id: 1000 + i,
    member_id: MEMBER_ID + (i % 3),
    project_id: p.id,
    customer_id: p.customer_id,
    service_id: 20,
    started_at: `${monthStart.slice(0, 8)}${day}T08:00:00+00:00`,
    ended_at: `${monthStart.slice(0, 8)}${day}T09:00:00+00:00`,
    duration_seconds: (i + 1) * 600,
    is_billable: i % 2 === 0,
    is_billed: false,
    is_calendar: false,
    notes: null,
    member: { display_name: `Member ${MEMBER_ID + (i % 3)}` },
    task: { name: `Task ${i}` },
    project: { name: p.name },
    customer: { name: `Kunde ${p.customer_id}` },
    service: { name: "Risk Assessment" },
  });
}

const TOTAL_SECONDS = entries.reduce((a, e) => a + e.duration_seconds, 0);
// 60 projects * 600 * (1+..+60)/60 -> 600 * 1830 = 1,098,000s = 305h
const TOTAL_HOURS = Math.round((TOTAL_SECONDS / 3600) * 10) / 10;
const ESTIMATED_PROJECTS = projects.filter((p) => p.estimated_hours).length;

const members = [
  { id: 7, display_name: "Member 7", user_id: USER_ID, weekly_hours: 40 },
  { id: 8, display_name: "Member 8", weekly_hours: 40 },
  { id: 9, display_name: "Member 9", weekly_hours: 40 },
];

const services = [{ id: 20, name: "Risk Assessment", is_travel: false, is_paid_travel: false }];

const PROFILE = {
  user_id: USER_ID,
  department: "HSE",
  person_id: "p-anna",
  is_active: true,
  created_at: new Date().toISOString(),
  app_role: { role_key: "exec", display_name: "Executive" },
  people: { name: "Anna Beck" },
};

// ── The stub ───────────────────────────────────────────────────────────────
const PORT = 54331;
const APP_PORT = 3113;
const requests = [];

function listenOrSkip(srv, port) {
  return new Promise((resolve) => {
    srv.once("error", (e) => {
      if (e.code === "EADDRINUSE") {
        console.log(
          `SKIP: port ${port} is already in use, probably by an earlier run that did not\n` +
            `      shut down. Free it and re-run:  netstat -ano | findstr ${port}`,
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
  requests.push(`${req.method} ${profile}:${url.pathname}${url.search}`);

  const send = (body, status = 200) => {
    res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify(body));
  };

  if (url.pathname === "/auth/v1/user")
    return send({
      id: USER_ID, aud: "authenticated", role: "authenticated",
      email: "anna@hs-experts.com", email_confirmed_at: new Date().toISOString(),
      app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString(),
    });

  if (url.pathname === "/auth/v1/token")
    return send({
      access_token: "stub-access", token_type: "bearer", expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "stub-refresh",
      user: { id: USER_ID, email: "anna@hs-experts.com", aud: "authenticated", role: "authenticated" },
    });

  if (profile === "time") {
    if (url.pathname === "/rest/v1/entry") {
      if (url.searchParams.has("ended_at")) return send(null);

      let rows = entries;
      const eqBool = (param, field) => {
        const raw = url.searchParams.get(param);
        if (raw === "eq.true") rows = rows.filter((e) => e[field] === true);
        else if (raw === "eq.false") rows = rows.filter((e) => e[field] === false);
      };
      eqBool("is_billable", "is_billable");
      eqBool("is_calendar", "is_calendar");

      for (const bound of url.searchParams.getAll("started_at")) {
        if (bound.startsWith("gte.")) rows = rows.filter((e) => e.started_at >= bound.slice(4));
        else if (bound.startsWith("lt.")) rows = rows.filter((e) => e.started_at < bound.slice(3));
      }

      const inList = (param, field) => {
        const raw = url.searchParams.get(param);
        if (raw?.startsWith("in.")) {
          const ids = raw.slice(3).replace(/[()]/g, "").split(",").map(Number);
          rows = rows.filter((e) => ids.includes(e[field]));
        }
      };
      inList("member_id", "member_id");
      inList("project_id", "project_id");
      inList("customer_id", "customer_id");
      inList("service_id", "service_id");

      // Paging. supabase-js's .range() compiles to `offset`/`limit` QUERY
      // PARAMS, not to a Range header -- checking the header (as an earlier
      // version of this stub did) meant every page returned all 60 rows, the
      // report never saw a short page, and fetchAllEntries looped to its
      // 25-page ceiling and reported 1,500 duplicated entries. An offset past
      // the data must answer [] so the loop terminates.
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const limit = Number(url.searchParams.get("limit") ?? rows.length);
      const paged = rows.slice(offset, offset + (Number.isFinite(limit) ? limit : rows.length));
      return send(paged);
    }

    if (url.pathname === "/rest/v1/project") return send(projects);
    if (url.pathname === "/rest/v1/customer") return send(customers);
    if (url.pathname === "/rest/v1/member") return send(members);
    if (url.pathname === "/rest/v1/service") return send(services);
    if (url.pathname === "/rest/v1/week_summary") return send([]);
    if (url.pathname === "/rest/v1/rpc/current_member_id") return send(MEMBER_ID);
    // Economics: money is a separate permission and the page passes p_from/p_to.
    // Answering with rows lets the panel's presence and its period-scoping both
    // be asserted.
    if (url.pathname === "/rest/v1/rpc/project_economics") {
      return send(
        projects.slice(0, 30).map((p, i) => ({
          project_id: p.id,
          project_name: p.name,
          customer_name: `Kunde ${p.customer_id}`,
          total_seconds: (i + 1) * 600,
          billable_seconds: (i + 1) * 300,
          revenue: (i + 1) * 100,
          cost: (i + 1) * 40,
          margin: (i + 1) * 60,
          margin_percent: 60,
        })),
      );
    }
    if (url.pathname.startsWith("/rest/v1/")) return send([]);
  }

  if (url.pathname === "/rest/v1/app_user_profile") {
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

if (!(await listenOrSkip(server, PORT))) process.exit(0);
console.log(`stub Supabase on http://localhost:${PORT}`);

// ── The real Next.js server, built against the stub ────────────────────────
// NEXT_PUBLIC_* are compile-time constants inlined into the server chunks, so
// passing them in the spawn env has NO effect on an existing build: the app keeps
// talking to the real project and the stub logs nothing. The app must be REBUILT.
const REBUILD = process.env.ACCEPTANCE_REBUILD !== "0";
const DIST = ".next-tables";

const stubEnv = {
  ...process.env,
  NEXT_PUBLIC_SUPABASE_URL: `http://localhost:${PORT}`,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "stub-anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "stub-service-key",
  NEXT_PUBLIC_SITE_URL: `http://localhost:${APP_PORT}`,
};

if (REBUILD) {
  console.log("building against the stub (NEXT_PUBLIC_* are compile-time)...");
  const build = spawnSync("npx", ["next", "build"], {
    env: { ...stubEnv, NEXT_ACCEPTANCE_DIST: DIST },
    shell: true,
    encoding: "utf8",
  });
  if (build.status !== 0) {
    console.log("FAIL: build against the stub failed");
    console.log((build.stdout ?? "") + (build.stderr ?? ""));
    restoreTsconfig();
    server.close();
    process.exit(1);
  }
  console.log("build ok\n");
}

const app = spawn("npx", ["next", "start", "--port", String(APP_PORT)], {
  env: { ...stubEnv, NEXT_ACCEPTANCE_DIST: REBUILD ? DIST : ".next" },
  shell: true,
  stdio: "pipe",
  // Its own process group on POSIX, so cleanup can kill the TREE. Under a
  // shell the listener is a grandchild (sh -> npm -> next-server); killing the
  // wrapper alone left next-server on the port after every run on Linux, and
  // the next run then drove that orphan -- serving a build whose dist this
  // cleanup had already deleted, so nothing hydrated and every control read
  // as dead (measured 2026-09-05: three consecutive runs, all against a
  // leaked server from the run before).
  detached: process.platform !== "win32",
});

let appLog = "";
app.stdout.on("data", (d) => (appLog += d));
app.stderr.on("data", (d) => (appLog += d));

const cleanup = () => {
  restoreTsconfig();
  clearTimeout(watchdog);
  // Under a shell, `next start` owns the port via a grandchild; killing only the
  // wrapper leaves it listening. /T kills the tree.
  try {
    if (process.platform === "win32" && app.pid) {
      spawnSync("taskkill", ["/PID", String(app.pid), "/T", "/F"], { stdio: "ignore" });
    } else if (app.pid) {
      // Negative pid: the whole process group, grandchild included.
      process.kill(-app.pid, "SIGKILL");
    }
  } catch { /* already gone */ }
  try { server.close(); } catch { /* already closed */ }
  if (REBUILD) {
    try { rmSync(DIST, { recursive: true, force: true }); } catch { /* windows handle */ }
  }
};

const WATCHDOG_MS = 180_000;
const watchdog = setTimeout(() => {
  console.log(`\nFAIL: timed out after ${WATCHDOG_MS / 1000}s`);
  console.log("--- app log (last 3000) ---\n" + (appLog.slice(-3000) || "(nothing)"));
  cleanup();
  process.exit(1);
}, WATCHDOG_MS);
watchdog.unref?.();

let up = false;
for (let i = 0; i < 90; i++) {
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
const { launchChromium } = await import("./lib/launch-chromium.mjs");
const browser = await launchChromium();

try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });

  // The session cookie @supabase/ssr expects. Two details that both fail as a
  // silent redirect to /auth/login when wrong: the cookie NAME derives from the
  // URL hostname (`sb-localhost-auth-token`), and access_token must be a
  // STRUCTURALLY valid JWT because the library parses it locally before it will
  // call /auth/v1/user at all. The signature is never checked here.
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const accessToken =
    `${b64({ alg: "HS256", typ: "JWT" })}.` +
    `${b64({ sub: USER_ID, aud: "authenticated", role: "authenticated", iat: now, exp: now + 3600, email: "anna@hs-experts.com" })}.stubsig`;
  const user = {
    id: USER_ID, aud: "authenticated", role: "authenticated",
    email: "anna@hs-experts.com", app_metadata: {}, user_metadata: {},
    created_at: new Date().toISOString(),
  };
  await ctx.addCookies([{
    name: "sb-localhost-auth-token",
    value: "base64-" + Buffer.from(JSON.stringify({
      access_token: accessToken, token_type: "bearer", expires_in: 3600,
      expires_at: now + 3600, refresh_token: "stub-refresh", user,
    })).toString("base64url"),
    domain: "localhost", path: "/", httpOnly: false, secure: false, sameSite: "Lax",
  }]);

  // Mark the onboarding tour as seen BEFORE the page exists. It is a first-login
  // modal that dims the whole page behind it, so without this every screenshot
  // is of an overlay and a click can land on the scrim rather than the control it
  // named. addInitScript must be registered on the CONTEXT before newPage(), or
  // it does not run for the first navigation -- which is the only one that
  // matters here.
  await ctx.addInitScript(() => {
    try {
      window.localStorage.setItem("hse_tour_done", "1");
    } catch {
      /* storage disabled; the tour is cosmetic here either way */
    }
  });

  const page = await ctx.newPage();
  // Surface a client-side crash instead of letting it read as "the table has no
  // rows". A hydration error in DataTable would otherwise fail the row-count
  // assertions with a completely misleading message.
  const consoleErrors = [];
  page.on("pageerror", (e) => consoleErrors.push(String(e)));

  const goto = async (qs) => {
    const resp = await page.goto(`http://localhost:${APP_PORT}/time/dashboard?${qs}`, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    await page.locator("text=TOTAL HOURS").first().waitFor({ state: "visible", timeout: 20_000 }).catch(() => {});
    return resp;
  };

  /** The <section> whose header names this panel. */
  const panel = (title) =>
    page.locator("section").filter({ has: page.locator(`h2:text-is("${title}")`) });

  const rowCount = async (title) => panel(title).locator("tbody tr").count();

  /**
   * Open a collapsed panel.
   *
   * Budget burn, economics and the entry list ship collapsed: four full tables
   * stacked made the page ~6,500px tall, so the breakdown you came for scrolled
   * away and nothing below it was ever seen. Their headline facts stay in the
   * collapsed summary, which is asserted separately below -- collapsing must
   * hide the rows, never the fact that rows exist.
   */
  const expand = async (title) => {
    const header = panel(title).locator("button[aria-expanded]").first();
    for (let i = 0; i < 12; i++) {
      if ((await header.getAttribute("aria-expanded")) === "true") return true;
      await header.click();
      await page.waitForTimeout(120);
    }
    return (await header.getAttribute("aria-expanded")) === "true";
  };

  /**
   * Row count after a client-side interaction, polled.
   *
   * Reading the count immediately after a click races React's re-render: an
   * earlier version asserted "ALL shows 60" against a DOM that still held the
   * previous 25 and reported the feature broken when it worked. Polling to an
   * EXPECTED value with a timeout keeps the failure message honest -- it still
   * fails if the number never arrives.
   */
  const waitForRows = async (title, expected, timeout = 5000) => {
    const started = Date.now();
    let last = -1;
    while (Date.now() - started < timeout) {
      last = await rowCount(title);
      if (last === expected) return last;
      await page.waitForTimeout(100);
    }
    return last;
  };

  /**
   * Click a control and confirm it took effect, retrying if not.
   *
   * THE RACE THIS EXISTS FOR: the first click after a navigation can land before
   * React has hydrated the table, so the DOM button exists, Playwright clicks it
   * happily, and nothing happens because no handler is attached yet. That failed
   * as "ALL shows 25 rows" -- indistinguishable from the truncation bug this
   * whole gate is about, which is the worst possible false positive here.
   */
  const clickUntil = async (locator, settled, attempts = 12) => {
    for (let i = 0; i < attempts; i++) {
      await locator.click();
      // A short settle window per attempt rather than one long one, so a lost
      // pre-hydration click is retried rather than waited out.
      for (let j = 0; j < 10; j++) {
        if (await settled()) return true;
        await page.waitForTimeout(100);
      }
    }
    return await settled();
  };

  // ── 1. The report loads at all ───────────────────────────────────────────
  const resp = await goto("preset=this_month&group=project&bucket=day");
  check("GET /time/dashboard returns 200 for a signed-in exec", resp?.status() === 200, `status ${resp?.status()}`);
  check("not bounced to /auth/login", !page.url().includes("/auth/login"), page.url());

  const text = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  if (process.env.DUMP === "1") {
    fs.writeFileSync("tmp-tables-text.txt", text);
    fs.writeFileSync("tmp-tables-requests.txt", requests.join("\n"));
    fs.writeFileSync("tmp-tables-applog.txt", appLog);
    console.log("(dumped page text and stub requests)");
  }
  // The page has an error boundary, so a server-side throw renders as a tidy
  // "This page couldn't load" card -- which then fails every assertion below
  // with a misleading message about missing rows. Name the real cause instead.
  if (/This page couldn't load/.test(text)) {
    check("the dashboard rendered rather than hitting its error boundary", false,
      `server threw. Last app log:\n${appLog.slice(-2500)}`);
  }
  check(
    "the seeded total is reported",
    text.includes(`${TOTAL_HOURS.toLocaleString("en-GB")}h`),
    `expected ${TOTAL_HOURS}h from ${PROJECT_COUNT} entries; page says: ${text.slice(0, 200)}`,
  );

  // ── 2. THE REGRESSION: no table silently truncates ───────────────────────
  // 60 projects. The old code rendered 40 with no control able to reach the
  // rest, so the count and the reachability are both asserted.
  const breakdownRows = await rowCount("BY PROJECT");
  check(
    "the breakdown pages rather than truncating (25 of 60 on page 1)",
    breakdownRows === 25,
    `${breakdownRows} rows — 40 means the old slice(0, 40) is back, 60 means paging is not applied`,
  );
  check(
    "the breakdown states the full row count, not a 'top N'",
    /1–25 of 60/.test(text),
    "the header must say how many rows exist in total, so a page-1 view is never mistaken for everything",
  );

  // Reaching row 60 is the whole point. ALL removes the page limit.
  await clickUntil(
    panel("BY PROJECT").getByRole("button", { name: "ALL" }),
    async () => (await rowCount("BY PROJECT")) === PROJECT_COUNT,
  );
  const allRows = await rowCount("BY PROJECT");
  check(
    "every one of the 60 projects is reachable via ALL",
    allRows === PROJECT_COUNT,
    `${allRows} rows with ALL selected — the previous build could reach at most 40`,
  );
  // And the LAST project, the one furthest from the top of a hours-sorted list,
  // is actually in the DOM. A count alone could be satisfied by 60 copies of
  // row 1.
  check(
    "the smallest project (rank 60) is rendered, not just counted",
    await panel("BY PROJECT").getByText("Projekt 00 Betreuung", { exact: false }).first().isVisible(),
    "Projekt 00 has the fewest hours, so it sorts last and was unreachable before",
  );

  // ── 3. Sorting actually reorders ─────────────────────────────────────────
  const firstRowName = async (title) =>
    (await panel(title).locator("tbody tr").first().innerText()).split("\n")[0].trim();

  // Default is hours descending, so the largest (Projekt 59) leads.
  const topByHours = await firstRowName("BY PROJECT");
  check(
    "the breakdown defaults to hours descending",
    topByHours.startsWith("Projekt 59"),
    `first row is "${topByHours}", expected the 10h project`,
  );

  await panel("BY PROJECT").getByRole("button", { name: /^Hours/ }).click();
  const topAscending = await firstRowName("BY PROJECT");
  check(
    "clicking the sorted column reverses it",
    topAscending.startsWith("Projekt 00"),
    `first row after reversing is "${topAscending}", expected the 0.2h project`,
  );
  // A negative control: if BOTH ends were the same row the assertions above
  // would pass on a table that never sorted at all.
  check(
    "control: the two sort directions really produce different first rows",
    topByHours !== topAscending,
    "sorting changed nothing, so the assertions above prove nothing",
  );

  await panel("BY PROJECT").getByRole("button", { name: /^project/i }).first().click();
  const topByName = await firstRowName("BY PROJECT");
  check(
    "a text column sorts alphabetically, ascending first",
    topByName.startsWith("Projekt 00"),
    `first row is "${topByName}"`,
  );

  // ── 4. In-table search narrows ───────────────────────────────────────────
  const search = panel("BY PROJECT").getByPlaceholder(/Find project/i);
  // "Betreuung 1" would be ambiguous: every row's customer hint is "Kunde N", so
  // a bare "1" also matches Kunde 1. Searching a full padded name is exact --
  // "Projekt 07" matches precisely one row, which is the sharpest possible
  // assertion that the search reaches the data.
  await search.fill("Projekt 07");
  const searchedOne = await waitForRows("BY PROJECT", 1);
  check(
    "search narrows to the single exact match",
    searchedOne === 1,
    `${searchedOne} rows for "Projekt 07", expected exactly 1`,
  );

  // The expectation is computed by REPLAYING the component's own rule -- every
  // whitespace-separated term must appear somewhere in the row's searchable text
  // -- rather than by eyeballing a number.
  //
  // That distinction matters here: "Projekt 1" is two terms, so the "1" also
  // matches every project whose customer hint is "Kunde 1". The answer is 25,
  // not the 11 a name-only reading suggests, and 11 was what an earlier version
  // of this gate asserted and failed on while the search worked correctly.
  const matchesSearch = (p, q) => {
    const hay = `${p.name} ${p.customer.name}`.toLowerCase();
    return q
      .toLowerCase()
      .trim()
      .split(/\s+/)
      .every((t) => hay.includes(t));
  };
  const EXPECT_PROJEKT_1 = projects.filter((p) => matchesSearch(p, "Projekt 1")).length;
  await search.fill("Projekt 1");
  const searched = await waitForRows("BY PROJECT", EXPECT_PROJEKT_1);
  check(
    "in-table search matches on the customer hint as well as the name",
    searched === EXPECT_PROJEKT_1 && searched < PROJECT_COUNT,
    `${searched} rows for "Projekt 1", expected ${EXPECT_PROJEKT_1} — and fewer than all ${PROJECT_COUNT}, or the search filtered nothing`,
  );
  const searchedText = (await panel("BY PROJECT").innerText()).replace(/\s+/g, " ");
  check(
    "search reports what it filtered from",
    /filtered from 60/.test(searchedText),
    "a filtered count with no 'of 60' reads as the whole dataset",
  );
  // Multi-term search must AND, not OR. "Projekt 07 Kunde 3" is Projekt 07 and
  // its own customer, so it stays at one row; swapping in a customer that
  // project does NOT belong to must drop to zero. That pair is the sharp test:
  // an OR would return every Kunde 3 project in both cases.
  await search.fill("Projekt 07 Kunde 3");
  const andedHit = await waitForRows("BY PROJECT", 1);
  check(
    "AND-search keeps a row when every term matches it",
    andedHit === 1,
    `${andedHit} rows for "Projekt 07 Kunde 3" (Projekt 07 belongs to Kunde 3), expected 1`,
  );
  await search.fill("Projekt 07 Kunde 4");
  const andedMiss = await waitForRows("BY PROJECT", 0);
  check(
    "AND-search drops a row when one term does not match, rather than ORing",
    andedMiss === 0,
    `${andedMiss} rows for "Projekt 07 Kunde 4" — Projekt 07 is Kunde 3, so ANDing gives 0 while ORing would list every Kunde 4 project`,
  );

  await search.fill("zzzzz-no-such-project");
  const noMatch = (await panel("BY PROJECT").innerText()).replace(/\s+/g, " ");
  check(
    "a search with no match explains itself and offers a way back",
    /No row matches/.test(noMatch) && /Clear the search/.test(noMatch),
    "an empty table with no explanation reads as missing data",
  );
  await panel("BY PROJECT").getByRole("button", { name: /Clear the search/i }).click();
  check(
    "clearing the search restores every row",
    (await rowCount("BY PROJECT")) > 11,
    "rows did not come back after clearing",
  );

  // ── 5. Paging ────────────────────────────────────────────────────────────
  await goto("preset=this_month&group=project&bucket=day");
  const pager = panel("BY PROJECT");
  check(
    "page 1 of 3 is stated for 60 rows at 25 per page",
    /1 \/ 3/.test((await pager.innerText()).replace(/\s+/g, " ")),
    "the pager must say where you are",
  );
  check(
    "PREV is disabled on the first page",
    await pager.getByRole("button", { name: /PREV/ }).isDisabled(),
    "an enabled PREV on page 1 is a dead control",
  );
  await pager.getByRole("button", { name: /NEXT/ }).click();
  const page2 = (await pager.innerText()).replace(/\s+/g, " ");
  check("NEXT advances the page", /2 \/ 3/.test(page2), "the pager did not advance");
  check(
    "page 2 shows rows 26–50",
    /26–50 of 60/.test(page2),
    "the range line must track the page",
  );
  await pager.getByRole("button", { name: /NEXT/ }).click();
  await pager.getByRole("button", { name: /NEXT/ }).click().catch(() => {});
  check(
    "NEXT is disabled on the last page",
    await pager.getByRole("button", { name: /NEXT/ }).isDisabled(),
    "paging past the end must not be offered",
  );

  // ── 6. Budget burn and the entry table are equally complete ─────────────
  // Both ship collapsed. First: a collapsed panel must still say how much is in
  // it. If it did not, hiding rows to shorten the page would be indistinguishable
  // from having no rows -- which is the same class of dishonesty as the "top 40
  // of 334" hint this whole change removed.
  const collapsedBudget = (await panel("BUDGET BURN").innerText()).replace(/\s+/g, " ");
  check(
    "a collapsed panel still states its row count and headline",
    /with an estimate/.test(collapsedBudget) && /over budget/.test(collapsedBudget),
    `collapsed summary was: ${collapsedBudget.slice(0, 160)}`,
  );
  check(
    "the collapsed summary does not repeat itself",
    (collapsedBudget.match(/over budget/g) ?? []).length === 1,
    `"over budget" appears ${(collapsedBudget.match(/over budget/g) ?? []).length} times — the standalone summary and the open-state hint were both being rendered`,
  );
  check(
    "a collapsed panel renders no rows, so it genuinely shortens the page",
    (await rowCount("BUDGET BURN")) === 0,
    "the rows are still in the DOM, so collapsing saved nothing",
  );
  check("budget burn expands on click", await expand("BUDGET BURN"));

  const budgetText = (await panel("BUDGET BURN").innerText()).replace(/\s+/g, " ");
  check(
    "budget burn counts every project WITH an estimate",
    budgetText.includes(`of ${ESTIMATED_PROJECTS}`),
    `expected ${ESTIMATED_PROJECTS} estimated projects, panel says: ${budgetText.slice(0, 160)}`,
  );
  check(
    "budget burn still omits projects with no estimate rather than showing 0%",
    /without an estimate are omitted/.test(budgetText),
    "the rule must stay stated on the panel, since an omission is invisible",
  );

  check("the entry list expands on click", await expand("TIME ENTRIES"));
  const entriesText = (await panel("TIME ENTRIES").innerText()).replace(/\s+/g, " ");
  check(
    "the entry table exposes all 60 entries, not 25",
    entriesText.includes("of 60"),
    `panel says: ${entriesText.slice(0, 160)}`,
  );

  // ── 7. CSV export ────────────────────────────────────────────────────────
  const dl = page.waitForEvent("download", { timeout: 15_000 });
  await panel("BY PROJECT").getByRole("button", { name: "CSV" }).click();
  const download = await dl;
  const path = await download.path();
  const csv = fs.readFileSync(path, "utf8");
  const csvLines = csv.trim().split(/\r?\n/);
  check(
    "the CSV exports every row, not only the visible page",
    csvLines.length === PROJECT_COUNT + 1,
    `${csvLines.length} lines including the header, expected ${PROJECT_COUNT + 1}`,
  );
  check(
    "the CSV carries a header row naming the columns",
    /project/i.test(csvLines[0]) && /hours/i.test(csvLines[0]),
    `header was: ${csvLines[0]}`,
  );
  check(
    "the CSV opens correctly in a German Excel (UTF-8 BOM present)",
    csv.charCodeAt(0) === 0xfeff,
    "without a BOM, umlauts in project names arrive mangled",
  );

  // ── 8. Filters still narrow the report (not just the table) ──────────────
  await goto("preset=this_month&billable=yes&group=project");
  const billableText = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  // Only even-indexed entries are billable: 30 of 60.
  check(
    "filtering to billable reaches the query and halves the projects",
    /1–25 of 30/.test(billableText),
    `expected 30 billable projects; page says: ${billableText.slice(0, 220)}`,
  );

  // ── 9. Economics is scoped to the selected period ────────────────────────
  // The RPC has always taken p_from/p_to; the page used to omit them and then
  // apologised for it in a caveat under the panel.
  const econCalls = requests.filter((r) => r.includes("rpc/project_economics"));
  check(
    "the economics RPC is called",
    econCalls.length > 0,
    "the money panel never queried",
  );
  check("the economics table expands on click", await expand("PROJECT ECONOMICS"));
  const econBody = (await panel("PROJECT ECONOMICS").innerText()).replace(/\s+/g, " ");
  check(
    "the economics panel no longer disclaims that it ignores the filter",
    !/not the filtered period/.test(econBody),
    "the caveat is still there, so the panel is still unscoped",
  );
  // NOTE this runs on the billable-filtered page, where only the 30 even-indexed
  // projects have billable entries and economics is intersected with the
  // projects actually in scope -- so 15 of the RPC's 30 rows is the CORRECT
  // answer here, not truncation. The point being asserted is that the old hard
  // limit of 15 is gone, so the count must be driven by the data. Re-checked on
  // the unfiltered page below, where all 30 are in scope.
  check(
    "the economics table row count follows the selection",
    /1–15 of 15/.test(econBody),
    `panel says: ${econBody.slice(0, 200)}`,
  );
  await goto("preset=this_month&group=project&bucket=day");
  check("economics expands on the unfiltered page", await expand("PROJECT ECONOMICS"));
  const econAll = (await panel("PROJECT ECONOMICS").innerText()).replace(/\s+/g, " ");
  check(
    "unfiltered, the economics table exposes all 30 rows rather than the old 15",
    /of 30/.test(econAll),
    `panel says: ${econAll.slice(0, 200)} — a hard-coded limit of 15 was applied at the query before this change`,
  );

  // ── 10. Nothing crashed in the browser ───────────────────────────────────
  check(
    "no uncaught client-side error",
    consoleErrors.length === 0,
    consoleErrors.slice(0, 2).join(" | "),
  );

  // ── 11. The default page is a usable length ──────────────────────────────
  // Uncapping every table without collapsing the secondary ones traded one
  // problem for another: four full tables stacked measured ~6,500px, so the
  // breakdown scrolled away and nothing under it was ever seen. Measured on a
  // 1000px viewport, so the threshold is "about four screens", not an arbitrary
  // pixel count. This is the one assertion here that a human eye would catch
  // faster than a test, which is exactly why it is written down.
  await goto("preset=this_month&group=project&bucket=day");
  const height = await page.evaluate(() => document.body.scrollHeight);
  check(
    "the default page is at most about four screens tall",
    height < 4200,
    `${height}px — the secondary tables should ship collapsed; every row is still one click away`,
  );

  // ── 12. The filter bar survives a scroll ─────────────────────────────────
  // First: the magnitude bars must be readable. Scaled to 100%, the biggest of 60
  // projects is a 3.3% share, so every bar rendered as a 3-pixel sliver and the
  // whole column was decoration -- indistinguishable at a glance from a column of
  // empty cells. They are now scaled to the LARGEST row, so the top row's bar is
  // full width while the number beside it still reads the true 3.3%.
  //
  // Re-navigated first so the table is back on its default hours-descending sort:
  // the earlier sort assertions left it ordered by name, where the first row is
  // NOT the largest and a correct bar would legitimately be short.
  await goto("preset=this_month&group=project&bucket=day");
  const topBar = await page.evaluate(() => {
    const section = [...document.querySelectorAll("section")].find((s) =>
      s.querySelector("h2")?.textContent?.includes("BY PROJECT"),
    );
    const row = section?.querySelector("tbody tr");
    // The bar is the inner fill span inside the last cell.
    const fill = row?.querySelector("td:last-child span span span");
    if (!fill || !row) return null;
    return {
      fill: fill.getBoundingClientRect().width,
      track: fill.parentElement.getBoundingClientRect().width,
    };
  });
  check(
    "the top row's magnitude bar fills its track, rather than rendering as a sliver",
    topBar !== null && topBar.track > 0 && topBar.fill / topBar.track > 0.9,
    `fill ${topBar?.fill}px of a ${topBar?.track}px track — scaled to 100% instead of to the largest row, every bar in a 60-row table is about 3% wide`,
  );

  // The filter bar must SCROLL AWAY, not stay parked over the page.
  //
  // It used to be sticky, and this gate asserted that. The user reported the
  // consequence: the bar is tall -- two rows of pickers plus a summary line -- so
  // on a laptop it held a large slice of the viewport on every scroll of a
  // 334-row table. The filters are at the top of the page, so getting back to
  // them is a wheel flick.
  //
  // Still asserted by GEOMETRY rather than by the absence of a class name: a
  // `sticky` class does nothing inside an ancestor with `overflow: hidden`, and
  // equally a bar could be pinned by something other than that class. Only the
  // rectangle after a scroll settles it.
  const barBox = async () =>
    await page.evaluate(() => {
      const el = document.querySelector('[data-filter-bar="1"]');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom };
    });

  const before = await barBox();
  check("the filter bar is findable for the scroll assertion", before !== null);
  await page.evaluate(() => window.scrollTo(0, 1600));
  await page.waitForTimeout(400);
  const after = await barBox();
  check(
    "the filter bar scrolls away instead of occupying the viewport",
    after !== null && after.bottom <= 0,
    `after scrolling 1600px the bar sits at top=${after?.top}, bottom=${after?.bottom} — a bottom still greater than 0 means it is pinned to the viewport, which is what was reported as a bug`,
  );

  // The SHARED app shell uses overflow-x-clip rather than overflow-x-hidden (a
  // change originally made to let a sticky bar work at all). `clip` is kept
  // because it does not create a scroll container, but that difference is exactly
  // what could let a wide table push the page sideways, so this confirms the thing
  // `hidden` was there for still holds: no page-level horizontal scrollbar, on
  // the widest table this app has and at the narrowest viewport it supports.
  for (const width of [1440, 420]) {
    await page.setViewportSize({ width, height: 900 });
    await goto("preset=this_month&group=project&bucket=day");
    await expand("TIME ENTRIES");
    const overflow = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      win: window.innerWidth,
    }));
    check(
      `no page-level horizontal scroll at ${width}px`,
      overflow.doc <= overflow.win + 1,
      `document is ${overflow.doc}px wide in a ${overflow.win}px viewport — a wide table is pushing the page sideways instead of scrolling inside its own panel`,
    );
  }
  await page.setViewportSize({ width: 1440, height: 1000 });

  // ── 13. The filter picker: uncapped, and drivable from the keyboard ───────
  // The picker capped its option list at 200 rows, applied after the search
  // filter and stated nowhere, so with 334 live projects the list stopped at 200
  // with no hint anything was missing. 60 seeded projects cannot exceed 200, so
  // what is asserted here is the property that made the cap unnecessary: the
  // count is on screen, and it matches the data.
  await goto("preset=this_month&group=project&bucket=day");
  const picker = page.locator('[data-filter-bar="1"]').getByRole("button", { name: /PROJECT/ }).first();
  await clickUntil(picker, async () =>
    (await page.getByPlaceholder(/Search project/i).count()) > 0,
  );
  const pickerBody = page.locator('[role="listbox"][aria-label="Project"]');
  check(
    "the picker states how many options exist, so a capped list cannot look complete",
    /60 options/.test(
      (await page.locator('[data-filter-bar="1"]').innerText()).replace(/\s+/g, " "),
    ),
    "the option count is the fix for the old silent 200-row cap",
  );
  check(
    "every seeded project is present in the picker, not capped",
    (await pickerBody.locator("[data-option]").count()) === PROJECT_COUNT,
    `${await pickerBody.locator("[data-option]").count()} options rendered of ${PROJECT_COUNT}`,
  );

  // Keyboard: arrow down twice, Enter, and the filter must actually apply. This
  // is the whole feature -- a highlight that moves but cannot commit is
  // decoration.
  const search2 = page.getByPlaceholder(/Search project/i);
  await search2.fill("Projekt 07");
  await page.waitForTimeout(200);
  await search2.press("ArrowDown");
  await search2.press("Enter");
  // The selection travels through the URL, which is the source of truth.
  await page.waitForFunction(() => window.location.search.includes("projects="), null, {
    timeout: 10_000,
  }).catch(() => {});
  check(
    "Enter on a highlighted option applies the filter",
    /projects=/.test(page.url()),
    `url is ${page.url()} — the keyboard path must reach the URL, which is the report's source of truth`,
  );
  const afterPick = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  if (process.env.DUMP === "1") fs.writeFileSync("tmp-afterpick.txt", afterPick);
  check(
    "the applied filter narrows the report to the one project",
    // Case-insensitive: the chip label is uppercased by CSS, so innerText reads
    // "FILTERED TO" and a case-sensitive match failed while the chip was right
    // there on screen.
    /filtered to/i.test(afterPick) && /1 project with logged time|1–1 of 1/.test(afterPick),
    `page after the keyboard pick: ${afterPick.slice(afterPick.indexOf("BY PROJECT"), afterPick.indexOf("BY PROJECT") + 160)}`,
  );

  // ── 14. Money cannot contradict the report beside it ─────────────────────
  // With the report narrowed to ONE project, the economics panel still summed
  // all 30, so €46,500 of revenue sat directly above a report reading 1.3
  // hours. Both numbers were true and they described different populations,
  // which is worse than either being absent -- an exec reads the big one.
  //
  // The RPC takes only a date range (rates resolve inside a security-definer
  // function with no filter surface), so the fix is to intersect its rows with
  // the projects the selection actually covers.
  check(
    "economics narrows with the report rather than showing every project's money",
    /PROJECT ECONOMICS 1 project/.test(afterPick),
    `the money panel still claims: ${afterPick.slice(afterPick.indexOf("PROJECT ECONOMICS"), afterPick.indexOf("PROJECT ECONOMICS") + 90)}`,
  );
  // The seeded revenue for Projekt 07 alone is (7+1)*100 = 800, so a five-figure
  // total here would mean the intersection silently did nothing.
  check(
    "the money tiles report this project's revenue, not the whole portfolio's",
    /REVENUE €800\b/.test(afterPick),
    `expected €800 for Projekt 07 alone; panel shows ${afterPick.slice(afterPick.indexOf("REVENUE"), afterPick.indexOf("REVENUE") + 60)}`,
  );

  // ── Screenshots, for judging the layout rather than the numbers ──────────
  // Opt-in: SHOTS=1. Assertions cannot see crowding, a misaligned column, or a
  // control that has become invisible against its background, and this page is
  // dense enough that those are real risks. Written to a gitignored directory.
  if (process.env.SHOTS === "1") {
    fs.mkdirSync("tmp-shots", { recursive: true });
    await goto("preset=this_month&group=project&bucket=day");
    await page.screenshot({ path: "tmp-shots/dashboard-full.png", fullPage: true });
    await page.setViewportSize({ width: 420, height: 900 });
    await page.screenshot({ path: "tmp-shots/dashboard-mobile.png", fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    // The filter popover open, since it is the one piece of UI a full-page shot
    // never captures.
    await page.getByRole("button", { name: /PROJECT/ }).first().click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: "tmp-shots/dashboard-picker.png" });
    console.log("(screenshots in tmp-shots/)");
  }
} finally {
  await browser.close();
  cleanup();
}

console.log(
  failed
    ? "\nDASHBOARD TABLES: rows are unreachable or controls are broken\n"
    : "\nDASHBOARD TABLES: every row is reachable, sortable, searchable and exportable\n",
);
process.exit(failed ? 1 : 0);
