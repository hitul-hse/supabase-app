/**
 * Second-order recheck: re-verify the claims whose EVIDENCE was itself suspect.
 *
 * The previous recheck corrected two of my claims, but it repeated the exact
 * methodological error that made my original performance work wrong: it compared
 * sequential against parallel paging using `admin` -- the SERVICE ROLE key, which
 * bypasses row-level security. RLS evaluation is the dominant cost on this table
 * (311ms vs 2,870ms measured earlier), so a service-role comparison cannot describe
 * what a signed-in user experiences. Twice now that shortcut has produced a
 * confident number about the wrong thing.
 *
 * It also left two gaps I am closing here:
 *
 *   - I verified "ALL reaches every row" on the BREAKDOWN table only. The claim
 *     covers three aggregate tables. Budget burn and economics were checked by
 *     reading their stated counts, never by clicking ALL and counting rendered
 *     rows.
 *   - "Three gates pass" was verified by running them. It was never verified that
 *     they would FAIL if the product regressed -- a gate that cannot fail is not
 *     evidence.
 *
 * Run: node --experimental-strip-types scripts/recheck2-paging-and-tables.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const root = process.cwd();
registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith("@/")) {
      const base = join(root, "src", spec.slice(2));
      const t = existsSync(`${base}.ts`) ? `${base}.ts` : `${base}.tsx`;
      return { url: pathToFileURL(t).href, shortCircuit: true };
    }
    return next(spec, ctx);
  },
});

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

const verdicts = [];
const verdict = (claim, upheld, evidence) => {
  verdicts.push({ claim, upheld, evidence });
  console.log(`${upheld ? "UPHELD   " : "CORRECTED"} ${claim}\n           ${evidence}`);
};

const admin = createClient(URL_BASE, SERVICE, { auth: { persistSession: false } });
if ((await admin.schema("time").from("entry").select("id").limit(1)).error) {
  console.log("SKIP: time schema unreachable");
  process.exit(0);
}

// A real exec session -- the caller the app actually uses.
const { data: profiles } = await admin
  .from("app_user_profile").select("user_id").eq("role_key", "exec").eq("is_active", true).limit(1);
if (!profiles?.length) { console.log("SKIP: no exec"); process.exit(0); }
const { data: u } = await admin.auth.admin.getUserById(profiles[0].user_id);
const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: u.user.email });
const anon = createClient(URL_BASE, ANON, { auth: { persistSession: false } });
const { data: sess } = await anon.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
if (!sess?.session) { console.log("SKIP: no session"); process.exit(0); }
const token = sess.session.access_token;
const asExec = createClient(URL_BASE, ANON, {
  auth: { persistSession: false },
  global: { headers: { Authorization: `Bearer ${token}` } },
});

// ══ 1. Paging, compared UNDER RLS as a signed-in user ══════════════════════
console.log("=== C4 re-done under RLS (the previous recheck used service_role) ===\n");

const { fetchAllEntries, parseFilters } = await import("../src/lib/queries/trackingtime-report.ts");
const PAGE = 1000;
const SELECT = `
  id, member_id, project_id, customer_id, service_id,
  started_at, duration_seconds, is_billable, is_billed, is_calendar, notes,
  member:member_id ( display_name ),
  project:project_id ( name ),
  customer:customer_id ( name ),
  service:service_id ( name ),
  task:task_id ( name )
`;

/** The pre-change sequential algorithm, run through whichever client is given. */
async function sequentialIds(client, filters) {
  const toExclusive = new Date(`${filters.to}T00:00:00.000Z`);
  toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);
  const ids = [];
  for (let page = 0; page < 25; page++) {
    let q = client.schema("time").from("entry").select(SELECT)
      .gte("started_at", `${filters.from}T00:00:00.000Z`)
      .lt("started_at", toExclusive.toISOString())
      .not("duration_seconds", "is", null)
      .order("started_at", { ascending: false })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (!filters.includeCalendar) q = q.eq("is_calendar", false);
    const { data, error } = await q;
    if (error || !data) break;
    for (const r of data) ids.push(Number(r.id));
    if (data.length < PAGE) break;
  }
  return ids;
}

const wide = parseFilters({ preset: "all", calendar: "1" });
const med = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const N = 5;

const seqRls = [], parRls = [], seqSvc = [], parSvc = [];
let refIds = [], shippedIds = [];
for (let i = 0; i < N; i++) {
  let t = performance.now();
  refIds = await sequentialIds(asExec, wide);
  seqRls.push(performance.now() - t);

  t = performance.now();
  shippedIds = (await fetchAllEntries(asExec, wide)).entries.map((e) => e.id);
  parRls.push(performance.now() - t);

  t = performance.now();
  await sequentialIds(admin, wide);
  seqSvc.push(performance.now() - t);

  t = performance.now();
  await fetchAllEntries(admin, wide);
  parSvc.push(performance.now() - t);
}

console.log(`  under RLS (what a user gets):  sequential ${med(seqRls).toFixed(0)}ms → parallel ${med(parRls).toFixed(0)}ms`);
console.log(`  service_role (RLS bypassed):   sequential ${med(seqSvc).toFixed(0)}ms → parallel ${med(parSvc).toFixed(0)}ms`);

verdict(
  "C4-redo: the paging speedup holds UNDER RLS, not just with the service-role key",
  med(parRls) < med(seqRls),
  `RLS: ${med(seqRls).toFixed(0)}ms → ${med(parRls).toFixed(0)}ms (saves ${(med(seqRls) - med(parRls)).toFixed(0)}ms). ` +
    `The previous recheck only measured the service-role path (${med(seqSvc).toFixed(0)}→${med(parSvc).toFixed(0)}ms), ` +
    `which bypasses the dominant cost and so could not describe a real user`,
);
verdict(
  "C4-redo: the service-role figures UNDERSTATE what the change is worth to a user",
  med(seqRls) - med(parRls) > med(seqSvc) - med(parSvc),
  `saving under RLS ${(med(seqRls) - med(parRls)).toFixed(0)}ms vs ${(med(seqSvc) - med(parSvc)).toFixed(0)}ms as service_role ` +
    `-- each of the 5 serial round trips carries policy evaluation, so removing the serialisation saves more, not less`,
);
verdict(
  "C4-redo: rows are still identical in order under RLS, with no duplicates",
  shippedIds.length === refIds.length &&
    shippedIds.every((id, i) => id === refIds[i]) &&
    new Set(shippedIds).size === shippedIds.length,
  `${shippedIds.length} ids vs ${refIds.length} from the sequential reference, both as the same exec`,
);

// ══ 2. Do the OTHER aggregate tables really reach every row? ════════════════
console.log("\n=== C1 re-done: click ALL on budget burn and economics, not just the breakdown ===\n");

const APP_PORT = 3123;
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
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.addInitScript(() => {
    try { window.localStorage.setItem("hse_tour_done", "1"); } catch { /* ignore */ }
  });
  const host = new URL(URL_BASE).hostname.split(".")[0];
  await ctx.addCookies([{
    name: `sb-${host}-auth-token`,
    value: "base64-" + Buffer.from(JSON.stringify(sess.session)).toString("base64url"),
    domain: "localhost", path: "/", httpOnly: false, secure: false, sameSite: "Lax",
  }]);
  const page = await ctx.newPage();
  const panel = (t) => page.locator("section").filter({ has: page.locator(`h2:text-is("${t}")`) });
  const rows = (t) => panel(t).locator("tbody tr").count();

  await page.goto(`http://localhost:${APP_PORT}/time/dashboard?preset=all&calendar=1&group=project&bucket=month`, {
    waitUntil: "domcontentloaded", timeout: 60_000,
  });
  await page.locator("text=TOTAL HOURS").first().waitFor({ state: "visible", timeout: 30_000 }).catch(() => {});

  const expand = async (t) => {
    const h = panel(t).locator("button[aria-expanded]").first();
    for (let i = 0; i < 12; i++) {
      if ((await h.getAttribute("aria-expanded")) === "true") return true;
      await h.click();
      await page.waitForTimeout(150);
    }
    return false;
  };

  for (const name of ["BUDGET BURN", "PROJECT ECONOMICS"]) {
    const opened = await expand(name);
    if (!opened) { verdict(`C1-redo: ${name} could not be expanded`, false, "panel did not open"); continue; }
    const header = (await panel(name).innerText()).replace(/\s+/g, " ");
    const stated = Number((/of ([\d,]+)/.exec(header)?.[1] ?? "0").replace(/,/g, ""));

    // Click ALL and count what actually renders -- the check I only ever did on
    // the breakdown table.
    const allBtn = panel(name).getByRole("button", { name: "ALL" });
    let rendered = 0;
    for (let i = 0; i < 12; i++) {
      await allBtn.click();
      for (let j = 0; j < 12; j++) {
        rendered = await rows(name);
        if (rendered === stated) break;
        await page.waitForTimeout(120);
      }
      if (rendered === stated) break;
    }
    verdict(
      `C1-redo: ${name} renders all ${stated} rows when ALL is selected`,
      rendered === stated && stated > 25,
      `${rendered} of ${stated} rendered${stated <= 25 ? " (too few rows for paging to be exercised)" : ""}`,
    );
  }

  // ══ 3. Can the gates actually FAIL? ══════════════════════════════════════
  // A gate that passes no matter what is not evidence. The cheapest honest test:
  // assert that the acceptance gate's own key locator would notice a missing
  // panel, by checking a panel that does NOT exist.
  console.log("\n=== C2 re-done: would the gates notice a regression? ===\n");
  const bogus = await panel("PANEL THAT DOES NOT EXIST").count();
  verdict(
    "C2-redo: the gates' panel locator distinguishes present from absent panels",
    bogus === 0 && (await panel("BY PROJECT").count()) === 1,
    `a non-existent panel matches ${bogus} sections while BY PROJECT matches 1 -- so 'panel renders' assertions are not vacuous`,
  );
} finally {
  await browser.close();
  cleanup();
}

console.log("\n=== summary ===");
for (const v of verdicts) console.log(`  ${v.upheld ? "upheld   " : "corrected"}  ${v.claim.split(":")[0]}`);
const bad = verdicts.filter((v) => !v.upheld);
console.log(`\n${verdicts.length} checked, ${bad.length} corrected.`);
process.exit(bad.length ? 1 : 0);
