/*
 * One reading of an order number, for both grammars the warehouse now holds.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Until 2026-09-10 every order id in public.projects had one shape,
 *   10275_00123_104_01      customer(5) _ AB(5) _ legacy service code _ subproject(2)
 * and four scripts parsed it by hand: the TrackingTime bridge
 * (String(id).split("_")[2]), link-tt-round2 (/^\d{5}_\d{5}_(\d+)_/) and the two
 * ADR-001 gates (/^\d{5}_\d+_(\d+)_\d+$/ against a word table keyed on the
 * 3-digit code). Since the masterdata sheet went live (HSEHU-16), the promote
 * step also inserts orders born in the sheet, whose id is the sheet's key,
 *   10178_00028_1001.1_01   customer(5) _ AB(5) _ service number(4).language _ subproject(2)
 * Every one of those parsers misreads it -- split("_")[2] is "1001.1", the
 * regexes do not match at all -- and a parser that returns nothing does not
 * fail, it silently drops the order out of the comparison. For link-tt-round2
 * that is worse than a miss: a customer's new-format order vanishing from the
 * candidate list can make a wrong old-format order look like the unique match.
 *
 * WHAT IS AUTHORITATIVE
 * ---------------------
 *   customer number   the first five digits, in both grammars.
 *   service number    public.project_masterdata.service_number (the sheet's
 *                     "Service Nummer"), for old and new ids alike. A new-format
 *                     id also states it, and the two must agree; when they do
 *                     not, the answer is n/a, never a pick between them.
 *   service name      public.project_masterdata.service_name, only.
 *   legacy code       the third segment of an OLD id ("104"). It is NOT a
 *                     service number and is never converted into one: measured
 *                     on 2026-09-10, legacy 104 is service 1001 in 65 sheet rows
 *                     and 1000 in 4. An old id with no project_masterdata row
 *                     therefore has service_number null (n/a), not a guessed 1001.
 *
 * EXACT KEYS ONLY (ADR-001)
 * -------------------------
 * A project_masterdata row is found by project_id equal to the order id, as
 * written -- no trimming, no case folding, no fallback to the customer, the
 * order name or the masterdata_key. Nothing in this file compares names.
 *
 * THE SERVICE-WORD VOCABULARY
 * ---------------------------
 * The two ADR-001 gates accept a TT->order link on "customer agrees AND the
 * order's service is named on the TT side", with the naming words taken from a
 * FIXED table keyed on the legacy code (SERVICE_WORDS below, formerly copied
 * into both gates). The table is deliberately not learned from data, so a new
 * spelling cannot silently widen the rule. A new-format order has no legacy
 * code of its own; it reaches the table only through the sheet's own crosswalk
 * -- the sheet rows that state BOTH an old key and a service number -- and only
 * when every such row with that service number carries the SAME legacy code.
 * A service number seen with two legacy codes has no words (n/a), so the rule
 * cannot accept on it; that errs toward flagging a lawful link, never toward
 * passing a wrong one.
 */

// The grammars. The old one is deliberately loose in the middle: the warehouse
// holds "10905_00357__01" (empty service part) and "10634_0_4_01" (single
// digits), and exact-key matching takes an id as it is. These two expressions
// are THE definition -- scripts/lib/masterdata-sheet.mjs re-exports them as
// OLD_KEY / NEW_KEY, so the importer and every parser read one grammar.
export const OLD_ORDER_KEY = /^(\d{5})_(\d*)_(\d*)_(\d{2})$/;
export const NEW_ORDER_KEY = /^(\d{5})_(\d{5})_(\d{4})\.([12])_(\d{2})$/;

/**
 * Parse an order id by grammar alone, without the database.
 * Returns null for anything that is not a string in one of the two grammars.
 */
export function parseOrderKey(id) {
  if (typeof id !== "string") return null;
  let m = NEW_ORDER_KEY.exec(id);
  if (m) {
    return {
      grammar: "new",
      customer_number: m[1],
      order_confirmation: m[2],
      service_number: Number(m[3]),
      language: Number(m[4]),
      subproject: m[5],
      legacy_service_code: null,
    };
  }
  m = OLD_ORDER_KEY.exec(id);
  if (m) {
    return {
      grammar: "old",
      customer_number: m[1],
      order_confirmation: m[2] || null,
      service_number: null, // the legacy code is not a service number
      language: null,
      subproject: m[4],
      legacy_service_code: m[3] || null,
    };
  }
  return null;
}

/*
 * The one read of project_masterdata every consumer uses, so the PGlite gate
 * exercises the same columns the live scripts select. PostgREST callers use
 * MASTERDATA_SERVICE_COLUMNS with .order("project_id") before .range().
 */
export const MASTERDATA_SERVICE_COLUMNS = "project_id, order_number_old, customer_number, service_number, service_name";
export const MASTERDATA_SERVICE_SQL = `select ${MASTERDATA_SERVICE_COLUMNS} from public.project_masterdata order by project_id`;

const svcNumber = (v) => (v === null || v === undefined || v === "" ? null : Number(v));

/**
 * Index project_masterdata rows by exact project_id, and build the sheet's
 * service-number -> legacy-code crosswalk from the rows that state both.
 */
export function indexMasterdata(rows = []) {
  const byProjectId = new Map();
  const seen = new Map(); // service_number -> Map(legacy code -> rows)
  for (const r of rows) {
    if (typeof r.project_id !== "string") continue;
    if (byProjectId.has(r.project_id)) throw new Error(`project_masterdata carries project_id ${r.project_id} twice; refusing to pick one`);
    const row = {
      project_id: r.project_id,
      customer_number: r.customer_number ?? null,
      service_number: svcNumber(r.service_number),
      service_name: r.service_name ?? null,
      order_number_old: r.order_number_old ?? null,
    };
    byProjectId.set(r.project_id, row);
    if (row.service_number === null) continue;
    const legacy = parseOrderKey(row.order_number_old) ?? parseOrderKey(row.project_id);
    if (legacy?.grammar !== "old") continue;
    if (!seen.has(row.service_number)) seen.set(row.service_number, new Map());
    const codes = seen.get(row.service_number);
    const code = legacy.legacy_service_code ?? "";
    codes.set(code, (codes.get(code) ?? 0) + 1);
  }
  const crosswalk = new Map();
  for (const [service, codes] of seen) {
    const only = codes.size === 1 ? [...codes.keys()][0] : null;
    crosswalk.set(service, {
      legacy_service_code: only || null, // "" (an empty legacy part) is not a code
      codes: Object.fromEntries([...codes.entries()].sort()),
    });
  }
  return { byProjectId, crosswalk };
}

const EMPTY_INDEX = indexMasterdata([]);

/**
 * Customer number, service number, service name and legacy code of one order,
 * for either grammar. Every field that cannot be established exactly is null.
 *
 *   service_source      "order_key+masterdata" | "order_key" | "masterdata" | null
 *   legacy_code_source  "order_key" | "crosswalk" | null
 *   conflict            null, or why the id and its masterdata row disagree
 */
export function resolveOrderKey(id, index = EMPTY_INDEX) {
  const key = parseOrderKey(id);
  const md = typeof id === "string" ? index.byProjectId.get(id) ?? null : null;
  const out = {
    id,
    grammar: key?.grammar ?? null,
    customer_number: key?.customer_number ?? md?.customer_number ?? null,
    service_number: null,
    service_name: null,
    service_source: null,
    language: key?.language ?? null,
    legacy_service_code: key?.legacy_service_code ?? null,
    legacy_code_source: key?.legacy_service_code ? "order_key" : null,
    has_masterdata: md !== null,
    conflict: null,
  };

  if (md && key && md.customer_number && md.customer_number !== key.customer_number) {
    out.customer_number = null;
    out.conflict = `customer ${key.customer_number} in the id, ${md.customer_number} in project_masterdata`;
  }

  if (key?.grammar === "new") {
    if (md && md.service_number !== null && md.service_number !== key.service_number) {
      out.conflict = [out.conflict, `service ${key.service_number} in the id, ${md.service_number} in project_masterdata`].filter(Boolean).join("; ");
    } else {
      out.service_number = key.service_number;
      out.service_source = md?.service_number === key.service_number ? "order_key+masterdata" : "order_key";
    }
  } else if (md && md.service_number !== null) {
    out.service_number = md.service_number;
    out.service_source = "masterdata";
  }

  if (out.conflict) {
    // A row that contradicts its own id is not evidence for anything.
    out.service_number = null;
    out.service_source = null;
  } else {
    out.service_name = md?.service_name ?? null;
  }

  if (!out.legacy_service_code && out.grammar === "new" && out.service_number !== null) {
    const xw = index.crosswalk.get(out.service_number);
    if (xw?.legacy_service_code) {
      out.legacy_service_code = xw.legacy_service_code;
      out.legacy_code_source = "crosswalk";
    }
  }
  return out;
}

/*
 * Legacy service code -> the abbreviations that name that service on the
 * TrackingTime side. Taken from the order-number grammar, not inferred from the
 * data, so a new spelling cannot silently widen the rule. Moved here verbatim
 * from check-management-data.mjs and check-adr001-rule-discriminates.mjs, which
 * each carried an identical copy.
 */
export const SERVICE_WORDS = Object.freeze({
  101: ["sifa", "ba", "dguv"], 102: ["sifa", "fasi", "praxis"],
  104: ["sifa", "fasi", "sicherheitstechnische", "safety"], 111: ["sifa"],
  203: ["ba", "betriebsarzt", "doctor", "health"], 205: ["ba", "betriebsarzt", "arbeitsmedizin", "health", "care"],
  301: ["kk", "sifa"], 401: ["gbu", "risk", "assessment", "gefaehrdungsbeurteilung"],
  403: ["support", "hse"], 404: ["hse"], 412: ["psych", "psysch"],
  501: ["bsb", "brandschutz", "evakuierung", "brandschutzhelfer"],
  601: ["sigeko", "site"], 605: ["sigeko", "site"], 606: ["sigeko"], 60107: ["sigeko", "site"],
  701: ["gu", "grundunterweisung", "instruction", "unterweisung"],
});

/** The fixed words that name a resolved order's service, or null when none are known. */
export function serviceWordsFor(resolved) {
  const code = resolved?.legacy_service_code;
  if (!code) return null;
  return SERVICE_WORDS[Number(code)] ?? null;
}
