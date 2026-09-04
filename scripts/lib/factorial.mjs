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
  /*
   * "api-key" sends `x-api-key`; "bearer" sends `Authorization: Bearer`.
   *
   * Measured 2026-08-28 against company 157774: the API key in .env.local gets
   * HTTP 200 with x-api-key and HTTP 401 with Bearer, on the same URL. This file
   * shipped Bearer-only, so every real request it made would have failed -- and
   * its 47 fake-transport assertions all passed, because a fake transport does
   * not care what header you send it. That is the limit of a stubbed test.
   *
   * Default is api-key because that is the credential that exists. OAuth remains
   * supported for when a company token replaces it.
   */
  auth = "api-key",
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
      headers: {
        ...(auth === "bearer"
          ? { Authorization: `Bearer ${token}` }
          : { "x-api-key": token }),
        Accept: "application/json",
      },
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

/*
 * THE FIELD ALLOW-LIST — the compensating control for using an API key.
 *
 * check-factorial-auth already tells the reader this exists ("The field
 * allow-list in scripts/lib/factorial.mjs is the compensating control until
 * then, and check-factorial-harvest asserts it"). Until now neither the
 * allow-list nor that gate did. This is the missing half.
 *
 * WHY IT IS NEEDED. An API key cannot be scope-limited: it grants total access.
 * The OpenAPI schema `employees_employee` carries 54 fields, and reading the
 * list is enough to see the problem -- bank_number, swift_bic,
 * social_security_number, identifier (national ID) and identifier_expiration_date,
 * birthday_on, nationality, country_of_birth, birthplace, gender,
 * disability_percentage_cents, address_line_1/2, personal_email, phone_number.
 *
 * Two that are easy to miss and matter most:
 *   - contact_name / contact_number are the EMERGENCY CONTACT: personal data
 *     about a third party who never dealt with us at all and cannot have
 *     consented. Nothing in an hours-and-utilisation product can justify it.
 *   - postal_code, city, state, country, age_number and pronouns read as
 *     harmless metadata and are not. A partial address plus a name identifies a
 *     person, and age_number is birthday_on with one step removed.
 *
 * ALLOW, NEVER DENY. The list below names what may be kept; everything else is
 * dropped, including fields Factorial has not invented yet. A deny-list would
 * silently start storing whatever the next API version adds, which is exactly
 * the failure mode a compensating control exists to prevent.
 *
 * WHY THESE FIVE. Four are what classifyEmployee() actually reads -- see its
 * @param, `{ id, login_email, full_name, active }` -- and company_id populates
 * crm.factorial_identity_review.factorial_company_id, which is NOT NULL. Nothing
 * else in the integration reads an employee field, so nothing else is kept. Add
 * to this list only with a stated reason; every addition is a new category of
 * personal data entering the hub.
 *
 * full_name is kept for DISPLAY ONLY and must never be a matching input --
 * matching on a name is the name-similarity guess ADR-001 forbids. It exists so
 * a human working the review queue can recognise the colleague, which they
 * cannot reliably do from an id.
 */
export const EMPLOYEE_ALLOWED_FIELDS = Object.freeze([
  "id",
  "company_id",
  "login_email",
  "full_name",
  "active",
  // Employment truth, per the harvest plan (doc �7 row 1): 'active' is an
  // app-access flag, not employment status -- the owner confirmed live
  // colleagues carrying active=false. terminated_on is the honest signal:
  // null means employed.
  "terminated_on",
  "is_terminating",
]);

/**
 * Keep only the allow-listed fields of a Factorial employee.
 *
 * Returns a NEW object built by picking, not by deleting from the original: a
 * delete-based filter leaves anything it forgot, and "what did I forget" is the
 * question this function exists so nobody has to answer.
 *
 * A missing allow-listed field yields `undefined` rather than throwing. Absence
 * is a real answer from this API and the classifier already handles it (no
 * login_email -> 'unmatched'); throwing here would turn one incomplete record
 * into a failed sync for everyone.
 */
export function projectEmployee(raw) {
  const out = {};
  for (const k of EMPLOYEE_ALLOWED_FIELDS) out[k] = raw?.[k];
  return out;
}

/**
 * Fields that must NEVER survive projection, named individually so the gate can
 * assert each one rather than trusting the allow-list to be complete by
 * construction. Two independent statements of the same rule catch a typo in
 * either. Not exhaustive, and not meant to be -- the allow-list is what makes it
 * safe; this is the tripwire.
 */
export const EMPLOYEE_FORBIDDEN_FIELDS = Object.freeze([
  "bank_number", "swift_bic", "bank_number_format",
  "social_security_number", "identifier", "identifier_type",
  "identifier_expiration_date", "birthday_on", "age_number",
  "nationality", "country_of_birth", "birthplace", "gender", "pronouns",
  "disability_percentage_cents", "address_line_1", "address_line_2",
  "postal_code", "city", "state", "country",
  "personal_email", "phone_number", "birth_name",
  "contact_name", "contact_number",
  "termination_reason", "termination_observations",
]);

/*
 * CONTRACT HOURS -- the fix for the fake uniform 40h week.
 *
 * `contracts/reference_contracts` returns the contract Factorial says is in
 * force TODAY for an employee (docs/factorial-api-integration.md §5 row 2;
 * §5.2 explains the "today-shaped" semantics -- it is not history, and a
 * terminated employee still returns their last contract, so "employed" must
 * never be inferred from a contract merely existing).
 *
 * Its `working_hours` field is undocumented as to unit. The vault's Factorial
 * data plan measured it against the live API as HUNDREDTHS OF AN HOUR (4000 =
 * 40,00 h/week), cross-checked against the independently-documented
 * `working_time_percentage_in_cents`. Nothing in this repo recorded that unit
 * before now, and the vendor's own field name gives no hint of it -- so it is
 * baked into every name this integration uses for the value (`*_centihours`),
 * not left in a comment for the next reader to miss.
 *
 * The same `contracts` scope that unlocks working hours also unlocks
 * `salary_amount` / `salary_frequency` on this exact endpoint (docs §7.5) --
 * there is no way to read contract hours without the API key being
 * technically able to read salary too. Those two fields are named
 * individually in CONTRACT_FORBIDDEN_FIELDS for the same reason
 * EMPLOYEE_FORBIDDEN_FIELDS exists: the allow-list already drops them by
 * construction, and this is the tripwire that catches a typo in it.
 */

/**
 * Fetch every reference contract (the contract in force today, one per
 * employee) for the given Factorial employee ids. A thin wrapper over
 * fetchAllPages so the paging/cursor/truncation contract is enforced exactly
 * once, in one place, for every Factorial resource this integration reads.
 *
 * `employeeIds` is required and non-empty on purpose: fetching contracts for
 * employees this hub has not even mapped to a person would read personal
 * data with nowhere honest to attribute it, the opposite of minimisation.
 */
export async function fetchReferenceContracts({
  token,
  employeeIds,
  auth,
  base,
  version,
  transport,
  onPage,
}) {
  if (!Array.isArray(employeeIds) || employeeIds.length === 0) {
    throw new Error("fetchReferenceContracts: employeeIds must be a non-empty array");
  }
  return fetchAllPages({
    resource: "contracts/reference_contracts",
    params: { employee_ids: employeeIds.map(String) },
    token,
    auth,
    base,
    version,
    transport,
    onPage,
  });
}

/**
 * Fields kept from one `contracts/reference_contracts` row. Same allow-not-
 * deny discipline as EMPLOYEE_ALLOWED_FIELDS: everything not named here is
 * dropped, including salary and anything Factorial adds later.
 *
 * Named per docs/factorial-api-integration.md §5 row 2. `employee_id` is the
 * join key back to crm.factorial_person_reference.external_id; the rest are
 * exactly what contractWeeklyHours() and crm.factorial_contract_version need.
 */
export const CONTRACT_ALLOWED_FIELDS = Object.freeze([
  "employee_id",
  "working_hours",
  "working_hours_frequency",
  "working_week_days",
  "working_time_percentage_in_cents",
  "maximum_weekly_hours",
  "starts_on",
  "ends_on",
  "effective_on",
  "job_title",
  "country",
]);

/**
 * Keep only the allow-listed fields of a Factorial reference contract.
 * Builds a NEW object by picking, not by deleting from the original -- see
 * projectEmployee() for why that direction is the one that stays safe when
 * someone forgets to update it.
 */
export function projectContract(raw) {
  const out = {};
  for (const k of CONTRACT_ALLOWED_FIELDS) out[k] = raw?.[k];
  return out;
}

/**
 * Named individually so the gate can assert each one rather than trusting the
 * allow-list to be complete by construction -- the same tripwire discipline as
 * EMPLOYEE_FORBIDDEN_FIELDS. salary_amount / salary_frequency are documented
 * on THIS exact endpoint (docs §7.5): the `contracts` scope is unavoidable for
 * working hours, which makes this the load-bearing control, not a formality.
 */
export const CONTRACT_FORBIDDEN_FIELDS = Object.freeze([
  "salary_amount",
  "salary_frequency",
]);

/**
 * Convert a Factorial reference contract's raw hundredths-of-an-hour figure
 * into decimal hours per week, or `null` when the input cannot be trusted.
 *
 * Divides by 100 exactly ONCE, here, and nowhere else in this repo. Every
 * caller must go through this function -- an inlined `/100` at a call site
 * would be a second implementation of the same rule, and this repo's own
 * house pattern (the "classifier is imported, not re-implemented" comment on
 * check-factorial-identity-baseline.mjs) is that two rules which can silently
 * disagree are worse than one.
 *
 * `working_hours_frequency` is an UNDOCUMENTED enum (docs §5.2): Factorial's
 * spec gives it as a bare string with no enumerated values. Never assume
 * "week" for an unrecognised value -- defaulting like that is exactly how the
 * fake uniform 40h got created in the first place. Any frequency outside the
 * three values this integration has actually observed and handles returns
 * `null`, counted as unknown, never silently treated as weekly or as zero.
 *
 * @param {object} input
 * @param {number|string|null|undefined} input.working_hours_centihours - the
 *   raw `working_hours` value from Factorial, in hundredths of an hour (4000
 *   = 40,00 h/week). Named at the call site as a reminder of what it is.
 * @param {string|null|undefined} input.working_hours_frequency - one of
 *   "week", "day", "month" (case-insensitive); anything else yields `null`.
 * @param {string[]|string|null|undefined} input.working_week_days - Factorial
 *   is expected to return an array of working days for a `day` frequency; a
 *   comma/whitespace-separated string is also accepted. Always parsed as a
 *   SET (deduplicated), never string-compared or assumed to be 5 or 7.
 * @returns {number|null} decimal hours per week, or `null` if unconvertible.
 */
export function contractWeeklyHours({
  working_hours_centihours,
  working_hours_frequency,
  working_week_days,
}) {
  // Explicit null/undefined check BEFORE the Number() coercion: Number(null)
  // is 0 (a finite, wrong answer), while Number(undefined) is NaN. Relying on
  // Number.isFinite() alone would have silently converted a missing contract
  // value into a 0-hour week -- one JS coercion quirk away from the exact
  // "plausible wrong number" class of bug this function exists to prevent.
  if (working_hours_centihours === null || working_hours_centihours === undefined) return null;
  const centihours = Number(working_hours_centihours);
  if (!Number.isFinite(centihours)) return null;

  const hoursPerUnit = centihours / 100;
  const frequency = String(working_hours_frequency ?? "").trim().toLowerCase();

  if (frequency === "week") return hoursPerUnit;

  if (frequency === "day") {
    const days = Array.isArray(working_week_days)
      ? new Set(working_week_days.map(String))
      : new Set(String(working_week_days ?? "").split(/[,\s]+/).filter(Boolean));
    if (days.size === 0) return null;
    return hoursPerUnit * days.size;
  }

  if (frequency === "month") return (hoursPerUnit * 12) / 52;

  // Unrecognised or missing frequency: refuse to guess.
  return null;
}
