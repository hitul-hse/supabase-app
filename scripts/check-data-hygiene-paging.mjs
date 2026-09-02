/**
 * Can a reader actually REACH every row of a data-hygiene finding?
 *
 * The panels used to render the first 8 rows of a 55-row finding and disclose
 * "showing 8 of 55". That was honest and it was still a dead end: the other 47
 * orders existed in no reachable place. They are now paged, and this gate exists
 * because "it is paged" is exactly the kind of claim that looks true from a
 * screenshot of page 1.
 *
 * WHY THIS GATE USES A STUB CLIENT RATHER THAN THE DATABASE
 * --------------------------------------------------------
 * check-data-hygiene-page.mjs is the live one: it recounts the findings against
 * the real order book, and it SKIPs without a service-role key -- correctly, as
 * a report about no data proves nothing. But paging is not a claim about the
 * data. It is arithmetic over whatever rows a probe returned, and the properties
 * worth asserting (no row appears on two pages, no row appears on none, the last
 * page is the remainder, an out-of-range page clamps) are true or false
 * independently of what is in Supabase.
 *
 * Driving it from a fixture buys three things the live gate cannot have:
 *
 *  1. It runs on a laptop with no credentials, and in CI on a fork. A gate that
 *     only runs where the secrets are is a gate that is not consulted while the
 *     code is being written, which is the only time it would be cheap to fix.
 *  2. The expected answers are known. Against live data the honest assertion is
 *     "the pages are disjoint"; against a fixture it is "there are exactly 137
 *     of them and here is the 137th", which is a strictly stronger statement.
 *  3. It cannot go quiet. The live gate's paging assertions are conditional on
 *     some finding happening to exceed one page today. This one guarantees the
 *     multi-page path is exercised on every run, because the fixture is built to
 *     require it.
 *
 * The fixture deliberately makes most orders trip SEVERAL probes at once, which
 * is the only arrangement under which `scope.affectedOrders` can be shown to
 * count an order once rather than once per finding -- the whole reason that
 * figure is on the page.
 *
 * Run: npm run check:data-hygiene-paging
 */

let failures = 0;
const ok = (pass, label, detail = "") => {
  console.log(`${pass ? "PASS" : "FAIL"}: ${label}`);
  if (!pass) { if (detail) console.log(`        ${detail}`); failures += 1; }
};

/* ------------------------------------------------------------ fixture ----- */

const ORDERS = 137;

/**
 * Every order here is broken in several ways at once, which is realistic and is
 * also the point: it is what makes "counted once per order" a testable claim.
 *
 *   - no owner                  -> probe `no_owner`          (all 137)
 *   - zero contracted hours     -> probe `zero_contract`     (all 137)
 *   - no legal entity link      -> probe `unlinked_customer` (all 137)
 *   - name shares no word with the customer -> `order_name_conflict`
 *   - `Order N` repeats past 100 under the same customer -> `dupe_order_names`
 *   - 5 customer names spread over 7 Lexware numbers -> both duplicate
 *     directions fire
 */
const PROJECTS = Array.from({ length: ORDERS }, (_, i) => ({
  id: `${10000 + (i % 7)}_${String(i).padStart(5, "0")}_1_01`,
  // `Order 0`..`Order 99`, so i and i-100 collide on BOTH name and customer
  // (100 is a multiple of 5), giving a known set of duplicate-name groups.
  name: `Order ${i % 100}`,
  customer: `Acme ${i % 5}`,
  customer_legal_entity_id: null,
  owner_person_id: null,
  contract_hours: 0,
}));

/**
 * The narrowest thing that satisfies the module's read: `.select().order().range()`
 * returning `{ data, error }`. Not a mock of Supabase -- a stand-in for the one
 * call shape `readAll` makes, so a change to that shape fails here loudly rather
 * than being absorbed.
 */
function stubClient(rows, log = []) {
  return {
    from(table) {
      const call = { table, columns: null, ordered: null, ranges: [] };
      log.push(call);
      const q = {
        select: (columns) => { call.columns = columns; return q; },
        order: (column) => { call.ordered = column ?? true; return q; },
        range: (from, to) => {
          call.ranges.push([from, to]);
          return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
        },
      };
      return q;
    },
  };
}

const readLog = [];
const supabase = stubClient(PROJECTS, readLog);
const { getDataHygiene } = await import("../src/lib/queries/data-hygiene.ts");

/* ------------------------------------------------------- the base read ---- */

const base = await getDataHygiene(supabase);

ok(!base.unavailable, "the fixture produces a report", "the stub client did not satisfy readAll()");
ok(base.findings.length > 0, "the fixture fires at least one probe");
console.log(`        ${base.findings.length} finding(s): ${base.findings.map((f) => `${f.key}=${f.count}`).join(" ")}`);

ok(base.scope.orders === ORDERS, `scope counts all ${ORDERS} orders read`, `got ${base.scope.orders}`);

/*
 * The reason `affectedOrders` exists. Every order in the fixture trips at least
 * three order-level probes, so the naive sum is several times the truth; the
 * figure on the page must be the number of DISTINCT orders, which here is all of
 * them. If this ever equalled the sum, the tile would be telling an exec that
 * three times more of their order book is broken than actually is.
 */
{
  const orderFindings = base.findings.filter((f) => f.subjectKind === "order");
  const naiveSum = orderFindings.reduce((s, f) => s + f.count, 0);
  ok(
    base.scope.affectedOrders === ORDERS,
    `affectedOrders counts each order once (${base.scope.affectedOrders}), not once per finding (${naiveSum})`,
    `expected ${ORDERS}, got ${base.scope.affectedOrders}`,
  );
  ok(naiveSum > base.scope.affectedOrders,
    `the fixture really does overlap (${naiveSum} order-level rows over ${ORDERS} orders)`,
    "no overlap, so the assertion above proves nothing this run");
}

/* The house rule for every paged read in this app: `.order()` BEFORE `.range()`,
 * or Postgres is free to return a different slice each call and the pages
 * silently overlap. The stub records the call order so this is measured rather
 * than assumed. */
{
  ok(readLog.length > 0, "the module actually read something");
  const bad = readLog.filter((c) => c.ordered === null || c.ranges.length === 0);
  ok(bad.length === 0, "every read is ordered before it is ranged",
    bad.map((c) => `${c.table}: ordered=${c.ordered} ranges=${c.ranges.length}`).join(" | "));
  /*
   * The read set is pinned, not merely bounded: a probe that quietly starts
   * reading a new table through this client should fail here and be added
   * deliberately. The `time` reads never reach `from()` on this stub, which has
   * no `.schema()`, so the module files those probes as could-not-run; the two
   * direct-Postgres probes do not touch the client at all. Both outcomes are
   * pinned in check-data-hygiene-claims.
   */
  const tables = [...new Set(readLog.map((c) => c.table))].sort();
  ok(tables.join(",") === "projects",
    "the probes read the order book and nothing else through the client",
    tables.join(", "));
}

/* The default page size is part of the contract, not just its ceiling. Asserting
 * only "<= 12" leaves DEFAULT_ROWS_PER_PAGE = 1 passing every check in this file
 * while making the page unusable. */
{
  const multi = base.findings.filter((f) => f.pageCount > 1);
  ok(multi.every((f) => f.rowsPerPage === 10),
    "the default page is 10 rows, the house size for a worked queue",
    [...new Set(multi.map((f) => f.rowsPerPage))].join(", "));
  ok(multi.every((f) => f.rows.length === 10),
    "a full page really renders 10 rows",
    multi.map((f) => `${f.key}=${f.rows.length}`).join(" "));
}

/* --------------------------------------------- every row is reachable ----- */

/*
 * The load-bearing assertion. Walk every page of every multi-page finding and
 * require the union to be exactly the finding's stated total, with no row seen
 * twice. A pager that silently re-serves page 1 passes an eyeball test and fails
 * this on the second page.
 */
{
  const multi = base.findings.filter((f) => f.pageCount > 1);
  ok(multi.length > 0, "the fixture produces at least one multi-page finding",
    "nothing is paged, so every assertion below is vacuous");

  for (const f of multi) {
    const seen = [];
    let shapeOk = true;
    let shapeDetail = "";

    for (let n = 1; n <= f.pageCount; n += 1) {
      const res = await getDataHygiene(supabase, { pages: { [f.key]: n } });
      const got = res.findings.find((x) => x.key === f.key);
      if (!got) { shapeOk = false; shapeDetail = `page ${n}: finding disappeared`; break; }

      if (got.page !== n) {
        shapeOk = false;
        shapeDetail = `asked for page ${n}, got page ${got.page}`;
        break;
      }
      if (got.count !== f.count) {
        // The total must not move as the reader pages. If it did, one of the two
        // numbers on screen would be a restatement of the visible slice.
        shapeOk = false;
        shapeDetail = `count changed on page ${n}: ${f.count} -> ${got.count}`;
        break;
      }
      const expectedStart = (n - 1) * got.rowsPerPage + 1;
      if (got.rowStart !== expectedStart) {
        shapeOk = false;
        shapeDetail = `page ${n} starts at row ${got.rowStart}, expected ${expectedStart}`;
        break;
      }
      const expectedRows = n < f.pageCount
        ? got.rowsPerPage
        : f.count - (f.pageCount - 1) * got.rowsPerPage;
      if (got.rows.length !== expectedRows) {
        shapeOk = false;
        shapeDetail = `page ${n} has ${got.rows.length} rows, expected ${expectedRows}`;
        break;
      }
      seen.push(...got.rows.map((r) => r.id));
    }

    ok(shapeOk, `${f.key}: every page reports its own number, start and size`, shapeDetail);
    if (!shapeOk) continue;

    const unique = new Set(seen);
    ok(unique.size === seen.length,
      `${f.key}: no row appears on two pages (${seen.length} drawn)`,
      `${seen.length - unique.size} duplicate row id(s) across pages`);
    ok(seen.length === f.count,
      `${f.key}: paging reaches all ${f.count} rows across ${f.pageCount} pages`,
      `walked every page and saw ${seen.length} rows of ${f.count} — ${f.count - seen.length} are unreachable`);
  }
}

/* ------------------------------------------------------------ clamping ---- */

/*
 * A stale bookmark must degrade, not 404 and not render an empty table. An empty
 * table on this page reads as "nothing left to fix", which is the one lie it
 * cannot afford, so every out-of-range value has to land somewhere real.
 */
{
  const target = base.findings.find((f) => f.pageCount > 1);
  if (!target) {
    ok(false, "a multi-page finding exists to test clamping against");
  } else {
    const at = async (value) => {
      const res = await getDataHygiene(supabase, { pages: { [target.key]: value } });
      return res.findings.find((x) => x.key === target.key);
    };

    const high = await at(9999);
    ok(high.page === target.pageCount && high.rows.length > 0,
      `page 9999 clamps to the last page (${high.page} of ${target.pageCount}) and still renders rows`,
      `landed on page ${high.page} with ${high.rows.length} rows`);

    for (const junk of [0, -3, Number.NaN]) {
      const got = await at(junk);
      ok(got.page === 1 && got.rows.length > 0,
        `page ${String(junk)} clamps to page 1 and still renders rows`,
        `landed on page ${got.page} with ${got.rows.length} rows`);
    }
  }
}

/* ------------------------------------------------ the page size is a cap -- */

/*
 * `rowsPerPage` reaches the query module from a URL. Unclamped, `?rows=100000`
 * would render every finding in full and reintroduce -- through a query string --
 * exactly the unbounded page the old cap existed to prevent. 12 is the bound
 * check-data-hygiene-page asserts against the live data; it is asserted here too
 * because this run needs no credentials.
 */
{
  const huge = await getDataHygiene(supabase, { rowsPerPage: 100000 });
  const over = huge.findings.filter((f) => f.rows.length > 12);
  ok(over.length === 0, "an absurd rowsPerPage is clamped to at most 12 rows per finding",
    over.map((f) => `${f.key}: ${f.rows.length} rows`).join(" | "));

  const tiny = await getDataHygiene(supabase, { rowsPerPage: 0 });
  const empty = tiny.findings.filter((f) => f.rows.length === 0);
  ok(empty.length === 0, "rowsPerPage 0 cannot produce a finding that renders nothing",
    empty.map((f) => f.key).join(", "));
}

/* -------------------------------------- findings page INDEPENDENTLY ------- */

/*
 * Eight panels on one document, each its own list. Advancing the unowned orders
 * must not move the duplicate account numbers -- if it did, the reader would
 * lose their place in seven panels every time they used one.
 */
{
  const multi = base.findings.filter((f) => f.pageCount > 1);
  if (multi.length < 2) {
    console.log("        (only one multi-page finding in the fixture; independence untested)");
  } else {
    const [a, b] = multi;
    const res = await getDataHygiene(supabase, { pages: { [a.key]: 2 } });
    const movedA = res.findings.find((f) => f.key === a.key);
    const movedB = res.findings.find((f) => f.key === b.key);
    ok(movedA.page === 2 && movedB.page === 1,
      `paging ${a.key} to page 2 leaves ${b.key} on page 1`,
      `${a.key} on page ${movedA.page}, ${b.key} on page ${movedB.page}`);
  }
}

/* ------------------------------------------------------- the URL half ----- */

/*
 * Half the feature is the link the reader clicks, and until this section existed
 * NOTHING executed it. A typo in the param prefix, or a `linkTo` that forgot to
 * override its finding's page, would leave every PREV/NEXT changing the URL and
 * returning the same ten rows -- the exact failure this gate's header claims to
 * prevent -- while every check above stayed green, because they all call the
 * query module directly and never go near a URL.
 *
 * `parsePages` and `hrefFor` were moved out of the page component into
 * src/lib/data-hygiene-url.ts precisely so this could import them.
 */
{
  const { PAGE_PREFIX, parsePages, parseKind, hrefFor, DATA_HYGIENE_PATH } =
    await import("../src/lib/data-hygiene-url.ts");

  const paramsOf = (url) =>
    Object.fromEntries(new URL(url, "http://x").searchParams.entries());

  // The round trip. Anything that survives a write and a read is the contract.
  {
    const want = { no_owner: 3, zero_contract: 7 };
    const got = parsePages(paramsOf(hrefFor("all", want)));
    ok(JSON.stringify(got) === JSON.stringify(want),
      "page numbers survive hrefFor -> parsePages unchanged",
      `wrote ${JSON.stringify(want)}, read back ${JSON.stringify(got)}`);
  }

  // Page 1 is the default and must not be spelled out, or every link on the
  // page carries eight redundant params.
  ok(hrefFor("all", { no_owner: 1 }) === DATA_HYGIENE_PATH,
    "page 1 is omitted from the URL entirely",
    hrefFor("all", { no_owner: 1 }));

  // The prefix is what makes a page param recognisable. A typo here is
  // invisible in the markup and breaks every pager link at once.
  ok(hrefFor("all", { no_owner: 2 }).includes(`${PAGE_PREFIX}no_owner=2`),
    `the page param is namespaced ${PAGE_PREFIX}<key>`,
    hrefFor("all", { no_owner: 2 }));
  ok(Object.keys(parsePages({ page: "3", kind: "exact" })).length === 0,
    "params that are not page params are ignored",
    "an unprefixed ?page= must not be read as a finding's page");

  // Each finding must get its OWN link. If linkTo ever dropped its override,
  // every panel's NEXT would point at the same URL.
  {
    const pages = { a: 1, b: 1 };
    const urls = new Set(["a", "b"].map((k) => hrefFor("all", { ...pages, [k]: 2 })));
    ok(urls.size === 2, "advancing different findings produces different URLs",
      [...urls].join(" | "));
  }

  // A filter change resets paging (UI-CONVENTIONS rule 2): a filter defines a
  // new list, and staying on page 4 of a different one shows arbitrary rows.
  ok(!hrefFor("exact", {}).includes(PAGE_PREFIX),
    "switching the kind filter drops every page param");
  ok(parseKind({ kind: "nonsense" }) === "all" && parseKind({}) === "all",
    "an unknown kind falls back to the whole report");

  // One view, one URL.
  ok(hrefFor("all", { b: 2, a: 3 }) === hrefFor("all", { a: 3, b: 2 }),
    "the same view produces the same URL regardless of key order");

  // Junk must reach the query module, which is the single place that clamps.
  ok(JSON.stringify(parsePages({ p_no_owner: "abc" })) === "{}",
    "an unparseable page number is dropped rather than guessed at");
  ok(parsePages({ p_no_owner: ["4", "9"] }).no_owner === 4,
    "a repeated param takes its first value rather than throwing");
}

/* ------------------------------------------- page-source properties ------- */

/*
 * These read a file off disk and need no credentials, but they used to live in
 * check-data-hygiene-page.mjs BELOW its `SKIP without a service-role key` exit.
 * On a laptop and on a fork they therefore never ran, and neither did the two
 * mutations in the meta-gate that depend on them. They are asserted here, where
 * nothing can skip them.
 */
{
  const { readFileSync } = await import("node:fs");
  const page = readFileSync("src/app/(app)/data-hygiene/page.tsx", "utf8");

  ok(/searchParams/.test(page) && /getDataHygiene\(supabase, \{ pages \}\)/.test(page),
    "the page reads its page numbers from searchParams and passes them to the query",
    "paging not driven by the URL breaks the back button, refresh and shared links");
  ok(/scroll=\{false\}/.test(page) && /aria-current=\{current \? "page" : undefined\}/.test(page),
    "pager links are server-rendered <Link>s that mark the current page for assistive tech",
    "a row of anchors where the current one is merely a different colour announces as identical links");
  ok(/from "@\/lib\/data-hygiene-url"/.test(page),
    "the page uses the shared URL contract rather than a private copy",
    "a second copy of hrefFor/parsePages would not be covered by the round-trip checks above");
}

console.log(failures === 0
  ? "\nHYGIENE PAGING IS SOUND: every row reachable, pages disjoint, out-of-range clamps, panels page independently"
  : `\n${failures} paging check(s) failed`);
process.exitCode = failures === 0 ? 0 : 1;
