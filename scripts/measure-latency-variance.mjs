/**
 * How variable is the dashboard's worst-case latency, really?
 *
 * WHY THIS MATTERS: successive runs of check:live-dashboard measured the widest
 * selection (all time + calendar, grouped by customer) at 3272ms, 3338ms and then
 * 4068ms. A single sample is therefore not a measurement of anything, and a budget
 * asserted against one sample either passes by luck or fails by luck. I had been
 * treating these numbers as stable when they are not.
 *
 * The cause is knowable rather than mysterious: that selection reads 4,194 rows
 * through a per-row RLS predicate over the public internet to a shared Supabase
 * instance. Every one of those is a source of variance.
 *
 * So this samples properly and reports the distribution, which is what a budget
 * should be set from -- and specifically the p95-ish worst observed, not the mean,
 * because a report that is usually 3s and sometimes 5s is experienced as the 5s.
 *
 * Run: node scripts/measure-latency-variance.mjs
 */
import { readFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const { NEXT_PUBLIC_SUPABASE_URL: URL_BASE, SUPABASE_SERVICE_ROLE_KEY: SERVICE, NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON } = env;
if (!URL_BASE || !SERVICE || !ANON) {
  console.log("SKIP: no live credentials");
  process.exit(0);
}

const admin = createClient(URL_BASE, SERVICE, { auth: { persistSession: false } });
if ((await admin.schema("time").from("entry").select("id").limit(1)).error) {
  console.log("SKIP: time schema unreachable");
  process.exit(0);
}

const { data: profiles } = await admin
  .from("app_user_profile").select("user_id").eq("role_key", "exec").eq("is_active", true).limit(1);
const { data: u } = await admin.auth.admin.getUserById(profiles[0].user_id);
const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: u.user.email });
const anon = createClient(URL_BASE, ANON, { auth: { persistSession: false } });
const { data: sess } = await anon.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
const session = sess.session;

const APP_PORT = 3121;
const app = spawn("npx", ["next", "start", "--port", String(APP_PORT)], {
  env: process.env, shell: true, stdio: "pipe",
});
const cleanup = () => {
  try {
    if (process.platform === "win32" && app.pid) {
      spawnSync("taskkill", ["/PID", String(app.pid), "/T", "/F"], { stdio: "ignore" });
    } else app.kill("SIGKILL");
  } catch { /* gone */ }
};
let up = false;
for (let i = 0; i < 120; i++) {
  try { await fetch(`http://localhost:${APP_PORT}/auth/login`); up = true; break; }
  catch { await new Promise((r) => setTimeout(r, 500)); }
}
if (!up) { console.log("FAIL: server did not start (npm run build first)"); cleanup(); process.exit(1); }

const { chromium } = await import("playwright");
const browser = await chromium.launch();

const stats = (xs) => {
  const s = xs.slice().sort((a, b) => a - b);
  return {
    min: s[0],
    median: s[Math.floor(s.length / 2)],
    max: s[s.length - 1],
    p90: s[Math.min(s.length - 1, Math.floor(s.length * 0.9))],
    spread: s[s.length - 1] - s[0],
  };
};

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

  const visit = async (qs) => {
    const t0 = performance.now();
    await page.goto(`http://localhost:${APP_PORT}/time/dashboard?${qs}`, {
      waitUntil: "domcontentloaded", timeout: 90_000,
    });
    await page.locator("text=TOTAL HOURS").first()
      .waitFor({ state: "visible", timeout: 60_000 }).catch(() => {});
    return performance.now() - t0;
  };

  await visit("preset=this_week"); // warm

  const N = 8;
  const CASES = [
    ["this month (typical)", "preset=this_month&group=project&bucket=day"],
    ["all time", "preset=all&group=project&bucket=week"],
    ["all time + calendar (worst)", "preset=all&calendar=1&group=customer&bucket=month"],
  ];

  console.log(`sampling each selection ${N} times through the real page, real RLS\n`);
  const table = [];
  for (const [label, qs] of CASES) {
    const xs = [];
    for (let i = 0; i < N; i++) xs.push(await visit(qs));
    const s = stats(xs);
    table.push([label, s]);
    console.log(
      `${label.padEnd(30)} min ${s.min.toFixed(0).padStart(5)}  median ${s.median.toFixed(0).padStart(5)}` +
        `  p90 ${s.p90.toFixed(0).padStart(5)}  max ${s.max.toFixed(0).padStart(5)}  spread ${s.spread.toFixed(0)}ms`,
    );
  }

  const worst = table.find(([l]) => l.includes("worst"))[1];
  console.log(
    `\n=== what this means for a budget ===\n` +
      `  The worst-case selection varies by ${worst.spread.toFixed(0)}ms across ${N} identical runs\n` +
      `  (${worst.min.toFixed(0)}ms to ${worst.max.toFixed(0)}ms). A budget asserted from ONE sample would\n` +
      `  therefore pass or fail by luck, which is what happened: three separate runs\n` +
      `  of check:live-dashboard reported 3272ms, 3338ms and 4068ms for this selection.\n\n` +
      `  A budget has to be set from the p90 or the max, not the median, because a\n` +
      `  report that is usually fast and sometimes slow is experienced as the slow\n` +
      `  case. Observed p90 here: ${worst.p90.toFixed(0)}ms.\n\n` +
      `  This is also the strongest argument yet for applying\n` +
      `  supabase/migrations/hoist_entry_read_policy.sql: the variance scales with the\n` +
      `  number of rows pushed through the per-row RLS predicate, so removing that\n` +
      `  work shrinks the spread as well as the median.`,
  );
} finally {
  await browser.close();
  cleanup();
}
