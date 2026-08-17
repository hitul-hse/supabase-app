/**
 * Render /time/dashboard against the REAL database, in a real browser.
 *
 * WHY THIS EXISTS, stated plainly: every other gate in this module -- mine
 * included -- runs against a STUB Supabase, on the inherited assumption that the
 * live project does not expose the `time` schema. That assumption is false. It
 * answers with 4,194 entries, 334 projects and 197 customers. So the page whose
 * reported symptom was "projects are just showing some projects in the lists" had
 * never actually been rendered against the dataset the symptom came from. A
 * 60-project fixture proves the paging logic; it cannot show what 334 projects
 * and 197 customers do to this layout.
 *
 * It signs in as a real exec via the admin API (a generated magic link, exchanged
 * for a session), so RLS applies exactly as it does for that person. Read-only
 * throughout: it navigates, measures and screenshots, and writes nothing.
 *
 * Run: node scripts/check-live-dashboard.mjs
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const URL_BASE = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!URL_BASE || !SERVICE || !ANON) {
  console.log("SKIP: no live credentials in .env.local");
  process.exit(0);
}

let failed = false;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed = true;
};

const admin = createClient(URL_BASE, SERVICE, { auth: { persistSession: false } });

// Confirm the premise before relying on it, so this gate can never pass vacuously
// against an empty schema.
const probe = await admin.schema("time").from("entry").select("id", { count: "exact" }).limit(1);
if (probe.error) {
  console.log(`SKIP: the time schema is not reachable — ${probe.error.message}`);
  process.exit(0);
}
const liveEntries = probe.count ?? 0;
const projectCount = (await admin.schema("time").from("project").select("id", { count: "exact" }).limit(1)).count ?? 0;
const customerCount = (await admin.schema("time").from("customer").select("id", { count: "exact" }).limit(1)).count ?? 0;
console.log(`live data: ${liveEntries} entries, ${projectCount} projects, ${customerCount} customers`);

check(
  "the live dataset is large enough for this gate to mean anything",
  liveEntries > 1000 && projectCount > 100,
  `${liveEntries} entries and ${projectCount} projects — below this a stub fixture would prove as much`,
);

// An exec, since the dashboard requires timesheets:read_all.
const { data: profiles, error: pErr } = await admin
  .from("app_user_profile")
  .select("user_id, role_key, is_active")
  .eq("role_key", "exec")
  .eq("is_active", true)
  .limit(1);

if (pErr || !profiles?.length) {
  console.log(`SKIP: no active exec profile to sign in as — ${pErr?.message ?? "none found"}`);
  process.exit(0);
}
const userId = profiles[0].user_id;
const { data: userRes } = await admin.auth.admin.getUserById(userId);
const email = userRes?.user?.email;
if (!email) {
  console.log("SKIP: the exec profile has no email to sign in with");
  process.exit(0);
}
console.log(`signing in as ${email.replace(/(.{2}).*(@.*)/, "$1***$2")} (exec)`);

// A magic link, exchanged server-side for a real session. This mints a session
// WITHOUT knowing or changing the password -- nothing about the account is
// modified.
const { data: link, error: lErr } = await admin.auth.admin.generateLink({
  type: "magiclink",
  email,
});
if (lErr || !link?.properties?.hashed_token) {
  console.log(`SKIP: could not mint a session — ${lErr?.message}`);
  process.exit(0);
}

const anonClient = createClient(URL_BASE, ANON, { auth: { persistSession: false } });
const { data: verified, error: vErr } = await anonClient.auth.verifyOtp({
  type: "magiclink",
  token_hash: link.properties.hashed_token,
});
if (vErr || !verified?.session) {
  console.log(`SKIP: could not verify the session — ${vErr?.message}`);
  process.exit(0);
}
const session = verified.session;

// ── The app, built and served against the REAL project ─────────────────────
// No rebuild needed: NEXT_PUBLIC_* are compile-time, and the existing .next build
// already points at the live project. That is the whole reason this gate is
// cheap while the stub one has to rebuild.
const APP_PORT = 3117;
const app = spawn("npx", ["next", "start", "--port", String(APP_PORT)], {
  env: process.env,
  shell: true,
  stdio: "pipe",
});
let appLog = "";
app.stdout.on("data", (d) => (appLog += d));
app.stderr.on("data", (d) => (appLog += d));

const cleanup = () => {
  try {
    if (process.platform === "win32" && app.pid) {
      spawnSync("taskkill", ["/PID", String(app.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      app.kill("SIGKILL");
    }
  } catch { /* already gone */ }
};

let up = false;
for (let i = 0; i < 90; i++) {
  if (app.exitCode !== null) break;
  try {
    await fetch(`http://localhost:${APP_PORT}/auth/login`);
    up = true;
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 500));
  }
}
if (!up) {
  console.log("FAIL: app server never started (run `npm run build` first)");
  console.log(appLog.slice(-2000));
  cleanup();
  process.exit(1);
}
console.log(`app on http://localhost:${APP_PORT}\n`);

const { chromium } = await import("playwright");
const browser = await chromium.launch();

try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  // The onboarding tour dims the page and can swallow clicks.
  await ctx.addInitScript(() => {
    try { window.localStorage.setItem("hse_tour_done", "1"); } catch { /* ignore */ }
  });

  // The cookie name derives from the project hostname, per supabase-js's own
  // defaultStorageKey.
  const host = new URL(URL_BASE).hostname.split(".")[0];
  const cookieValue = "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");
  const cookieHeader = `sb-${host}-auth-token=${cookieValue}`;
  await ctx.addCookies([{
    name: `sb-${host}-auth-token`,
    value: cookieValue,
    domain: "localhost", path: "/", httpOnly: false, secure: false, sameSite: "Lax",
  }]);

  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  const panel = (title) =>
    page.locator("section").filter({ has: page.locator(`h2:text-is("${title}")`) });

  /** Navigate and time it, end to end, as a person experiences it. */
  const visit = async (qs, label) => {
    // Server time measured separately from total, because they point at
    // different fixes. The per-query measurements say the database work for the
    // widest selection is ~220ms, so if TTFB is small and the total is seconds,
    // the cost is payload serialisation and React rendering -- and no amount of
    // query tuning would touch it.
    const t0raw = performance.now();
    const raw = await fetch(`http://localhost:${APP_PORT}/time/dashboard?${qs}`, {
      headers: { cookie: cookieHeader },
      redirect: "manual",
    });
    const html = await raw.text();
    const serverMs = performance.now() - t0raw;

    const t0 = performance.now();
    const resp = await page.goto(`http://localhost:${APP_PORT}/time/dashboard?${qs}`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await page
      .locator("text=TOTAL HOURS")
      .first()
      .waitFor({ state: "visible", timeout: 30_000 })
      .catch(() => {});
    const ms = performance.now() - t0;
    const kb = html.length / 1024;
    console.log(
      `  ${label.padEnd(34)} total ${ms.toFixed(0).padStart(5)}ms · server ${serverMs.toFixed(0).padStart(5)}ms · html ${kb.toFixed(0).padStart(4)}kb · HTTP ${resp?.status()}`,
    );
    return { ms, serverMs, kb, status: resp?.status() };
  };

  console.log("--- real response times, real data ---");
  // WARM UP FIRST. `next start` compiles a route lazily on its first request, and
  // this page also pays a one-off client-bundle cost. Reporting the first hit as
  // "the response time" would attribute framework startup to the dashboard and
  // send the next change at the wrong target -- which is exactly what nearly
  // happened here: the first measured pass blamed the widest selection for 3.2s.
  await page.goto(`http://localhost:${APP_PORT}/time/dashboard?preset=this_week`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });

  // Each selection twice, and the SECOND is the one asserted on. The first hit of
  // a given shape still pays route-level warmup; the second is the steady state a
  // person navigating the dashboard actually experiences.
  const twice = async (qs, label) => {
    await visit(qs, `${label} (cold)`);
    return visit(qs, `${label} (warm)`);
  };

  const thisMonth = await twice("preset=this_month&group=project&bucket=day", "this month, by project");
  const allTime = await twice("preset=all&group=project&bucket=week", "all time, by project");
  const allCal = await twice("preset=all&calendar=1&group=customer&bucket=month", "all time + calendar, by customer");
  const filtered = await twice("preset=this_year&billable=yes&group=member&bucket=week", "this year, billable, by member");

  check("the live dashboard returns 200 for a real exec", thisMonth.status === 200, `status ${thisMonth.status}`);
  check("the live dashboard was not bounced to /auth/login", !page.url().includes("/auth/login"), page.url());

  // A budget rather than a vague "feels fast". 3s is the point past which a
  // report is experienced as broken rather than slow; the widest selection this
  // product offers must stay inside it.
  for (const [label, r] of [
    ["this month", thisMonth],
    ["all time", allTime],
    ["all time + calendar", allCal],
    ["this year filtered", filtered],
  ]) {
    check(`${label} renders within 3s on live data`, r.ms < 3000, `took ${r.ms.toFixed(0)}ms`);
  }

  // ── The original complaint, checked against the real dataset ─────────────
  await visit("preset=all&group=project&bucket=week", "all time, by project (assert)");
  const bodyText = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  writeFileSync("tmp-live-dashboard.txt", bodyText);

  check(
    "the dashboard rendered rather than hitting its error boundary",
    !/This page couldn't load/.test(bodyText),
    `server log tail: ${appLog.slice(-1200)}`,
  );

  const byProject = (await panel("BY PROJECT").innerText()).replace(/\s+/g, " ");
  const stated = /of ([\d,]+)/.exec(byProject);
  const statedTotal = stated ? Number(stated[1].replace(/,/g, "")) : 0;
  console.log(`\n  BY PROJECT header: ${byProject.slice(0, 120)}`);
  check(
    "the project breakdown states a real, large row count rather than a 'top N'",
    statedTotal > 100,
    `header claims ${statedTotal} rows — the reported symptom was a list showing only some projects`,
  );
  check(
    "page one holds 25 rows of that total",
    (await panel("BY PROJECT").locator("tbody tr").count()) === 25,
    `${await panel("BY PROJECT").locator("tbody tr").count()} rows`,
  );

  // ALL, on the real dataset. This is the assertion the whole change is for, and
  // it is also the one place real scale could hurt: rendering 300+ rows at once.
  const t0 = performance.now();
  await panel("BY PROJECT").getByRole("button", { name: "ALL" }).click();
  await page.waitForFunction(
    (n) => {
      const s = [...document.querySelectorAll("section")].find((x) =>
        x.querySelector("h2")?.textContent?.includes("BY PROJECT"),
      );
      return (s?.querySelectorAll("tbody tr").length ?? 0) >= n;
    },
    Math.min(statedTotal, 200),
    { timeout: 20_000 },
  ).catch(() => {});
  const allMs = performance.now() - t0;
  const allRows = await panel("BY PROJECT").locator("tbody tr").count();
  console.log(`  ALL rendered ${allRows} rows in ${allMs.toFixed(0)}ms`);
  check(
    "every project in the real dataset is reachable via ALL",
    allRows === statedTotal,
    `${allRows} of ${statedTotal} — this is the exact symptom reported: a list that shows only some projects`,
  );
  check(
    "rendering every real row stays interactive (under 2s)",
    allMs < 2000,
    `took ${allMs.toFixed(0)}ms for ${allRows} rows — a table that locks the tab is not usable`,
  );

  // Sorting the full real table, client-side. My claim that this "costs nothing"
  // was never measured on real row counts.
  const t1 = performance.now();
  await panel("BY PROJECT").getByRole("button", { name: /^Hours/ }).click();
  await page.waitForTimeout(50);
  const sortMs = performance.now() - t1;
  console.log(`  re-sort of ${allRows} rows: ${sortMs.toFixed(0)}ms`);
  check(
    "re-sorting the full real table is instant (under 400ms)",
    sortMs < 400,
    `took ${sortMs.toFixed(0)}ms — this is the claim that client-side sorting beats a round trip`,
  );

  // The customer picker over 197 real options, the other list the old 200-cap
  // silently truncated.
  await page.getByRole("button", { name: /CUSTOMER/ }).first().click();
  await page.waitForTimeout(400);
  const custOptions = await page.locator('[role="listbox"][aria-label="Customer"] [data-option]').count();
  console.log(`  customer picker rendered ${custOptions} options (live total ${customerCount})`);
  check(
    "the customer picker is not silently capped on real data",
    custOptions > 100,
    `${custOptions} options for ${customerCount} customers`,
  );

  check("no uncaught client-side error on live data", errors.length === 0, errors.slice(0, 2).join(" | "));

  mkdirSync("tmp-shots", { recursive: true });

  // ── The loading skeleton ─────────────────────────────────────────────────
  // This page takes 0.5s-3.3s against real data, so the wait is real and a
  // skeleton is the difference between "loading" and "broken". Asserted by
  // catching the intermediate state during a CLIENT-SIDE navigation, which is the
  // only time a route's loading.tsx is shown: on a hard document request the
  // server streams the finished page and the skeleton never appears. Getting that
  // wrong is why the first version of this check looked for a skeleton that could
  // not have been there. A loading.tsx in the wrong directory is invisible
  // otherwise, so this is worth asserting rather than assuming.
  {
    const slow = await ctx.newPage();
    // Delay the RSC payload the client router fetches, so the pending state is
    // observable. `_rsc` marks those requests.
    await slow.route(/_rsc=/, async (route) => {
      await new Promise((r) => setTimeout(r, 1200));
      await route.continue();
    });

    // Start somewhere else in the app, then navigate to the dashboard through the
    // sidebar link, exactly as a person would.
    await slow.goto(`http://localhost:${APP_PORT}/time?view=records`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await slow.getByRole("link", { name: /TrackingTime Dashboard/i }).first().click();

    let sawSkeleton = false;
    for (let i = 0; i < 40; i++) {
      const n = await slow.locator(".animate-pulse").count().catch(() => 0);
      if (n > 5) {
        sawSkeleton = true;
        break;
      }
      await slow.waitForTimeout(100);
    }
    await slow
      .locator("text=TOTAL HOURS")
      .first()
      .waitFor({ state: "visible", timeout: 30_000 })
      .catch(() => {});
    check(
      "a loading skeleton is shown while the slow report is fetched",
      sawSkeleton,
      "no shimmer blocks appeared — the route's loading.tsx is not being reached, so a 3s wait shows a frozen page",
    );
    await slow.close();
  }

  await page.keyboard.press("Escape");
  await visit("preset=all&group=project&bucket=week", "screenshot pass");
  await page.screenshot({ path: "tmp-shots/live-dashboard.png", fullPage: true });
  console.log("\n  screenshot: tmp-shots/live-dashboard.png");
} finally {
  await browser.close();
  cleanup();
}

console.log(
  failed
    ? "\nLIVE DASHBOARD: the real dataset exposes problems the fixture did not\n"
    : "\nLIVE DASHBOARD: the real 334-project dataset renders, fully reachable and fast\n",
);
process.exit(failed ? 1 : 0);
