/*
 * Tests scripts/lib/factorial.mjs against a FAKE transport. No credential, no
 * network, no Factorial tenant.
 *
 * Why bother before Phase 0 is done: the paging loop is the highest-risk code in
 * this integration, and its failure mode is silence. A short page does not throw,
 * it produces a smaller number, and that number lands in a utilisation figure
 * about a named employee. This repo has already shipped that bug twice on the
 * Supabase side (docs/live-people-data-map.md).
 *
 * Every case below is a way the loop could quietly return the wrong row count.
 * Run: node scripts/check-factorial-pager.mjs
 */
import {
  MAX_LIMIT, MAX_PAGES, FactorialContractError,
  buildUrl, fetchAllPages, classifyEmployee, normaliseEmail,
  SHARED_MAILBOX_RE, boundedAtToday,
} from "./lib/factorial.mjs";

let failures = 0;
const check = (l, ok, d = "") => { console.log(`${ok ? "PASS" : "FAIL"}: ${l}${d ? ` — ${d}` : ""}`); if (!ok) failures += 1; };

const throws = async (label, fn, matcher) => {
  try {
    await fn();
    check(label, false, "it RETURNED instead of throwing — a silent partial read");
  } catch (e) {
    const ok = !matcher || matcher.test(e.message);
    check(label, ok, ok ? e.message.slice(0, 78) : `wrong error: ${e.message}`);
  }
};

/** A transport that serves scripted pages and records the URLs it was asked for. */
const fakeTransport = (pages) => {
  const calls = [];
  return {
    calls,
    fetch: async (url) => {
      calls.push(String(url));
      const cursor = new URL(url).searchParams.get("after_id");
      const page = pages.find((p) => (p.cursor ?? null) === cursor);
      if (!page) throw new Error(`fake transport: no scripted page for cursor ${cursor}`);
      if (page.http && page.http !== 200) {
        return { ok: false, status: page.http, text: async () => page.body ?? "boom" };
      }
      return { ok: true, status: 200, json: async () => page.body };
    },
  };
};

const row = (i) => ({ id: i, login_email: `p${i}@hs-experts.com` });

/* ============================================================ URL building */

console.log("--- URL construction (a wrong param name is an empty result, not an error)\n");

{
  const u = buildUrl({ base: "https://api.factorialhr.com", version: "2026-07-01", resource: "employees/employees" });
  check("path is /api/<version>/resources/<resource>",
    u.pathname === "/api/2026-07-01/resources/employees/employees", u.pathname);
  /*
   * The LITERAL 100, not MAX_LIMIT. Comparing the sent value against the same
   * constant that produced it passes at any value and proves nothing -- the same
   * self-referential flaw check-new-gates-can-fail.mjs caught on MAX_PAGES.
   * 100 is what the docs state is both the default AND the maximum
   * (https://apidoc.factorialhr.com/docs/pagination), so it is a fact to assert.
   */
  check("the documented page size is 100", MAX_LIMIT === 100, `MAX_LIMIT is ${MAX_LIMIT}`);
  check("limit defaults to 100", u.searchParams.get("limit") === "100", u.searchParams.get("limit"));
  check("no after_id on the first page", u.searchParams.get("after_id") === null);
}
{
  // Asking for more than the max is silently capped by the server, so cap it here
  // too rather than letting a caller believe they asked for 1000.
  const u = buildUrl({ base: "https://x", version: "v", resource: "r", limit: 1000 });
  check("an over-max limit is clamped to 100, not sent as-is",
    u.searchParams.get("limit") === "100", u.searchParams.get("limit"));
}
{
  const u = buildUrl({ base: "https://x", version: "v", resource: "r", params: { employee_ids: [7, 8, 9] } });
  const got = u.searchParams.getAll("employee_ids[]");
  check("array params use the repeated name[] form",
    got.length === 3 && got[0] === "7", JSON.stringify(got));
  check("they are NOT comma-joined (which would filter to nothing)",
    u.searchParams.get("employee_ids") === null);
}
{
  const u = buildUrl({ base: "https://x", version: "v", resource: "r", params: { a: undefined, b: null, c: 0, d: false } });
  check("undefined and null params are omitted",
    !u.searchParams.has("a") && !u.searchParams.has("b"));
  check("but 0 and false are SENT, not treated as absent",
    u.searchParams.get("c") === "0" && u.searchParams.get("d") === "false",
    "a falsy filter value is a real filter");
}
{
  const u = buildUrl({ base: "https://x", version: "v", resource: "r", cursor: "MTY=" });
  check("the cursor is passed through verbatim, base64 and all",
    u.searchParams.get("after_id") === "MTY=", u.searchParams.get("after_id"));
}

/* ============================================================ happy paging */

console.log("\n--- paging (the row count must be COMPLETE or loudly incomplete)\n");

{
  const t = fakeTransport([
    { cursor: null,  body: { data: [row(1), row(2)], meta: { has_next_page: true,  end_cursor: "c1", total: 5 } } },
    { cursor: "c1",  body: { data: [row(3), row(4)], meta: { has_next_page: true,  end_cursor: "c2", total: 5 } } },
    { cursor: "c2",  body: { data: [row(5)],         meta: { has_next_page: false, end_cursor: "c3", total: 5 } } },
  ]);
  const r = await fetchAllPages({ resource: "r", token: "t", transport: t.fetch });
  check("all pages are followed to the end", r.rows.length === 5, `${r.rows.length} rows over ${r.pages} pages`);
  check("truncated is false on a complete read", r.truncated === false);
  check("total is surfaced when present", r.total === 5, String(r.total));
  check("the second request carries the first page's end_cursor",
    t.calls[1].includes("after_id=c1"), t.calls[1]);
}
{
  // The single-page case, which is most resources most days.
  const t = fakeTransport([{ cursor: null, body: { data: [row(1)], meta: { has_next_page: false } } }]);
  const r = await fetchAllPages({ resource: "r", token: "t", transport: t.fetch });
  check("a single page stops after one request", r.rows.length === 1 && t.calls.length === 1);
  check("a missing `total` is null, not 0", r.total === null,
    "the spec marks total optional; 0 would be a fabricated count");
}
{
  const t = fakeTransport([{ cursor: null, body: { data: [], meta: { has_next_page: false, total: 0 } } }]);
  const r = await fetchAllPages({ resource: "r", token: "t", transport: t.fetch });
  check("a genuinely empty result is 0 rows and not an error", r.rows.length === 0 && r.truncated === false);
}

/* =========================================== the ways it could lie quietly */

console.log("\n--- the failure modes that would otherwise be silent\n");

await throws("a cursor that does not advance is fatal, not an infinite loop", async () => {
  const t = fakeTransport([
    { cursor: null, body: { data: [row(1)], meta: { has_next_page: true, end_cursor: null } } },
  ]);
  await fetchAllPages({ resource: "r", token: "t", transport: t.fetch });
}, /end_cursor is absent/);

await throws("a REPEATED cursor is fatal (the classic infinite page loop)", async () => {
  const t = fakeTransport([
    { cursor: null, body: { data: [row(1)], meta: { has_next_page: true, end_cursor: "c1" } } },
    { cursor: "c1", body: { data: [row(2)], meta: { has_next_page: true, end_cursor: "c1" } } },
  ]);
  await fetchAllPages({ resource: "r", token: "t", transport: t.fetch });
}, /did not advance/);

await throws("a CYCLE of cursors is fatal", async () => {
  const t = fakeTransport([
    { cursor: null, body: { data: [row(1)], meta: { has_next_page: true, end_cursor: "c1" } } },
    { cursor: "c1", body: { data: [row(2)], meta: { has_next_page: true, end_cursor: "c2" } } },
    { cursor: "c2", body: { data: [row(3)], meta: { has_next_page: true, end_cursor: "c1" } } },
  ]);
  await fetchAllPages({ resource: "r", token: "t", transport: t.fetch });
}, /did not advance/);

await throws("a missing data array is fatal, not an empty read", async () => {
  const t = fakeTransport([{ cursor: null, body: { meta: { has_next_page: false } } }]);
  await fetchAllPages({ resource: "r", token: "t", transport: t.fetch });
}, /data is not an array/);

await throws("data as an object (a single-resource shape) is fatal", async () => {
  const t = fakeTransport([{ cursor: null, body: { data: { id: 1 }, meta: { has_next_page: false } } }]);
  await fetchAllPages({ resource: "r", token: "t", transport: t.fetch });
}, /data is not an array/);

await throws("a missing meta is fatal", async () => {
  const t = fakeTransport([{ cursor: null, body: { data: [row(1)] } }]);
  await fetchAllPages({ resource: "r", token: "t", transport: t.fetch });
}, /has_next_page is missing/);

await throws("has_next_page as a STRING is fatal (truthy 'false' would end the loop early)", async () => {
  const t = fakeTransport([{ cursor: null, body: { data: [row(1)], meta: { has_next_page: "false" } } }]);
  await fetchAllPages({ resource: "r", token: "t", transport: t.fetch });
}, /not a boolean/);

await throws("an HTTP error mid-run is fatal, so the rows already read are not mistaken for all of them", async () => {
  const t = fakeTransport([
    { cursor: null, body: { data: [row(1)], meta: { has_next_page: true, end_cursor: "c1" } } },
    { cursor: "c1", http: 500, body: "upstream exploded" },
  ]);
  await fetchAllPages({ resource: "r", token: "t", transport: t.fetch });
}, /HTTP 500/);

await throws("a 429 is fatal too — there is no documented GET budget to back off against", async () => {
  const t = fakeTransport([{ cursor: null, http: 429, body: "slow down" }]);
  await fetchAllPages({ resource: "r", token: "t", transport: t.fetch });
}, /HTTP 429/);

await throws("no token is refused before any request is made", async () => {
  await fetchAllPages({ resource: "r", token: null, transport: async () => { throw new Error("should not be called"); } });
}, /Phase 0 is not complete/);

/* ------------------------------------------------- the cap must be honest */

{
  // A server that claims has_next_page forever. The loop must stop AND say so.
  let n = 0;
  const transport = async () => ({
    ok: true, status: 200,
    json: async () => { n += 1; return { data: [row(n)], meta: { has_next_page: true, end_cursor: `c${n}` } }; },
  });
  const r = await fetchAllPages({ resource: "r", token: "t", transport });

  /*
   * Assert the LITERAL 500, not MAX_PAGES.
   *
   * `r.pages === MAX_PAGES` compares the result against the same constant the
   * code under test used, so it holds at any cap and proves only that the loop
   * stopped somewhere. check-new-gates-can-fail.mjs caught exactly that: it
   * changed the cap to 3 and this gate stayed green.
   *
   * 500 pages x 100 rows is 50,000 -- far above any employee-scale response, and
   * low enough to bound a runaway job against an API with no documented GET rate
   * limit. Changing it is a real decision, so it should require editing a test.
   */
  check("the page cap is the documented 500, not merely 'some' cap",
    MAX_PAGES === 500, `MAX_PAGES is ${MAX_PAGES}`);
  check("an endless has_next_page stops at exactly 500 pages", r.pages === 500, `${r.pages} pages`);
  check("and reports truncated:true rather than pretending to be complete", r.truncated === true,
    "a rollup must discard a truncated read; it can only do that if it is told");
  check("the rows it did read are still returned for diagnosis", r.rows.length === 500);
}

/* ==================================== the classifier, shared with the sync */

console.log("\n--- identity classification (exact key only, ADR-001)\n");

const members = new Map([
  ["rency@hs-experts.com",  [{ id: 1, hub_person_id: "md-rency" }]],
  ["nobody@hs-experts.com", [{ id: 2, hub_person_id: null }]],
  ["twin@hs-experts.com",   [{ id: 3, hub_person_id: "md-a" }, { id: 4, hub_person_id: "md-b" }]],
  ["taken@hs-experts.com",  [{ id: 5, hub_person_id: "md-taken" }]],
]);
const claimed = new Set(["md-taken"]);
const status = (email) => classifyEmployee({ login_email: email }, members, claimed).status;

check("an exact match with a linked person resolves", status("rency@hs-experts.com") === "resolvable");
check("case and whitespace are normalised, not fuzzy-matched",
  status("  RENCY@HS-Experts.COM  ") === "resolvable");
check("a member with no hub_person_id queues as bridged_unlinked",
  status("nobody@hs-experts.com") === "bridged_unlinked");
check("two members on one email is ambiguous, never a pick",
  status("twin@hs-experts.com") === "ambiguous");
check("a person already claimed is ambiguous, not a second mapping",
  status("taken@hs-experts.com") === "ambiguous",
  "people.factorial_employee_id is UNIQUE; predicting this beats a mid-sync insert failure");
check("a shared mailbox is excluded as not-a-person",
  status("info@hs-experts.com") === "excluded_not_a_person");
check("a stranger is unmatched", status("who@hs-experts.com") === "unmatched");
check("a missing email is unmatched, never resolved", status(null) === "unmatched");
check("a dot inserted in the local part does NOT match",
  status("re.ncy@hs-experts.com") === "unmatched", "no dot-stripping: that is Gmail's rule, not an identity rule");
check("the same local part on another domain does NOT match",
  status("rency@example.com") === "unmatched");
check("a full name is not an email and must not match",
  status("Rency Sebastian") === "unmatched");
check("a near-miss domain does NOT match (hs-expert vs hs-experts)",
  status("rency@hs-expert.com") === "unmatched",
  "a real member carries exactly this typo, so this is not hypothetical");

// The resolvable case must carry the ids the mapping row needs.
{
  const v = classifyEmployee({ login_email: "rency@hs-experts.com" }, members, claimed);
  check("a resolvable verdict names both the member and the person",
    v.memberId === 1 && v.personId === "md-rency", JSON.stringify(v));
}

/* ------------------------------------------------------- the today bound */

console.log("\n--- the future-date bound (planned time is not worked time)\n");

const today = new Date("2026-08-26T12:00:00Z");
check("a past date is in bounds", boundedAtToday("2026-08-01", today) === true);
check("today itself is in bounds", boundedAtToday("2026-08-26", today) === true);
check("tomorrow is OUT of bounds", boundedAtToday("2026-08-27", today) === false);
check("a far-future planned entry is out of bounds", boundedAtToday("2026-12-31", today) === false,
  "TrackingTime holds entries dated 2026-12-31; an unbounded sum reports them as worked");
check("a null date is out of bounds rather than silently included",
  boundedAtToday(null, today) === false);

console.log(failures === 0
  ? `\nFACTORIAL CLIENT: pages completely or fails loudly. ${MAX_PAGES}-page cap, cursor cycles refused.`
  : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
