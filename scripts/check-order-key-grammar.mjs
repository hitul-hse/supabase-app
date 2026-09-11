/*
 * Both order-number grammars, read one way, by everyone who reads them.
 *
 * WHY THIS GATE EXISTS. Since 2026-09-10 public.projects holds two shapes of
 * order id side by side: the 231 old ones (10275_00123_104_01) and the orders
 * the masterdata-sheet promote step inserts under the sheet's key
 * (10178_00028_1001.1_01). Four scripts parsed the old grammar by hand and
 * misread the new one without failing -- the TrackingTime bridge took "1001.1"
 * as a service segment, link-tt-round2 and the two ADR-001 gates matched
 * nothing and so quietly left new-format orders out of every comparison.
 * scripts/lib/order-key.mjs is now the one reader. This gate pins:
 *
 *   1. the two grammars, including the warehouse's odd legacy keys, and what
 *      each is NOT (no third shape, no trimming, no numbers);
 *   2. that the grammar is the staging importer's own (one definition) and
 *      round-trips the importer's deriveOrderNumber();
 *   3. against the real public.project_masterdata table in PGlite: a new-format
 *      id resolves its service THROUGH project_masterdata (number corroborated,
 *      name from the sheet); an old id takes its service number ONLY from
 *      project_masterdata and never from its 3-digit code (104 is 1001 in one
 *      row, 1000 in another); a missing row is n/a, a contradicting row is n/a;
 *   4. ADR-001: resolution is by exact project_id -- a padded id, the
 *      masterdata_key of an old order, or another order of the same customer
 *      finds nothing -- and no name is compared anywhere;
 *   5. the service-word vocabulary reaches a new-format order only through the
 *      sheet's crosswalk, and only when that crosswalk is unambiguous;
 *   6. the four former hand parsers now import the helper and carry no copy of
 *      the old-grammar parsing or of SERVICE_WORDS.
 *
 * No credentials: supabase/schema.sql and the migrations the masterdata tables
 * depend on, executed in PGlite.
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { record } from "./lib/gate-result.mjs";
import { REPO_ROOT } from "./lib/repo-root.mjs";
import {
  OLD_ORDER_KEY, NEW_ORDER_KEY, parseOrderKey, indexMasterdata, resolveOrderKey, serviceWordsFor,
  SERVICE_WORDS, MASTERDATA_SERVICE_SQL, MASTERDATA_SERVICE_COLUMNS,
} from "./lib/order-key.mjs";
import { OLD_KEY, NEW_KEY, deriveOrderNumber } from "./lib/masterdata-sheet.mjs";

let failures = 0;
const check = (label, ok, detail = "") => {
  record(ok);
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${!ok && detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};
const j = (x) => JSON.stringify(x);
const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o?.[k] ?? null]));

console.log("check-order-key-grammar: one reading of both order-number grammars\n");

/* ============================================================ 1. the grammars */
{
  const old = parseOrderKey("10275_00123_104_01");
  check("old grammar: 10275_00123_104_01 is customer 10275, AB 00123, legacy code 104, subproject 01 -- and NO service number (the legacy code is not one)",
    j(pick(old, ["grammar", "customer_number", "order_confirmation", "legacy_service_code", "subproject", "service_number", "language"]))
      === j({ grammar: "old", customer_number: "10275", order_confirmation: "00123", legacy_service_code: "104", subproject: "01", service_number: null, language: null }), j(old));
  const oddEmpty = parseOrderKey("10905_00357__01");
  const oddShort = parseOrderKey("10634_0_4_01");
  check("old grammar keeps the warehouse's odd legacy keys as they are: 10905_00357__01 (empty service part -> legacy code n/a) and 10634_0_4_01",
    oddEmpty?.grammar === "old" && oddEmpty.legacy_service_code === null && oddEmpty.customer_number === "10905"
    && oddShort?.grammar === "old" && oddShort.legacy_service_code === "4", j([oddEmpty, oddShort]));
  const neu = parseOrderKey("10178_00028_1001.1_01");
  check("new grammar: 10178_00028_1001.1_01 is customer 10178, AB 00028, service number 1001, language 1, subproject 01, no legacy code",
    j(pick(neu, ["grammar", "customer_number", "order_confirmation", "service_number", "language", "subproject", "legacy_service_code"]))
      === j({ grammar: "new", customer_number: "10178", order_confirmation: "00028", service_number: 1001, language: 1, subproject: "01", legacy_service_code: null }), j(neu));
  check("the defect this replaces, pinned: the old hand parsers misread the new grammar (third segment \"1001.1\", both regexes match nothing)",
    "10178_00028_1001.1_01".split("_")[2] === "1001.1"
    && !/^\d{5}_\d+_(\d+)_\d+$/.test("10178_00028_1001.1_01") && !/^\d{5}_\d{5}_(\d+)_/.test("10178_00028_1001.1_01"));
  const rejects = ["01.03.01", "10178_00028_1001.3_01", "10178_00028_104.1_01", "10178_00028_10001.1_01", "10178_0028_1001.1_01",
    " 10275_00123_104_01", "10275_00123_104_01 ", "10275_00123_104_1", "1027_00123_104_01", "prj-001", "", null, undefined, 10275];
  const accepted = rejects.filter((x) => parseOrderKey(x) !== null);
  check("neither grammar accepts a service code, language 3, a 3- or 5-digit service number, a short AB in a new key, padding, a one-digit subproject, a short customer, a demo id, empty, null or a number",
    accepted.length === 0, j(accepted));
}

/* ============================================ 2. one definition, the importer's */
{
  check("the grammar is the staging importer's own: masterdata-sheet.mjs's OLD_KEY / NEW_KEY are these very objects",
    OLD_KEY === OLD_ORDER_KEY && NEW_KEY === NEW_ORDER_KEY);
  const parts = { customer_number: "10275", order_confirmation_number: "AB123", service_number: 1001, language: 2, subproject_number: 3 };
  const derived = deriveOrderNumber(parts);
  const back = parseOrderKey(derived);
  check("a key the importer derives (deriveOrderNumber) parses back to its own parts",
    derived === "10275_00123_1001.2_03" && back?.grammar === "new" && back.customer_number === "10275" && back.order_confirmation === "00123"
    && back.service_number === 1001 && back.language === 2 && back.subproject === "03", j({ derived, back }));
}

/* ================================== 3-5. against the real project_masterdata */
const sql = (rel) => readFileSync(`${REPO_ROOT}/${rel}`, "utf8");
const WORLD = [
  "supabase/schema.sql",
  "supabase/migrations/20260822130000_create_customer_master_foundation.sql",
  "supabase/migrations/20260822140000_add_customer_master_legal_entity_fields.sql",
  "supabase/migrations/20260823090000_add_project_change_control.sql",
  "supabase/migrations/20260824160000_create_project_responsibility.sql",
  "supabase/migrations/20260824170000_link_project_customer_entity.sql",
  "supabase/migrations/20260826120000_projects_admit_unmeasured_hours.sql",
  "supabase/migrations/20260827080000_reassignment_moves_responsibility.sql",
  "supabase/migrations/20260903230000_project_link.sql",
  "supabase/migrations/20260910120000_masterdata_sheet_warehouse.sql",
];
const db = await new PGlite();
await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key, email text);
  do $$ begin
    if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
    if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
  end $$;
  create or replace function auth.uid() returns uuid
    language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
`);
for (const f of WORLD) await db.exec(sql(f));

// The world. Old orders promoted from the sheet keep their old id and carry the
// new key as masterdata_key; orders born in the sheet have id = new key.
const OLD_A = "10275_00123_104_01";     // legacy 104, sheet service 1001
const OLD_B = "10275_00124_104_01";     // legacy 104, sheet service 1000 -- the measured split
const OLD_E = "10300_00001_205_01";     // no masterdata row at all
const OLD_G = "10400_00001_701_01";     // legacy 701, service 1010
const OLD_H = "10400_00002_702_01";     // legacy 702, service 1010 -> 1010's crosswalk is ambiguous
const NEW_C = "10178_00028_1001.1_01";  // born in the sheet, masterdata agrees
const NEW_D = "10178_00029_1002.2_01";  // born in the sheet, no masterdata row (yet)
const NEW_F = "10300_00002_1003.1_01";  // masterdata says 1004: contradicts its own id
const NEW_I = "10400_00003_1010.1_01";  // service 1010, whose crosswalk is ambiguous
const NEW_J = "10500_00001_1001.1_01";  // masterdata row with a different customer number
const projects = [OLD_A, OLD_B, OLD_E, OLD_G, OLD_H, NEW_C, NEW_D, NEW_F, NEW_I, NEW_J];
await db.exec(`
  insert into public.projects (id, code, name, customer, lead, status, contract_hours, billable_hours, consumed_percent, logged_hours, due)
  values ${projects.map((id) => `('${id}', '${id}', 'Auftrag ${id}', 'Kunde', 'n/a', 'NORMAL', 10, 0, 0, 0, 'n/a')`).join(",\n         ")};
  insert into public.project_masterdata (project_id, masterdata_key, order_number_old, customer_number, service_number, service_name) values
    ('${OLD_A}', '10275_00123_1001.1_01', '${OLD_A}', '10275', 1001, 'Sicherheitstechnische Betreuung'),
    ('${OLD_B}', '10275_00124_1000.1_01', '${OLD_B}', '10275', 1000, 'Sicherheitstechnische Betreuung Basis'),
    ('${OLD_G}', '10400_00001_1010.1_01', '${OLD_G}', '10400', 1010, 'Unterweisung'),
    ('${OLD_H}', '10400_00002_1010.1_01', '${OLD_H}', '10400', 1010, 'Unterweisung'),
    ('${NEW_C}', '${NEW_C}', null, '10178', 1001, 'Sicherheitstechnische Betreuung'),
    ('${NEW_F}', '${NEW_F}', null, '10300', 1004, 'Brandschutz'),
    ('${NEW_I}', '${NEW_I}', null, '10400', 1010, 'Unterweisung'),
    ('${NEW_J}', '${NEW_J}', null, '10501', 1001, 'Sicherheitstechnische Betreuung');
`);

const rows = (await db.query(MASTERDATA_SERVICE_SQL)).rows;
check("MASTERDATA_SERVICE_SQL (what the bridge and the ADR-001 gate run) executes against the real project_masterdata and returns every row",
  rows.length === 8 && Object.keys(rows[0]).join(", ") === MASTERDATA_SERVICE_COLUMNS, j({ n: rows.length, cols: Object.keys(rows[0] ?? {}) }));
const index = indexMasterdata(rows);
const r = (id) => resolveOrderKey(id, index);
const svc = (id) => pick(r(id), ["service_number", "service_name", "service_source", "conflict"]);

/* ---- 3. where the service comes from */
check("a new-format id resolves its service through project_masterdata: 1001 from the key, corroborated by the row, with the sheet's service name",
  j(svc(NEW_C)) === j({ service_number: 1001, service_name: "Sicherheitstechnische Betreuung", service_source: "order_key+masterdata", conflict: null }), j(svc(NEW_C)));
check("a new-format id without a masterdata row keeps the number its key states and has NO service name (n/a, not borrowed from anywhere)",
  j(svc(NEW_D)) === j({ service_number: 1002, service_name: null, service_source: "order_key", conflict: null }), j(svc(NEW_D)));
check("an old id takes its service number from project_masterdata only: 104 -> 1001 for one order and 104 -> 1000 for another, the legacy code kept beside it",
  r(OLD_A).service_number === 1001 && r(OLD_A).service_source === "masterdata" && r(OLD_A).legacy_service_code === "104"
  && r(OLD_B).service_number === 1000 && r(OLD_B).legacy_service_code === "104", j([svc(OLD_A), svc(OLD_B)]));
check("an old id with no masterdata row has service number n/a -- never a 1001 guessed from its 104/205 code -- while its customer and legacy code still read",
  j(pick(r(OLD_E), ["customer_number", "service_number", "service_name", "service_source", "legacy_service_code"]))
    === j({ customer_number: "10300", service_number: null, service_name: null, service_source: null, legacy_service_code: "205" }), j(r(OLD_E)));
check("a masterdata row contradicting its own new-format id (1003 in the key, 1004 in the row) makes the service n/a and says why -- no pick between them",
  r(NEW_F).service_number === null && r(NEW_F).service_name === null && /1003.*1004/.test(r(NEW_F).conflict ?? ""), j(r(NEW_F)));
check("a masterdata row naming a different customer than the id makes customer AND service n/a",
  r(NEW_J).customer_number === null && r(NEW_J).service_number === null && /10500.*10501/.test(r(NEW_J).conflict ?? ""), j(r(NEW_J)));
check("the customer number is the id's first five digits in both grammars",
  r(OLD_A).customer_number === "10275" && r(NEW_C).customer_number === "10178" && r(NEW_D).customer_number === "10178");

/* ---- 4. ADR-001: exact project_id, never a neighbour */
{
  const padded = [` ${NEW_C}`, `${NEW_C} `, ` ${OLD_A}`].map((id) => r(id));
  check("ADR-001: a padded id finds no masterdata row and no service (resolution is exact, never trimmed)",
    padded.every((x) => x.has_masterdata === false && x.service_number === null && x.grammar === null), j(padded));
  const viaNewKey = r("10275_00123_1001.1_01"); // OLD_A's masterdata_key: a key, not a project id
  check("ADR-001: the masterdata_key of an old order is not a project id -- it resolves from its own grammar alone, without the old order's row or service name",
    viaNewKey.has_masterdata === false && viaNewKey.service_name === null && viaNewKey.service_source === "order_key", j(viaNewKey));
  const sibling = r("10275_00999_104_01"); // same customer as OLD_A / OLD_B, not in project_masterdata
  check("ADR-001 negative control: an old order of a customer whose OTHER orders have masterdata borrows nothing from them (service n/a)",
    sibling.customer_number === "10275" && sibling.service_number === null && sibling.service_name === null && sibling.has_masterdata === false, j(sibling));
  const helper = readFileSync(`${REPO_ROOT}/scripts/lib/order-key.mjs`, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  check("ADR-001: the helper's code reads no name column (service_name is carried, never compared)",
    !/\.(service_name|name|customer_display_name|customer_name)\s*(===|!==|==|\.includes|\.startsWith|\.test)/.test(helper)
    && !/(===|!==|==)\s*[\w.?]*\.(service_name|name)\b/.test(helper));
}

/* ---- 5. the service-word vocabulary */
{
  check("crosswalk: service 1001 is stated only with legacy code 104 in the sheet, so it maps to 104; 1010 is stated with 701 AND 702, so it maps to nothing",
    index.crosswalk.get(1001)?.legacy_service_code === "104" && index.crosswalk.get(1010)?.legacy_service_code === null
    && j(index.crosswalk.get(1010)?.codes) === j({ 701: 1, 702: 1 }), j(Object.fromEntries(index.crosswalk)));
  check("a new-format SiFa order reaches the FIXED SiFa words through the crosswalk; an old order keeps its own code's words exactly as before",
    j(serviceWordsFor(r(NEW_C))) === j(SERVICE_WORDS[104]) && r(NEW_C).legacy_code_source === "crosswalk"
    && j(serviceWordsFor(r(OLD_A))) === j(SERVICE_WORDS[104]) && r(OLD_A).legacy_code_source === "order_key"
    && j(serviceWordsFor(r(OLD_G))) === j(SERVICE_WORDS[701]), j([r(NEW_C), r(OLD_A)]));
  check("no words where the crosswalk is ambiguous (1010), absent (1002, no old row states it) or the row contradicts its id -- so the service rule cannot accept on them",
    serviceWordsFor(r(NEW_I)) === null && serviceWordsFor(r(NEW_D)) === null && serviceWordsFor(r(NEW_F)) === null
    && serviceWordsFor(resolveOrderKey(NEW_C)) === null, j([r(NEW_I), r(NEW_D)]));
  check("the bridge's key is the service number, so an old order and a new-format order of the same service land in one bucket (1001 and 1001), and the 104/1000 order in another",
    r(OLD_A).service_number === r(NEW_C).service_number && r(OLD_B).service_number !== r(OLD_A).service_number);
  let refused = null;
  try { indexMasterdata([{ project_id: OLD_A, service_number: 1 }, { project_id: OLD_A, service_number: 2 }]); } catch (e) { refused = e.message; }
  check("an index fed the same project_id twice refuses rather than keeping one", /twice/.test(refused ?? ""), refused ?? "no error");
}
await db.close();

/* ============================================= 6. the consumers use the helper */
{
  const CONSUMERS = [
    "scripts/bridge-time-to-hub.mjs",
    "scripts/link-tt-round2.mjs",
    "scripts/check-management-data.mjs",
    "scripts/check-adr001-rule-discriminates.mjs",
  ];
  // The hand parsers each consumer carried before issue #94.
  const OLD_PARSERS = [
    /split\("_"\)\s*\[\s*2\s*\]/,                       // bridge: third underscore segment
    /\\d\{5\}_\\d\{5\}_\(\\d\+\)_/,                     // link-tt-round2: codeOf
    /\\d\{5\}_\\d\+_\(\\d\+\)_\\d\+\$/,                 // the two gates: rule 3
    /\/_701_\//,                                         // adr001: the GU order by substring
    /const\s+SERVICE_WORDS\s*=/,                         // a private copy of the vocabulary
  ];
  const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const report = CONSUMERS.map((f) => {
    const src = code(readFileSync(`${REPO_ROOT}/${f}`, "utf8"));
    return { f, imports: /from\s+"\.\/lib\/order-key\.mjs"/.test(src), parsers: OLD_PARSERS.filter((re) => re.test(src)).map(String) };
  });
  check("the bridge, link-tt-round2 and both ADR-001 gates import scripts/lib/order-key.mjs",
    report.every((x) => x.imports), j(report.filter((x) => !x.imports).map((x) => x.f)));
  check("none of them still parses the old grammar by hand or keeps its own SERVICE_WORDS",
    report.every((x) => x.parsers.length === 0), j(report.filter((x) => x.parsers.length)));
  check("every consumer that reads project_masterdata over PostgREST orders before it ranges (house rule: .order() before .range())",
    ["scripts/link-tt-round2.mjs", "scripts/check-management-data.mjs"].every((f) => {
      const src = readFileSync(`${REPO_ROOT}/${f}`, "utf8");
      return /project_masterdata[\s\S]{0,200}?\.order\([\s\S]{0,40}?\.range\(/.test(src)
        || /\.order\(orderBy\)\.range\(/.test(src);
    }));
}

console.log(failures ? `\n${failures} check(s) failed` : "\nORDER KEYS: both grammars read one way, services from project_masterdata, exact keys only");
process.exit(failures ? 1 : 0);
