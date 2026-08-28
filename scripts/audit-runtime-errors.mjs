/**
 * scripts/audit-runtime-errors.mjs — DRIVE the app, per role, and record what breaks.
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT A GATE
 * -----------------------------------------
 * Every other check-*.mjs in this repo asserts one named property. This one asserts
 * nothing. It is a DIAGNOSTIC: it opens every route as several different roles,
 * clicks the controls a reader actually clicks, and writes down every console error,
 * uncaught exception and failed request it sees, with the route and the role attached.
 * The output is a list to triage, not a red/green verdict, so it exits 0 unless the
 * run itself could not happen. A fix chosen from a partial list is usually the wrong
 * fix, so the list comes first.
 *
 * WHY MORE THAN ONE ROLE. RLS makes the roles genuinely different code paths, not
 * different data in the same path. can_view_project() is:
 *   role='exec'  OR  (dept_head AND same department)  OR  owner  OR  assigned.
 * An exec's arrays are full, an employee's are a subset, and an account whose
 * app_user_profile.person_id is NULL can never satisfy the last two arms, so every
 * list it loads is EMPTY. Empty arrays are where reduce-without-seed, [0], max of
 * nothing and divide-by-total live. Those crash for exactly one class of user and
 * for nobody who tests the app, which is why they survive.
 *
 * WHY IT CLICKS. Server-rendered HTML is the tested part; the untested code is behind
 * an onClick. Sorting comparators, page-size handlers, the CSV serialiser and the
 * donut's onSelect only ever run in a browser after a click, so a fetch-and-parse
 * audit reads every one of them as fine. Every table gets: each sort header, each of
 * 25/50/100/ALL, a search that matches nothing, and CSV. ALL is included on purpose —
 * it is the branch that renders the whole result set and the one nobody clicks twice.
 *
 * THE ?_rsc= ABORTS ARE PROVEN HARMLESS, NOT ASSUMED
 * ---------------------------------------------------
 * Next's <Link> prefetches an RSC payload and cancels it the moment the real
 * navigation starts, which surfaces as net::ERR_ABORTED on a ...?_rsc=... URL. That is
 * the framework working. But "known-harmless" is a claim, so this script tests it
 * instead of filtering on the string: for every aborted _rsc request it records
 * whether the navigation that raced it still COMPLETED (the destination document
 * rendered, and the route's own content is on screen). Only aborts with a completed
 * navigation are set aside, and they are still COUNTED and reported as a separate
 * "benign" line. An abort with a broken navigation is promoted to a real finding.
 *
 * THE EM-DASH RULE (docs: honest nulls, never a plausible 0)
 * ----------------------------------------------------------
 * A missing number renders as an em dash. So on the no-person account — which sees
 * nothing at all — a KPI tile reading "0" is a defect even though nothing threw: it
 * asserts a measured zero where the truth is "we have no data for you". This script
 * flags a page that shows a bare 0 in a KPI position while its lists are empty, and
 * separately flags a page with no rows and no empty-state sentence at all.
 *
 * SILENT VS VISIBLE. Every finding is classified. A console error with the page still
 * rendering is SILENT — nobody reports it and it stays forever. An error boundary, a
 * blank main, or a redirect is VISIBLE. Both matter; they are triaged differently.
 *
 * Read-only. It never submits a form, never saves, never deletes: the only writes it
 * could reach are behind buttons this script does not press (Save, Delete, Approve,
 * Invite). CSV export downloads to a temp dir and is discarded.
 *
 * Run:  node scripts/audit-runtime-errors.mjs
 *       SITE=http://localhost:3000 node scripts/audit-runtime-errors.mjs
 *       AUDIT_ROLES=exec,employee node scripts/audit-runtime-errors.mjs
 */
import { existsSync, readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/* ── credentials, or a clean skip ──────────────────────────────────────── */
const ENV_PATH = "C:/Supabase/.env.local";
const envFile = existsSync(".env.local") ? ".env.local" : existsSync(ENV_PATH) ? ENV_PATH : null;
if (!envFile) {
  console.log("SKIP: no .env.local, so no session can be minted for these authed routes");
  process.exit(0);
}
const env = Object.fromEntries(
  readFileSync(envFile, "utf8")
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

/**
 * THE ROLES.
 *
 * Three shapes of caller, each hitting a different arm of the RLS predicate. The
 * emails are read from the live app_user_profile where possible so the list cannot
 * silently drift; the fallbacks are the accounts observed on 2026-08-25.
 *
 *   exec        — sees all 231 projects. Every array is full. This is the only role
 *                 anybody develops against, so it is the CONTROL, not the target.
 *   employee    — 54 projects via owner/assignment. Partial arrays: the case where a
 *                 chart has some slices but not the ones the code assumed.
 *   no-person   — app_user_profile.person_id IS NULL. Sees literally nothing. This is
 *                 the row this audit was written for; every empty-array bug lands here
 *                 and only here.
 */
const ROLE_DEFS = [
  { key: "exec", email: "bjoern.schoenemann@hs-experts.com", expect: "all projects" },
  { key: "employee", email: "mathias@hs-experts.com", expect: "own subset (~54 projects)" },
  { key: "no-person", email: "hituls18@gmail.com", expect: "NOTHING — person_id is NULL" },
  // Second person-less account. Its profile role is `employee` rather than
  // `dept_head`, so it exercises a different branch of the same absence: the
  // dept_head arm of can_view_project can still fire on a department match even
  // with a NULL person_id, this one has no arm that can ever be true.
  { key: "no-person-2", email: "invite.flow.test.20260814@gmail.com", expect: "NOTHING — person_id is NULL, employee role" },
];
const ONLY = (process.env.AUDIT_ROLES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const ROLES = ONLY.length ? ROLE_DEFS.filter((r) => ONLY.includes(r.key)) : ROLE_DEFS;

/**
 * EVERY route with a page.tsx behind auth, plus the Management tabs, which are
 * separate documents behind ?tab= and share no client state.
 *
 * Dynamic segments (/projects/[id], /admin/users/[userId]) cannot be listed
 * statically because the id has to exist AND be visible to the role — and for the
 * no-person role no id is visible at all, which is itself a case worth driving. They
 * are reached instead by clicking the first row link on the parent list, so each role
 * visits an id that role can actually see, and a role with none is recorded as such.
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
  "/dashboard/management?tab=overview",
  "/dashboard/management?tab=employees",
  "/dashboard/management?tab=customers",
  "/dashboard/management?tab=risks",
];

/* ── the findings ledger ───────────────────────────────────────────────── */
/** @type {{role:string,route:string,kind:string,visibility:string,detail:string,phase:string}[]} */
const findings = [];
const add = (role, route, kind, visibility, detail, phase = "load") =>
  findings.push({ role, route, kind, visibility, detail: String(detail).replace(/\s+/g, " ").slice(0, 400), phase });

/** Noise that is not this app's code and cannot be acted on here. */
const IGNORABLE = [
  /Download the React DevTools/i,
  /\[Fast Refresh\]/i,
  /Lighthouse/i,
];

/**
 * Is this an RSC prefetch abort? Recorded, never silently dropped — see header.
 * The proof that it is harmless is the navigation check at the call site.
 */
const isRscAbort = (url, failure) =>
  /[?&]_rsc=/.test(url) && /ERR_ABORTED|aborted/i.test(failure ?? "");

/* ── mint a session for one email, exactly as check-table-scroll-budget does ── */
async function mint(email) {
  const gen = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ type: "magiclink", email, options: { redirect_to: `${SITE}/auth/callback` } }),
  });
  const body = await gen.json().catch(() => ({}));
  return { hashed: body?.properties?.hashed_token ?? body?.hashed_token ?? null, status: gen.status, body };
}

/**
 * What the page looks like right now, from the reader's side.
 *
 * Everything here is read from the rendered DOM rather than inferred, because the
 * whole point of the audit is what a user would hit. `errored` and `blank` are the
 * two VISIBLE failures; `kpiZeros` and `emptyWithoutMessage` are the honest-nulls
 * rule; `tables` drives the interaction pass.
 */
const snapshot = () => {
  const text = document.body.innerText ?? "";
  const main = document.querySelector("main") ?? document.body;
  const mainText = (main.innerText ?? "").trim();

  /**
   * A KPI tile showing a bare "0".
   *
   * House rule: a missing number renders as an em dash, never zero. "0" is a claim
   * that we measured zero. So this looks for a tile whose whole value is 0 (or 0.0,
   * 0%, 0h) — not for a 0 anywhere in the text, which would match "10" or a date.
   * Reported with its label so triage can tell a true zero ("0 overdue", correct)
   * from a fabricated one ("0 hours" for a user with no data, wrong).
   */
  const kpiZeros = [];
  for (const el of document.querySelectorAll("div,section,article,li")) {
    if (el.children.length > 4) continue;
    const t = (el.innerText ?? "").trim();
    if (!t || t.length > 80) continue;
    const lines = t.split("\n").map((s) => s.trim()).filter(Boolean);
    if (lines.length < 2 || lines.length > 3) continue;
    const value = lines.find((l) => /^0([.,]0+)?\s*(%|h|hrs|hours|d|days)?$/i.test(l));
    if (value) {
      const label = lines.filter((l) => l !== value).join(" / ").slice(0, 48);
      if (label) kpiZeros.push(`${label} = "${value}"`);
    }
  }

  const tables = [...document.querySelectorAll("table")].map((t, i) => ({
    index: i,
    rows: t.querySelectorAll("tbody tr").length,
    headers: [...t.querySelectorAll("thead th")].map((th) => (th.textContent ?? "").trim()).filter(Boolean),
  }));

  /**
   * ROWS THAT ARE NOT <tr>.
   *
   * The first full run reported "/projects: no rows anywhere and no empty-state
   * sentence" for the EXEC, the one role that provably sees all 231 projects. The
   * page was fine; the detector was wrong. ProjectsLedger.tsx renders its rows as
   * `div.grid.grid-cols-12`, not as a table, so a <tr> count sees zero and the
   * honest-nulls check then fabricates an empty-state defect on a full page.
   *
   * That is the worst kind of false positive for this audit specifically: it is
   * indistinguishable in the report from the real empty-state finding it was
   * written to catch, so it would send a fix at a page that has nothing wrong with
   * it. Rows are therefore counted structurally — repeated siblings sharing a grid
   * class under one parent — with a floor of 3 so a 12-column KPI strip or a
   * two-cell layout row is not mistaken for a ledger.
   */
  let gridRows = 0;
  const seen = new Set();
  for (const el of document.querySelectorAll('[class*="grid-cols-"]')) {
    const parent = el.parentElement;
    if (!parent || seen.has(parent)) continue;
    const cls = el.className;
    if (typeof cls !== "string" || !/grid/.test(cls)) continue;
    const siblings = [...parent.children].filter(
      (s) => typeof s.className === "string" && s.className === cls,
    );
    if (siblings.length >= 3) {
      seen.add(parent);
      gridRows += siblings.length;
    }
  }

  /** Rows inside a collapsed <details>: present in the DOM, invisible to the reader. */
  const collapsedRows = [...document.querySelectorAll("details:not([open])")].reduce(
    (a, d) => a + d.querySelectorAll("tbody tr").length,
    0,
  );

  return {
    url: location.pathname + location.search,
    title: document.title,
    /**
     * IS THIS PAGE A LIST SURFACE AT ALL?
     *
     * The empty-state rule is about lists. /profile is a form — name, email, a
     * couple of fields — and it has no rows because it never had any, which the
     * audit reported for all four roles as "no rows and no empty-state sentence".
     * A form with no table is not an unhandled empty state, and telling someone to
     * add "no data" text to the profile form would be acting on a miscount.
     *
     * A list surface is one that has a table, a rendered row grid, or the controls
     * that only ever accompany a list (a pager, a row-count line). If none of those
     * is present the page is not making a claim about a collection and the rule
     * does not apply.
     */
    isListSurface:
      document.querySelector("table") !== null ||
      document.querySelector('[class*="grid-cols-12"]') !== null ||
      /\d+\s*[–-]\s*\d+\s+of\s+[\d.,]+|all\s+[\d.,]+\s+rows/i.test(text) ||
      [...document.querySelectorAll("button")].some((b) => /^(25|50|100|ALL)$/.test((b.textContent ?? "").trim())),
    /** The route-level error boundary. Visible, and the loudest thing here. */
    errored: /This page couldn.t load|Something went wrong|Application error|Unhandled Runtime Error|digest/i.test(
      text.slice(0, 600),
    ),
    /** A main region with essentially nothing in it. Visible: a white page. */
    blank: mainText.length < 40,
    mainChars: mainText.length,
    tables,
    /** Everything the reader would call a row, however it is marked up. */
    totalRows: tables.reduce((a, t) => a + t.rows, 0) + gridRows,
    tableRows: tables.reduce((a, t) => a + t.rows, 0),
    gridRows,
    collapsedRows,
    /**
     * Does the page SAY it is empty? An empty list with a sentence explaining it is
     * correct behaviour; an empty list with nothing at all is the unhandled empty
     * state this audit is looking for.
     */
    saysEmpty:
      /**
       * STRUCTURE FIRST, VOCABULARY SECOND.
       *
       * The word list alone was wrong. It reported "/leave: no empty-state
       * sentence" for three roles, on a page that renders
       * `<EmptyState title="No leave requests yet" …>` and, for an unlinked
       * account, a whole explanatory card ending "NOTHING IS WRONG WITH YOUR
       * ACCOUNT". The page is a model of the behaviour this check wants; the
       * check just did not know the word "leave". A vocabulary test can only ever
       * find the phrasings whoever wrote the regex happened to think of.
       *
       * src/components/EmptyState.tsx is the house component for exactly this, and
       * it is recognisable without reading a word: a dashed border, which nothing
       * else in the UI uses. So the presence of that component IS the answer, and
       * the wording test stays only as a fallback for the panels that predate it.
       *
       * Deliberately NOT matching a bare em dash: it appears throughout the app's
       * chrome, so accepting one would make this pass everywhere and find nothing.
       */
      document.querySelector('[class*="border-dashed"]') !== null ||
      /**
       * The house EmptyState is not the only correct answer. /admin/alerts renders
       * a plain centred Card reading "No open budget alerts. Bookings that
       * approach or exceed an agreed budget appear here…", and ContractWatchlist
       * does the same with a paragraph explaining that an empty watchlist is
       * ambiguous until the migration lands. Both do exactly what this rule wants
       * and neither uses the dashed component, so both were reported as defects.
       *
       * So a short, centred block of prose where the rows would be also counts:
       * that IS an empty state, whatever component drew it.
       */
      [...document.querySelectorAll('[class*="text-center"]')].some((el) => {
        const t = (el.textContent ?? "").trim();
        return t.length > 25 && t.length < 400;
      }) ||
      /no (data|rows|results|projects|entries|records|items|matches|timesheets|tasks|leave|requests|alerts|people|customers)\b|nothing (to show|here|yet|is wrong)|you have no\b|not assigned|no access|isn.t connected|none yet|keine\b/i.test(
        text,
      ),
    kpiZeros: kpiZeros.slice(0, 8),
    /** Sentinel for "the em dash convention is actually in use on this page". */
    hasEmDash: /—/.test(text),
  };
};

/* ── run ───────────────────────────────────────────────────────────────── */
const downloadDir = mkdtempSync(join(tmpdir(), "audit-csv-"));
const browser = await chromium.launch();
let ran = 0;

/** Per-role summary lines for the table at the end. */
const roleSummary = [];

try {
  for (const role of ROLES) {
    console.log(`\n${"=".repeat(78)}\n ROLE ${role.key}  <${role.email}>  expects: ${role.expect}\n${"=".repeat(78)}`);

    const minted = await mint(role.email);
    if (!minted.hashed) {
      console.log(`  !! could not mint a link (${minted.status}) — skipping this role`);
      add(role.key, "(sign-in)", "cannot-audit", "n/a", `generate_link returned ${minted.status}: ${JSON.stringify(minted.body).slice(0, 160)}`, "signin");
      continue;
    }

    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      acceptDownloads: true,
    });
    const page = await ctx.newPage();

    /* ── the recorders. Attached once per role, tagged with the current route ── */
    let current = "(sign-in)";
    let phase = "load";
    /** Aborted _rsc prefetches seen since the last navigation check. */
    let rscAborts = [];

    page.on("console", (msg) => {
      if (msg.type() !== "error") return;
      const t = msg.text();
      if (IGNORABLE.some((r) => r.test(t))) return;
      /**
       * A console error while the page still renders is SILENT: the reader sees a
       * working page and never reports it, so it lives forever. Promoted to visible
       * later if the same route also failed its snapshot.
       */
      add(role.key, current, "console.error", "silent", t, phase);
    });

    page.on("pageerror", (err) => {
      // An uncaught exception. React unmounts the subtree, so this is very often
      // visible even when the URL looks fine.
      add(role.key, current, "uncaught-exception", "likely-visible", `${err.name}: ${err.message}`, phase);
    });

    page.on("requestfailed", (req) => {
      const failure = req.failure()?.errorText ?? "";
      if (isRscAbort(req.url(), failure)) {
        // Held, not dropped. Proven against the navigation below.
        rscAborts.push({ url: req.url().replace(SITE, ""), failure, route: current });
        return;
      }
      add(role.key, current, "request-failed", "silent", `${req.method()} ${req.url().replace(SITE, "")} — ${failure}`, phase);
    });

    page.on("response", (res) => {
      if (res.status() < 400) return;
      // 401/403 on an authed asset after sign-in is a finding; so is any 5xx.
      add(
        role.key,
        current,
        res.status() >= 500 ? "server-500" : "http-error",
        res.status() >= 500 ? "likely-visible" : "silent",
        `${res.status()} ${res.request().method()} ${res.url().replace(SITE, "")}`,
        phase,
      );
    });

    /* ── sign in ─────────────────────────────────────────────────────── */
    /**
     * SIGN IN, WITH REAL RETRIES.
     *
     * Two independent things break this step, and both were observed:
     *
     *  1. `generate_link` INVALIDATES any previous link for that address. Other
     *     agents run gates against the same production accounts, so a link can be
     *     dead before it is used and the callback lands on /auth/login.
     *  2. Supabase rate-limits link generation. Retrying immediately just burns
     *     the next link, which is what a probe run demonstrated: five back-to-back
     *     attempts, all "Email link is invalid or has expired".
     *
     * So retries BACK OFF, and a goto timeout is retried rather than recorded as a
     * finding — one run lost the exec's whole route list to a single 120s timeout
     * that a second attempt would have survived, and a role that never signed in
     * produces no observations at all, which is the most expensive failure here.
     */
    let landed = "";
    for (let attempt = 0; attempt < 4; attempt++) {
      const token = attempt === 0 ? minted.hashed : (await mint(role.email)).hashed;
      if (token) {
        try {
          await page.goto(`${SITE}/auth/callback?token_hash=${token}&type=magiclink&next=%2F`, {
            waitUntil: "networkidle",
            timeout: 120_000,
          });
        } catch (e) {
          // Recorded only if every attempt fails; see after the loop.
          landed = `timeout: ${e.message.split("\n")[0]}`;
        }
      }
      landed = page.url();
      if (!/\/auth\/login|error=/.test(landed)) break;
      // Give the rate limiter room before asking for another link.
      await page.waitForTimeout(6000 * (attempt + 1));
    }
    console.log(`  signed in, landed on ${landed.replace(SITE, "") || "/"}`);

    if (/\/auth\/login|error=/.test(landed)) {
      console.log("  !! never signed in — every observation for this role would be of the login page, so it is skipped");
      add(role.key, "(sign-in)", "cannot-audit", "visible", `stuck on ${landed}`, "signin");
      await ctx.close();
      continue;
    }

    /**
     * /access-pending is not a failure — it is the product's answer for an account
     * that is not provisioned. Recorded as an OBSERVATION so the report says which
     * roles never reach the app at all, which changes how the rest reads.
     */
    if (/\/access-pending/.test(landed)) {
      console.log("  note: this account lands on /access-pending");
      add(role.key, "(sign-in)", "gated-at-access-pending", "visible", `landed on ${landed.replace(SITE, "")}`, "signin");
    }

    // The first-run tour overlay covers the content and makes every table read as
    // empty. Dismiss it before measuring anything.
    for (const label of ["Skip tour", "Skip", "Close", "Dismiss"]) {
      const btn = page.getByRole("button", { name: label, exact: false });
      if (await btn.count().catch(() => 0)) {
        try {
          await btn.first().click({ timeout: 2000 });
          await page.waitForTimeout(300);
          break;
        } catch { /* not the overlay's button */ }
      }
    }

    let routesSeen = 0;
    let deepestRowLink = null;

    for (const route of ROUTES) {
      current = route;
      phase = "load";
      rscAborts = [];
      ran += 1;
      routesSeen += 1;

      let snap;
      try {
        await page.goto(`${SITE}${route}`, { waitUntil: "networkidle", timeout: 90_000 });
        await page.waitForTimeout(1200); // client tables hydrate and settle
        snap = await page.evaluate(snapshot);
        /**
         * A blank read is re-taken once before it is believed. The same navigation
         * race that produced four false "blanked-on-interaction" findings can catch
         * the load snapshot mid-swap, and "this route renders an empty page" is far
         * too serious a claim to make from a single sample that a 1.2s timer chose.
         */
        if (snap.blank && !snap.errored) {
          await page.waitForTimeout(2500);
          snap = await page.evaluate(snapshot);
        }
      } catch (e) {
        add(role.key, route, "navigation-failed", "visible", e.message.split("\n")[0], "load");
        continue;
      }

      /* ── PROVE the _rsc aborts were harmless, rather than assuming it ──
       *
       * The claim is "the prefetch was cancelled because the real navigation
       * started". So: did the navigation complete? We are standing on the
       * destination, the document rendered, and it is not the error boundary. If
       * all three hold the abort cost the reader nothing and is set aside (still
       * counted). If any fails, the abort is promoted to a real finding, because
       * then something DID break and the abort is evidence of it.
       *
       * "Standing on the destination" deliberately tolerates a REDIRECT, and the
       * first run is why. As the no-person role, /dashboard/management bounced to
       * `/` and the aborts on that visit were reported as "abort WITH broken
       * navigation" — blaming the prefetch for a redirect that the server chose and
       * that would have happened with prefetching switched off entirely. The abort
       * is harmless there too: a document rendered and the reader saw a page. The
       * redirect is the finding, and it is raised on its own terms just below, so
       * conflating the two would double-count one defect and mis-name it.
       */
      const rendered = !snap.errored && !snap.blank;
      const navCompleted =
        rendered && !/\/auth\/login/.test(snap.url);
      if (rscAborts.length) {
        if (navCompleted) {
          add(role.key, route, "rsc-abort-benign", "none",
            `${rscAborts.length} ?_rsc= prefetch abort(s); navigation still completed (landed on ${snap.url}${
              snap.url.split("?")[0] === route.split("?")[0] ? "" : ", after a server redirect reported separately"
            }, ${snap.mainChars} chars rendered, no error boundary) — harmless, proven not assumed`,
            "load");
        } else {
          add(role.key, route, "rsc-abort-WITH-broken-nav", "visible",
            `${rscAborts.length} ?_rsc= abort(s) AND the navigation did NOT complete: landed on ${snap.url}, errored=${snap.errored}, blank=${snap.blank}. First: ${rscAborts[0].url} ${rscAborts[0].failure}`,
            "load");
        }
      }

      /* ── WHERE DID WE ACTUALLY END UP? ────────────────────────────
       *
       * This has to come before every content assertion, because a route that
       * silently bounced elsewhere renders the DESTINATION's DOM. Observed for
       * real on the first run: as the no-person role, /dashboard/management and
       * /customer-master/import-review both landed on `/`, and the audit then
       * reported the HOME page's four KPI tiles four separate times, once per
       * management tab, as if each tab had its own defect. Four duplicates of one
       * finding, attributed to routes that never rendered — exactly the partial,
       * misleading list this audit exists to avoid producing.
       *
       * So a mismatch is recorded as its own finding and the route's content
       * assertions are SKIPPED, because there is no content of this route to
       * assert anything about.
       */
      const asked = route.split("?")[0];
      const arrived = snap.url.split("?")[0];
      const bounced = arrived !== asked;

      if (bounced) {
        const kind = /\/auth\/login/.test(arrived)
          ? "redirected-to-login"
          : /\/access-pending/.test(arrived)
            ? "redirected-to-access-pending"
            : "silently-redirected";
        add(role.key, route, kind, "visible",
          `asked for ${route}, rendered ${snap.url} instead — no message explains the bounce, so the reader clicks a nav item and lands somewhere else`,
          "load");
        console.log(`  ${route.padEnd(42)} -> ${snap.url} (bounced)`);
        continue;
      }

      /* ── visible failures ─────────────────────────────────────────── */
      if (snap.errored) add(role.key, route, "error-boundary", "visible", `route rendered its error boundary; title="${snap.title}"`, "load");
      if (snap.blank && !snap.errored)
        add(role.key, route, "blank-main", "visible", `<main> rendered ${snap.mainChars} chars — effectively an empty page`, "load");

      /* ── INTERACTIVE PASS: this is where the untested code is ─────── */
      // Only worth doing where there is something to interact with.
      await exercise(page, role.key, route, snap, (p) => { phase = p; });
      phase = "load";

      /* ── the honest-nulls rule, judged AFTER the interaction pass ───
       *
       * The interaction pass opens every collapsed <details> and panel first, and
       * the emptiness verdict has to be taken on the page in THAT state. Taken
       * before, /my-work looks rowless to the audit because its projects live one
       * collapsed group per customer — the rows are there and the reader can reach
       * them in one click. Judging a page empty while its rows are merely shut is
       * how this check would report the two roles that DO have data as having none.
       *
       * Re-reading also costs nothing: it is the same evaluate() on a page that is
       * already open.
       */
      const settled = await page.evaluate(snapshot).catch(() => snap);
      const reallyEmpty = settled.totalRows === 0 && snap.totalRows === 0;

      if (reallyEmpty && settled.isListSurface && !settled.saysEmpty && !settled.blank && !settled.errored)
        add(role.key, route, "empty-without-message", "visible",
          `no rows anywhere (after opening every collapsed panel) and no empty-state sentence — the reader sees furniture around nothing`,
          "load");
      if (settled.kpiZeros.length && reallyEmpty)
        add(role.key, route, "zero-where-em-dash-expected", "visible",
          `lists are empty for this role, yet KPI tiles assert measured zeros: ${settled.kpiZeros.join("; ")} — house rule is an em dash for a missing number`,
          "load");

      // Remember a row link so the dynamic routes get visited as this role.
      if (route === "/projects" && !deepestRowLink) {
        deepestRowLink = await page
          .locator('a[href^="/projects/"]')
          .first()
          .getAttribute("href")
          .catch(() => null);
      }

      const flag =
        settled.errored ? "ERROR-BOUNDARY" : settled.blank ? "BLANK" : reallyEmpty ? "no rows" : `${settled.totalRows} rows (${settled.tableRows} tr + ${settled.gridRows} grid)`;
      console.log(`  ${route.padEnd(42)} ${flag}`);
    }

    /* ── the dynamic routes, as a row this role can actually see ────── */
    current = deepestRowLink ?? "/projects/[id]";
    phase = "detail";
    if (deepestRowLink) {
      try {
        await page.goto(`${SITE}${deepestRowLink}`, { waitUntil: "networkidle", timeout: 90_000 });
        await page.waitForTimeout(1200);
        const snap = await page.evaluate(snapshot);
        if (snap.errored) add(role.key, deepestRowLink, "error-boundary", "visible", "project detail rendered its error boundary", "detail");
        if (snap.blank) add(role.key, deepestRowLink, "blank-main", "visible", `<main> rendered ${snap.mainChars} chars`, "detail");
        await exercise(page, role.key, deepestRowLink, snap, (p) => { phase = p; });
        console.log(`  ${deepestRowLink.padEnd(42)} (detail) ${snap.errored ? "ERROR-BOUNDARY" : `${snap.totalRows} rows`}`);
      } catch (e) {
        add(role.key, deepestRowLink, "navigation-failed", "visible", e.message.split("\n")[0], "detail");
      }
    } else {
      // Not a defect by itself — a role with no visible projects has no detail page
      // to open. Recorded because it explains a gap in this role's coverage.
      add(role.key, "/projects/[id]", "no-row-to-open", "none",
        "this role sees no project rows, so the detail route could not be exercised as this role", "detail");
    }

    /* ── the MOBILE More sheet ───────────────────────────────────────
     *
     * A separate context: setViewportSize() does not give isMobile/hasTouch, and the
     * tab bar only mounts on a touch viewport. Storage state is copied so this costs
     * no second magic link — minting one would invalidate the first.
     */
    phase = "mobile";
    current = "/ (mobile More sheet)";
    const mCtx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      storageState: await ctx.storageState(),
    });
    const mPage = await mCtx.newPage();
    mPage.on("pageerror", (err) => add(role.key, current, "uncaught-exception", "likely-visible", `${err.name}: ${err.message}`, "mobile"));
    mPage.on("console", (m) => {
      if (m.type() === "error" && !IGNORABLE.some((r) => r.test(m.text())))
        add(role.key, current, "console.error", "silent", m.text(), "mobile");
    });
    try {
      await mPage.goto(`${SITE}/`, { waitUntil: "networkidle", timeout: 90_000 });
      await mPage.waitForTimeout(1000);
      const moreBtn = mPage.locator('[data-testid="tab-more"]');
      if (await moreBtn.count()) {
        await moreBtn.click({ timeout: 5000 });
        await mPage.waitForTimeout(600);
        const sheet = await mPage.evaluate(() => {
          const open = document.querySelector('[data-testid="tab-more"]')?.getAttribute("aria-expanded");
          const links = [...document.querySelectorAll("a[href^='/']")]
            .map((a) => a.getAttribute("href"))
            .filter(Boolean);
          return { open, linkCount: links.length, sample: links.slice(0, 12) };
        });
        if (sheet.open !== "true")
          add(role.key, current, "more-sheet-did-not-open", "visible",
            `tapped the More tab, aria-expanded is "${sheet.open}" — the drawer did not open`, "mobile");
        else console.log(`  mobile More sheet opened (${sheet.linkCount} links reachable)`);
      } else {
        add(role.key, current, "no-mobile-tab-bar", "visible",
          "no [data-testid=mobile-tab-bar] More button at 390x844 — the phone navigation is absent for this role", "mobile");
      }
    } catch (e) {
      add(role.key, current, "mobile-interaction-failed", "visible", e.message.split("\n")[0], "mobile");
    } finally {
      await mCtx.close();
    }

    const mine = findings.filter((f) => f.role === role.key);
    roleSummary.push({
      role: role.key,
      routes: routesSeen,
      visible: mine.filter((f) => f.visibility === "visible" || f.visibility === "likely-visible").length,
      silent: mine.filter((f) => f.visibility === "silent").length,
      benign: mine.filter((f) => f.visibility === "none").length,
    });

    await ctx.close();
  }
} finally {
  await browser.close();
}

/* ── the report ────────────────────────────────────────────────────────── */
const real = findings.filter((f) => f.visibility !== "none");
const benign = findings.filter((f) => f.visibility === "none");

console.log(`\n\n${"#".repeat(78)}\n# RUNTIME ERROR AUDIT — ${SITE}\n# ${ran} route-visits across ${ROLES.length} role(s); ${real.length} finding(s), ${benign.length} set aside as proven-harmless\n${"#".repeat(78)}`);

console.log(`\n${"role".padEnd(14)} ${"routes".padStart(7)} ${"visible".padStart(8)} ${"silent".padStart(7)} ${"benign".padStart(7)}`);
for (const s of roleSummary)
  console.log(`${s.role.padEnd(14)} ${String(s.routes).padStart(7)} ${String(s.visible).padStart(8)} ${String(s.silent).padStart(7)} ${String(s.benign).padStart(7)}`);

/** Grouped by kind, because one root cause usually produces one kind across routes. */
const byKind = new Map();
for (const f of real) byKind.set(f.kind, [...(byKind.get(f.kind) ?? []), f]);

for (const [kind, list] of [...byKind].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n\n── ${kind.toUpperCase()} (${list.length}) ${"─".repeat(Math.max(0, 60 - kind.length))}`);
  for (const f of list)
    console.log(`  [${f.visibility}] ${f.role} @ ${f.route} (${f.phase})\n      ${f.detail}`);
}

if (benign.length) {
  console.log(`\n\n── SET ASIDE, WITH PROOF (${benign.length}) ${"─".repeat(40)}`);
  for (const f of benign) console.log(`  ${f.role} @ ${f.route}: ${f.detail}`);
}

const out = join(process.cwd(), "audit-runtime-errors.json");
writeFileSync(out, JSON.stringify({ site: SITE, at: new Date().toISOString(), roles: ROLES.map((r) => r.key), findings }, null, 2));
console.log(`\nfull ledger: ${out}\ncsv downloads discarded in ${downloadDir}`);

/**
 * DIAGNOSTIC, NOT A GATE. Exits 0 with findings on purpose — the caller asked for the
 * whole list before anyone changes code, and a non-zero exit here would get this run
 * wired into CI as a pass/fail before the list has been triaged. It exits non-zero
 * only when the audit itself could not observe anything.
 */
const couldNotAudit = findings.filter((f) => f.kind === "cannot-audit").length;
process.exitCode = ran === 0 || couldNotAudit === ROLES.length ? 1 : 0;

/* ── the interaction pass ──────────────────────────────────────────────── */
/**
 * Click the things a reader clicks. Every click is wrapped: a click that throws is
 * itself a finding, and one broken control must not abort the rest of the route.
 *
 * The controls come from src/components/data-table/DataTable.tsx, which is the shared
 * primitive: sortable headers are <th><button>, the pager is four aria-pressed
 * buttons labelled 25/50/100/ALL, the search is a labelled input, and CSV is a button
 * titled "Download these rows as CSV". Driving the primitive covers every table in
 * the app at once, and the per-page extras (facet chips, the donut, the Management
 * tab links) are handled explicitly below.
 */
async function exercise(page, role, route, snap, setPhase) {
  const note = (kind, vis, detail, ph) => add(role, route, kind, vis, detail, ph);

  /**
   * OPEN WHAT IS SHUT, BEFORE CLICKING ANYTHING.
   *
   * /my-work groups its projects into one collapsed <details> per customer, and
   * DataTable itself has a `collapsible` mode. Their controls are in the DOM but
   * not visible, so Playwright waits for actionability and times out after 4s. The
   * first full run reported five of those timeouts as "interaction-threw ...
   * visible", which reads in the report exactly like a broken control — a fake
   * defect on a working page, and slow (4s each) on top of it.
   *
   * A shut panel is not a bug and it is also not a test. So the panels are opened
   * first, and any control still not visible after that is SKIPPED rather than
   * clicked, with the skip recorded so the report says what was not covered instead
   * of quietly claiming it was.
   */
  setPhase("expand");
  try {
    const shut = page.locator("details:not([open]) > summary");
    const n = Math.min(await shut.count().catch(() => 0), 8);
    for (let d = 0; d < n; d++) await shut.nth(d).click({ timeout: 2500 }).catch(() => {});
    // DataTable's own collapsible heading is a button, not a <summary>.
    const shutPanels = page.locator('button[aria-expanded="false"]:not([data-testid="tab-more"])');
    const m = Math.min(await shutPanels.count().catch(() => 0), 6);
    for (let d = 0; d < m; d++) await shutPanels.nth(d).click({ timeout: 2500 }).catch(() => {});
    await page.waitForTimeout(400);
  } catch { /* nothing to expand */ }

  /** Is this control actually operable? A hidden one is out of scope, not broken. */
  const usable = async (loc) => {
    if (!(await loc.count().catch(() => 0))) return false;
    return (await loc.first().isVisible().catch(() => false)) && (await loc.first().isEnabled().catch(() => false));
  };

  /** Run one interaction; a throw is a finding, never an abort of the pass. */
  const attempt = async (what, phaseName, fn) => {
    setPhase(phaseName);
    try {
      await fn();
      /**
       * LET IT SETTLE BEFORE JUDGING IT.
       *
       * Some of these interactions NAVIGATE — the Management tab controls are
       * <Link>s, not client state. During a navigation `document` is momentarily
       * the new, empty one, so an evaluate() 220ms after the click reads <main> as
       * 0 chars and the audit reports "blanked-on-interaction". That is what the
       * second run did: four findings saying the exec's Management tabs went blank
       * on click, on tabs whose own load snapshot had just measured 9,203 chars of
       * content. The page was fine; the audit photographed the shutter.
       *
       * So: wait for the document to finish loading, then re-read. A page that is
       * still empty AFTER it has settled is a real blank.
       */
      await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => {});
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
      await page.waitForTimeout(400);
      const read = () => page.evaluate(() => ({
        errored: /This page couldn.t load|Something went wrong|Application error|Unhandled Runtime Error/i.test(
          (document.body.innerText ?? "").slice(0, 600),
        ),
        chars: ((document.querySelector("main") ?? document.body).innerText ?? "").trim().length,
        onLogin: /\/auth\/login/.test(location.pathname),
      }));
      let after = await read().catch(() => null);
      // One more look, because a client transition can still be swapping trees.
      if (after && after.chars < 40 && !after.errored) {
        await page.waitForTimeout(1200);
        after = await read().catch(() => after);
      }
      if (!after) return;
      /**
       * A lapsed session lands on /auth/login, which also renders <main> with 0
       * chars. Reporting that as "this control blanked the page" would blame a
       * button for an expired cookie, so it is named for what it is.
       */
      if (after.onLogin) {
        note("session-lapsed-mid-run", "silent", `${what}: landed on /auth/login — the session expired during the run, so this control was not actually cleared`, phaseName);
        return;
      }
      if (after.errored) note("broke-on-interaction", "visible", `${what} put the route into its error boundary`, phaseName);
      else if (after.chars < 40) note("blanked-on-interaction", "visible", `${what} left <main> with ${after.chars} chars`, phaseName);
    } catch (e) {
      const msg = String(e.message).split("\n")[0];
      // A timeout means the control never became actionable — usually because it is
      // behind something still shut. Reported as a COVERAGE GAP, not as a defect:
      // calling it a defect is what produced five false findings on the first run.
      if (/Timeout \d+ms exceeded/.test(msg))
        note("control-not-reachable", "silent", `${what}: never became actionable (${msg}) — not exercised, so not cleared either`, phaseName);
      else note("interaction-threw", "visible", `${what}: ${msg}`, phaseName);
    }
  };

  /* ── 1. every table: sort headers, page sizes, search, CSV ───────── */
  const tables = page.locator("section:has(table)");
  const tableCount = Math.min(await tables.count().catch(() => 0), 6);

  for (let i = 0; i < tableCount; i++) {
    const t = tables.nth(i);
    const label = `table#${i}`;

    // SORT. Each header button toggles asc/desc, so it is clicked twice: the second
    // click is the reversed comparator, which is the half that is usually untested.
    const sortBtns = t.locator("thead th button");
    const sortCount = Math.min(await sortBtns.count().catch(() => 0), 12);
    for (let h = 0; h < sortCount; h++) {
      if (!(await usable(sortBtns.nth(h)))) continue;
      const name = (await sortBtns.nth(h).textContent().catch(() => ""))?.trim().slice(0, 24) || `col${h}`;
      await attempt(`${label} sort "${name}" asc`, "sort", () => sortBtns.nth(h).click({ timeout: 4000 }));
      await attempt(`${label} sort "${name}" desc`, "sort", () => sortBtns.nth(h).click({ timeout: 4000 }));
    }

    // PAGE SIZE. ALL is the branch that renders the entire result set and the one
    // nobody clicks twice; it is included deliberately.
    for (const size of ["25", "50", "100", "ALL"]) {
      const btn = t.getByRole("button", { name: size, exact: true });
      if (await usable(btn))
        await attempt(`${label} page size ${size}`, "pagesize", () => btn.first().click({ timeout: 4000 }));
    }

    // SEARCH. A term that matches nothing exercises the no-match branch (which
    // renders its own message and a reset button); then it is cleared, which is a
    // second state transition and a second chance to throw.
    const search = t.locator('input[id^="search"], input[placeholder*="Search" i]');
    if (await usable(search)) {
      await attempt(`${label} search "zzqqxx" (matches nothing)`, "search", async () => {
        await search.first().fill("zzqqxx", { timeout: 4000 });
      });
      // Did the no-match state say anything, or is it a silent void?
      const said = await page
        .locator("text=/No row matches|no results|nothing/i")
        .count()
        .catch(() => 0);
      if (!said) note("search-no-match-silent", "visible", `${label}: a search matching nothing rendered no explanation`, "search");
      /**
       * Clearing is a second state transition and a second chance to throw, so it
       * is worth driving — but the input must still be reachable. On /my-work and
       * /team-lead the no-match state re-renders the panel and the box scrolls out
       * of the viewport, so `fill` waited 4s and timed out; three runs reported
       * that as a coverage gap on a control that works. Scroll it back into view
       * and re-check before deciding.
       */
      await search.first().scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
      if (await usable(search)) {
        await attempt(`${label} clear search`, "search", async () => {
          await search.first().fill("", { timeout: 4000 });
        });
      } else {
        note("control-not-reachable", "silent",
          `${label}: the search box was no longer reachable after a no-match search, so clearing it was not exercised`,
          "search");
      }
    }

    // CSV. The serialiser only ever runs on click. A row containing a comma or a
    // quote, or a column whose csv() reads a null, throws here and nowhere else.
    const csv = t.getByRole("button", { name: "CSV", exact: true });
    if (await usable(csv)) {
      await attempt(`${label} CSV export`, "csv", async () => {
        const dl = page.waitForEvent("download", { timeout: 8000 }).catch(() => null);
        await csv.first().click({ timeout: 4000 });
        const got = await dl;
        if (!got) note("csv-no-download", "visible", `${label}: clicking CSV produced no download`, "csv");
        else await got.saveAs(join(downloadDir, `${role}-${route.replace(/\W+/g, "_")}-${i}.csv`)).catch(() => {});
      });
    }
  }

  /* ── 2. the projects facet chips and the donut slices ────────────── */
  if (route.startsWith("/projects") && !route.includes("/", 9)) {
    for (const facet of ["Over budget", "At risk", "No budget", "Idle", "No activity"]) {
      const chip = page.getByRole("button", { name: new RegExp(facet, "i") });
      if (await chip.count().catch(() => 0)) {
        await attempt(`facet chip "${facet}" on`, "facet", () => chip.first().click({ timeout: 4000 }));
        await attempt(`facet chip "${facet}" off`, "facet", () => chip.first().click({ timeout: 4000 }));
      }
    }
    /**
     * The donut slices are <path onClick> inside an svg[role=img], not buttons, so
     * getByRole cannot reach them. Clicked by their DOM position. A slice with a
     * zero value renders a degenerate arc, which is precisely the shape an empty
     * portfolio produces — the reason this is driven for every role and not only
     * for the exec.
     *
     * They are <circle>, NOT <path>. Charts.tsx draws each arc as a full circle
     * with a strokeDasharray, which is why the first runs reported "no clickable
     * slices" for all four roles including the exec with 40 project rows on
     * screen — a selector miss reported as an app defect. The `cursor` style is
     * the honest signal: Donut sets it only when an onSelect handler exists, so a
     * circle carrying it is exactly a slice that is meant to be clickable.
     */
    const slices = page.locator('svg[role="img"] circle[style*="cursor"]');
    const sliceCount = Math.min(await slices.count().catch(() => 0), 6);
    for (let s = 0; s < sliceCount; s++) {
      await attempt(`donut slice #${s}`, "donut", () => slices.nth(s).click({ timeout: 4000, force: true }));
    }
    if (sliceCount === 0) {
      // Only meaningful where the role HAS a portfolio to chart. With no rows an
      // empty donut is the correct rendering, not a missing control.
      const hasRows = snap.totalRows > 0;
      note("no-donut-slices", hasRows ? "visible" : "none",
        hasRows
          ? `the portfolio donut rendered no clickable slices although this role sees ${snap.totalRows} rows — the cross-filter control is missing`
          : "no clickable donut slices, and this role sees no projects — correct, an empty portfolio has nothing to chart",
        "donut");
    }
  }

  /* ── 3. the Management tab links, clicked rather than deep-linked ──
   *
   * Deep-linking ?tab= is a server render; CLICKING the link is a client transition
   * with the previous tab's state still mounted. Those are different code paths and
   * only the second one can throw during unmount.
   */
  if (route.startsWith("/dashboard/management")) {
    for (const tab of ["Overview", "Employees", "Customers", "Risks"]) {
      const link = page.getByRole("link", { name: new RegExp(`^${tab}$`, "i") });
      if (await link.count().catch(() => 0))
        await attempt(`Management tab link "${tab}"`, "tabs", async () => {
          await link.first().click({ timeout: 5000 });
          await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
        });
    }
  }
}
