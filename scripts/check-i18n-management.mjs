/**
 * The Management dashboard speaks both languages — and keeps speaking them.
 *
 * WHY THIS GATE EXISTS
 * --------------------
 * /dashboard/management was German-only: the night-shift check flagged its SSR
 * as identical in en and de. The fix extracted every user-visible string into
 * messages/{en,de}.json under `management` (the German verbatim, as the
 * canonical source) and routed the panels through next-intl. That is a refactor
 * that drifts backwards one literal at a time — a new `<th>KUNDE</th>` passes
 * tsc, eslint and the design-system gate and quietly puts a German word on the
 * English page. This gate is the thing that fails when that happens.
 *
 * WHAT IT PINS (static, no network, no browser)
 * ---------------------------------------------
 *   1. Catalogue parity: en and de carry identical key sets, and `management`
 *      is at least as large as when it was extracted (306 leaves).
 *   2. Every key the migrated files reference resolves in BOTH catalogues.
 *   3. The render-site map (management-i18n.ts) maps German strings the query
 *      modules actually emit — a rewording in src/lib/queries fails here, not
 *      silently as untranslated German on the English page.
 *   4. No user-visible literal in a migrated file: no diacritics outside
 *      value comparisons, no JSX text, no title/aria-label/placeholder/label
 *      literals. Wording lives in the catalogue or it does not ship.
 *   5. The German canon behind the keys (Auslastung, Vertragsstunden,
 *      Kapazitätsrisiko …) and the English glossary shared with overview.*
 *      (Utilisation, Contract hours, People, Customers, Data quality).
 *   6. Numbers stay de-DE in both languages, and a missing number still
 *      renders n/a, never 0.
 */
import { readFileSync, existsSync } from "node:fs";

const DIR = "src/app/(app)/dashboard/management/";
const MIGRATED = [
  "page.tsx",
  "actions.ts",
  "ManagementMatrix.tsx",
  "ManagementDrilldown.tsx",
  "BrokenCoverPanel.tsx",
  "EmployeeOwnershipOverview.tsx",
  "ManagementDataQuality.tsx",
  "ManagementProjectRisks.tsx",
  "ManagementCustomerPortfolio.tsx",
  "ManagementMultiServiceMatrix.tsx",
  "ReassignmentPicker.tsx",
];
const MAP_FILE = "management-i18n.ts";
const QUERY_MODULES = [
  "src/lib/queries/management-contract-hours.ts",
  "src/lib/queries/management-data-quality.ts",
  "src/lib/queries/management-project-risks.ts",
  "src/lib/queries/management-customer-portfolio.ts",
  "src/lib/queries/management-employee-ownership.ts",
  "src/lib/queries/management-multi-service-matrix.ts",
  "src/lib/queries/broken-cover.ts",
];

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const read = (path) => readFileSync(path, "utf8");
const flat = (obj, prefix = "") =>
  Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object" ? flat(v, `${prefix}${k}.`) : [[`${prefix}${k}`, v]]);
const get = (obj, path) => path.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), obj);

const en = JSON.parse(read("messages/en.json"));
const de = JSON.parse(read("messages/de.json"));
const enKeys = new Set(flat(en).map(([k]) => k));
const deKeys = new Set(flat(de).map(([k]) => k));

// 1. parity
const onlyEn = [...enKeys].filter((k) => !deKeys.has(k));
const onlyDe = [...deKeys].filter((k) => !enKeys.has(k));
check("en and de carry identical key sets", onlyEn.length === 0 && onlyDe.length === 0,
  onlyEn.length || onlyDe.length ? `only en: ${onlyEn.join(", ") || "-"}; only de: ${onlyDe.join(", ") || "-"}` : `${enKeys.size} keys each`);
const mgmtLeaves = flat(en.management ?? {}).length;
check("the management namespace is intact", mgmtLeaves >= 306, `${mgmtLeaves} leaves`);
const emptyLeaves = flat(en.management ?? {}).concat(flat(de.management ?? {})).filter(([, v]) => typeof v !== "string" || v.length === 0);
check("no empty management message", emptyLeaves.length === 0, emptyLeaves.map(([k]) => k).join(", "));

// Comment-free source: block comments, line comments, JSX comments.
const stripComments = (src) =>
  src.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// 2. every referenced key resolves in both catalogues
const resolveKeys = (src) => {
  // Bindings are tracked in source order: a component further down the file
  // may rebind `t` to another namespace, and a call resolves against the
  // binding in force where it appears.
  const refs = [];
  const nsOf = Object.create(null);
  const namespaces = [];
  const decl = /(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\("([^"]+)"\)/g;
  const inline = /(?:useTranslations|getTranslations)\("([^"]+)"\)\("([^"]+)"\)/g;
  const call = /\b([A-Za-z_]\w*)\(\s*"([^"]+)"/g;
  const events = [];
  for (const m of src.matchAll(decl)) events.push({ at: m.index, kind: "decl", ident: m[1], ns: m[2] });
  for (const m of src.matchAll(inline)) events.push({ at: m.index, kind: "ref", key: `${m[1]}.${m[2]}` });
  for (const m of src.matchAll(call)) events.push({ at: m.index, kind: "call", ident: m[1], key: m[2] });
  events.sort((a, b) => a.at - b.at);
  for (const e of events) {
    if (e.kind === "decl") { nsOf[e.ident] = e.ns; namespaces.push(e.ns); }
    else if (e.kind === "ref") refs.push(e.key);
    else if (nsOf[e.ident]) refs.push(`${nsOf[e.ident]}.${e.key}`);
  }
  return { refs, namespaces: [...new Set(namespaces)] };
};
const missingRefs = [];
let refCount = 0;
for (const file of MIGRATED) {
  const src = stripComments(read(DIR + file));
  const { refs, namespaces } = resolveKeys(src);
  refCount += refs.length;
  check(`${file} reads the management catalogue`, namespaces.some((ns) => ns.startsWith("management")) || /useTranslations\("management/.test(src),
    namespaces.join(", "));
  for (const ref of refs) if (!enKeys.has(ref) || !deKeys.has(ref)) missingRefs.push(`${file}: ${ref}`);
}
check("every referenced key resolves in both catalogues", missingRefs.length === 0,
  missingRefs.length ? missingRefs.join("; ") : `${refCount} references`);

// 3. the render-site map: keys resolve, and the German it maps is what the modules emit
const mapSrc = read(DIR + MAP_FILE);
const mapEntries = [...mapSrc.matchAll(/^\s*(?:"([^"]+)"|([A-Za-zÄÖÜäöüß]+))\s*:\s*"([a-zA-Z.]+)",?\s*$/gm)]
  .map((m) => ({ german: m[1] ?? m[2], key: m[3] }));
check("management-i18n.ts maps at least the statuses, ratings, risks, checks and meanings", mapEntries.length >= 40, `${mapEntries.length} entries`);
const badMapKeys = mapEntries.filter(({ key }) => !enKeys.has(`management.${key}`) || !deKeys.has(`management.${key}`));
check("every mapped key exists in both catalogues", badMapKeys.length === 0, badMapKeys.map((e) => e.key).join(", "));
const modules = QUERY_MODULES.filter(existsSync).map(read).join("\n");
const unemitted = mapEntries.filter(({ german }) => !modules.includes(`"${german}"`));
check("every mapped German string is emitted verbatim by a query module (no silent rewording)", unemitted.length === 0,
  unemitted.map((e) => e.german).join(" | "));
const verbatim = mapEntries.filter(({ german, key }) => get(de.management, key) !== german);
check("the de catalogue carries each mapped German string verbatim", verbatim.length === 0,
  verbatim.map((e) => `${e.key} ≠ ${e.german}`).join(" | "));
// The statuses are compared in code: the map must cover every UtilisationStatus.
const statusUnion = read("src/lib/queries/management-contract-hours.ts").match(/export type UtilisationStatus = ([^;]+);/)?.[1] ?? "";
const statuses = [...statusUnion.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
check("STATUS_KEY covers every UtilisationStatus", statuses.length >= 3 && statuses.every((s) => mapEntries.some((e) => e.german === s)),
  statuses.join(", "));

// 4. no user-visible literal in a migrated file
const VISIBLE_ATTRS = ["title", "aria-label", "placeholder", "label", "hint", "qualifier", "emptyText", "searchPlaceholder", "summary", "ariaLabel", "meta", "description", "kicker", "footer", "subline", "header", "noun", "empty"];
const CANON = /\b(Vertragsstunden|Auslastung|Mitarbeiter|Kunden?|Risiken|Projekte|Verantwortlich\w*|Vertretung\w*|Datenqualität|Anzahl|Bewertung|Prüfung|Keine|Nicht zugeordnet|Grund|Antrag)\b/;
const literalHits = [];
for (const file of MIGRATED) {
  const raw = read(DIR + file);
  // Comparisons against module values are internal, not visible: `=== "Kritisch"`.
  const src = stripComments(raw).replace(/(?:===|!==)\s*"[^"]*"/g, "=== ''");
  const lines = src.split("\n");
  lines.forEach((line, i) => {
    const where = `${file}:${i + 1}`;
    if (/[äöüÄÖÜß]/.test(line)) literalHits.push(`${where} diacritic: ${line.trim().slice(0, 80)}`);
    else if (CANON.test(line.replace(/\/\/.*$/, ""))) literalHits.push(`${where} German canon word: ${line.trim().slice(0, 80)}`);
    for (const m of line.matchAll(/>([^<>{}]*?[A-Za-z]{3,}[^<>{}]*?)</g)) {
      literalHits.push(`${where} JSX text: ${m[1].trim().slice(0, 60)}`);
    }
    for (const attr of VISIBLE_ATTRS) {
      const m = line.match(new RegExp(`(?:^|[\\s,{])${attr.replace("-", "\\-")}\\s*[=:]\\s*"([^"]*[A-Za-z]{3,}[^"]*)"`));
      if (m) literalHits.push(`${where} ${attr} literal: ${m[1].slice(0, 60)}`);
    }
    const t = line.trim();
    if (/^[A-Za-z„"][^<>{}=;()]*$/.test(t) && t.split(/\s+/).length >= 3 && !/,$/.test(t) && !/^(import|export|return|const|let|type|case|default|else|if)\b/.test(t)) {
      literalHits.push(`${where} prose: ${t.slice(0, 60)}`);
    }
  });
}
check("no user-visible string literal in a migrated file", literalHits.length === 0,
  literalHits.length ? `\n      ${literalHits.slice(0, 20).join("\n      ")}${literalHits.length > 20 ? `\n      … ${literalHits.length - 20} more` : ""}` : `${MIGRATED.length} files clean`);

// 5. the German canon behind the keys, and the English glossary shared with overview.*
const pins = [
  ["de", "management.status.capacityRisk", "Kapazitätsrisiko"],
  ["de", "management.status.healthy", "Gesunde Auslastung"],
  ["de", "management.status.underutilised", "Unterauslastung"],
  ["de", "management.tabs.overview", "Auslastung"],
  ["de", "management.tabs.employees", "Mitarbeiter"],
  ["de", "management.tabs.customers", "Kunden"],
  ["de", "management.tabs.risks", "Risiken & Qualität"],
  ["de", "management.tiles.contractHours.label", "GESAMT VERTRAGSSTUNDEN"],
  ["de", "management.tiles.outlook.label", "AUSLASTUNGSAUSBLICK"],
  ["de", "management.outlook.title", "Auslastungsausblick"],
  ["de", "management.header.meta", "VERTRAGSSTUNDEN · SERVICES · PORTFOLIO · RISIKEN · READ MODEL"],
  ["de", "management.rating.critical", "Kritisch"],
  ["de", "management.brokenCover.title", "Defekte Vertretungen"],
  ["en", "management.status.capacityRisk", "Capacity risk"],
  ["en", "management.tabs.overview", "Utilisation"],
  ["en", "management.tabs.employees", "People"],
  ["en", "management.tabs.customers", "Customers"],
  ["en", "management.tabs.risks", "Risks & quality"],
  ["en", "management.tiles.contractHours.label", "TOTAL CONTRACT HOURS"],
  ["en", "management.tiles.outlook.label", "UTILISATION OUTLOOK"],
  ["en", "management.outlook.columns.planHours", "PLAN HOURS / YEAR"],
  ["en", "management.dataQuality.title", "Data quality"],
  ["en", "management.header.meta", "CONTRACT HOURS · SERVICES · PORTFOLIO · RISKS · READ MODEL"],
];
const badPins = pins.filter(([loc, key, want]) => get(loc === "en" ? en : de, key) !== want);
check("the German canon and the English glossary are pinned", badPins.length === 0,
  badPins.map(([loc, key, want]) => `${loc} ${key} should be "${want}", is "${get(loc === "en" ? en : de, key)}"`).join("; "));
// Glossary consistency with overview.*: the same concept, the same English word.
check("utilisation is spelled the overview way (British, one word)",
  /utilisation/i.test(get(en, "overview.utilisation.title") ?? "") && !/utilization/i.test(JSON.stringify(en.management)));
check("no 'Employee' where the glossary says People, outside the panel title that carries that name",
  !flat(en.management).some(([k, v]) => k !== "employees.title" && /\bemployees?\b/i.test(v)));

// 6. numbers stay de-DE; missing numbers stay n/a
for (const file of ["ManagementMatrix.tsx", "ManagementDrilldown.tsx", "EmployeeOwnershipOverview.tsx", "ManagementProjectRisks.tsx", "ManagementCustomerPortfolio.tsx", "ManagementMultiServiceMatrix.tsx", "ReassignmentPicker.tsx"]) {
  const src = read(DIR + file);
  check(`${file} formats numbers de-DE in both languages`, /Intl\.NumberFormat\("de-DE"/.test(src) && !/"en-US"|toLocaleString\("en/.test(src));
}
check("a missing number renders n/a in both languages, never 0",
  get(en, "management.values.notAvailable") === "n/a" && get(de, "management.values.notAvailable") === "n/a");

console.log(`\n${failures === 0 ? "I18N MANAGEMENT: OK" : `I18N MANAGEMENT: ${failures} FAILURE(S)`}`);
process.exit(failures ? 1 : 0);
