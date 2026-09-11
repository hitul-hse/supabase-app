/**
 * No table is wider than the card it sits in: the horizontal mirror of
 * check-table-scroll-budget.mjs.
 *
 * THE REPORTED BUG. hitul, 2026-09-11: the tables are "too clustered and cant see
 * proper data easily in all the tabs we have". The scroll gate already held the
 * vertical axis (79 of 79 against production); nothing measured how much is
 * crammed across the WIDTH of a row, which is why it drifted. The house mechanism
 * for it, `Column.compact` in src/components/data-table/DataTable.tsx, was used by
 * three of the ten tables that could use it.
 *
 * WHAT IT MEASURED BEFORE THE CHANGE (fixture pass, 1280px, sidebar open, a 17px
 * classic scrollbar; px of table against px of card, both locales; a full-width
 * card is 993px inside its border, and each Overview queue was 489px because the
 * two shared a row from `xl`):
 *
 *   management?tab=customers · multi-service   en 1694   de 1690   in 993
 *   management?tab=risks · project risks       en 1263   de 1293   in 993
 *   my-work · projects                         en 1153   de 1153   in 993
 *   time/dashboard · entries                   en 1056   de 1068   in 993
 *   management?tab=customers · portfolio       en 1004   de 1024   in 993
 *   overview · utilisation                     en  529   de  539   in 489
 *   overview · over budget                     en  492   de  526   in 489
 *   → 14 of 32 table measurements scrolled sideways at 1280.
 *
 * After it: 0 of 32 scroll that are not pinned, and 4 that are -- my-work ·
 * projects at 1,153 and the multi-service crosstab at 1,534 / 1,530, both of
 * which freeze their label column and are pinned as debt in WIDE_BY_DESIGN below
 * with the owner decision that would clear each. The 400px pass was green before
 * and after (see below for what it asserts and why it is not the same assertion).
 *
 * TWO PASSES, and why there are two.
 *
 *   1. FIXTURE PASS -- always runs, needs no credentials. Every table surface is
 *      rendered from its REAL component (scripts/lib/render-tsx.mjs) with rows
 *      shaped like production (scripts/lib/table-width-fixtures.mjs), styled by
 *      the REAL stylesheet (src/app/globals.css compiled through the same
 *      @tailwindcss/postcss plugin the build uses), set in the REAL faces
 *      (Poppins and JetBrains Mono, fetched from Google Fonts exactly as next/font
 *      does at build time), in Chromium, inside a box the width the page gives
 *      that surface. This is the pass that produced the before/after above, and
 *      it is the one that can run in a worktree or on CI with no secrets.
 *   2. LIVE PASS -- the ticket's literal ask: the table routes on SITE, signed
 *      in, in a real browser at 1280 and at 400. Every route is behind auth, so
 *      without SUPABASE_SERVICE_ROLE_KEY it records NOT RUN with the reason,
 *      never a pass. Collapsed panels are opened before measuring.
 *
 * WHAT IS ASSERTED
 *
 *   At 1280 -- a table's laid-out width does not exceed its scroll container's
 *   width. This is the desktop the complaint came from, and a table that fits
 *   needs no sideways scroll to find the figure at the end of its row.
 *
 *   At 400 -- the page itself never scrolls sideways: no table, and no card
 *   around one, reaches past the phone's content width. The (app) <main> is
 *   `overflow-x: clip`, so anything that did would be CUT OFF, unreachable, rather
 *   than scrollable.
 *
 *   What is deliberately NOT asserted at 400 is "every table fits a phone". A
 *   seven-column ledger of figures cannot fit 368px without dropping columns,
 *   APPLE_REF's answer to that is to hide tertiary columns as the view narrows,
 *   and the ticket forbids changing what any table shows outside ReportTables.
 *   So on a phone the tables scroll inside their own card, and the pass PRINTS
 *   every table that does and whether its label column is frozen, as the list the
 *   column-priority follow-up works from, without claiming it as a verdict.
 *
 * WHY THE SLOT WIDTHS ARE WHAT THEY ARE. 1280 viewport - 17 (a classic scrollbar,
 * which is what Chrome on Windows draws on these tall pages) - 220 (the expanded
 * sidebar, `--sidebar-width`) - 2 x 24 (`.page-shell` padding at >= 640px) = 995.
 * The two Overview queues sit in that page's `xl:grid-cols-2` row with the 12px
 * `--card-gap`: (995 - 12) / 2 = 491. At 400 there is no sidebar and no classic
 * scrollbar, and `.page-shell` pads 16: 368.
 *
 * Both locales are measured, because German headers ("VERTRAGSSTUNDEN") are the
 * wider ones and the team reads the app in German.
 *
 * A pass that measured nothing is red: each surface must render the number of
 * tables it declares, each with rows, and the brand faces must actually have
 * loaded -- a width measured in a fallback face is not the width that ships, so
 * the fixture pass records NOT RUN rather than a verdict when they cannot load.
 *
 * Run: npm run check:table-width
 */
import { readFileSync } from "node:fs";
import { record, recordNotRun, notRunInChain } from "./lib/gate-result.mjs";
import { loadEnv } from "./lib/gate-env.mjs";

const VIEWPORTS = {
  desktop: { width: 1280, height: 900, phone: false },
  // Measured too because the Overview queues go side by side here, and a slot
  // that only exists at 1440 would otherwise never be measured at all.
  wide: { width: 1440, height: 900, phone: false },
  phone: { width: 400, height: 844, phone: true },
};
/** A classic scrollbar (Chrome on Windows, on these tall pages). */
const SCROLLBAR = 17;
/** `--sidebar-width`, expanded -- the state a reader gets unless they collapse it. */
const SIDEBAR = 220;
/** `.page-shell` padding per side: 1.5rem from 640px, 1rem below. */
const shellPad = (vw) => (vw >= 640 ? 24 : 16);
/** `--card-gap`, between two cards sharing a row. */
const CARD_GAP = 12;

/**
 * The width the page gives a surface at viewport `vw`. Derived from the layout
 * constants above rather than written per surface, so it cannot be edited for
 * one table to make that table pass.
 */
function slotWidth(vw, surface) {
  if (vw < 1024) return vw - 2 * shellPad(vw); // no sidebar, overlay scrollbar
  const full = vw - SCROLLBAR - SIDEBAR - 2 * shellPad(vw);
  return surface.halfFrom && vw >= surface.halfFrom ? Math.floor((full - CARD_GAP) / 2) : full;
}

const LOCALES = ["en", "de"];
/** Sub-pixel layout rounding, not a tolerance for a real overflow. */
const EPS = 1;

/**
 * WIDE BY DESIGN, and pinned as DEBT -- the same shape as the scroll gate's
 * ROUTE_BUDGETS: a ceiling one notch above the width MEASURED after this change,
 * so the table cannot quietly grow, with the work that would clear it named.
 * Clearing one means deleting its line, not raising the number.
 *
 * An entry is only honoured while the table FREEZES its label column (asserted
 * below): a table allowed to scroll sideways must keep saying which row you are
 * on while it does. Every other table must simply fit.
 */
const WIDE_BY_DESIGN = {
  /*
   * Measured 1,153px in a 993px card at 1280, both locales. Every token column
   * was already `compact` before this ticket (CODE, ROLE, STATUS, SERVICE, DUE,
   * the five link columns); what remains is ten columns of tokens and two of
   * names that already truncate. Fits from ~1440 (1,153 in 1,153).
   * CLEARS WHEN the owner decides what gives at 1280: the usual candidate is
   * folding the five link columns (234px) into one LINKS column below 1440,
   * which changes what the table shows and so was out of this ticket's scope.
   */
  "my-work · projects": 1160,
  /*
   * Measured 1,534px (en) / 1,530px (de) at 1280 -- down from 1,694 with every
   * count column `compact`. It is a crosstab whose width is its seven service
   * headers, printed in full because they are the names of what is sold
   * ("BRANDSCHUTZBEAUFTRAGTER" alone is 199px of nowrap caption over a
   * one-digit count), and it has frozen its customer column since it was built.
   * CLEARS WHEN the owner accepts short service codes in the header (full name
   * in the tooltip and a legend), which changes the words on screen and so was
   * out of this ticket's scope.
   */
  "management?tab=customers · multi-service": 1540,
};

let failed = 0;
const check = (name, ok, detail = "") => {
  record(ok);
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? `\n        ${detail}` : ""}`);
};

let launchChromium;
try {
  ({ launchChromium } = await import("./lib/launch-chromium.mjs"));
} catch {
  notRunInChain("playwright is not installed in this environment");
}

let browser;
try {
  browser = await launchChromium();
} catch (e) {
  notRunInChain(`chromium could not start: ${String(e?.message ?? e).split("\n")[0]}`);
}

/**
 * Measure every <table> in `root` against the element that actually bounds it:
 * the nearest ancestor whose overflow-x is not `visible` (DataTable's
 * `overflow-x-auto` scroller, a hand-rolled wrapper, or a card's
 * overflow-hidden), falling back to `root` itself. Runs in the page.
 */
const measureIn = (rootSelector) => {
  const root = rootSelector ? document.querySelector(rootSelector) : document.body;
  const rootBox = root.getBoundingClientRect();
  const tables = [...root.querySelectorAll("table")].map((table) => {
    let box = table.parentElement;
    while (box && box !== root && getComputedStyle(box).overflowX === "visible") box = box.parentElement;
    const container = box ?? root;
    let n = table;
    let title = "";
    while (n && !title && n !== document.body) {
      n = n.parentElement;
      const heading = n?.querySelector?.("h2,h3,h4");
      if (heading) title = (heading.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 48);
    }
    const firstHead = table.querySelector("thead th");
    const cBox = container.getBoundingClientRect();
    return {
      title: title || "(untitled)",
      cols: table.querySelectorAll("thead th").length,
      rows: table.querySelectorAll("tbody tr").length,
      width: Math.round(table.getBoundingClientRect().width),
      room: container.clientWidth,
      frozen: firstHead ? getComputedStyle(firstHead).position === "sticky" : false,
      containerRight: Math.round(cBox.right),
    };
  });
  return {
    tables,
    rootRight: Math.round(rootBox.right),
    rootOverflow: root.scrollWidth - root.clientWidth,
    docOverflow: document.documentElement.scrollWidth - window.innerWidth,
  };
};

/* ════════════════════════════════════════════════════════ 1. FIXTURE PASS */

async function fixturePass() {
  console.log("===== FIXTURE PASS: real components, real stylesheet, real faces\n");

  const [{ loadTsx, renderWith, React }, { surfaces }, postcss, tailwind] = await Promise.all([
    import("./lib/render-tsx.mjs"),
    import("./lib/table-width-fixtures.mjs"),
    import("postcss").then((m) => m.default),
    import("@tailwindcss/postcss").then((m) => m.default),
  ]);

  const css = (
    await postcss([tailwind({ base: process.cwd() })]).process(
      readFileSync("src/app/globals.css", "utf8"),
      { from: "src/app/globals.css" },
    )
  ).css;

  const shell = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=block">
<style>${css}</style>
<style>:root{--font-poppins:"Poppins";--font-jetbrains:"JetBrains Mono"}</style>
</head><body class="min-h-full font-sans bg-[var(--page)] text-[var(--text-primary)]">
<div id="slot"></div></body></html>`;

  const all = surfaces({ loadTsx, React });
  const phoneScrollers = [];
  /** Per desktop width: how many table measurements scroll sideways, of how many. */
  const tally = {};

  // The slot model is only as good as its match with the pages. A surface that
  // claims a two-column row names the class that creates it; if the page no
  // longer carries that class, every width measured for it is in the wrong box.
  for (const s of all.filter((x) => x.layout)) {
    const matches = readFileSync(s.layout.file, "utf8").includes(s.layout.pattern);
    check(
      `${s.id}: the page still lays it out the way this gate measures it`,
      matches,
      matches
        ? `"${s.layout.pattern}" in ${s.layout.file}`
        : `expected "${s.layout.pattern}" in ${s.layout.file} (a two-column row from ${s.halfFrom}px) --` +
          " the page has changed, so every width measured for this surface is in the wrong box;" +
          " update halfFrom/layout in scripts/lib/table-width-fixtures.mjs to match the page",
    );
  }
  // A pin for a surface that no longer exists would be an exemption nobody can see.
  for (const id of Object.keys(WIDE_BY_DESIGN)) {
    check(`WIDE_BY_DESIGN entry "${id}" names a measured surface`, all.some((s) => s.id === id));
  }

  for (const [vpName, viewport] of Object.entries(VIEWPORTS)) {
    const page = await browser.newPage({ viewport });
    await page.setContent(shell, { waitUntil: "load", timeout: 60_000 }).catch(() => {});
    const faces = await page.evaluate(async () => {
      // Faces load lazily, on first use by rendered text, and the slot is still
      // empty here -- so ask for every weight the tables use, explicitly.
      await Promise.all([
        ...["400", "500", "600", "700"].map((w) => document.fonts.load(`${w} 12px "Poppins"`)),
        ...["400", "500"].map((w) => document.fonts.load(`${w} 11px "JetBrains Mono"`)),
      ]).catch(() => {});
      await document.fonts.ready;
      return {
        poppins: document.fonts.check('500 12px "Poppins"'),
        mono: document.fonts.check('400 11px "JetBrains Mono"'),
      };
    });
    if (!faces.poppins || !faces.mono) {
      await page.close();
      recordNotRun(
        `fixture pass at ${viewport.width}px: the brand faces did not load (Poppins ${faces.poppins},` +
          ` JetBrains Mono ${faces.mono}) -- a width measured in a fallback face is not the width that ships`,
        all.length * LOCALES.length,
      );
      continue;
    }

    console.log(`--- ${viewport.width}px (${vpName}), faces loaded\n`);

    for (const surface of all) {
      for (const locale of LOCALES) {
        const html = renderWith(surface.render(), { locale, search: surface.search ?? "" });
        const box = slotWidth(viewport.width, surface);
        await page.evaluate(
          ({ html, box }) => {
            const slot = document.getElementById("slot");
            slot.style.width = `${box}px`;
            slot.innerHTML = html;
            return slot.offsetWidth; // forces layout before the measurement below
          },
          { html, box },
        );
        const m = await page.evaluate(measureIn, "#slot");

        const label = `${surface.id} [${locale}] @${viewport.width}`;

        // A render that produced no table would pass every width check below.
        const withRows = m.tables.filter((t) => t.rows > 0).length;
        check(
          `${label}: renders its ${surface.tables} table(s), with rows`,
          m.tables.length === surface.tables && withRows === surface.tables,
          `rendered ${m.tables.length} table(s), ${withRows} with body rows`,
        );

        if (!viewport.phone) {
          const row = (tally[viewport.width] ??= { over: 0, of: 0, pinned: 0 });
          for (const t of m.tables) {
            row.of += 1;
            const fits = t.width <= t.room + EPS;
            const pin = WIDE_BY_DESIGN[surface.id];
            if (fits) {
              check(
                `${label}: "${t.title}" fits its card without scrolling sideways`,
                true,
                `${t.cols} columns, ${t.width}px of table in ${t.room}px of card`,
              );
            } else if (pin !== undefined) {
              row.pinned += 1;
              check(
                `${label}: "${t.title}" is wide by design: label column frozen, width within its ${pin}px pin`,
                t.frozen && t.width <= pin,
                `${t.cols} columns, ${t.width}px of table in ${t.room}px of card` +
                  (!t.frozen ? " -- its label column is NOT frozen, so the pin does not apply" : "") +
                  (t.width > pin ? ` -- ${t.width - pin}px past its pin; it grew, which the pin exists to stop` : ""),
              );
            } else {
              row.over += 1;
              check(
                `${label}: "${t.title}" fits its card without scrolling sideways`,
                false,
                `${t.cols} columns, ${t.width}px of table in ${t.room}px of card -- ${t.width - t.room}px too wide;` +
                  " mark the token columns `compact` (DataTable.tsx) and check for a hard min-width",
              );
            }
          }
        } else {
          check(
            `${label}: nothing reaches past the phone's ${box}px content width`,
            m.rootOverflow <= EPS && m.tables.every((t) => t.containerRight <= m.rootRight + EPS),
            m.rootOverflow > EPS
              ? `the surface is ${m.rootOverflow}px wider than its slot; <main> clips it, so that part is unreachable`
              : "",
          );
          for (const t of m.tables) {
            if (t.width > t.room + EPS && locale === "de") {
              phoneScrollers.push(`${surface.id}: "${t.title}" ${t.cols} cols, ${t.width}px in ${t.room}px` +
                `${t.frozen ? ", label frozen" : ", label NOT frozen"}`);
            }
          }
        }
      }
    }
    await page.close();
  }

  for (const [w, row] of Object.entries(tally)) {
    console.log(
      `\n${w}px: ${row.over + row.pinned} of ${row.of} table measurements scroll sideways` +
        ` (${row.pinned} of them pinned wide-by-design, ${row.over} not).`,
    );
  }
  if (phoneScrollers.length) {
    console.log(
      "\nAt 400px these scroll sideways inside their own card (German; reported, not asserted --" +
        " see the header):\n  " + phoneScrollers.join("\n  "),
    );
  }
}

/* ═══════════════════════════════════════════════════════════ 2. LIVE PASS */

const LIVE_ROUTES = [
  "/",
  "/my-work",
  "/my-work?view=customers",
  "/time/dashboard",
  "/operations-analytics",
  "/dashboard/management?tab=employees",
  "/dashboard/management?tab=customers",
  "/dashboard/management?tab=risks",
];

async function livePass() {
  console.log("\n\n===== LIVE PASS: the table routes, signed in\n");
  const env = loadEnv();
  if (!env.SUPABASE_SERVICE_ROLE_KEY || !env.NEXT_PUBLIC_SUPABASE_URL) {
    recordNotRun(
      "live pass: no SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_URL in the environment or a" +
        " .env.local, so no session can be minted for these authed routes",
      LIVE_ROUTES.length * 2,
    );
    return;
  }
  const SITE = process.env.SITE ?? "https://hseportal.hs-experts.com";
  const EMAIL = process.env.GATE_EMAIL ?? "bjoern.schoenemann@hs-experts.com";

  const gen = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ type: "magiclink", email: EMAIL, options: { redirect_to: `${SITE}/auth/callback` } }),
  }).catch(() => null);
  const body = gen ? await gen.json().catch(() => ({})) : {};
  const hashed = body?.properties?.hashed_token ?? body?.hashed_token;
  if (!hashed) {
    recordNotRun(`live pass: could not mint a magic link for ${EMAIL}`, LIVE_ROUTES.length * 2);
    return;
  }

  const ctx = await browser.newContext({ viewport: VIEWPORTS.desktop });
  const page = await ctx.newPage();
  try {
    await page.goto(`${SITE}/auth/callback?token_hash=${hashed}&type=magiclink&next=%2F`, {
      waitUntil: "networkidle",
      timeout: 120_000,
    });
  } catch (e) {
    await ctx.close();
    recordNotRun(`live pass: could not reach ${SITE} -- ${String(e?.message ?? e).split("\n")[0]}`, LIVE_ROUTES.length * 2);
    return;
  }
  if (/\/auth\/login|error=/.test(page.url())) {
    check("live pass: signed in", false, `stuck on ${page.url()} -- every measurement would be of the login page`);
    await ctx.close();
    return;
  }
  console.log(`signed in as ${EMAIL}\n`);

  const phoneCtx = await browser.newContext({
    viewport: VIEWPORTS.phone,
    isMobile: true,
    hasTouch: true,
    storageState: await ctx.storageState(),
  });
  const phone = await phoneCtx.newPage();

  const visit = async (p, route) => {
    await p.goto(`${SITE}${route}`, { waitUntil: "networkidle", timeout: 90_000 });
    await p.waitForTimeout(1200);
    // Open every collapsed table panel: a shut panel renders no <table>, and a
    // width that is never laid out is never measured.
    await p.evaluate(() => {
      for (const b of document.querySelectorAll('section > header button[aria-expanded="false"]')) b.click();
    });
    await p.waitForTimeout(400);
    return p.evaluate(measureIn, "main");
  };

  try {
    for (const route of LIVE_ROUTES) {
      for (const [vpName, p] of [["desktop", page], ["phone", phone]]) {
        const w = VIEWPORTS[vpName].width;
        let m;
        try {
          m = await visit(p, route);
        } catch (e) {
          check(`${route} @${w}: renders`, false, String(e?.message ?? e).split("\n")[0].slice(0, 110));
          continue;
        }
        if (/\/auth\/login|\/access-pending/.test(p.url())) {
          check(`${route} @${w}: measured the route rather than a redirect`, false, `landed on ${p.url()}`);
          continue;
        }
        if (vpName === "desktop") {
          const wide = m.tables.filter((t) => t.width > t.room + EPS);
          check(
            `${route} @${w}: every table fits its card without scrolling sideways`,
            wide.length === 0,
            wide.length
              ? wide.map((t) => `"${t.title}" ${t.cols} cols, ${t.width}px in ${t.room}px`).join("; ")
              : `${m.tables.length} table(s)`,
          );
        } else {
          const escaped = m.tables.filter((t) => t.containerRight > m.rootRight + EPS);
          check(
            `${route} @${w}: nothing reaches past the phone's content width`,
            m.docOverflow <= EPS && escaped.length === 0,
            m.docOverflow > EPS
              ? `the document is ${m.docOverflow}px wider than the viewport`
              : escaped.map((t) => `"${t.title}" ends at ${t.containerRight}px, main at ${m.rootRight}px`).join("; "),
          );
        }
      }
    }
  } finally {
    await phoneCtx.close();
    await ctx.close();
  }
}

try {
  await fixturePass();
  await livePass();
} finally {
  await browser.close();
}

console.log(failed === 0 ? "\nTABLE WIDTH: all evaluated checks passed" : `\nTABLE WIDTH: ${failed} check(s) failed`);
process.exitCode = failed === 0 ? 0 : 1;
