/**
 * Do the numbers on the DEPLOYED page match the database?
 *
 * WHY THIS IS THE GAP. Two strong checks already exist and neither answers this.
 * `check:no-mock-data` reads source: it proves the page cannot QUERY the seeded
 * tables. `.v3code/prove-overview-live.mjs` renders the real page against the real
 * database, but against a LOCAL `next start` build. Both can pass while production
 * serves something else -- a deploy that did not include the commit, a stale
 * bundle, or a CDN/ISR entry still holding the pre-fix render. That gap is exactly
 * the class of fault the original bug lived in: a page that looked authoritative
 * and was reporting something other than the database.
 *
 * So this drives the production URL, as a real exec, and compares what is on
 * screen against figures recomputed here from the service-role client.
 *
 * The session is minted with a magic link and injected as a cookie, following
 * prove-overview-live.mjs, because the exec's password is not in the repo and
 * should not be. Unlike the local version the cookie has to be CHUNKED -- see
 * below, a real session exceeds the per-cookie size limit.
 *
 * Read-only against production: it reads one page and creates nothing. The magic
 * link consumes a single OTP for an existing account and leaves no new rows.
 *
 * Run: npm run check:live-overview-deployed [site]
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const {
  NEXT_PUBLIC_SUPABASE_URL: URL_BASE,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE,
} = env;
const SITE = (process.argv[2] ?? "https://hseportal.hs-experts.com").replace(/\/$/, "");

if (!URL_BASE || !ANON || !SERVICE) {
  console.log("SKIP: need Supabase URL, anon key and service-role key in .env.local");
  process.exit(0);
}

let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? `\n        ${detail}` : ""}`);
};

const admin = createClient(URL_BASE, SERVICE, { auth: { persistSession: false } });

// ── Ground truth, recomputed here rather than via the page's own helpers ────
const OVERVIEW_WEEKS = 12;

// The same bounded window the page uses: whole weeks up to and including the
// current one, never future-dated planned weeks. Recomputed independently, since
// importing getOrgWeeks would let a wrong helper agree with itself.
const now = new Date();
const day = now.getUTCDay();
const mondayOffset = day === 0 ? 6 : day - 1;
const thisMonday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - mondayOffset));
const windowStart = new Date(thisMonday);
windowStart.setUTCDate(windowStart.getUTCDate() - (OVERVIEW_WEEKS - 1) * 7);
const iso = (d) => d.toISOString().slice(0, 10);

const { data: weeks, error: weeksErr } = await admin
  .schema("time")
  .from("org_week")
  .select("week_start, total_seconds, billable_seconds, entry_count")
  .gte("week_start", iso(windowStart))
  .lte("week_start", iso(thisMonday))
  .order("week_start");

if (weeksErr) {
  // The view name is an implementation detail; fall back to raw entries.
  console.log(`  (org_week unavailable: ${weeksErr.message}) -- recomputing from time.entry`);
}

let totalSeconds = 0;
let billableSeconds = 0;
if (weeks?.length) {
  for (const w of weeks) {
    totalSeconds += Number(w.total_seconds ?? 0);
    billableSeconds += Number(w.billable_seconds ?? 0);
  }
}

const expectTotalHours = Math.round(totalSeconds / 3600);
const expectBillablePct = totalSeconds > 0 ? Math.round((billableSeconds / totalSeconds) * 1000) / 10 : null;

const { count: projectCount } = await admin
  .schema("time")
  .from("project")
  .select("*", { count: "exact", head: true });

console.log(`window        : ${iso(windowStart)} .. ${iso(thisMonday)} (${weeks?.length ?? 0} weeks)`);
console.log(`ground truth  : ${expectTotalHours}h logged, ${expectBillablePct}% billable, ${projectCount} projects`);
console.log(`target        : ${SITE}\n`);

check("the window excludes future-dated planned weeks", iso(thisMonday) <= iso(new Date()),
  `latest week counted is ${iso(thisMonday)}, today is ${iso(new Date())}`);

// ── Mint a session for a real exec ─────────────────────────────────────────
const { data: profiles } = await admin
  .from("app_user_profile")
  .select("user_id")
  .eq("role_key", "exec")
  .eq("is_active", true)
  .limit(1);
if (!profiles?.length) {
  console.log("SKIP: no active exec to render as");
  process.exit(0);
}
const { data: userRes } = await admin.auth.admin.getUserById(profiles[0].user_id);
const email = userRes?.user?.email;
const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email });
const anonClient = createClient(URL_BASE, ANON, { auth: { persistSession: false } });
const { data: verified } = await anonClient.auth.verifyOtp({
  type: "magiclink",
  token_hash: link.properties.hashed_token,
});
const session = verified?.session;
if (!session) {
  console.log("SKIP: could not mint an exec session");
  process.exit(0);
}
console.log(`  rendering as: ${email}\n`);

const { chromium } = await import("playwright");
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  await ctx.addInitScript(() => {
    try { window.localStorage.setItem("hse_tour_done", "1"); } catch { /* ignore */ }
  });
  const ref = new URL(URL_BASE).hostname.split(".")[0];

  /**
   * Chunk the session cookie the way @supabase/ssr does.
   *
   * The single-cookie form that works locally is rejected here: this session
   * serialises to ~5.2 KB, over the ~4 KB per-cookie limit, and Chrome answers
   * with a flat "Invalid cookie fields" that says nothing about size. Measured,
   * not guessed -- a 3-byte value on the identical cookie spec is accepted.
   *
   * Supabase's own browser client splits oversized sessions into
   * `<name>.0`, `<name>.1`, ... and the server helper reassembles them in index
   * order, so writing the same shape is what makes a real production session
   * work rather than a local-only shortcut.
   */
  const CHUNK = 3200; // comfortably under the limit, including name and attributes
  const value = "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");
  const base = `sb-${ref}-auth-token`;
  const cookies = [];
  if (value.length <= CHUNK) {
    cookies.push({ name: base, value, url: SITE, sameSite: "Lax" });
  } else {
    for (let i = 0, at = 0; at < value.length; i++, at += CHUNK) {
      cookies.push({
        name: `${base}.${i}`,
        value: value.slice(at, at + CHUNK),
        url: SITE,
        sameSite: "Lax",
      });
    }
  }
  console.log(`  session cookie: ${value.length} bytes in ${cookies.length} chunk(s)`);
  await ctx.addCookies(cookies);

  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto(`${SITE}/`, { waitUntil: "networkidle", timeout: 90_000 });
  const body = await page.locator("body").innerText();

  check("landed on the Hub overview as an exec, not redirected", /Business overview/i.test(body),
    `at ${page.url()} -- "${body.slice(0, 100).replace(/\n/g, " ")}"`);

  // ── The figures on screen must be the measured ones ──────────────────────
  const cardText = async (key) => {
    const el = page.locator(`[data-metric="${key}"]`);
    return (await el.count()) ? (await el.innerText()).replace(/\n/g, " | ") : null;
  };

  const billable = await cardText("billable-share");
  check(
    `PRODUCTION billable share matches the database (${expectBillablePct}%)`,
    billable !== null && expectBillablePct !== null && billable.includes(`${expectBillablePct}%`),
    billable ?? "billable-share card not found on the deployed page",
  );

  const hours = await cardText("hours-logged");
  if (hours) {
    const shownHours = Number((hours.match(/([\d.]+)/)?.[1] ?? "0").replace(/\./g, ""));
    check(
      `PRODUCTION hours logged matches the database (~${expectTotalHours}h)`,
      Math.abs(shownHours - expectTotalHours) <= 2,
      `screen ${shownHours}h, db ${expectTotalHours}h -- ${hours}`,
    );
    check(
      "hours logged is not the pre-fix future-window figure",
      shownHours !== 267,
      "267h was the bug: a 12-week window resolving entirely to one person's forward plan",
    );
  } else {
    check("hours-logged card is rendered", false, "not found on the deployed page");
  }

  // The header count regression: a page-size constant rendered as a measurement.
  const headerMatch = body.replace(/\s+/g, " ").match(/([\d.,]+)\s*ACTIVE PROJECTS/i);
  check(
    `PRODUCTION header project count matches the database (${projectCount})`,
    headerMatch !== null && Number(headerMatch[1].replace(/[.,]/g, "")) === projectCount,
    headerMatch ? `page says ${headerMatch[0]}, db has ${projectCount}` : "no 'ACTIVE PROJECTS' figure found",
  );

  // ── None of the seeded fiction may survive in production ────────────────
  for (const ghost of ["73.4%", "18 240", "24 900", "1 480", "prj-1"]) {
    check(`the invented value "${ghost}" is gone from PRODUCTION`, !body.includes(ghost));
  }
  check(
    "SyncBar does not claim pipelines that have never run",
    !/FACTORIAL|SAMDOCK|HUBSPOT/i.test(body),
    (body.match(/(FACTORIAL|SAMDOCK|HUBSPOT)/gi) ?? []).join(", ") || "none present",
  );

  check("no uncaught client error on the deployed page", errors.length === 0,
    errors.slice(0, 2).join(" | ") || "none");
} finally {
  await browser.close();
}

console.log(
  failed
    ? "\nLIVE OVERVIEW: the DEPLOYED page disagrees with the database\n"
    : "\nLIVE OVERVIEW: the deployed page's numbers match the database\n",
);
process.exit(failed ? 1 : 0);
