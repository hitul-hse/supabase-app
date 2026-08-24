// Where do the seconds actually go?
//
// audit-app-quality.mjs says every route takes >3s wall-clock. The database
// says the heaviest query is 62ms. This script settles the argument by
// splitting each navigation into the four phases that can actually contain
// the time, using the browser's own Navigation Timing / Resource Timing:
//
//   TTFB      responseStart - requestStart   ... the server thinking
//   download  responseEnd - responseStart    ... HTML streaming down
//   dom       domContentLoaded - responseEnd ... scripts parsed + executed
//   hydrate   loadEvent -> last resource     ... client work after first paint
//   post-load any fetch/xhr/rsc that starts AFTER load -- a client waterfall
//
// It also lists the biggest scripts and every request the page fired after
// the load event, because a client component fetching post-hydration is the
// classic cause of "fast query, slow page".
//
// Usage:  node scripts/measure-page-timing.mjs [email] [--runs=2]
//         SITE=http://localhost:3000 node scripts/measure-page-timing.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const SB = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const SITE = process.env.SITE ?? "https://hseportal.hs-experts.com";
const args = process.argv.slice(2);
const EMAIL = args.find((a) => !a.startsWith("--")) ?? "bjoern.schoenemann@hs-experts.com";
const RUNS = Number((args.find((a) => a.startsWith("--runs=")) ?? "--runs=1").split("=")[1]);

const ROUTES = (process.env.ROUTES ?? [
  "/", "/my-work", "/projects", "/people", "/timesheets", "/time",
  "/time/dashboard", "/leave", "/profile", "/team-lead",
  "/dashboard/management?tab=overview", "/dashboard/management?tab=customers",
  "/admin/users", "/admin/roles", "/admin/alerts", "/customer-master/import-review",
].join(",")).split(",").filter(Boolean);

const link = async () => {
  const r = await fetch(`${SB}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "magiclink", email: EMAIL, options: { redirect_to: `${SITE}/auth/callback` } }),
  });
  const b = await r.json();
  return b?.properties?.hashed_token ?? b?.hashed_token;
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

await page.goto(`${SITE}/auth/callback?token_hash=${await link()}&type=magiclink&next=%2F`, { waitUntil: "networkidle", timeout: 120000 });
if (/auth\/login|error=/.test(page.url())) {
  await page.goto(`${SITE}/auth/callback?token_hash=${await link()}&type=magiclink&next=%2F`, { waitUntil: "networkidle", timeout: 120000 });
}
if (/auth\/login|error=/.test(page.url())) { console.log(`FAILED TO SIGN IN: ${page.url()}`); await browser.close(); process.exit(1); }
console.log(`signed in as ${EMAIL} against ${SITE}\n`);

const results = [];

for (const route of ROUTES) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) {
    // Always navigate away first, so every measurement is a real full
    // document load and not a no-op same-URL navigation.
    await page.goto(`${SITE}/auth/blank-measure-probe`, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});

    const t0 = Date.now();
    try {
      await page.goto(`${SITE}${route}`, { waitUntil: "networkidle", timeout: 60000 });
    } catch { runs.push({ err: "timeout" }); continue; }
    const wall = Date.now() - t0;

    const t = await page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0];
      const res = performance.getEntriesByType("resource");
      const loadEnd = nav ? nav.loadEventEnd : 0;

      const sum = (list) => list.reduce((a, r) => a + (r.transferSize || 0), 0);
      const scripts = res.filter((r) => r.initiatorType === "script" || /\.js(\?|$)/.test(r.name));
      const fetches = res.filter((r) => r.initiatorType === "fetch" || r.initiatorType === "xmlhttprequest");

      // Anything that only STARTED after the load event is client-side work
      // the server could have done. This is the waterfall detector.
      const afterLoad = res.filter((r) => loadEnd > 0 && r.startTime > loadEnd);

      const short = (u) => { try { const x = new URL(u); return (x.host.includes("supabase") ? "SUPABASE " : "") + x.pathname.slice(-58) + (x.search ? "?" + x.search.slice(0, 40) : ""); } catch { return u.slice(-60); } };

      return {
        // The server: how long before the first byte of HTML arrives.
        ttfb: nav ? Math.round(nav.responseStart - nav.requestStart) : null,
        redirect: nav ? Math.round(nav.redirectEnd - nav.redirectStart) : 0,
        dns: nav ? Math.round(nav.domainLookupEnd - nav.domainLookupStart) : 0,
        tls: nav ? Math.round(nav.connectEnd - nav.connectStart) : 0,
        // HTML streaming: with RSC streaming this covers server data fetches
        // that resolve inside Suspense boundaries.
        htmlDownload: nav ? Math.round(nav.responseEnd - nav.responseStart) : null,
        domInteractive: nav ? Math.round(nav.domInteractive - nav.responseEnd) : null,
        domContentLoaded: nav ? Math.round(nav.domContentLoadedEventEnd - nav.responseEnd) : null,
        loadEvent: nav ? Math.round(nav.loadEventEnd - nav.startTime) : null,
        htmlBytes: nav ? nav.transferSize : null,

        scriptCount: scripts.length,
        scriptKb: Math.round(sum(scripts) / 1024),
        resourceCount: res.length,
        totalKb: Math.round(sum(res) / 1024),

        fetchCount: fetches.length,
        // The smoking gun, if there is one.
        afterLoadCount: afterLoad.length,
        afterLoadMs: afterLoad.length ? Math.round(Math.max(...afterLoad.map((r) => r.responseEnd)) - loadEnd) : 0,
        afterLoadList: afterLoad.slice(0, 12).map((r) => ({
          name: short(r.name),
          type: r.initiatorType,
          start: Math.round(r.startTime - loadEnd),
          dur: Math.round(r.duration),
        })),
        biggestScripts: scripts.sort((a, b) => (b.transferSize || 0) - (a.transferSize || 0)).slice(0, 5)
          .map((r) => ({ name: short(r.name), kb: Math.round((r.transferSize || 0) / 1024), dur: Math.round(r.duration) })),
        slowestResources: res.slice().sort((a, b) => b.duration - a.duration).slice(0, 6)
          .map((r) => ({ name: short(r.name), type: r.initiatorType, dur: Math.round(r.duration), start: Math.round(r.startTime) })),
      };
    });

    runs.push({ wall, ...t });
  }
  const ok = runs.filter((r) => !r.err);
  const best = ok.sort((a, b) => a.wall - b.wall)[0] ?? { err: "timeout" };
  results.push({ route, ...best, allWall: runs.map((r) => r.wall ?? "to") });
  const b = best;
  console.log(
    route.padEnd(38),
    `wall ${String(b.wall ?? "-").padStart(6)}`,
    `ttfb ${String(b.ttfb ?? "-").padStart(5)}`,
    `html ${String(b.htmlDownload ?? "-").padStart(5)}`,
    `dcl ${String(b.domContentLoaded ?? "-").padStart(5)}`,
    `load ${String(b.loadEvent ?? "-").padStart(5)}`,
    `js ${String(b.scriptKb ?? "-").padStart(4)}kb/${String(b.scriptCount ?? "-").padStart(2)}`,
    `afterLoad ${String(b.afterLoadCount ?? "-").padStart(2)} (${String(b.afterLoadMs ?? "-")}ms)`,
  );
}

console.log("\n\n=== where the time goes (best run per route) ===");
const tot = (k) => results.reduce((a, r) => a + (r[k] || 0), 0);
console.log(`sum wall ${tot("wall")}ms   sum ttfb ${tot("ttfb")}ms   sum htmlDownload ${tot("htmlDownload")}ms   sum afterLoad ${tot("afterLoadMs")}ms`);
const serverShare = (tot("ttfb") + tot("htmlDownload")) / Math.max(1, tot("wall"));
console.log(`server (ttfb + html stream) is ${(serverShare * 100).toFixed(0)}% of wall time`);

console.log("\n=== requests that START after the load event (client waterfalls) ===");
for (const r of results) {
  if (!r.afterLoadCount) continue;
  console.log(`\n${r.route}  (+${r.afterLoadMs}ms after load)`);
  for (const a of r.afterLoadList) console.log(`   +${String(a.start).padStart(5)}ms  ${String(a.dur).padStart(5)}ms  ${a.type.padEnd(6)} ${a.name}`);
}

console.log("\n=== slowest single resources per route ===");
for (const r of results) {
  if (!r.slowestResources) continue;
  const top = r.slowestResources.filter((s) => s.dur > 200).slice(0, 4);
  if (!top.length) continue;
  console.log(`\n${r.route}`);
  for (const s of top) console.log(`   ${String(s.dur).padStart(5)}ms @${String(s.start).padStart(5)}ms ${(s.type || "").padEnd(10)} ${s.name}`);
}

writeFileSync("C:/Supabase/.measure-page-timing.json", JSON.stringify(results, null, 2));
console.log("\nwrote .measure-page-timing.json");

await browser.close();
