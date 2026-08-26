/*
 * The Factorial paging client. One helper, because every read we need is a GET
 * over a cursor-paginated list.
 *
 * WHY THIS IS ITS OWN FILE, WRITTEN BEFORE ANY CREDENTIAL EXISTS
 * -------------------------------------------------------------
 * Silent truncation is this repo's recurring bug. It has already happened twice
 * on the Supabase side: `.limit(20000)` did not defeat PostgREST's 1000-row cap
 * and reported "8 members with logged time" instead of 18, and selecting a
 * column that did not exist returned an error that an unchecked `data` then read
 * as an empty array, reporting "0 members have ever logged time"
 * (docs/live-people-data-map.md).
 *
 * A partial read is worse than a failed one, because it looks like an answer.
 * Feeding a short page into a utilisation figure produces a number that is
 * plausible, wrong, and about a named employee.
 *
 * So the paging behaviour is isolated here and tested against a fake transport
 * (see check-factorial-pager.mjs) covering the cases that actually bite: a
 * cursor that stops advancing, has_next_page lying, a missing envelope, an HTTP
 * error mid-run, and a page count that exceeds the cap. None of that needs a
 * Factorial token, so it is verified now rather than discovered in production.
 *
 * CONTRACT, from https://apidoc.factorialhr.com/docs/pagination
 * ------------------------------------------------------------
 *   limit      page size; default 100 and ALSO the maximum
 *   after_id   opaque cursor, NOT an integer -- the doc's example is base64
 *   response   { data: [...], meta: { has_next_page, end_cursor, total?, limit? } }
 *
 * `total` and `limit` are optional in the OpenAPI spec, so termination is driven
 * by has_next_page and never by counting up to `total`.
 *
 * These three query params appear ONLY in prose; they are absent from the
 * OpenAPI spec. A spec-diff gate therefore cannot catch a pagination change,
 * which is exactly why the runtime assertions below are not optional.
 */

/** Documented maximum AND default page size. Asking for more is ignored. */
export const MAX_LIMIT = 100;

/**
 * Hard ceiling on pages per resource. At 100 rows a page this is 50,000 rows,
 * far above any plausible employee-scale response.
 *
 * An unbounded loop against an API with NO documented GET rate limit (§4 of the
 * doc: only POST has a documented 200/min) is how a nightly job becomes an
 * outage. Hitting the cap returns truncated:true rather than throwing, because
 * the caller must decide -- for a weekly rollup a truncated read must be
 * discarded, not written.
 */
export const MAX_PAGES = 500;

/** Error thrown when the response is not the documented envelope. */
export class FactorialContractError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = "FactorialContractError";
    this.detail = detail;
  }
}

/**
 * Build a request URL. Array params use the documented repeated `name[]` form.
 *
 * Exported so the gate can assert URL construction without any network at all:
 * a wrong param name is a silently empty result set, which is the same class of
 * bug as a short page.
 */
export function buildUrl({ base, version, resource, params = {}, cursor = null, limit = MAX_LIMIT }) {
  const url = new URL(`${base}/api/${version}/resources/${resource}`);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      // Factorial's array convention is the repeated bracketed name. Joining
      // with commas silently filters to nothing instead of erroring.
      const key = k.endsWith("[]") ? k : `${k}[]`;
      for (const item of v) url.searchParams.append(key, String(item));
    } else {
      url.searchParams.set(k, String(v));
    }
  }
  url.searchParams.set("limit", String(Math.min(limit, MAX_LIMIT)));
  // The cursor is OPAQUE. Never parse it, never increment it, never compare it
  // to an id. The doc's own example value is base64.
  if (cursor) url.searchParams.set("after_id", cursor);
  return url;
}

/**
 * Read every page of one resource.
 *
 * @returns {Promise<{rows: object[], pages: number, truncated: boolean, total: number|null}>}
 *   `truncated` true means MAX_PAGES was reached and rows are INCOMPLETE. A
 *   caller writing derived figures must treat that as a failure, not a result.
 */
export async function fetchAllPages({
  resource,
  params = {},
  token,
  base = "https://api.factorialhr.com",
  version = "2026-07-01",
  limit = MAX_LIMIT,
  // Injected so the gate can drive this with a fake transport, and so a retry
  // policy can wrap it later without editing the loop.
  transport = globalThis.fetch,
  onPage = null,
}) {
  if (!token) throw new Error("fetchAllPages: no token. Phase 0 is not complete.");

  const rows = [];
  let cursor = null;
  let pages = 0;
  let total = null;
  const seenCursors = new Set();

  while (pages < MAX_PAGES) {
    const url = buildUrl({ base, version, resource, params, cursor, limit });

    const res = await transport(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });

    /*
     * Fail loud on a non-2xx. A caught-and-ignored error here yields a short
     * page that downstream becomes a wrong utilisation number, and the sync
     * would report success. There is no documented 429 or Retry-After for GETs,
     * so the caller's backoff has to treat any 4xx/5xx as potentially
     * rate-limiting -- which it can only do if this throws.
     */
    if (!res.ok) {
      const body = await res.text().catch(() => "(unreadable)");
      throw new FactorialContractError(
        `${resource} page ${pages}: HTTP ${res.status}`,
        body.slice(0, 500),
      );
    }

    const body = await res.json();
    const data = body?.data;
    const meta = body?.meta;

    // Validate the envelope rather than optional-chaining into silence. A
    // breaking change should surface here, at sync time, not as missing rows.
    if (!Array.isArray(data)) {
      throw new FactorialContractError(
        `${resource}: response.data is not an array`,
        `keys: ${Object.keys(body ?? {}).join(",")}`,
      );
    }
    if (!meta || typeof meta.has_next_page !== "boolean") {
      throw new FactorialContractError(
        `${resource}: response.meta.has_next_page is missing or not a boolean`,
        `meta: ${JSON.stringify(meta)}`,
      );
    }

    rows.push(...data);
    pages += 1;
    if (typeof meta.total === "number") total = meta.total;
    if (onPage) onPage({ page: pages, received: data.length, rows: rows.length, total });

    if (!meta.has_next_page) return { rows, pages, truncated: false, total };

    /*
     * has_next_page is true, so we need a cursor to advance with. Three ways
     * this goes wrong, all of them an infinite loop against a rate-limited API:
     *   - end_cursor absent
     *   - end_cursor identical to the one we just used
     *   - end_cursor we have already visited (a cycle, not just a repeat)
     */
    const next = meta.end_cursor;
    if (!next) {
      throw new FactorialContractError(
        `${resource}: has_next_page is true but end_cursor is absent`,
        `after ${pages} page(s), ${rows.length} row(s)`,
      );
    }
    if (next === cursor || seenCursors.has(next)) {
      throw new FactorialContractError(
        `${resource}: end_cursor did not advance (${next})`,
        `after ${pages} page(s), ${rows.length} row(s) — refusing to loop`,
      );
    }
    seenCursors.add(next);
    cursor = next;
  }

  // Honest signal. NOT an exception, because the caller decides: a diagnostic
  // may keep partial rows, a rollup must discard them.
  return { rows, pages, truncated: true, total };
}

/*
 * The identity classifier, shared by the baseline script and the eventual sync
 * so the two cannot disagree about who resolves.
 *
 * ADR-001: the ONLY matching input is lower(trim(email)). No dot-stripping, no
 * local-part comparison, no display-name comparison, no similarity score.
 */

/** Addresses that are inboxes, not colleagues. Terminal exclusion. */
export const SHARED_MAILBOX_RE =
  /^(info|jobs|office|kontakt|kontact|mail|hello|admin|noreply|no-reply|support)@/i;

export const normaliseEmail = (e) => String(e ?? "").trim().toLowerCase();

/**
 * Decide what happens to one Factorial employee.
 *
 * @param {object}   employee            { id, login_email, full_name, active }
 * @param {Map}      membersByEmail      normalised email -> array of time.member rows
 * @param {Set}      claimedPersonIds    people.id values already claimed by a factorial id
 * @returns {{status: string, reason: string, memberId?: number, personId?: string, count: number}}
 *   status is one of the crm.factorial_identity_review status values, plus
 *   'resolvable' for the auto-resolve case which becomes a mapping row instead.
 *
 * IMPORTANT: this returns only statuses a MACHINE may write. The terminal
 * statuses (`excluded_not_a_person`, `excluded_not_employee`) are deliberately
 * NOT returned -- see the shared-mailbox branch below.
 */
export function classifyEmployee(employee, membersByEmail, claimedPersonIds = new Set()) {
  const email = normaliseEmail(employee?.login_email);

  if (!email) {
    return { status: "unmatched", reason: "Factorial has no login email for this employee", count: 0 };
  }

  /*
   * A shared mailbox is FLAGGED, not excluded.
   *
   * This function used to return `excluded_not_a_person` here, and
   * check-factorial-classifier-schema-agree.mjs proved that would have aborted
   * the first sync: the schema's
   * factorial_identity_review_decision_needs_reviewer constraint requires
   * reviewed_by AND reviewed_at for any terminal status, and a sync has no human
   * to name.
   *
   * The constraint is right and this function was wrong. Per
   * docs/factorial-api-integration.md, an exclusion must be "a recorded decision
   * with an author rather than an accident" -- that is exactly what makes it safe
   * to be permanent. A machine that could self-authorise a terminal exclusion
   * could quietly delete a colleague from every hours figure.
   *
   * So the machine reports `ambiguous` and says WHY in the reason. A human then
   * moves it to excluded_not_a_person and their name goes on it. The row is
   * visible in the open queue until they do, which is the desired outcome: an
   * address that looks like a mailbox is worth one glance.
   */
  if (SHARED_MAILBOX_RE.test(email)) {
    return {
      status: "ambiguous",
      reason: `${email} looks like a shared mailbox, not a colleague. `
        + "Confirm and set excluded_not_a_person; a machine may not self-authorise a terminal exclusion.",
      count: 0,
    };
  }

  const hits = membersByEmail.get(email) ?? [];
  if (hits.length === 0) {
    return { status: "unmatched", reason: `no time.member carries ${email}`, count: 0 };
  }
  if (hits.length > 1) {
    return { status: "ambiguous", reason: `${hits.length} time.member rows share ${email}`, count: hits.length };
  }

  const m = hits[0];
  if (!m.hub_person_id) {
    return {
      status: "bridged_unlinked",
      reason: `member ${m.id} matches on email but has no hub_person_id`,
      memberId: m.id,
      count: 1,
    };
  }
  if (claimedPersonIds.has(m.hub_person_id)) {
    return {
      status: "ambiguous",
      reason: `${m.hub_person_id} is already claimed by another Factorial employee`,
      memberId: m.id,
      count: 1,
    };
  }
  return {
    status: "resolvable",
    reason: `exact email -> member ${m.id} -> ${m.hub_person_id}`,
    memberId: m.id,
    personId: m.hub_person_id,
    count: 1,
  };
}

/**
 * Bound a date at today. TrackingTime holds future-dated planned entries and
 * Factorial returns planned shifts, so an unbounded sum reports unworked time as
 * worked. This bug has already been fixed once in getOrgWeeks.
 *
 * Returns a real boolean, never a falsy empty string: a caller writing
 * `if (boundedAtToday(x) === false)` must not be defeated by `"" === false`
 * being untrue. A missing date is OUT of bounds -- an undated fact cannot be
 * shown to have happened before today, so including it would be a guess.
 */
export const boundedAtToday = (iso, today = new Date()) => {
  const d = String(iso ?? "").slice(0, 10);
  if (!d) return false;
  return d <= today.toISOString().slice(0, 10);
};
