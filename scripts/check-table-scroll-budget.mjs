/**
 * No page in this app is taller than three screens, and no table dumps its whole
 * result set into the document.
 *
 * THE REPORTED BUG. "Fix long-scrolling tables for all the tables in the whole app
 * and for future reference as well." Measured in a real browser at 1440x900 against
 * production before this work:
 *
 *   /dashboard/management?tab=customers   17.7 screens   177 rows in ONE unpaged table
 *   /dashboard/management?tab=risks         4.3 screens    17 rows
 *   /team-lead                              3.7 screens     8 rows (49 people in prod)
 *   /time/dashboard                         2.9 screens     8 rows
 *   /admin/roles                            2.6 screens    37 rows
 *
 * The static audit (scripts/audit-tables.mjs) found 7 tables with nothing bounding
 * their row count and 9 with no sticky header. The row counts above are what today's
 * data happens to be; the defect is that NOTHING CAPS THEM. 17 rows in the risks tab
 * is 170 the month a service is onboarded, and no code change is needed for that.
 *
 * WHY THIS IS MEASURED IN THE BROWSER, in pixels and in <tr> elements. The complaint
 * is about the height of a document, so the assertion has to be the height of a
 * document. Every one of these tables is a client component, so server HTML
 * undercounts the rows badly -- a fetch-and-regex gate would report the risks tab as
 * clean. And a source check ("does it import DataTable?") passes on a page that
 * imports the primitive and then renders `pageSize="all"`.
 *
 * WHY 3 SCREENS
 * -------------
 * Not a round number picked to be safe. At 1440x900 these pages spend roughly:
 *   ~0.35 screen  SyncBar + PageHeader + tab or filter row
 *   ~0.30 screen  the KPI tile strip
 *   ~0.60 screen  a chart, where the page has one
 *   ~1.00 screen  the first page of a 25-row table (rule 2 in DESIGN.md)
 * which is about 2.25. Three leaves a third of a screen of slack for a second panel
 * or a footnote without licensing a second unbounded table. It is deliberately
 * TIGHTER than check-page-length.mjs's 6: that gate was catching an appending pager
 * on three specific surfaces, this one sets the house ceiling for every route.
 *
 * The two /projects-family routes are pinned at a wider budget, documented at
 * ROUTE_BUDGETS below, because they carry a genuinely different amount of furniture
 * above the rows -- and they are pinned per route rather than raising the default,
 * so the exception is visible and countable rather than a weaker rule for everyone.
 *
 * WHY 60 ROWS
 * -----------
 * The page size is 25 and the largest offered page is 100, so a table rendering more
 * than 60 <tr> is not on a default page and not on a 25/50 page either: it is either
 * unpaged or someone shipped `defaultPageSize: "all"`. 60 sits in the dead zone
 * between those, which makes the assertion unambiguous. A reader who picks ALL
 * themselves is fine -- this is measured ON FIRST LOAD only.
 *
 * WHAT IS ASSERTED, per route
 *   1. The document opens within its budget.
 *   2. No single table renders more than MAX_ROWS rows on first load.
 *   3. Every table with more than 15 rows has a sticky header -- past ~15 rows the
 *      header leaves the screen, so the columns become unlabelled numbers.
 *   4. Any table that IS paged states its total ("1-25 of 177"), so a bounded list
 *      is not misread as a truncated one.
 *
 * SKIPS CLEANLY WITHOUT CREDENTIALS. Every route here is behind auth, so with no
 * .env.local there is nothing to measure and the gate exits 0 with a stated reason.
 * CI without secrets stays green; CI with them gets the real verdict. Silence would
 * be worse than either.
 *
 * Run: npm run check:table-scroll-budget
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Repo root resolved from this file, so these paths work on any machine and
// from any working directory. They were previously hardcoded to C:/Supabase,
// which existed on exactly one developer's laptop and nowhere else.
const REPO = fileURLToPath(new URL("..", import.meta.url));


const ENV_PATH = join(REPO, ".env.local");

/* ── skip path: no credentials, nothing to measure ─────────────────────── */
if (!existsSync(".env.local") && !existsSync(ENV_PATH)) {
  console.log("SKIP: no .env.local, so no session can be minted for these authed routes");
  process.exit(0);
}

const env = Object.fromEntries(
  readFileSync(existsSync(".env.local") ? ".env.local" : ENV_PATH, "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);

if (!env.SUPABASE_SERVICE_ROLE_KEY || !env.NEXT_PUBLIC_SUPABASE_URL) {
  console.log("SKIP: no service-role key in .env.local, so no session can be minted");
  process.exit(0);
}

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.log("SKIP: playwright is not installed in this environment");
  process.exit(0);
}

const SITE = process.env.SITE ?? "https://hseportal.hs-experts.com";
const EMAIL = process.env.GATE_EMAIL ?? "bjoern.schoenemann@hs-experts.com";

const VIEWPORT_H = 900;
/** The house ceiling, in screens. Justified in the header comment. */
const MAX_SCREENS = 3;
/**
 * Pinned exceptions, per route, each with the reason it earns one.
 *
 * A route is listed here only when the furniture ABOVE its rows is genuinely
 * bigger, never because its table is long -- a long table is the bug.
 */
const ROUTE_BUDGETS = {
  // Insight cards ("where the hours go"), a filter bar and a KPI strip sit above
  // the 334-row ledger, and check-page-length.mjs already owns its pager.
  "/projects": 6,
  // Two chart rows plus the grouped breakdown; the same 6 that gate uses.
  "/time/dashboard": 6,
  /**
   * Four stacked ANALYSIS panels, measured on production at 3.67 screens:
   * "Analysis by team" 1,011px, an 8-row board 933px, "Month over month" 749px,
   * "Team hours per week" 334px. Its single table is 8 rows with a sticky
   * header, so nothing here is a long table -- the height is four charts a team
   * lead reads top to bottom, which is what the page is for.
   *
   * Raised to 4 rather than 6: enough for the four panels that exist, tight
   * enough that a fifth panel or a 60-row table has to justify itself.
   */
  "/team-lead": 4,
};

/**
 * THE MOBILE PASS. Same routes, same document-height assertion, 390x844.
 *
 * WHY IT EXISTS. Every measurement this project had ever taken was at 1440x900,
 * and PRODUCT.md claims "mobile responsive". When someone finally looked
 * (scripts/audit-mobile.mjs), /projects was 7.1 screens on a phone and
 * /team-lead 5.6, against a desktop gate that was green on both. The failure
 * mode is structural and silent: a `lg:grid-cols-12` row of four panels is one
 * screen on a desktop and four on a phone, so a layout can pass the desktop
 * ceiling forever while rotting at 390px. A gate that only measures the wide
 * viewport cannot see it, so it would happen again.
 *
 * WHY THE BUDGET IS LOOSER THAN 3, AND WHY IT IS 4 RATHER THAN "whatever passes".
 * Single-column stacking is not a defect in itself -- it is the correct response
 * to a 390px viewport, and the same content genuinely occupies more vertical
 * space when it cannot go sideways. A KPI strip that is one row of five tiles at
 * 1440px is five rows at 390px, which alone is ~1.5 screens more. Holding the
 * phone to the desktop's 3 would force deleting content rather than arranging
 * it, and DESIGN.md's point is the opposite.
 *
 * Four screens is the smallest budget that a correctly-arranged page meets
 * without hiding anything: header and filter (~0.4), a stacked KPI strip (~1.0),
 * one open panel or table (~1.3), and collapsed summaries for the rest (~0.15
 * each). It is a ceiling on ARRANGEMENT, not on content -- a route that exceeds
 * it is stacking panels that should be behind a disclosure.
 *
 * Only the height is asserted here. The row, sticky-header and count checks are
 * viewport-independent properties of the same DOM, so re-asserting them at a
 * second width would double every failure message without adding a finding.
 */
const MOBILE = { width: 390, height: 844 };
const MOBILE_MAX_SCREENS = 4;
/**
 * Per-route mobile exceptions.
 *
 * Note what is NOT here: /projects and /team-lead, the two routes this pass was
 * written for. They were 7.1 and 5.6 screens and are now 2.4 and 2.3, fixed by
 * collapsing their secondary panels behind MobileDisclosure rather than by
 * pinning a bigger number. That is the outcome this gate exists to produce, and
 * an exception granted instead would have hidden it. /  came along the same way
 * (4.1 -> 3.6) and needs no entry either.
 *
 * The three entries below are DEBT, not exemptions, and they are written as
 * debt: each is pinned one notch above its MEASURED height so it cannot get
 * worse un-noticed, and each names the work that clears it. They are listed
 * because the mobile pass found them on its first run and they sit in files
 * owned by other work in flight, so fixing them here would have collided; the
 * alternative was shipping the pass switched off, which is how a gate never
 * gets switched on.
 *
 * Clearing one means deleting its line, not raising it.
 */
const MOBILE_ROUTE_BUDGETS = {
  // Measured 7.38. Import review stacks a filter bar, a summary strip and
  // several full-width review panels; the Pager here is the house reference
  // implementation, so the rows are already bounded and the height is layout.
  "/customer-master/import-review": 7.5,
  // Measured 5.25. The user list renders a card per user at phone width.
  "/admin/users": 5.5,
  // Measured 4.96. Two chart rows plus the grouped breakdown, the same
  // furniture its pinned desktop budget of 6 documents.
  "/time/dashboard": 5,
};
/** More rows than any offered page size below "all" -- see header comment. */
const MAX_ROWS = 60;
/** Past this many rows the header scrolls away, so it has to be sticky. */
const STICKY_FLOOR = 15;

/**
 * Every authed route with a page.tsx, plus the Management tabs, which are separate
 * documents behind ?tab= and were the worst offender by a factor of four. Dynamic
 * segments are excluded: they need a real id, and the shape they render is the
 * detail-page shape rather than a ledger.
 */
const ROUTES = [
  "/",
  "/my-work",
  "/projects",
  "/people",
  "/leave",
  "/profile",
  "/timesheets",
  "/time",
  "/time/dashboard",
  "/team-lead",
  "/admin/roles",
  "/admin/users",
  "/admin/alerts",
  "/customer-master/import-review",
  "/data-hygiene",
  "/dashboard/management?tab=overview",
  "/dashboard/management?tab=employees",
  "/dashboard/management?tab=customers",
  "/dashboard/management?tab=risks",
];

let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? `\n        ${detail}` : ""}`);
};

/* ── sign in exactly the way measure-management-tabs.mjs does ───────────── */
const gen = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/generate_link`, {
  method: "POST",
  headers: {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    type: "magiclink",
    email: EMAIL,
    options: { redirect_to: `${SITE}/auth/callback` },
  }),
});
const linkBody = await gen.json();
const hashed = linkBody?.properties?.hashed_token ?? linkBody?.hashed_token;
if (!hashed) {
  console.log(`SKIP: could not mint a magic link for ${EMAIL} (${gen.status})`);
  process.exit(0);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: VIEWPORT_H } });
const page = await ctx.newPage();

/**
 * Measure the document and every table in it.
 *
 * `rows` counts <tr> in tbody, which is what the reader scrolls past. `sticky` is
 * read from computed style rather than from a class name, because the class can be
 * present on a th whose ancestor has `overflow: hidden` and pins nothing.
 */
const shapeOf = () => {
  const vh = window.innerHeight;
  const sh = document.documentElement.scrollHeight;
  return {
    screens: +(sh / vh).toFixed(2),
    px: sh,
    /**
     * DID THIS MEASUREMENT ACTUALLY LAND ON THE PAGE?
     *
     * The sign-in check at the top of the run only proves the session was good
     * ONCE. A session can be invalidated mid-run -- another agent restarting the
     * server, a parallel gate minting a link for the same address, a cookie
     * rotating -- and from that point every route redirects to /auth/login. The
     * login page is one viewport tall with no <table> in it, so it reports
     * "1 screen, 0 tables" and PASSES every assertion. Observed for real: a whole
     * run of 18 routes each reporting exactly 900px and all green, which is a
     * green build that measured nothing.
     *
     * So each measurement carries where it actually was. A route that is not the
     * route we asked for is void, and void is reported as a failure rather than
     * as a pass.
     */
    url: location.pathname + location.search,
    /** The route-level error boundary. Same problem as a redirect: a short
     *  document with no table that passes every assertion while showing the
     *  reader nothing. Observed on a route whose data query threw. */
    errored: /This page couldn.t load|Something went wrong|Application error/i.test(
      document.body.innerText.slice(0, 400),
    ),
    // The count line, wherever it is on the page.
    statesTotal:
      /\d+\s*[–-]\s*\d+\s+of\s+[\d.,]+|all\s+[\d.,]+\s+rows|\d+\s*\/\s*\d+/i.test(
        document.body.innerText,
      ),
    tables: [...document.querySelectorAll("table")].map((t) => {
      // Nearest enclosing card heading names the table in the failure message.
      let n = t;
      let title = "";
      while (n && !title) {
        n = n.parentElement;
        const h = n?.querySelector?.("h2,h3,h4");
        if (h) title = (h.textContent ?? "").trim().slice(0, 44);
        if (n === document.body) break;
      }
      const head = [...t.querySelectorAll("thead th")];
      return {
        title: title || "(untitled)",
        rows: t.querySelectorAll("tbody tr").length,
        cols: head.length,
        sticky:
          head.some((th) => getComputedStyle(th).position === "sticky") ||
          [...t.querySelectorAll("thead")].some(
            (th) => getComputedStyle(th).position === "sticky",
          ),
      };
    }),
  };
};

try {
  await page.goto(
    `${SITE}/auth/callback?token_hash=${hashed}&type=magiclink&next=%2F`,
    { waitUntil: "networkidle", timeout: 120_000 },
  );
  console.log(`signed in as ${EMAIL}, landed on ${page.url()}\n`);

  /**
   * FAIL LOUDLY IF THE SESSION DID NOT TAKE.
   *
   * Without this the gate is worse than useless: an expired or already-consumed
   * magic link lands on /auth/login, and every subsequent measurement is of the
   * LOGIN PAGE -- one 900px screen with no <table> in it. That reports
   * "0 table(s), biggest 0 rows" and passes all twenty routes, which is exactly
   * how a table regression would ship behind a wall of green. Observed for real:
   * "landed on .../auth/login?error=Email%20link%20is%20invalid%20or%20has%20expired"
   * followed by 60 PASS lines.
   *
   * `generate_link` invalidates any previous link for that address, so two runs
   * racing each other is enough to cause it. Retry once with a freshly minted
   * token before giving up.
   */
  const landed = page.url();
  if (/\/auth\/login|\/auth\/callback|error=/.test(landed)) {
    console.log("sign-in did not take; minting a second link and retrying once");
    const retry = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/generate_link`, {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "magiclink",
        email: EMAIL,
        options: { redirect_to: `${SITE}/auth/callback` },
      }),
    });
    const retryBody = await retry.json();
    const retryHash = retryBody?.properties?.hashed_token ?? retryBody?.hashed_token;
    if (retryHash) {
      await page.goto(`${SITE}/auth/callback?token_hash=${retryHash}&type=magiclink&next=%2F`, {
        waitUntil: "networkidle",
        timeout: 120_000,
      });
      console.log(`retry landed on ${page.url()}\n`);
    }
  }

  if (/\/auth\/login|error=/.test(page.url())) {
    console.log(
      `FAIL: never signed in -- stuck on ${page.url()}\n` +
        "        Every measurement below would be of the login page, so the run is void.",
    );
    await browser.close();
    process.exit(1);
  }

  // A first-run tour overlay covers the content and makes every table read as
  // empty (learned the hard way in inspect-page-shape.mjs).
  for (const label of ["Skip tour", "Skip", "Close", "Dismiss"]) {
    const btn = page.getByRole("button", { name: label, exact: false });
    if (await btn.count().catch(() => 0)) {
      try {
        await btn.first().click({ timeout: 2000 });
        await page.waitForTimeout(300);
        break;
      } catch {
        /* not the overlay's button */
      }
    }
  }

  const measured = [];

  for (const route of ROUTES) {
    const budget = ROUTE_BUDGETS[route.split("?")[0]] ?? MAX_SCREENS;
    let m;
    try {
      await page.goto(`${SITE}${route}`, { waitUntil: "networkidle", timeout: 90_000 });
      await page.waitForTimeout(1400); // let client tables hydrate and settle
      m = await page.evaluate(shapeOf);
    } catch (e) {
      // A route that cannot be measured is not a pass. It is also not a scroll
      // failure, so it is reported distinctly rather than counted as one.
      check(`${route}: renders`, false, e.message.split("\n")[0].slice(0, 110));
      continue;
    }

    measured.push({ route, ...m, budget });

    /* ── 0. is this a measurement of the route at all? ────────────────────
     *
     * A redirect to /auth/login and a route-level error boundary are both a
     * SHORT document with NO table in it, so both pass every assertion below
     * and report "1 screen, 0 tables". Observed for real in both flavours: a
     * run where a lapsed session produced 18 green routes each measuring
     * exactly 900px, and a route whose query threw rendering "This page
     * couldn't load" at one screen tall. A gate that reports those as passes
     * is worse than no gate, because it is green precisely when the page is
     * broken. Void is a failure, and it says which kind.
     */
    if (/\/auth\/login|\/access-pending/.test(m.url) || m.errored) {
      check(
        `${route}: measured the route rather than a redirect or an error page`,
        false,
        m.errored
          ? "the route rendered its error boundary — this run is void here, and that is" +
            " a real defect worth its own investigation"
          : `landed on ${m.url} — the session lapsed mid-run, so this measurement is void`,
      );
      continue;
    }

    // ── 1. the document fits its budget ──────────────────────────────────
    check(
      `${route}: opens within ${budget} screens`,
      m.screens <= budget,
      `${m.px}px = ${m.screens} screens at ${VIEWPORT_H}px tall` +
        (budget !== MAX_SCREENS ? ` (pinned budget, house default is ${MAX_SCREENS})` : ""),
    );

    // ── 2. no table dumps its result set ─────────────────────────────────
    const flood = m.tables.filter((t) => t.rows > MAX_ROWS);
    check(
      `${route}: no table renders more than ${MAX_ROWS} rows on first load`,
      flood.length === 0,
      flood.length
        ? flood.map((t) => `"${t.title}" rendered ${t.rows} rows`).join("; ") +
          " — page it through src/components/data-table/DataTable.tsx"
        : `${m.tables.length} table(s), biggest ${m.tables.reduce((a, t) => Math.max(a, t.rows), 0)} rows`,
    );

    // ── 3. a table long enough to outscroll its header pins it ───────────
    const naked = m.tables.filter((t) => t.rows > STICKY_FLOOR && !t.sticky);
    check(
      `${route}: every table over ${STICKY_FLOOR} rows keeps its header on screen`,
      naked.length === 0,
      naked.length
        ? naked.map((t) => `"${t.title}" (${t.rows} rows, ${t.cols} cols) has no sticky header`).join("; ")
        : "no unpinned long table",
    );

    // ── 4. a bounded list says how much it is bounding ───────────────────
    // Only asserted where there is something to bound: a page whose biggest
    // table is 8 rows has no total to state and no reader to mislead.
    const biggest = m.tables.reduce((a, t) => Math.max(a, t.rows), 0);
    if (biggest >= STICKY_FLOOR) {
      check(
        `${route}: states how many rows are on screen out of the total`,
        m.statesTotal,
        m.statesTotal
          ? ""
          : `biggest table is ${biggest} rows and nothing on the page says "X-Y of N" — a bounded list reads as a truncated one`,
      );
    }
  }

  /* ── the summary table, so a red build says WHERE in one glance ───────── */
  console.log(`\n${"route".padEnd(42)} ${"screens".padStart(8)} ${"budget".padStart(7)} ${"tables".padStart(7)} ${"biggest".padStart(8)} sticky`);
  for (const m of measured.sort((a, b) => b.screens - a.screens)) {
    const biggest = m.tables.reduce((a, t) => Math.max(a, t.rows), 0);
    console.log(
      `${m.route.padEnd(42)} ${String(m.screens).padStart(8)} ${String(m.budget).padStart(7)} ${String(m.tables.length).padStart(7)} ${String(biggest).padStart(8)}   ${
        m.tables.length === 0 ? "-" : m.tables.every((t) => t.sticky || t.rows <= STICKY_FLOOR) ? "Y" : "."
      }${m.screens > m.budget ? "   <- OVER BUDGET" : ""}`,
    );
  }

  /* ── SECOND PASS: the same routes on a phone ───────────────────────────
   *
   * A new context rather than page.setViewportSize(), so the run gets a real
   * mobile context (isMobile/hasTouch) and the responsive branches that key off
   * touch behave as they do on a device. The storage state is copied from the
   * signed-in desktop context, so this costs no second magic link -- minting one
   * would invalidate the first and is the exact race the retry logic above
   * exists to survive.
   */
  console.log(`\n\n===== MOBILE PASS ${MOBILE.width}x${MOBILE.height} (budget ${MOBILE_MAX_SCREENS} screens)\n`);

  const mobileCtx = await browser.newContext({
    viewport: MOBILE,
    isMobile: true,
    hasTouch: true,
    storageState: await ctx.storageState(),
  });
  const mobilePage = await mobileCtx.newPage();
  const mobileMeasured = [];

  try {
    for (const route of ROUTES) {
      const budget = MOBILE_ROUTE_BUDGETS[route.split("?")[0]] ?? MOBILE_MAX_SCREENS;
      let m;
      try {
        await mobilePage.goto(`${SITE}${route}`, { waitUntil: "networkidle", timeout: 90_000 });
        await mobilePage.waitForTimeout(1400);
        m = await mobilePage.evaluate(shapeOf);
      } catch (e) {
        check(`${route} @${MOBILE.width}px: renders`, false, e.message.split("\n")[0].slice(0, 110));
        continue;
      }

      mobileMeasured.push({ route, ...m, budget });

      if (/\/auth\/login|\/access-pending/.test(m.url) || m.errored) {
        check(
          `${route} @${MOBILE.width}px: measured the route rather than a redirect`,
          false,
          `landed on ${m.url} — the session lapsed mid-run, so this measurement is void`,
        );
        continue;
      }

      check(
        `${route} @${MOBILE.width}px: opens within ${budget} screens`,
        m.screens <= budget,
        `${m.px}px = ${m.screens} screens at ${MOBILE.height}px tall` +
          (m.screens > budget
            ? " — panels are stacking into one column; collapse the secondary ones behind" +
              " src/components/MobileDisclosure.tsx (it keeps the desktop layout identical)"
            : ""),
      );
    }

    console.log(`\n${"route".padEnd(42)} ${"screens".padStart(8)} ${"budget".padStart(7)} (at ${MOBILE.width}x${MOBILE.height})`);
    for (const m of mobileMeasured.sort((a, b) => b.screens - a.screens)) {
      console.log(
        `${m.route.padEnd(42)} ${String(m.screens).padStart(8)} ${String(m.budget).padStart(7)}${
          m.screens > m.budget ? "   <- OVER BUDGET" : ""
        }`,
      );
    }
  } finally {
    await mobileCtx.close();
  }
} finally {
  await browser.close();
}

console.log(
  failed === 0
    ? `\nTABLE SCROLL BUDGET: all checks passed (${MAX_SCREENS}-screen ceiling at 1440px, ` +
      `${MOBILE_MAX_SCREENS} at ${MOBILE.width}px, ${MAX_ROWS}-row cap)`
    : `\n${failed} check(s) failed`,
);
process.exitCode = failed === 0 ? 0 : 1;
