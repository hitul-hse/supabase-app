/**
 * Is the PRODUCTION deployment reading the database I backfilled, and is it running
 * the year-to-date fix?
 *
 * The user reports 6,292h, which is exactly our PRE-backfill total for 2026 and is
 * not producible from the current data by any definition. So something they are
 * looking at is stale. Two candidates remain, with different fixes:
 *
 *   A) PRODUCTION READS A DIFFERENT SUPABASE PROJECT. NEXT_PUBLIC_SUPABASE_URL is
 *      inlined at build time, so the deployed bundle points at whatever project was
 *      configured for that build. If it is not wdbedblvyrfqwypngghs, my backfill
 *      never touched the data production serves, and 6,292h would be that other
 *      project's real number.
 *
 *   B) PRODUCTION RUNS PRE-FIX CODE. This checkout is 15 commits ahead of origin,
 *      including the "This year = year-to-date" change. Old code against the SAME
 *      (now backfilled) database would show 8,263.4h, not 6,292h -- so this alone
 *      cannot explain the report, but it does mean production still disagrees with
 *      what I verified locally.
 *
 * The deployed bundle is the evidence: NEXT_PUBLIC_SUPABASE_URL appears verbatim in
 * the client JavaScript, so it can simply be read.
 *
 * Read-only: fetches public assets and unauthenticated pages only.
 *
 * Run: node scripts/check-prod-config.mjs
 */
import { readFileSync } from "node:fs";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const LOCAL_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const LOCAL_REF = LOCAL_URL ? new URL(LOCAL_URL).hostname.split(".")[0] : null;

const SITE = process.argv[2] ?? "https://hseportal.hs-experts.com";
console.log(`production:  ${SITE}`);
console.log(`this repo:   ${LOCAL_URL} (project ref ${LOCAL_REF})\n`);

// The login page is public and ships the same client bundle as the rest of the app.
const login = await fetch(`${SITE}/auth/login`, { redirect: "follow" });
const html = await login.text();
console.log(`GET /auth/login -> HTTP ${login.status}, ${(html.length / 1024).toFixed(0)}kb`);

// Collect the script URLs the page loads, then grep them for the project ref.
const scripts = [...html.matchAll(/src="([^"]+\.js[^"]*)"/g)].map((m) => m[1]);
const unique = [...new Set(scripts)].slice(0, 40);
console.log(`client scripts referenced: ${unique.length}`);

const refs = new Set();
// Supabase project refs are 20 lowercase letters in a *.supabase.co hostname.
const refRe = /https:\/\/([a-z0-9]{16,24})\.supabase\.co/g;
for (const m of html.matchAll(refRe)) refs.add(m[1]);

let scanned = 0;
for (const s of unique) {
  const url = s.startsWith("http") ? s : `${SITE}${s.startsWith("/") ? "" : "/"}${s}`;
  try {
    const res = await fetch(url);
    if (!res.ok) continue;
    const body = await res.text();
    scanned++;
    for (const m of body.matchAll(refRe)) refs.add(m[1]);
  } catch {
    /* a missing chunk is not fatal to this diagnosis */
  }
}
console.log(`scanned ${scanned} script chunks for a Supabase project ref\n`);

console.log("=== which Supabase project does production talk to? ===");
if (refs.size === 0) {
  console.log("  could not find any project ref in the public bundle (it may be server-only).");
  console.log("  Inconclusive from outside; check the Vercel project's environment variables.");
} else {
  for (const r of refs) {
    const same = r === LOCAL_REF;
    console.log(`  ${r}${same ? "   <== SAME project this repo backfilled" : "   <== DIFFERENT project"}`);
  }
  if (!refs.has(LOCAL_REF)) {
    console.log("\n  => Production reads a DIFFERENT database. My backfill did not touch it, so its");
    console.log("     totals are still short and 6,292h would be its genuine pre-backfill number.");
    console.log("     Fix: run the backfill against that project, or point production at this one.");
  } else {
    console.log("\n  => Production reads the same database I backfilled, so its DATA is current.");
  }
}

// Is the deployed code the pre-fix version? The year-to-date change is server-side,
// so it cannot be read from the bundle; the honest answer is the commit state.
console.log("\n=== is production running the fix? ===");
console.log("  The 'This year = year-to-date' change is server-side, so it is not visible in");
console.log("  the client bundle. What is knowable: this checkout is ahead of origin/master,");
console.log("  and production deploys from origin. Until those commits are pushed and");
console.log("  deployed, production will still resolve 'This year' to 31 December and show");
console.log("  8,263.4h rather than the 7,498.5h that matches TrackingTime.");
console.log("\n  Expected AFTER a deploy, for This Year:");
console.log("    default (calendar off):        4,409.4h");
console.log("    with Calendar time ON:         7,498.5h   <- matches TrackingTime's 7,498h");
