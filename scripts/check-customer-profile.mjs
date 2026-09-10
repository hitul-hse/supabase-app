/*
 * Does /customers/[number] stay inside the contract it was built under?
 *
 * The customer profile is the first route in the Hub that answers "who is this
 * customer". Six properties hold its shape, in the order they would fail worst:
 *
 * 1. THE KEY. It resolves on the five-digit Lexware number and nothing else
 *    (ADR-001). The route validates the segment against the table's own check
 *    constraint and 404s BEFORE any read; the query filters `.eq(
 *    "customer_number", ...)` and never a name, never a LIKE, never the legal
 *    entity id. Keying on the entity would merge accounts Lexware bills
 *    separately -- 4 entities carry more than one number.
 *
 * 2. PRIVACY. `public.project_contact` is personal data of third parties. It
 *    renders once per person in its own card and NOWHERE else: no column, no
 *    `csv:`, no tooltip, no export. Pinned in three places, because the first
 *    two alone are bypassable: the column list, the DataTable call site
 *    (`columns={orderColumns}` by name -- no spread, no concat), and the whole
 *    of CustomerOrdersTable.tsx for any contact field at all.
 *
 * 3. HONEST NULLS, AT THE ROW AS WELL AS AT THE SUM. A sum over zero measured
 *    orders is null, never 0 -- one live account holds 6 orders and 250
 *    contracted hours with 0 of 6 measured, and "0 h logged" there reads as a
 *    customer we abandoned. The two SUMS are only honest because the ROW that
 *    feeds them is, so `loggedHours` and the budget-gated `contractHours` are
 *    pinned at the row too: `?? 0` on either line survives every assertion about
 *    the sums and re-introduces exactly the figure they exist to prevent. A
 *    withheld budget is the WORDS "nicht freigegeben", never a dash: absence and
 *    refusal mean opposite things (budget-visibility.ts).
 *
 * 3b. A DEGRADED READ IS NOT AN ABSENCE. Every side read carries `failed`, and
 *    the two counts derived from those rows are absent rather than recomputed
 *    when it is set. Recomputed over the empty rows of a failed read they become
 *    "nobody is responsible for any of these orders" and "N orders carry no
 *    customer number" -- confident claims manufactured out of a network error,
 *    which is the class budget-visibility.ts's header forbids by name.
 *
 * 3c. NOTHING IS COMPUTED THAT NOBODY READS. Every field of `CustomerFigures`
 *    is rendered somewhere. A figure that is computed, documented and pinned but
 *    never drawn makes its assertion a description of the code rather than a
 *    protection of the page, and makes a correct cleanup look like a regression.
 *
 * 4. THE READ MODEL DECIDES, THE COMPONENTS DRAW. Every figure -- including
 *    `termState`, i.e. whether a contract has ended -- is computed in
 *    customer-profile.ts against the BERLIN date. A component deriving liveness
 *    would compare against the viewer's clock, so the server render and the
 *    client render could disagree on one machine.
 *
 * 5. PAGING. `.order()` before `.range()` on every paged read, so the pages are
 *    a stable partition rather than an arbitrary one.
 *
 * 6. LANGUAGE. Every string goes through the `customer` branch, present in both
 *    catalogues with the same key set, with no dead keys and no rendered
 *    English literal bypassing the catalogue.
 *
 * HOW THIS GATE PROVES IT CAN GO RED
 * ----------------------------------
 * A gate nobody has seen fail is a gate nobody knows the meaning of. Every
 * load-bearing predicate below is re-run against a DELIBERATELY BROKEN COPY of
 * the file it guards, written to os.tmpdir() and deleted at the end -- the real
 * files are never touched. If a predicate still passes on the broken copy, the
 * gate fails, because that predicate was asserting nothing.
 *
 * Static and offline: it reads source and the two catalogues, so it runs in CI
 * with no secrets and costs a second.
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { REPO_ROOT } from "./lib/repo-root.mjs";
import { record } from "./lib/gate-result.mjs";

let failures = 0;
const check = (label, ok, detail = "") => {
  record(ok);
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${detail ? `\n        ${detail}` : ""}`);
  if (!ok) failures += 1;
};

const read = (p) => readFileSync(join(REPO_ROOT, p), "utf8");
/** Comments describe intent; they must never satisfy an assertion about code. */
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const QUERY = "src/lib/queries/customer-profile.ts";
const PAGE = "src/app/(app)/customers/[number]/page.tsx";
const TABLE = "src/components/customer/CustomerOrdersTable.tsx";
const CRM_CARD = "src/components/customer/CustomerMasterRecord.tsx";
const NAV = "src/components/nav-access.ts";
const IDENTITY = "src/components/customer/CustomerIdentityCard.tsx";
const CARE = "src/components/customer/CustomerCare.tsx";
/* The ONE file allowed to render a contact's value. Everything else is checked
 * against it, which is the point: the rule is "here and nowhere else". */
const CONTACTS_CARD = "src/components/customer/CustomerContacts.tsx";

const COMPONENTS = [
  "src/components/customer/parts.tsx",
  IDENTITY,
  "src/components/customer/CustomerLocations.tsx",
  CONTACTS_CARD,
  TABLE,
  CARE,
  "src/components/customer/CustomerLinks.tsx",
  CRM_CARD,
];
const LOADING = "src/app/(app)/customers/[number]/loading.tsx";
const NEW_FILES = [QUERY, PAGE, LOADING, "src/lib/date-display.ts", ...COMPONENTS];

const raw = Object.fromEntries(NEW_FILES.map((f) => [f, read(f)]));
const src = Object.fromEntries(NEW_FILES.map((f) => [f, stripComments(raw[f])]));
const nav = stripComments(read(NAV));

/* -------------------------------------------------- the predicates, once */

/*
 * Every load-bearing assertion is a NAMED predicate over a file's source, so
 * the same function can be run against the real file and against a broken copy
 * of it. A predicate that only exists inline cannot be negatively controlled,
 * and this gate's whole claim rests on being able to show each one going red.
 */
const P = {
  guardBeforeRead: (s) => {
    const guard = s.indexOf("CUSTOMER_NUMBER_PATTERN.test(number)");
    const notFound = s.indexOf("notFound()");
    const read1 = s.indexOf("createClient(");
    const read2 = s.indexOf("getCustomerProfile(");
    const requireProfile = s.indexOf("requireProfile(");
    return (
      guard !== -1 &&
      notFound !== -1 &&
      notFound > guard &&
      read1 > notFound &&
      read2 > notFound &&
      requireProfile > notFound
    );
  },
  patternIsFiveDigits: (s) => /export const CUSTOMER_NUMBER_PATTERN = \/\^\\d\{5\}\$\/;/.test(s),
  routeGuarded: (s) => /enforceRoleRouteAccess\("\/customers"\)/.test(s),
  navAllowsCustomers: (s) => /operations: \[[^\]]*"\/customers"[^\]]*\]/.test(s),

  // Anchored to the ROSTER read specifically. `crm.lexware_customer` is filtered
  // on the same column, so an unanchored test would stay green while the roster
  // itself had been switched to a name match.
  exactKeyFilter: (s) =>
    /\.from\("project_masterdata"\)[\s\S]{0,240}\.eq\("customer_number", customerNumber\)/.test(s),
  noNameMatching: (s) => !/\.i?like\(/.test(s) && !/customer_display_name["']?\s*[,)]?\s*\)?\s*\.eq/.test(s),
  notKeyedOnEntity: (s) => !/\.eq\("customer_legal_entity_id"/.test(s),

  orderBeforeRange: (s) => {
    // Every `.range(` must have an `.order(` earlier in the same builder chain.
    // A chain starts at `.from(` / `.rpc(`; anything before that belongs to a
    // different statement and must not count.
    const chains = s.split(/\.from\(/).slice(1);
    return chains.every((chain) => {
      const range = chain.indexOf(".range(");
      if (range === -1) return true;
      const order = chain.indexOf(".order(");
      return order !== -1 && order < range;
    });
  },

  budgetAware: (s) => /budgetAwareColumns\(PROJECT_COLUMNS, canSeeBudgets\)/.test(s),
  noStatusColumn: (s) => /const PROJECT_COLUMNS =\s*\n?\s*"[^"]*";/.test(s) &&
    !/const PROJECT_COLUMNS =\s*\n?\s*"[^"]*\bstatus\b[^"]*";/.test(s),
  loggedNullWhenUnmeasured: (s) =>
    /loggedHours:\s*measured\.length === 0 \? null : round1\(/.test(s),
  contractNullWhenUnbudgeted: (s) =>
    /contractHours:\s*budgeted\.length === 0 \? null : round1\(/.test(s),
  /*
   * THE ROW, NOT ONLY THE SUM. Both sums above are computed by filtering on
   * `!== null`, so `numOrNull(p.logged_hours) ?? 0` leaves every assertion about
   * them green while the page reports "0,0 h -- gemessen für 6 von 6
   * Aufträgen" for the account with six unlinked orders. The same is true of
   * the budget: dropping `canSeeBudgets ?` puts a withheld figure back into the
   * payload, and `budgetOrNull` is what keeps a stored 0 from becoming a budget.
   */
  rowLevelNulls: (s) =>
    /loggedHours: numOrNull\(p\.logged_hours\),/.test(s) &&
    /contractHours: canSeeBudgets \? budgetOrNull\(p\.contract_hours\) : null,/.test(s),
  /*
   * The gap is defined on the ROLE TABLE. Testing only that the strings
   * "project_responsibility" and "responsibleProjectIds" appear leaves the set
   * free to be rebuilt from `m.responsible_person_id`, which reports 92 gaps
   * where the role table reports 23 (both re-measured live on 2026-09-10).
   */
  responsibleFromRoleTable: (s) =>
    /const responsibleProjectIds = new Set\(\s*responsibilities\.rows\s*\.filter\(\(r\) => r\.role === "responsible"\)\s*\.map\(\(r\) => r\.project_id\),?\s*\);/.test(s),
  /* Every degrading read reports whether it failed, and the catch says so. */
  sideReadCarriesFailure: (s) =>
    /Promise<\{ rows: Row\[\]; truncated: boolean; failed: boolean \}>/.test(s) &&
    /\} catch \{\s*return \{ rows: \[\], truncated: false, failed: true \};\s*\}/.test(s),
  /* ... and the two counts derived from those rows are ABSENT when it did. */
  gapAbsentOnFailedRead: (s) =>
    /ordersWithoutResponsible: responsibilities\.failed\s*\?\s*null\s*:\s*orders\.filter\(\(o\) => !responsibleProjectIds\.has\(o\.id\)\)\.length,/.test(s),
  siblingCountAbsentOnFailedRead: (s) =>
    /if \(md\.failed\) return \{ unnumbered: null, numbers: \[\], truncated: true, failed: true \};/.test(s) &&
    /catch \{\s*return \{ unnumbered: null, numbers: \[\], truncated: false, failed: true \};/.test(s),
  /*
   * A lost read fires the same footnote as a read that was cut short. Anchored on
   * `loadFailed: false,` so this reads the PROFILE's own truncated expression and
   * not one of the six the reads return along the way.
   */
  everyDegradationIsStated: (s) => {
    const expr = /loadFailed: false,\s*truncated:([\s\S]*?),\n\s*\};/.exec(s)?.[1] ?? "";
    return [
      "roster.truncated",
      "projects.truncated",
      "contacts.truncated",
      "contacts.failed",
      "links.truncated",
      "links.failed",
      "responsibilities.truncated",
      "responsibilities.failed",
      "siblings.truncated",
      "siblings.failed",
    ].every((f) => expr.includes(f));
  },
  /* The Betreuung card renders the unknown case as its own sentence. */
  careStatesTheUnknownGap: (s) =>
    /ordersWithoutResponsible === null \|\| ordersWithoutResponsible > 0 \?/.test(s) &&
    /ordersWithoutResponsible === null\s*\?\s*t\("care\.gapUnknown"\)/.test(s),
  /* A failed contact or link read is a failure, not "nothing recorded". */
  emptyStateNamesTheFailure: (s) => /unavailable \? t\("[a-z]+\.unavailable"\) : t\("[a-z]+\.none"\)/.test(s),
  /* The service name reaches the table AS WRITTEN, never bucketed by substring. */
  serviceNameAsWritten: (s) =>
    /serviceName: textOrNull\(m\.service_name\),/.test(s) && !/canonicalService/.test(s),
  termStateOnServer: (s) =>
    /termState:\s*contractEnd === null \? "unknownEnd" : contractEnd < today \? "ended" : "running"/.test(s) &&
    /todayInBerlin\(\)/.test(s),
  masterFourStates: (s) =>
    /masterState:\s*!isExec \? "withheld" : master === undefined \? "unavailable" : master === null \? "none" : "present"/.test(s),
  masterFailReturnsUndefined: (s) => /\} catch \{\s*return undefined;\s*\}/.test(s),

  columnsByName: (s) => /columns=\{orderColumns\}/.test(s),
  columnsNotSpliced: (s) => !/columns=\{\[/.test(s) && !/orderColumns\.concat/.test(s) && !/\.\.\.orderColumns/.test(s),
  noContactField: (s) => !/\bcontacts?\b|\.phone\b|\.email\b|project_contact|telHref|mailto:/.test(s),
  /*
   * The same rule for every OTHER surface. `noContactField` bans the word
   * outright, which the orders table can afford and the page cannot: the page
   * has to hand `contacts={data.contacts}` to the card that renders them. So
   * this bans a contact's VALUE -- the fields, the anchors, and any traversal of
   * the array -- while leaving the plumbing legal.
   */
  noContactValue: (s) =>
    !/\.phone\b|\.email\b|project_contact|telHref|mailto:|\bcontacts\s*\.\s*(?:map|forEach|filter|reduce|slice|join|flatMap)\b|\bcontacts\[/.test(s),
  contractColumnGuarded: (s) => /if \(!budgetsWithheld\) \{\s*cols\.push\(\{\s*key: "contract"/.test(s),
  bothStateBranches: (s) => /orders\.status\.historical/.test(s) && /unknownEnd/.test(s),

  crmWithheldHasReason: (s) =>
    /state === "withheld"\s*\?\s*\{ label: t\("crm\.withheldLabel"\), body: t\("crm\.withheldBody"\) \}/.test(s),
  crmDistinguishesNoneFromUnavailable: (s) =>
    /t\("crm\.none"\)/.test(s) && /t\("crm\.unavailable"\)/.test(s),

  withheldTileIsWords: (s) =>
    /profile\.budgetsWithheld \? \(\s*<WithheldTile/.test(s) &&
    /t\("tiles\.withheld"\)/.test(s),

  /*
   * EVERY FIGURE IS DRAWN. Three fields of CustomerFigures once shipped
   * computed, documented at length and pinned by this gate, and rendered by
   * nothing -- so two assertions here described the code instead of protecting
   * the page, and a correct cleanup would have read as a regression. The type is
   * the list; the rendered files are the proof.
   */
  figuresAllRendered: (s) => {
    const block = /export type CustomerFigures = \{([\s\S]*?)\n\};/.exec(s)?.[1] ?? "";
    const fields = [...block.matchAll(/^ {2}([A-Za-z][A-Za-z0-9]*)\??:/gm)].map((m) => m[1]);
    if (fields.length < 8) return false;
    const drawn = [PAGE, ...COMPONENTS].map((f) => src[f]).join("\n");
    return fields.every((f) => new RegExp(`\\bfigures\\.${f}\\b`).test(drawn));
  },
};

/* ------------------------------------------------------------- 1. the key */

console.log("\n--- 1. the five-digit Lexware number, and nothing else (ADR-001)\n");

check(
  "the route validates the segment and calls notFound() BEFORE any read",
  P.guardBeforeRead(src[PAGE]),
  "project_masterdata.customer_number carries check (customer_number ~ '^[0-9]{5}$'), so a failing segment cannot name a row and needs no round trip",
);
check(
  "the pattern IS the table's check constraint, exported once and shared",
  P.patternIsFiveDigits(src[QUERY]) && /CUSTOMER_NUMBER_PATTERN/.test(src[PAGE]),
  "a second copy of the regex in the page is a second thing to get wrong",
);
check(
  "the roster is filtered on an EXACT customer number",
  P.exactKeyFilter(src[QUERY]),
);
check(
  "no name matching anywhere in the query (no ilike, no like)",
  P.noNameMatching(src[QUERY]),
  "ADR-001: the number is the identity; name similarity is what the rule exists to forbid",
);
check(
  "the profile is NOT keyed on the legal entity id",
  P.notKeyedOnEntity(src[QUERY]),
  "119 numbers sit on 119 distinct entities, but 4 entities carry several numbers -- keying on the entity would merge accounts Lexware bills apart",
);
check(
  "the customers whose orders carry no number are counted, never invented",
  /siblingUnnumberedOrders/.test(src[QUERY]) && /orders\.footnote\.unnumbered/.test(src[TABLE]),
  "20 of 242 orders have no number and can belong to no profile; the count is a footnote, never folded into a figure",
);

/* -------------------------------------------------------- 2. route access */

console.log("\n--- 2. the page is reachable by the role it was built for\n");

check("the route guards on its own root", P.routeGuarded(src[PAGE]));
check(
  "ROLE_ROUTE_ALLOWLIST.operations carries /customers",
  P.navAllowsCustomers(nav),
  "without it enforceRoleRouteAccess redirects all six operations accounts to /my-work and the page is invisible to its audience",
);
check(
  "the page adds NO permission gate beyond the session",
  !/requirePermission\(/.test(src[PAGE]) && !/PROJECTS_READ_ALL/.test(src[PAGE]),
  "projects:read_all would lock out operations, employee and project_manager -- 15 of 23 accounts -- from the page built for them",
);
check(
  "the order code links to /orders/[id] only for a reader who holds projects:read_all",
  /canOpenOrder \? \(/.test(src[TABLE]) && /PERMISSIONS\.PROJECTS_READ_ALL/.test(src[QUERY]),
  "a link that lands on a refusal panel is worse than no link",
);

/* ------------------------------------------------------------ 3. privacy */

console.log("\n--- 3. contacts render in their own card and nowhere else\n");

check(
  "no contact field appears ANYWHERE in the orders table",
  P.noContactField(src[TABLE]),
  "not a column, not a csv callback, not a tooltip -- the CSV is what would ship a contact list to every download",
);
const csvBodies = [...src[TABLE].matchAll(/csv:\s*\(r\)\s*=>[\s\S]*?(?=\n\s*(?:cell|title|search|compare|className|compact|align|descFirst|nullish|header|key):|\n\s*\}\s*[,)])/g)].map((m) => m[0]);
check(
  "the column list carries csv callbacks to inspect",
  csvBodies.length >= 5,
  `${csvBodies.length} csv callbacks found`,
);
check(
  "no csv callback reads a contact field",
  csvBodies.every((b) => P.noContactField(b)),
);
check(
  "the DataTable takes its pinned column list BY NAME (no spread, no concat at the call site)",
  P.columnsByName(src[TABLE]) && P.columnsNotSpliced(src[TABLE]),
  "a column spliced in at the JSX call site never enters the array above; this is the pin that sees it",
);
const mentions = (id) => (src[TABLE].match(new RegExp(`\\b${id}\\b`, "g")) ?? []).length;
check(
  "orderColumns appears exactly twice: its definition and its DataTable prop",
  mentions("orderColumns") === 2,
  `orderColumns x${mentions("orderColumns")}`,
);
check(
  "the contacts card states the privacy rule on screen",
  /t\("contacts\.privacy"\)/.test(src[CONTACTS_CARD]),
  "the reader should be able to see the promise, not only rely on it",
);
/*
 * THE RULE IS "HERE AND NOWHERE ELSE", SO IT IS CHECKED EVERYWHERE ELSE.
 * Pinning only the orders table left the page and the other five cards free to
 * render a phone number or an e-mail address. `contacts={data.contacts}` on the
 * page is plumbing and stays legal; a contact's VALUE is what may not appear.
 */
const contactValueLeaks = [PAGE, ...COMPONENTS].filter(
  (f) => f !== CONTACTS_CARD && !P.noContactValue(src[f]),
);
check(
  "no contact VALUE is rendered outside the contacts card -- not on the page, not in any other card",
  contactValueLeaks.length === 0,
  contactValueLeaks.join(", "),
);

/* ------------------------------------------------------------ 4. columns */

console.log("\n--- 4. the column set, pinned\n");

const keysIn = (block) => [...block.matchAll(/key: "([A-Za-z]+)"/g)].map((m) => m[1]).sort();
const ORDER_KEYS = ["contract", "logged", "responsible", "service", "status", "term"];
check(
  "the orders table carries exactly its six pinned columns",
  keysIn(src[TABLE]).join(",") === ORDER_KEYS.join(","),
  keysIn(src[TABLE]).join(", "),
);
check(
  "the VERTRAGSSTUNDEN column is omitted when budgets are withheld, not blanked",
  P.contractColumnGuarded(src[TABLE]),
  "nine rows of the words 'nicht freigegeben' say nothing the withheld tile has not; a column never built cannot leak into the CSV",
);
check(
  "the omission is STATED in a footnote rather than being silent",
  /orders\.footnote\.budgets/.test(src[TABLE]),
);
check(
  "both rarely-exercised state branches exist in source",
  P.bothStateBranches(src[TABLE]),
  "0 rows are 'historical' today and every order but 7 has an end date, so source is the only place these can be pinned",
);

/* ------------------------------------------------------- 5. honest nulls */

console.log("\n--- 5. unknown, zero and withheld are three different renderings\n");

check(
  "a sum over zero measured orders is null, never 0",
  P.loggedNullWhenUnmeasured(src[QUERY]),
  "one live account holds 6 orders and 250 contracted hours with 0 of 6 measured; '0 h logged' there reads as a customer we abandoned",
);
check(
  "contracted hours are null when nobody recorded any, never 0",
  P.contractNullWhenUnbudgeted(src[QUERY]),
);
check(
  "the ROW that feeds both sums is null-honest too",
  P.rowLevelNulls(src[QUERY]),
  "`numOrNull(p.logged_hours) ?? 0` leaves every assertion about the SUMS green while the tile reports '0,0 h -- gemessen für 6 von 6 Aufträgen' on the account with six unlinked orders, and its coverage clause silently becomes 6/6",
);
check(
  "the budget is redacted at the row, where the column becomes a field",
  /contractHours: canSeeBudgets \? budgetOrNull\(p\.contract_hours\) : null,/.test(src[QUERY]),
  "redacted once, so no downstream sum, CSV column or component can reconstruct it -- and budgetOrNull keeps a stored 0 from becoming a zero budget",
);
check(
  "the withheld budget tile carries WORDS, not the absence glyph",
  P.withheldTileIsWords(src[IDENTITY]),
  "StatTile renders null as an em dash, which means ABSENT; a refusal is not an absence",
);
check(
  "the hours figure always carries its coverage clause",
  /tiles\.loggedHint/.test(src[IDENTITY]) && /measured: figures\.loggedMeasuredOrders/.test(src[IDENTITY]),
  "a bare total invites the reader to divide by the full contract and conclude a burn nobody measured",
);
check(
  "no burn percentage is computed anywhere on the page",
  COMPONENTS.every((f) => !/consumed|burnPercent|\* 100/.test(src[f])),
  "a customer-level burn across 57%-partial hour coverage is the plausible wrong number budget-visibility.ts exists to prevent",
);

/* ------------------------------------- 6. the read model decides, not the UI */

console.log("\n--- 6. every figure comes from the read model\n");

check(
  "contract liveness is decided on the SERVER against the Berlin date",
  P.termStateOnServer(src[QUERY]),
  "a component comparing against the viewer's clock would let the server render and the client render disagree",
);
check(
  "no customer component derives today, sums hours, or reads a raw database column",
  COMPONENTS.every((f) => !/todayInBerlin|\.reduce\(|contract_hours|logged_hours/.test(src[f])),
  COMPONENTS.filter((f) => /todayInBerlin|\.reduce\(|contract_hours|logged_hours/.test(src[f])).join(", "),
);
check(
  "the figures the page renders are declared as one type in the query layer",
  /export type CustomerFigures = \{/.test(src[QUERY]) && /figures: CustomerFigures;/.test(src[QUERY]),
);
check(
  "the service name reaches the table AS WRITTEN, never bucketed by substring",
  P.serviceNameAsWritten(src[QUERY]),
  "canonicalService() buckets by substring (key.includes('brandschutz')) -- name similarity, forbidden by ADR-001 -- and maps anything unmatched to 'Nicht zugeordnet'",
);
check(
  "'no responsible' is counted from public.project_responsibility, not from the masterdata person column",
  /"project_responsibility"/.test(src[QUERY]) && P.responsibleFromRoleTable(src[QUERY]),
  "64 rows record responsible_kind='doctor' with a null person id; the masterdata column reports 92 gaps live where the role table reports 23. The set has to be BUILT from the role rows, not merely mentioned near them",
);
check(
  "every field of CustomerFigures is rendered somewhere",
  P.figuresAllRendered(src[QUERY]),
  "a figure computed, documented and pinned but drawn nowhere turns its assertion into a description of the code, and makes deleting it look like a regression",
);

/* ------------------------------- 6b. a degraded read is not an absence */

console.log("\n--- 6b. a read that FAILED never renders as a fact about the customer\n");

check(
  "every side read reports whether it failed",
  P.sideReadCarriesFailure(src[QUERY]),
  "`{rows: []}` from a caught error and `{rows: []}` from a customer with no contacts are the same value and opposite facts",
);
check(
  "the responsibility gap is ABSENT, not recomputed, when the role table could not be read",
  P.gapAbsentOnFailedRead(src[QUERY]),
  "over an empty row set the count equals orders.length, which the card renders as 'auf keinem dieser Aufträge ist jemand verantwortlich benannt' -- directly under the carers it just listed by name",
);
check(
  "the unnumbered-sibling count is ABSENT, not recomputed, when its sub-read failed",
  P.siblingCountAbsentOnFailedRead(src[QUERY]),
  "over an empty masterdata sub-read every sibling order counts as unnumbered, and the footnote states it as a fact",
);
check(
  "EVERY degraded read fires the 'the figures are floors' footnote, not only the two that page",
  P.everyDegradationIsStated(src[QUERY]),
  "a read cut short and a read lost outright are the same fact to a reader",
);
check(
  "the Betreuung card gives the unknown gap its own sentence",
  P.careStatesTheUnknownGap(src[CARE]),
  "null is a fact about the READ; 'nobody at all' is a claim about the customer",
);
for (const f of [CONTACTS_CARD, "src/components/customer/CustomerLinks.tsx"]) {
  check(
    `${f.split("/").pop()}: a failed read reads as a failure, not as 'nothing recorded'`,
    P.emptyStateNamesTheFailure(src[f]),
  );
}
check(
  "the collapsed links panel does not count the rows a failed read returned",
  /data\.linksUnavailable\s*\?\s*t\("links\.summaryUnavailable"\)/.test(src[PAGE]),
  "a collapsed panel is read INSTEAD of the card behind it, so '0 Links' there is the same lie one level up",
);
check(
  "colleague names resolve through org_chart_nodes, never public.people",
  /\.from\("org_chart_nodes"\)/.test(src[QUERY]) && !/\.from\("people"\)/.test(src[QUERY]),
  "can_view_person() hides people from a non-exec caller; the identity view is not hidden",
);

/* -------------------------------------------------------------- 7. paging */

console.log("\n--- 7. .order() before .range() on every paged read\n");

check(
  "every builder chain that ranges has ordered first",
  P.orderBeforeRange(src[QUERY]),
  "an unordered paged read returns an arbitrary partition, not a stable one",
);
check(
  "the two reads the page cannot survive without are NOT caught",
  (() => {
    const roster = /async function fetchRoster\([\s\S]*?\n\}/.exec(src[QUERY])?.[0] ?? "";
    const projects = /async function fetchRosterProjects\([\s\S]*?\n\}/.exec(src[QUERY])?.[0] ?? "";
    return roster.length > 0 && projects.length > 0 && !/try \{/.test(roster) && !/try \{/.test(projects);
  })(),
  "swallowing these would render 'no orders' to a reader with nine of them -- the lie /my-work shipped once",
);
check(
  "losing a side table costs its section, not the page -- and the section is TOLD",
  /\} catch \{\s*return \{ rows: \[\], truncated: false, failed: true \};\s*\}/.test(src[QUERY]),
  "without `failed` the empty result is indistinguishable from a customer who has none, and every caller renders a sentence about that emptiness",
);
check(
  "the budget column is omitted from the wire, not blanked after the fetch",
  P.budgetAware(src[QUERY]),
);
check(
  "projects.status is never selected (it is contract_hours in disguise)",
  P.noStatusColumn(src[QUERY]),
  "refresh-order-hours.mjs derives it from consumed%, so beside a visible logged_hours it is a two-sided bound on the withheld budget",
);

/* ------------------------------------------------- 8. the four crm states */

console.log("\n--- 8. the master record is always present, in one of four states\n");

check(
  "the query distinguishes all four states in one expression",
  P.masterFourStates(src[QUERY]),
);
check(
  "a FAILED crm read returns undefined, distinct from the null that means 'no row'",
  P.masterFailReturnsUndefined(src[QUERY]),
  "'could not be read' and 'does not exist' are different sentences and must not collapse",
);
check(
  "the withheld branch renders a REASON, never nothing",
  P.crmWithheldHasReason(src[CRM_CARD]),
  "a blank card would let a reader infer that no record exists; under exec-only RLS the page cannot know that",
);
check(
  "'no record' and 'could not be read' use different keys",
  P.crmDistinguishesNoneFromUnavailable(src[CRM_CARD]),
);
check(
  "the crm read runs on the reader's own session, never a service role",
  /crmSchema\(supabase\)/.test(src[QUERY]) && !/SERVICE_ROLE/.test(src[QUERY]),
  "the exec-only policy IS the enforcement; a service key would make it decorative",
);

/* ------------------------------------------------------ 9. terminal states */

console.log("\n--- 9. five terminal states, five different sentences\n");

const cat = Object.fromEntries(["en", "de"].map((l) => [l, JSON.parse(read(`messages/${l}.json`))]));
const at = (o, p) => p.split(".").reduce((x, s) => (x && typeof x === "object" ? x[s] : undefined), o);
const TERMINALS = [
  "customer.empty.invisible.title",
  "customer.empty.unknown.title",
  "customer.empty.noOrders.title",
  "customer.empty.unchecked.title",
  "customer.empty.failed.title",
];
for (const lang of ["de", "en"]) {
  const texts = TERMINALS.map((k) => at(cat[lang], k));
  check(
    `the five terminal titles all exist and are all different in ${lang}.json`,
    texts.every((s) => typeof s === "string" && s.length > 0) && new Set(texts).size === TERMINALS.length,
    texts.join(" | "),
  );
}
check(
  "a failed read is checked BEFORE the empty states, so it can never be mistaken for one",
  src[PAGE].indexOf("data.loadFailed") < src[PAGE].indexOf("data.orders.length === 0"),
);
check(
  "the non-exec empty state makes no claim about whether the number exists",
  /empty\.invisible\.description/.test(src[PAGE]) &&
    /Ob es die Nummer gibt, sagt diese Seite nicht/.test(at(cat.de, "customer.empty.invisible.description")),
  "under can_view_project() a customer you may not see and one that is not there are the same absence",
);
check(
  "only an exec is ever told a number is unknown",
  /isExec\s*$/m.test(src[PAGE]) || /!isExec\s*\?/.test(src[PAGE]),
  "only an exec can read the evidence for that sentence",
);

/* ---------------------------------------------------------- 10. language */

console.log("\n--- 10. one customer branch, two catalogues, the same keys\n");

const flatten = (obj, prefix = "", out = []) => {
  for (const [k, v] of Object.entries(obj ?? {})) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out.push(path);
    else if (v && typeof v === "object") flatten(v, path, out);
  }
  return out.sort();
};
const enKeys = flatten(cat.en.customer);
const deKeys = flatten(cat.de.customer);
check("customer.* exists in en.json", enKeys.length > 0, `${enKeys.length} keys`);
check("customer.* exists in de.json", deKeys.length > 0, `${deKeys.length} keys`);
check(
  "the two branches hold the same key set",
  enKeys.join("|") === deKeys.join("|"),
  enKeys.join("|") === deKeys.join("|")
    ? ""
    : `en only: ${enKeys.filter((k) => !deKeys.includes(k)).join(", ")} | de only: ${deKeys.filter((k) => !enKeys.includes(k)).join(", ")}`,
);
/*
 * A handful of strings are legitimately identical in both catalogues -- a brand
 * name, a word English borrowed, a date range template. They are listed so the
 * next one has to be argued rather than absorbed.
 */
const SAME_IN_BOTH = new Set([
  "care.onOrders",
  "crm.summary.present",
  "language.en",
  "links.onOrders",
  "links.title",
  "orders.col.status",
  "orders.termRange",
]);
const untranslated = deKeys.filter(
  (k) => !SAME_IN_BOTH.has(k) && at(cat.en.customer, k) === at(cat.de.customer, k),
);
check(
  "the German branch is German, not a copy of the English",
  untranslated.length === 0,
  untranslated.join(", "),
);

const referenced = [
  ...new Set(
    [PAGE, LOADING, ...COMPONENTS].flatMap((f) => [...src[f].matchAll(/\bt\("([^"$]+)"/g)].map((m) => m[1])),
  ),
].sort();
const missing = referenced.filter((k) => !enKeys.includes(k));
check(
  "every literal customer.* key the page asks for exists in both catalogues",
  referenced.length >= 40 && missing.length === 0,
  missing.length ? `missing: ${missing.join(", ")}` : `${referenced.length} literal keys referenced`,
);
/*
 * Dynamic keys -- t(`orders.status.${state}`) -- cannot be resolved statically,
 * so their branches are named here and every leaf under them is treated as
 * referenced. Listing the prefixes is the price of using them at all.
 */
const DYNAMIC_PREFIXES = ["orders.status", "crm.summary", "language"];
const isReferenced = (k) => referenced.includes(k) || DYNAMIC_PREFIXES.some((p) => k.startsWith(`${p}.`));
const stale = enKeys.filter((k) => !isReferenced(k));
check("no dead strings in the branch", stale.length === 0, stale.join(", "));

/*
 * PLURALS ARE THE HOUSE CONVENTION, NOT A NEW IDEA. de.json already carries 47
 * ICU plural forms. Interpolating {count} into hard-coded plural German reads as
 * a translation on live data: 16 accounts hit `care.gap` with count 1 ("1 von 3
 * Aufträgen HABEN"), 28 render `links.summary` as "1 Links", 7 legal entities
 * carry exactly one unnumbered sibling, and one account resolves to "1
 * Personen" -- all four re-measured against production on 2026-09-10.
 */
const pluralOffenders = [];
for (const lang of ["de", "en"]) {
  for (const k of flatten(cat[lang].customer)) {
    const v = at(cat[lang].customer, k);
    if (/\{count\}/.test(v) && !/\{count,\s*plural,/.test(v)) pluralOffenders.push(`${lang}:${k}`);
  }
}
check(
  "every count-bearing customer.* string carries an ICU plural form",
  pluralOffenders.length === 0,
  pluralOffenders.join(", "),
);

/* ------------------------------------------------------- 11. house tokens */

console.log("\n--- 11. house tokens in every new file\n");

for (const f of NEW_FILES) {
  const name = f.split("/").pop();
  check(
    `${name}: type through the roles only`,
    !/text-\[\d+(?:\.\d+)?px\]|\btext-(?:xs|sm|base|lg|xl|2xl)\b/.test(src[f]),
  );
  check(`${name}: no hex colour and no var() fallback literal`, !/#[0-9a-fA-F]{3,8}\b/.test(src[f]) && !/var\(--[a-z-]+,\s*#/.test(src[f]));
  /*
   * Measured on the CODE, not on the comments. German prose in a header comment
   * is documentation and carries umlauts by right; what this forbids is a glyph
   * standing in for an icon, or a German string literal that bypassed the
   * catalogue -- both of which live in the code.
   */
  const glyphs = [...src[f].matchAll(/[^\t\n\r\x20-\x7E]/g)].map((m) => m[0]).filter((c) => c !== "—" && c !== "·");
  check(
    `${name}: no emoji, glyph or untranslated literal in the code`,
    glyphs.length === 0,
    glyphs.length ? `found: ${[...new Set(glyphs)].join(" ")}` : "",
  );
}
check(
  "the design-system gate owns every new component and the route",
  (() => {
    const ds = read("scripts/check-design-system.mjs");
    return [PAGE, ...COMPONENTS].every((f) => ds.includes(`"${f}"`));
  })(),
  "SCALE_OWNED / ROLE_ONLY must list the new files the way MyWorkTables.tsx is listed",
);

/* ------------------------------------------------- 12. the entry points */

console.log("\n--- 12. the way in, without losing the way that was there\n");

const tables = stripComments(read("src/components/my-work/MyWorkTables.tsx"));
check(
  "My Work's customers view links the name to the profile",
  /href=\{`\/customers\/\$\{r\.customerNumber\}`\}/.test(tables),
);
check(
  "it links ONLY when the group resolves to exactly one number",
  /r\.customerNumber !== null \? \(/.test(tables) &&
    /customerNumber: numberSet\.size === 1 \? \[\.\.\.numberSet\]\[0\] : null/.test(stripComments(read("src/lib/queries/my-work.ts"))),
  "3 legal entities carry 2-4 Lexware numbers; a link from the first one seen would open a different customer",
);
check(
  "the in-table drill survived: it moved to the count, it was not removed",
  (tables.match(/drillInto\(r\.customer\)/g) ?? []).length >= 2,
  `${(tables.match(/drillInto\(r\.customer\)/g) ?? []).length} drillInto call sites in the tables`,
);
check(
  "the management customer panel links to the profile, and says why when it cannot",
  (() => {
    const panel = stripComments(read("src/app/(app)/dashboard/management/ManagementCustomerPortfolio.tsx"));
    return /href=\{`\/customers\/\$\{row\.customerNumber\}`\}/.test(panel) && /customerProfileNa/.test(panel);
  })(),
);

/* ------------------------------- negative controls, on a THROWAWAY COPY */

console.log("\n--- negative controls: each predicate re-run against a broken copy\n");

/*
 * One mutation per load-bearing predicate. The mutated source is written to a
 * temp directory (never over the real file), read back, and the predicate must
 * FAIL on it. A predicate that still passes was asserting nothing, and that is
 * a failure of this gate rather than of the code it guards.
 */
const MUTATIONS = [
  [QUERY, "the exact-key filter becomes a name match", P.exactKeyFilter,
    (s) => s.replace('.eq("customer_number", customerNumber)', '.ilike("customer_display_name", customerNumber)')],
  [QUERY, "a LIKE creeps into the query", P.noNameMatching,
    (s) => s.replace('.eq("customer_number", customerNumber)', '.ilike("customer_name", customerNumber)')],
  [QUERY, "the profile is keyed on the legal entity", P.notKeyedOnEntity,
    (s) => s.replace('.eq("customer_number", customerNumber)', '.eq("customer_legal_entity_id", customerNumber)')],
  [QUERY, "a paged read ranges without ordering", P.orderBeforeRange,
    (s) => s.replace('.order("project_id")\n      .range(from, to)', ".range(from, to)")],
  [QUERY, "the budget column stops being redacted", P.budgetAware,
    (s) => s.replace("budgetAwareColumns(PROJECT_COLUMNS, canSeeBudgets)", "PROJECT_COLUMNS")],
  [QUERY, "projects.status comes back into the select", P.noStatusColumn,
    (s) => s.replace('"id, code, name, customer, contract_hours', '"id, code, name, customer, status, contract_hours')],
  [QUERY, "an unmeasured customer reports 0 h", P.loggedNullWhenUnmeasured,
    (s) => s.replace("loggedHours: measured.length === 0 ? null : round1(", "loggedHours: round1(")],
  [QUERY, "an unbudgeted customer reports 0 contracted hours", P.contractNullWhenUnbudgeted,
    (s) => s.replace("contractHours: budgeted.length === 0 ? null : round1(", "contractHours: round1(")],
  [QUERY, "an unmeasured ORDER reports 0 h, leaving both sums green", P.rowLevelNulls,
    (s) => s.replace("loggedHours: numOrNull(p.logged_hours),", "loggedHours: numOrNull(p.logged_hours) ?? 0,")],
  [QUERY, "the budget stops being redacted at the row", P.rowLevelNulls,
    (s) => s.replace(
      "contractHours: canSeeBudgets ? budgetOrNull(p.contract_hours) : null,",
      "contractHours: budgetOrNull(p.contract_hours),",
    )],
  [QUERY, "the responsibility gap is counted from the masterdata person column", P.responsibleFromRoleTable,
    (s) => s.replace(
      'responsibilities.rows.filter((r) => r.role === "responsible").map((r) => r.project_id),',
      'rosterRows.filter((m) => m.responsible_person_id).map((m) => m.project_id),',
    )],
  [QUERY, "a side read stops reporting that it failed", P.sideReadCarriesFailure,
    (s) => s.replace(
      "return { rows: [], truncated: false, failed: true };",
      "return { rows: [], truncated: false, failed: false };",
    )],
  [QUERY, "the responsibility gap is recomputed over a failed read", P.gapAbsentOnFailedRead,
    (s) => s.replace(
      "ordersWithoutResponsible: responsibilities.failed\n      ? null\n      : orders.filter((o) => !responsibleProjectIds.has(o.id)).length,",
      "ordersWithoutResponsible: orders.filter((o) => !responsibleProjectIds.has(o.id)).length,",
    )],
  [QUERY, "the unnumbered-sibling count is recomputed over a failed sub-read", P.siblingCountAbsentOnFailedRead,
    (s) => s.replace(
      "if (md.failed) return { unnumbered: null, numbers: [], truncated: true, failed: true };",
      "",
    )],
  [QUERY, "a lost side read stops firing the floor footnote", P.everyDegradationIsStated,
    (s) => s.replace("      responsibilities.failed ||\n", "")],
  [QUERY, "a figure is computed that nothing renders", P.figuresAllRendered,
    (s) => s.replace("  loggedHoursAsOf: string | null;", "  loggedHoursAsOf: string | null;\n  endingWithin90Days: number;")],
  [QUERY, "the service name is bucketed by substring", P.serviceNameAsWritten,
    (s) => s.replace("serviceName: textOrNull(m.service_name),", "serviceName: canonicalService(m.service_name),")],
  [CARE, "the unknown gap is rendered as a count again", P.careStatesTheUnknownGap,
    (s) => s.replace(
      "{ordersWithoutResponsible === null || ordersWithoutResponsible > 0 ? (",
      "{(ordersWithoutResponsible ?? 0) > 0 ? (",
    )],
  [CONTACTS_CARD, "a failed contact read reads as 'nothing recorded'", P.emptyStateNamesTheFailure,
    (s) => s.replace(
      '{unavailable ? t("contacts.unavailable") : t("contacts.none")}',
      '{t("contacts.none")}',
    )],
  [PAGE, "a contact value is spliced onto the page", P.noContactValue,
    (s) => s.replace(
      "<CustomerIdentityCard profile={data} />",
      "<CustomerIdentityCard profile={data} />\n          <p>{data.contacts.map((c) => c.email).join(\", \")}</p>",
    )],
  [QUERY, "a failed crm read is reported as 'no record'", P.masterFailReturnsUndefined,
    (s) => s.replace("    return undefined;\n  }", "    return null;\n  }")],
  [QUERY, "the four master states collapse to three", P.masterFourStates,
    (s) => s.replace(
      'masterState: !isExec ? "withheld" : master === undefined ? "unavailable" : master === null ? "none" : "present"',
      'masterState: !isExec ? "withheld" : master === null ? "none" : "present"',
    )],
  [PAGE, "the guard moves after the read", P.guardBeforeRead,
    (s) => s.replace(
      "if (!CUSTOMER_NUMBER_PATTERN.test(number)) notFound();",
      "",
    ).replace("const supabase = await createClient();", "if (!CUSTOMER_NUMBER_PATTERN.test(number)) notFound();\n  const supabase = await createClient();")],
  [PAGE, "the route guard is dropped", P.routeGuarded,
    (s) => s.replace('await enforceRoleRouteAccess("/customers");', "")],
  [NAV, "/customers falls off the operations allow-list", P.navAllowsCustomers,
    (s) => s.replace('operations: ["/my-work", "/profile", "/customers"]', 'operations: ["/my-work", "/profile"]')],
  [TABLE, "a contact column is added", P.noContactField,
    (s) => s.replace('key: "logged"', 'key: "email"').replace("r.loggedHours === null ? \"\" : r.loggedHours", "r.email")],
  // The JSX occurrence, matched with its indentation: the file's own header
  // comment quotes `columns={orderColumns}` too, and a bare string replace hits
  // the comment first and then loses to stripComments -- which is exactly the
  // silent no-op the "actually changed" check below now catches.
  [TABLE, "columns are spliced in at the call site", P.columnsNotSpliced,
    (s) => s.replace("\n      columns={orderColumns}", "\n      columns={[...orderColumns]}")],
  [TABLE, "the contract column stops being guarded", P.contractColumnGuarded,
    (s) => s.replace("if (!budgetsWithheld) {\n      cols.push({\n        key: \"contract\",", "if (true) {\n      cols.push({\n        key: \"contract\",")],
  [CRM_CARD, "the withheld branch renders nothing", P.crmWithheldHasReason,
    (s) => s.replace(
      'state === "withheld"\n      ? { label: t("crm.withheldLabel"), body: t("crm.withheldBody") }',
      'state === "withheld"\n      ? null',
    )],
  [IDENTITY, "a withheld budget renders as a dash", P.withheldTileIsWords,
    (s) => s.replace("profile.budgetsWithheld ? (\n            <WithheldTile", "false ? (\n            <WithheldTile")],
];

const tmp = mkdtempSync(join(tmpdir(), "hse-customer-profile-gate-"));
try {
  for (const [file, name, predicate, mutate] of MUTATIONS) {
    const original = file === NAV ? read(NAV) : raw[file];
    const broken = mutate(original);
    check(
      `[control] the mutation "${name}" actually changed the CODE`,
      stripComments(broken) !== stripComments(original),
      "compared after stripping comments: a mutation that only hit a comment is a no-op the predicate never sees, and it would make the control below vacuously green",
    );
    // Written to a THROWAWAY COPY. The real file is never touched.
    const copy = join(tmp, `${file.replace(/[^A-Za-z0-9]/g, "_")}.txt`);
    writeFileSync(copy, broken, "utf8");
    const reread = stripComments(readFileSync(copy, "utf8"));
    check(
      `[control] ${name} WOULD be caught`,
      predicate(reread) === false,
      "the predicate still passed on the broken copy, so it is asserting nothing",
    );
  }

  // The i18n comparison has its own control: a key present in one catalogue only.
  check(
    "[control] a key present in one catalogue only WOULD be caught",
    flatten({ a: "x", b: { c: "y" } }).join("|") !== flatten({ a: "x", b: { c: "y", d: "z" } }).join("|"),
  );
  check(
    "[control] two terminal states resolving to the same string WOULD be caught",
    new Set(["same", "same", "b", "c", "d"]).size !== 5,
  );
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nCUSTOMER PROFILE: OK" : `\nCUSTOMER PROFILE: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
