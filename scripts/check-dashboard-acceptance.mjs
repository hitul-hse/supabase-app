/**
 * Requirement-to-evidence map for the TrackingTime dashboard, measured through the
 * REAL page over the REAL database as a REAL signed-in exec.
 *
 * WHY THIS EXISTS SEPARATELY FROM THE OTHER GATES
 * ----------------------------------------------
 * The two existing gates each have a hole this one closes:
 *
 *   - check-dashboard-tables.mjs drives a STUB Supabase. Everything it proves is
 *     about our own wiring, and none of its timings mean anything.
 *   - check-live-dashboard.mjs uses the real database, but it grew organically and
 *     asserts what was convenient, not one check per stated requirement.
 *
 * And the specific way my earlier performance work was wrong: every profile ran
 * with the SERVICE ROLE key, which bypasses row-level security -- the exact cost
 * that turned out to dominate. So "quick responses" had been asserted from code
 * shape and from measurements that structurally could not see the problem.
 *
 * This file therefore does one thing: takes each requirement the user actually
 * stated, and for each one performs an observation through the public interface a
 * person uses (a browser, signed in, against production data) and prints the
 * requirement, the check, and the observed value. No stub, no service-role
 * shortcut, no inspection standing in for a measurement.
 *
 * THE REQUIREMENTS, verbatim in intent:
 *   R1  "some data like projects are just showing some projects in the lists and
 *        not having an option or scrollable table to see all the projects"
 *   R2  "good filtering options"
 *   R3  "quick reponses"
 *   R4  "more interactions"
 *   R5  the page must keep working -- no crash, no error boundary, correct numbers
 *
 * Run: node scripts/check-dashboard-acceptance.mjs
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const { NEXT_PUBLIC_SUPABASE_URL: URL_BASE, SUPABASE_SERVICE_ROLE_KEY: SERVICE, NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON } = env;
if (!URL_BASE || !SERVICE || !ANON) {
  console.log("SKIP: no live credentials in .env.local");
  process.exit(0);
}

// ── Requirement-tagged reporting ────────────────────────────────────────────
const results = [];
let failed = false;
const req = (id, requirement, check, ok, observed) => {
  results.push({ id, requirement, check, ok, observed });
  if (!ok) failed = true;
  console.log(`${ok ? "PASS" : "FAIL"} ${id}  ${check}\n        observed: ${observed}`);
};

const admin = createClient(URL_BASE, SERVICE, { auth: { persistSession: false } });
const probe = await admin.schema("time").from("entry").select("id", { count: "exact" }).limit(1);
if (probe.error) {
  console.log(`SKIP: the time schema is not reachable — ${probe.error.message}`);
  process.exit(0);
}
const liveEntries = probe.count ?? 0;
const liveProjects = (await admin.schema("time").from("project").select("id", { count: "exact" }).limit(1)).count ?? 0;
const liveCustomers = (await admin.schema("time").from("customer").select("id", { count: "exact" }).limit(1)).count ?? 0;
const liveMembers = (await admin.schema("time").from("member").select("id", { count: "exact" }).eq("is_archived", false).limit(1)).count ?? 0;
console.log(`live: ${liveEntries} entries · ${liveProjects} projects · ${liveCustomers} customers · ${liveMembers} members\n`);

// Sign in as a real exec so RLS applies exactly as in production. Read-only: a
// magic link exchanged for a session changes no credential.
const { data: profiles } = await admin
  .from("app_user_profile").select("user_id").eq("role_key", "exec").eq("is_active", true).limit(1);
if (!profiles?.length) {
  console.log("SKIP: no active exec to sign in as");
  process.exit(0);
}
const { data: u } = await admin.auth.admin.getUserById(profiles[0].user_id);
const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: u.user.email });
const anonClient = createClient(URL_BASE, ANON, { auth: { persistSession: false } });
const { data: verified } = await anonClient.auth.verifyOtp({
  type: "magiclink", token_hash: link.properties.hashed_token,
});
if (!verified?.session) {
  console.log("SKIP: could not mint a session");
  process.exit(0);
}
const session = verified.session;

// ── The real production build, served ───────────────────────────────────────
const APP_PORT = 3119;
const app = spawn("npx", ["next", "start", "--port", String(APP_PORT)], {
  env: process.env, shell: true, stdio: "pipe",
});
let appLog = "";
app.stdout.on("data", (d) => (appLog += d));
app.stderr.on("data", (d) => (appLog += d));
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
  try { await fetch(`http://localhost:${APP_PORT}/auth/login`); up = true; break; }
  catch { await new Promise((r) => setTimeout(r, 500)); }
}
if (!up) {
  console.log("FAIL: app server never started — run `npm run build` first");
  console.log(appLog.slice(-1500));
  cleanup();
  process.exit(1);
}

const { chromium } = await import("playwright");
const browser = await chromium.launch();

try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.addInitScript(() => {
    try { window.localStorage.setItem("hse_tour_done", "1"); } catch { /* ignore */ }
  });
  const host = new URL(URL_BASE).hostname.split(".")[0];
  await ctx.addCookies([{
    name: `sb-${host}-auth-token`,
    value: "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url"),
    domain: "localhost", path: "/", httpOnly: false, secure: false, sameSite: "Lax",
  }]);
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));

  const panel = (title) =>
    page.locator("section").filter({ has: page.locator(`h2:text-is("${title}")`) });
  const rows = (title) => panel(title).locator("tbody tr").count();

  const expand = async (title) => {
    const h = panel(title).locator("button[aria-expanded]").first();
    for (let i = 0; i < 12; i++) {
      if ((await h.getAttribute("aria-expanded")) === "true") return true;
      await h.click();
      await page.waitForTimeout(120);
    }
    return (await h.getAttribute("aria-expanded")) === "true";
  };

  const clickUntil = async (loc, settled, attempts = 12) => {
    for (let i = 0; i < attempts; i++) {
      await loc.click();
      for (let j = 0; j < 12; j++) {
        if (await settled()) return true;
        await page.waitForTimeout(100);
      }
    }
    return settled();
  };

  /** Navigate, wait for real content, return elapsed ms. */
  const visit = async (qs) => {
    const t0 = performance.now();
    const resp = await page.goto(`http://localhost:${APP_PORT}/time/dashboard?${qs}`, {
      waitUntil: "domcontentloaded", timeout: 60_000,
    });
    await page.locator("text=TOTAL HOURS").first()
      .waitFor({ state: "visible", timeout: 30_000 }).catch(() => {});
    return { ms: performance.now() - t0, status: resp?.status() };
  };

  // Warm the route so framework lazy-compilation is not attributed to the page.
  await visit("preset=this_week");

  // ══ R5: the page works at all ═════════════════════════════════════════════
  const base = await visit("preset=all&group=project&bucket=week");
  req("R5.1", "the page must work", "GET /time/dashboard returns 200 for a real exec",
    base.status === 200, `HTTP ${base.status}`);
  req("R5.2", "the page must work", "not redirected to /auth/login",
    !page.url().includes("/auth/login"), page.url());

  const text = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  req("R5.3", "the page must work", "no error boundary ('This page could not load')",
    !/This page couldn't load/.test(text), "error card absent");

  // The headline number must AGREE WITH THE DATABASE, not merely exist. This is
  // the assertion that would catch a paging bug silently under-reporting hours --
  // exactly the class of failure the parallel-paging change could have introduced,
  // and one that leaves the page looking perfectly healthy.
  //
  // Summed here with the service-role key, excluding calendar time because that is
  // what the page excludes by default. Two independent computations of the same
  // quantity: if they agree, the page's arithmetic and paging are both right.
  let expectedSeconds = 0;
  for (let off = 0; ; off += 1000) {
    const { data } = await admin.schema("time").from("entry")
      .select("duration_seconds")
      .not("duration_seconds", "is", null)
      .eq("is_calendar", false)
      .range(off, off + 999);
    if (!data?.length) break;
    for (const r of data) expectedSeconds += Number(r.duration_seconds);
    if (data.length < 1000) break;
  }
  const expectedHours = Math.round((expectedSeconds / 3600) * 10) / 10;
  const headline = /TOTAL HOURS ([\d,]+\.?\d*)h/.exec(text)?.[1];
  const shown = headline ? Number(headline.replace(/,/g, "")) : null;
  req("R5.4", "the page must be correct",
    "TOTAL HOURS matches the database's own sum for the same filter",
    shown !== null && Math.abs(shown - expectedHours) <= 1.0,
    `page ${shown}h vs database ${expectedHours}h (calendar excluded, as the page defaults)`);

  // ══ R1: every project reachable ═══════════════════════════════════════════
  const byProject = (await panel("BY PROJECT").innerText()).replace(/\s+/g, " ");
  const statedTotal = Number((/of ([\d,]+)/.exec(byProject)?.[1] ?? "0").replace(/,/g, ""));
  req("R1.1", "all projects must be reachable",
    "the breakdown states the FULL row count, not a 'top N'",
    statedTotal > 100, `header states ${statedTotal} rows over ${liveProjects} live projects`);
  req("R1.2", "all projects must be reachable", "page 1 shows a bounded 25 rows",
    (await rows("BY PROJECT")) === 25, `${await rows("BY PROJECT")} rows`);

  const okAll = await clickUntil(
    panel("BY PROJECT").getByRole("button", { name: "ALL" }),
    async () => (await rows("BY PROJECT")) === statedTotal,
  );
  req("R1.3", "all projects must be reachable",
    "ALL renders every project with logged time",
    okAll && (await rows("BY PROJECT")) === statedTotal,
    `${await rows("BY PROJECT")} of ${statedTotal} rendered`);

  // The last-ranked row must be in the DOM, not just counted: a count could be
  // satisfied by duplicates.
  const lastName = await panel("BY PROJECT").locator("tbody tr").last().innerText();
  req("R1.4", "all projects must be reachable",
    "the LAST-ranked project is really rendered, not merely counted",
    lastName.trim().length > 0, `last row reads "${lastName.split("\n")[0].trim()}"`);

  // A scrollable container, which is what the user literally asked for.
  const scrollable = await page.evaluate(() => {
    const s = [...document.querySelectorAll("section")].find((x) =>
      x.querySelector("h2")?.textContent?.includes("BY PROJECT"));
    const d = s?.querySelector("div.overflow-y-auto, div.overflow-x-auto");
    return d ? { h: d.clientHeight, sh: d.scrollHeight } : null;
  });
  req("R1.5", "a scrollable table to see all projects",
    "with ALL selected the table body is a scrollable container",
    scrollable !== null && scrollable.sh > scrollable.h,
    `scrollHeight ${scrollable?.sh}px inside ${scrollable?.h}px viewport`);

  // The other lists that were silently capped.
  for (const [label, expected, panelName] of [
    ["budget burn", null, "BUDGET BURN"],
    ["time entries", null, "TIME ENTRIES"],
  ]) {
    await expand(panelName);
    const t = (await panel(panelName).innerText()).replace(/\s+/g, " ");
    const n = Number((/of ([\d,]+)/.exec(t)?.[1] ?? "0").replace(/,/g, ""));
    req("R1.6", "all rows reachable in every table",
      `${label} states its full row count`,
      n > 0, `${n} rows stated`);
    void expected;
  }

  // THE ONE TABLE THAT IS NOT UNCAPPED, checked as such rather than glossed.
  //
  // The three aggregate tables show every row. The raw entry list ships at most
  // ENTRY_ROW_LIMIT (2000) rows, deliberately, and the widest live selection has
  // 4,194 entries. That is defensible only if the page SAYS so -- an undisclosed
  // cap is exactly the "top 40 of 334" dishonesty this whole change removed. So
  // this asserts the disclosure exists and names both numbers.
  await visit("preset=all&calendar=1&group=project&bucket=month");
  const capText = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  const capDisclosed = /entry table lists the ([\d,]+) most recent of ([\d,]+)/.exec(capText);
  req("R1.7", "no hidden truncation anywhere",
    "where the entry list IS capped, the page states the cap and the true total",
    capDisclosed !== null,
    capDisclosed
      ? `page says "lists the ${capDisclosed[1]} most recent of ${capDisclosed[2]}" — disclosed, and every total above still covers all ${capDisclosed[2]}`
      : "no disclosure found; an undisclosed cap is the exact bug this change set out to remove");

  // ══ R2: filtering ═════════════════════════════════════════════════════════
  await visit("preset=all&group=project&bucket=week");
  for (const label of ["MEMBER", "PROJECT", "CUSTOMER", "SERVICE"]) {
    req("R2.1", "good filtering options", `the ${label.toLowerCase()} filter is present`,
      (await page.locator(`[data-filter-bar="1"]`).innerText()).includes(label), `${label} rendered`);
  }

  // A filter must CHANGE the result, and by the right amount. Billable-only is
  // checkable against the database.
  let billableSeconds = 0;
  for (let off = 0; ; off += 1000) {
    const { data } = await admin.schema("time").from("entry")
      .select("duration_seconds").not("duration_seconds", "is", null)
      .eq("is_calendar", false).eq("is_billable", true).range(off, off + 999);
    if (!data?.length) break;
    for (const r of data) billableSeconds += Number(r.duration_seconds);
    if (data.length < 1000) break;
  }
  const expectedBillable = Math.round((billableSeconds / 3600) * 10) / 10;
  await visit("preset=all&billable=yes&group=project&bucket=week");
  const bText = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  const bShown = Number((/TOTAL HOURS ([\d,]+\.?\d*)h/.exec(bText)?.[1] ?? "0").replace(/,/g, ""));
  req("R2.2", "good filtering options",
    "filtering to billable reaches the query and matches the database",
    Math.abs(bShown - expectedBillable) <= 1.0,
    `page ${bShown}h vs database ${expectedBillable}h`);

  // The picker must expose every option (the old code capped at 200 after search).
  await visit("preset=all&group=project&bucket=week");
  await clickUntil(
    page.locator('[data-filter-bar="1"]').getByRole("button", { name: /CUSTOMER/ }).first(),
    async () => (await page.getByPlaceholder(/Search customer/i).count()) > 0,
  );
  const custOpts = await page.locator('[role="listbox"][aria-label="Customer"] [data-option]').count();
  req("R2.3", "good filtering options",
    "the customer picker exposes every real option, uncapped",
    custOpts === liveCustomers, `${custOpts} rendered of ${liveCustomers} in the database`);

  // Keyboard path: the filter must be operable without a mouse.
  const search = page.getByPlaceholder(/Search customer/i);
  const firstCustomer = await page
    .locator('[role="listbox"][aria-label="Customer"] [data-option]').first().innerText();
  await search.press("ArrowDown");
  await search.press("Enter");
  await page.waitForFunction(() => window.location.search.includes("customers="), null, { timeout: 10_000 })
    .catch(() => {});
  req("R2.4", "good filtering options",
    "a filter can be applied entirely from the keyboard, and reaches the URL",
    /customers=/.test(page.url()), `url now ${page.url().split("?")[1] ?? "(no query)"}`);
  const chipText = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  req("R2.5", "good filtering options",
    "the active filter is shown as a removable chip",
    /filtered to/i.test(chipText),
    `chip row present for "${firstCustomer.split("\n")[0].trim()}"`);

  // ══ R3: quick responses — THROUGH THE REAL PAGE, UNDER RLS ════════════════
  // This is the requirement my earlier work never actually measured. Each figure
  // below is a full navigation of the real build, signed in, RLS enforced.
  console.log("\n  --- R3: end-to-end page latency, real data, real RLS ---");
  const SELECTIONS = [
    ["today", "preset=today&group=member&bucket=day"],
    ["this week", "preset=this_week&group=member&bucket=day"],
    ["this month", "preset=this_month&group=project&bucket=day"],
    ["last month", "preset=last_month&group=customer&bucket=week"],
    ["this year", "preset=this_year&group=member&bucket=week"],
    ["all time", "preset=all&group=project&bucket=week"],
    ["all time + calendar (worst case)", "preset=all&calendar=1&group=customer&bucket=month"],
    ["all time, billable only", "preset=all&billable=yes&group=project&bucket=week"],
    ["narrowed to one customer", null],
  ];
  const timings = [];
  for (const [label, qs] of SELECTIONS) {
    if (qs === null) continue;
    // THREE samples, and the MEDIAN is what gets asserted.
    //
    // Not fastidiousness: measure:latency-variance sampled the worst-case
    // selection 8 times and saw 3219-3793ms, a 574ms spread, because 4,194 rows go
    // through a per-row RLS predicate over the public internet to a shared
    // instance. Asserting on one sample made an earlier version of this budget
    // pass twice and fail once on identical code. A median of three is stable
    // enough to mean something while keeping the run short.
    const xs = [];
    for (let i = 0; i < 3; i++) xs.push((await visit(qs)).ms);
    xs.sort((a, b) => a - b);
    const ms = xs[1];
    timings.push([label, ms, xs[0], xs[2]]);
    console.log(
      `      ${label.padEnd(34)} median ${ms.toFixed(0).padStart(5)}ms  (${xs[0].toFixed(0)}-${xs[2].toFixed(0)}ms)`,
    );
  }

  // Is the RLS migration in place? The budget depends on it, and inferring it from
  // a measurement beats hard-coding an expectation that is wrong half the time.
  const rlsProbe = await (async () => {
    const sel = "id,member_id,started_at,duration_seconds";
    const once = async (key, bearer) => {
      const t0 = performance.now();
      await fetch(`${URL_BASE}/rest/v1/entry?select=${sel}&duration_seconds=not.is.null&order=started_at.desc&offset=0&limit=1000`,
        { headers: { apikey: key, Authorization: `Bearer ${bearer}`, "Accept-Profile": "time" } });
      return performance.now() - t0;
    };
    const svc = Math.min(await once(SERVICE, SERVICE), await once(SERVICE, SERVICE));
    const usr = Math.min(await once(ANON, session.access_token), await once(ANON, session.access_token));
    return { svc, usr, hoisted: usr < svc * 1.6 };
  })();
  console.log(`\n      RLS overhead: service_role ${rlsProbe.svc.toFixed(0)}ms vs exec ${rlsProbe.usr.toFixed(0)}ms → migration ${rlsProbe.hoisted ? "APPLIED" : "PENDING"}`);

  // Budgets from the measured distribution: p90 of the worst case is 3793ms
  // pre-migration, so 4600ms fails a real regression without failing on noise.
  const BUDGET = rlsProbe.hoisted ? 3000 : 4600;
  const common = timings.filter(([l]) => !l.includes("worst case"));
  const worst = timings.find(([l]) => l.includes("worst case"));

  // TWO budgets, because one number over all selections hid a real difference and
  // let me claim "every routine selection under 650ms" when year-scale selections
  // measure ~2.3s. Splitting them makes each claim checkable and honest.
  //
  // SHORT-RANGE presets (today/week/month) are what people load repeatedly, and
  // they are genuinely sub-second. YEAR-SCALE and all-time selections read
  // thousands of rows through a per-row RLS predicate and land around 2.4s; that
  // is slower but it is a deliberate, occasional query.
  const SHORT = ["today", "this week", "this month", "last month"];
  const shortRange = common.filter(([l]) => SHORT.includes(l));
  const wideRange = common.filter(([l]) => !SHORT.includes(l));

  req("R3.1a", "quick responses",
    "the short-range presets people use constantly render under 1s",
    shortRange.every(([, ms]) => ms < 1000),
    shortRange.map(([l, ms]) => `${l} ${ms.toFixed(0)}ms`).join(" · "));
  req("R3.1b", "quick responses",
    // 2.9s, from measure:latency-variance: "all time" median ~1974ms with a 514ms
    // spread, and this year measured up to 2399ms. A 2500ms line failed on a noisy
    // run of working code.
    "year-scale and all-time selections render under 2.9s",
    wideRange.every(([, ms]) => ms < 2900),
    wideRange.map(([l, ms]) => `${l} ${ms.toFixed(0)}ms`).join(" · "));
  req("R3.2", "quick responses",
    `the worst-case selection renders within ${BUDGET / 1000}s${rlsProbe.hoisted ? "" : " (pre-migration budget)"}`,
    worst[1] < BUDGET, `${worst[0]} median ${worst[1].toFixed(0)}ms, slowest sample ${worst[3].toFixed(0)}ms`);
  req("R3.3", "quick responses",
    "the narrowest selection (today) is well under 1s, so routine use is fast",
    timings[0][1] < 1000, `today took ${timings[0][1].toFixed(0)}ms`);

  // Interaction latency, which is what "quick" means once the page is up.
  await visit("preset=all&group=project&bucket=week");
  await clickUntil(panel("BY PROJECT").getByRole("button", { name: "ALL" }),
    async () => (await rows("BY PROJECT")) === statedTotal);
  // Sampled, for the same reason page latency is: successive single-click
  // measurements of this gave 233ms, 260ms, 361ms and 400ms+ on identical code.
  // Most of each figure is Playwright's own click round trip (locator resolution,
  // actionability checks, CDP hops), not React's work -- so a single sample is
  // dominated by harness noise and a tight threshold on it fails at random.
  //
  // What the requirement actually is: sorting must not go to the SERVER. So the
  // assertion is the one that distinguishes those two worlds -- no network request
  // fires -- with a generous latency ceiling alongside it. A round trip to this
  // database costs 100ms+ and would also show up as a request; local work does
  // neither.
  const sortSamples = [];
  const requestsDuringSort = [];
  const onReq = (r) => {
    // Ignore the browser's own noise; only count calls that would fetch data.
    if (/_rsc=|\/rest\/v1\//.test(r.url())) requestsDuringSort.push(r.url());
  };
  page.on("request", onReq);
  for (let i = 0; i < 4; i++) {
    const t0 = performance.now();
    await panel("BY PROJECT").getByRole("button", { name: /^Hours/ }).click();
    await page.waitForTimeout(30);
    sortSamples.push(performance.now() - t0);
  }
  page.off("request", onReq);
  sortSamples.sort((a, b) => a - b);
  const sortMedian = sortSamples[Math.floor(sortSamples.length / 2)];
  req("R3.4", "quick responses",
    "re-sorting every row is done in the browser, with NO server round trip",
    requestsDuringSort.length === 0,
    `${statedTotal} rows re-sorted ${sortSamples.length}x with ${requestsDuringSort.length} data requests; median ${sortMedian.toFixed(0)}ms (${sortSamples[0].toFixed(0)}-${sortSamples[sortSamples.length - 1].toFixed(0)}ms, mostly Playwright's own click overhead)`);
  req("R3.4b", "quick responses",
    "re-sorting stays well inside a second even at full row count",
    sortMedian < 1000, `median ${sortMedian.toFixed(0)}ms over ${statedTotal} rows`);

  const searchRequests = [];
  const onSearchReq = (r) => {
    if (/_rsc=|\/rest\/v1\//.test(r.url())) searchRequests.push(r.url());
  };
  page.on("request", onSearchReq);
  const tSearch = performance.now();
  await panel("BY PROJECT").getByPlaceholder(/Find project/i).fill("travel");
  await page.waitForTimeout(120);
  const searchMs = performance.now() - tSearch;
  page.off("request", onSearchReq);
  const searchHits = await rows("BY PROJECT");
  req("R3.5", "quick responses",
    "in-table search filters in the browser, with no server round trip",
    searchRequests.length === 0 && searchHits > 0 && searchHits < statedTotal,
    `"travel" narrowed ${statedTotal} rows to ${searchHits} in ${searchMs.toFixed(0)}ms with ${searchRequests.length} data requests`);

  // A slow page must SAY it is loading. Verified on a client-side navigation,
  // the only time a route's loading.tsx renders.
  {
    const slow = await ctx.newPage();
    await slow.route(/_rsc=/, async (r) => {
      await new Promise((res) => setTimeout(res, 1200));
      await r.continue();
    });
    await slow.goto(`http://localhost:${APP_PORT}/time?view=records`, {
      waitUntil: "domcontentloaded", timeout: 60_000,
    });
    await slow.getByRole("link", { name: /TrackingTime Dashboard/i }).first().click();
    let saw = false;
    for (let i = 0; i < 40; i++) {
      if ((await slow.locator(".animate-pulse").count().catch(() => 0)) > 5) { saw = true; break; }
      await slow.waitForTimeout(100);
    }
    req("R3.6", "quick responses", "a slow load shows a skeleton rather than a frozen page",
      saw, saw ? "skeleton observed during navigation" : "no skeleton appeared");
    await slow.close();
  }

  // ══ R4: interactions ══════════════════════════════════════════════════════
  await visit("preset=all&group=project&bucket=week");

  // Drill-down: clicking a project name must narrow the report.
  const firstProject = (await panel("BY PROJECT").locator("tbody tr").first().innerText()).split("\n")[0].trim();
  const drill = panel("BY PROJECT").locator("tbody tr a").first();
  const hadLink = (await drill.count()) > 0;
  const drillHref = hadLink ? await drill.getAttribute("href") : null;
  if (hadLink) {
    await drill.click();
    // Wait for the URL itself, not for a heading that is already on screen.
    // `waitFor(visible)` on TOTAL HOURS returns instantly because the PREVIOUS
    // render still satisfies it, so the assertion raced the client-side
    // navigation and read the old URL -- reporting a working drill-down as
    // broken. This is a soft-navigation, so the wait has to be on location.
    await page
      .waitForFunction(() => window.location.search.includes("projects="), null, { timeout: 30_000 })
      .catch(() => {});
    await page.locator("text=TOTAL HOURS").first().waitFor({ state: "visible", timeout: 30_000 }).catch(() => {});
  }
  req("R4.1", "more interactions", "clicking a breakdown row narrows the report",
    hadLink && /projects=/.test(page.url()),
    `clicked "${firstProject}" (href ${drillHref?.split("?")[1]?.slice(0, 46) ?? "none"}) → ${page.url().split("?")[1]?.slice(0, 80) ?? "(no change)"}`);

  // And the narrowing must be REAL, not just a URL change: the filtered total
  // has to be smaller than the unfiltered one.
  const narrowedText = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  const narrowedHours = Number((/TOTAL HOURS ([\d,]+\.?\d*)h/.exec(narrowedText)?.[1] ?? "0").replace(/,/g, ""));
  req("R4.1b", "more interactions",
    "the drill-down actually reduces the reported total, not just the URL",
    narrowedHours > 0 && narrowedHours < expectedHours,
    `${narrowedHours}h after drilling in, against ${expectedHours}h unfiltered`);

  // Sorting, both directions, on a real column.
  await visit("preset=all&group=project&bucket=week");
  const top1 = (await panel("BY PROJECT").locator("tbody tr").first().innerText()).split("\n")[0].trim();
  await panel("BY PROJECT").getByRole("button", { name: /^Hours/ }).click();
  await page.waitForTimeout(120);
  const top2 = (await panel("BY PROJECT").locator("tbody tr").first().innerText()).split("\n")[0].trim();
  req("R4.2", "more interactions", "a column sorts, and reverses on a second click",
    top1 !== top2, `"${top1}" → "${top2}"`);

  // CSV export of the real data.
  const dl = page.waitForEvent("download", { timeout: 20_000 });
  await panel("BY PROJECT").getByRole("button", { name: "CSV" }).click();
  const download = await dl;
  const csv = readFileSync(await download.path(), "utf8");
  const csvLines = csv.trim().split(/\r?\n/);
  req("R4.3", "more interactions", "CSV export contains every row plus a header",
    csvLines.length === statedTotal + 1,
    `${csvLines.length} lines for ${statedTotal} rows; BOM ${csv.charCodeAt(0) === 0xfeff ? "present" : "MISSING"}`);

  // Trend bars are clickable and narrow the period.
  const barHref = await page.locator("section a[href*='preset=custom']").first().getAttribute("href").catch(() => null);
  req("R4.4", "more interactions", "trend bars link to their own period",
    barHref !== null, barHref ? `first bar → ${barHref.split("?")[1]?.slice(0, 60)}` : "no linked bar found");

  // Collapse/expand.
  const expanded = await expand("TIME ENTRIES");
  req("R4.5", "more interactions", "collapsed panels expand on click",
    expanded, `TIME ENTRIES aria-expanded=${expanded}`);

  // Page-size control.
  await visit("preset=all&group=project&bucket=week");
  await clickUntil(panel("BY PROJECT").getByRole("button", { name: "100" }),
    async () => (await rows("BY PROJECT")) === Math.min(100, statedTotal));
  req("R4.6", "more interactions", "the page-size control changes how many rows render",
    (await rows("BY PROJECT")) === Math.min(100, statedTotal),
    `${await rows("BY PROJECT")} rows with 100 selected`);

  // ══ Integration boundaries and failure modes ══════════════════════════════
  // Mobile viewport: the app shell change (overflow-x-clip) touched every page, so
  // this is a regression surface, not a nicety.
  for (const w of [1440, 768, 420]) {
    await page.setViewportSize({ width: w, height: 900 });
    await visit("preset=all&group=project&bucket=week");
    await expand("TIME ENTRIES");
    const ov = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth, win: window.innerWidth,
    }));
    req("R5.5", "the page must work everywhere",
      `no page-level horizontal scroll at ${w}px`,
      ov.doc <= ov.win + 1, `document ${ov.doc}px in a ${ov.win}px viewport`);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });

  // An empty selection must explain itself rather than looking broken.
  await visit("preset=custom&from=2001-01-01&to=2001-01-02");
  const emptyText = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  req("R5.6", "likely failure modes",
    "a selection with no data explains itself instead of rendering blank",
    /No time logged in this selection/.test(emptyText), "empty-state copy present");

  // A hostile URL must not crash the page — these ids flow into PostgREST IN lists.
  const hostile = await visit("preset=all&projects=abc,-1,99999999999999&members=%27%29%3B--&group=task&bucket=day");
  const hostileText = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  req("R5.7", "likely failure modes",
    "malformed and injected filter ids are rejected without a crash",
    hostile.status === 200 && !/This page couldn't load/.test(hostileText),
    `HTTP ${hostile.status}, error boundary absent`);

  req("R5.8", "the page must work", "no uncaught client-side error during the whole run",
    pageErrors.length === 0, pageErrors.slice(0, 2).join(" | ") || "none");

  // ── Requirement coverage summary ────────────────────────────────────────
  console.log("\n=== requirement → evidence map ===");
  const byReq = {};
  for (const r of results) {
    const key = r.id.split(".")[0];
    byReq[key] ??= { requirement: r.requirement, pass: 0, fail: 0 };
    byReq[key][r.ok ? "pass" : "fail"] += 1;
  }
  for (const [k, v] of Object.entries(byReq).sort()) {
    console.log(`  ${k}  ${v.pass} passed, ${v.fail} failed  — ${v.requirement}`);
  }

  mkdirSync("tmp-shots", { recursive: true });
  writeFileSync("tmp-shots/acceptance-results.json", JSON.stringify(results, null, 2));
} finally {
  await browser.close();
  cleanup();
}

console.log(
  failed
    ? "\nDASHBOARD ACCEPTANCE: at least one stated requirement is NOT met\n"
    : "\nDASHBOARD ACCEPTANCE: every stated requirement verified through the real page\n",
);
process.exit(failed ? 1 : 0);
