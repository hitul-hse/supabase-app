/**
 * /time, /projects and /people speak both languages — and keep speaking them.
 *
 * WHY THIS GATE EXISTS
 * --------------------
 * On 2026-09-03 the night-shift SSR check reported `/projects` rendering
 * "de IDENTICAL to en": 519 lines of English under a German locale cookie.
 * /time/dashboard was the same, and /people was half-done — its header spoke
 * German while its filter chips and table headers did not. The fix extracted
 * every user-visible string into messages/{en,de}.json under `timeDashboard`,
 * `time`, `projects` and `people`, and routed every number and date through
 * the request locale.
 *
 * That is a refactor, and refactors drift back one literal at a time. A new
 * `<th>HOURS</th>` passes tsc, eslint and the design-system gate and quietly
 * puts an English word on the German page — which is exactly how these three
 * pages ended up monolingual in the first place. This gate is the thing that
 * fails when that happens.
 *
 * It is the mirror image of check-i18n-management.mjs. That page was
 * German-first, so its gate hunts German diacritics in the source. These pages
 * were English-first, so this one hunts ENGLISH prose in the source: JSX text,
 * visible attributes and bare prose lines. Wording lives in the catalogue or it
 * does not ship.
 *
 * WHAT IT PINS (static, no network, no browser)
 * ---------------------------------------------
 *   1. Catalogue parity: en and de carry identical key sets, no empty leaves,
 *      and the four namespaces are at least as large as when they were
 *      extracted.
 *   2. Every key the migrated files reference resolves in BOTH catalogues.
 *   3. No user-visible English literal in any file under the three trees.
 *   4. The German is real and consistent: the glossary is pinned, and the
 *      synonyms it displaces (fakturierbar, Nutzungsgrad, Zeiterfassung for
 *      "tracked hours") are banned, because two words for one concept read as
 *      two features.
 *   5. de actually differs from en: no namespace may be a copy of the other
 *      language, which is the failure the SSR check caught.
 *   6. Numbers and dates follow the request locale — no hard-coded "en-GB" or
 *      "de-DE" left in the three trees; they go through @/lib/locale-format.
 *   7. Product and proper nouns are NOT translated.
 *   8. A missing number still renders n/a, never 0.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const DIRS = ["src/app/(app)/time", "src/app/(app)/projects", "src/app/(app)/people"];
const NAMESPACES = { timeDashboard: 60, time: 10, projects: 90, people: 60 };
/** Where a locale-aware figure is allowed to come from. */
const FORMAT_MODULE = "@/lib/locale-format";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const read = (p) => readFileSync(p, "utf8");
const walk = (d) =>
  readdirSync(d).flatMap((f) => {
    const p = join(d, f);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(p) ? [p] : [];
  });
const flat = (obj, prefix = "") =>
  Object.entries(obj ?? {}).flatMap(([k, v]) =>
    v && typeof v === "object" ? flat(v, `${prefix}${k}.`) : [[`${prefix}${k}`, v]]);
const get = (obj, path) =>
  path.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), obj);

const en = JSON.parse(read("messages/en.json"));
const de = JSON.parse(read("messages/de.json"));
const enKeys = new Set(flat(en).map(([k]) => k));
const deKeys = new Set(flat(de).map(([k]) => k));
const FILES = DIRS.flatMap(walk).sort();

/* ------------------------------------------------------------------ 1. parity */

const onlyEn = [...enKeys].filter((k) => !deKeys.has(k));
const onlyDe = [...deKeys].filter((k) => !enKeys.has(k));
check("en and de carry identical key sets", onlyEn.length === 0 && onlyDe.length === 0,
  onlyEn.length || onlyDe.length
    ? `only en: ${onlyEn.slice(0, 8).join(", ") || "-"}; only de: ${onlyDe.slice(0, 8).join(", ") || "-"}`
    : `${enKeys.size} keys each`);

for (const [ns, floor] of Object.entries(NAMESPACES)) {
  const n = flat(en[ns]).length;
  check(`the ${ns} namespace is intact`, n >= floor, `${n} leaves (floor ${floor})`);
}
const empties = Object.keys(NAMESPACES)
  .flatMap((ns) => flat(en[ns]).concat(flat(de[ns])))
  .filter(([, v]) => typeof v !== "string" || v.trim().length === 0);
check("no empty message in the four namespaces", empties.length === 0,
  empties.map(([k]) => k).slice(0, 10).join(", "));

/* ------------------------------------- 2. every referenced key resolves in both */

// Comments are blanked, NOT deleted: a multi-line /* */ replaced by "" collapses
// its lines together and every line number reported after it is wrong, which is
// how a hit gets chased to the wrong place in a 900-line file. Keeping the
// newlines preserves the mapping from hit to source line.
const blank = (m) => m.replace(/[^\n]/g, "");
const stripComments = (src) =>
  src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, blank)
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/^(\s*)\/\/.*$/gm, "$1");

// Bindings tracked in source order: a component further down a file may rebind
// `t` to another namespace, and a call resolves against the binding in force
// where it appears. Lifted from check-i18n-management.mjs so both gates agree
// on what "references a key" means.
const resolveKeys = (src) => {
  const refs = [];
  const nsOf = Object.create(null);
  const namespaces = [];
  const events = [];
  const decl = /(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\("([^"]+)"\)/g;
  const inline = /(?:useTranslations|getTranslations)\("([^"]+)"\)\("([^"]+)"\)/g;
  const call = /\b([A-Za-z_]\w*)\(\s*"([^"]+)"/g;
  for (const m of src.matchAll(decl)) events.push({ at: m.index, kind: "decl", ident: m[1], ns: m[2] });
  for (const m of src.matchAll(inline)) events.push({ at: m.index, kind: "ref", key: `${m[1]}.${m[2]}` });
  for (const m of src.matchAll(call)) events.push({ at: m.index, kind: "call", ident: m[1], key: m[2] });
  // t.rich("key", {...}) for messages carrying markup tags, and t.raw / t.has.
  // The plain `call` pattern above captures "rich" as the identifier and drops
  // the reference on the floor, so a typo in a rich key would never be caught —
  // ReportPanels.tsx already has two of these (s.rich("calendarExcluded.…")).
  const member = /\b([A-Za-z_]\w*)\.(?:rich|raw|markup|has)\(\s*"([^"]+)"/g;
  for (const m of src.matchAll(member)) events.push({ at: m.index, kind: "call", ident: m[1], key: m[2] });
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
const translatedFiles = [];
for (const f of FILES) {
  const { refs, namespaces } = resolveKeys(stripComments(read(f)));
  refCount += refs.length;
  if (namespaces.length) translatedFiles.push(f);
  for (const r of refs) if (!enKeys.has(r) || !deKeys.has(r)) missingRefs.push(`${f}: ${r}`);
}
check("every referenced key resolves in both catalogues", missingRefs.length === 0,
  missingRefs.length ? missingRefs.slice(0, 12).join("; ") : `${refCount} references across ${translatedFiles.length} files`);

/* --------------------------------- 3. no user-visible English literal in source */

/**
 * Attributes a reader actually SEES. An allowlist, not a blocklist: className,
 * href, data-*, viewBox and friends carry English forever and must not be
 * flagged, so anything not named here is invisible by default.
 */
const VISIBLE_ATTRS = [
  "title", "aria-label", "ariaLabel", "placeholder", "label", "hint", "qualifier",
  "emptyText", "searchPlaceholder", "summary", "description", "kicker", "footer",
  "subline", "noun", "empty", "category", "meta", "alt", "heading", "caption",
  "legend", "unit", "sub", "tooltip", "message", "confirm", "cta",
];
/** Words that are English on the German page on purpose. */
const PROPER_NOUNS = /^(TrackingTime|Factorial|Asana|Samdock|Lexware|HSE Hub|Supabase|Postgres|Hub|API|CSV|PDF|ISO|UTC|OK|ID|URL|EN|DE)$/;
/** Bare technical tokens that are never prose. */
const TECH = /^(string|number|boolean|void|null|undefined|true|false|const|let|var|type|interface|import|export|return|default|async|await|div|span|button|input|select|option|table|thead|tbody|tr|td|th|svg|path|circle|rect|line|text|g|p|h1|h2|h3|h4|ul|ol|li|a|main|section|header|footer|nav|form|label)$/;

/** Does this look like prose a person reads, rather than code? */
const isProse = (raw) => {
  const s = raw.trim();
  if (s.length < 2) return false;
  if (!/[A-Za-z]{2}/.test(s)) return false;                 // no letters -> a number, a symbol, an arrow
  if (/[{}`$\\]/.test(s)) return false;                      // an expression leaked into the match
  if (!/^[A-Za-z0-9 ,.'’&%/·:;!?()+\-–—…"„“]+$/.test(s)) return false;
  if (PROPER_NOUNS.test(s)) return false;
  if (TECH.test(s)) return false;
  if (/^[a-z][A-Za-z0-9]*$/.test(s) && !s.includes(" ")) return false; // camelCase identifier
  // A single short capitalised token is usually a component or a type name.
  if (!/\s/.test(s) && s.length < 3) return false;
  return true;
};

const literalHits = [];
for (const f of FILES) {
  const raw = stripComments(read(f));
  // Every removal below BLANKS rather than deletes, for the same reason the
  // comment stripper does: a multi-line import or a template-literal className
  // deleted outright renumbers everything after it.
  const src = raw
    .replace(/^\s*import[\s\S]*?from\s+"[^"]*";?\s*$/gm, blank)  // import lines
    .replace(/(?:===|!==)\s*"[^"]*"/g, "=== ''")                // value comparisons are internal
    .replace(/\bdata-[\w-]+=(?:"[^"]*"|\{[^}]*\})/g, blank)      // script handles stay English on purpose
    .replace(/\b(?:className|href|id|key|name|type|role|viewBox|d|fill|stroke|src|value|htmlFor|action|method|rel|target|xmlns|transform|points|dominantBaseline|textAnchor)=(?:"[^"]*"|\{`[^`]*`\}|\{[^{}]*\})/g, blank);
  src.split("\n").forEach((line, i) => {
    const where = `${f}:${i + 1}`;
    // JSX text: >…< with nothing but prose between.
    // (?<!=) keeps an arrow function out of it: `(fn: () => Promise<T>)` reads
    // as ">" + " Promise" + "<" to a naive scan, and a generic return type is
    // not something a reader ever sees.
    for (const m of line.matchAll(/(?<!=)>([^<>{}]+)</g)) {
      if (isProse(m[1])) literalHits.push(`${where} JSX text: ${m[1].trim().slice(0, 60)}`);
    }
    // A visible attribute given a literal.
    for (const attr of VISIBLE_ATTRS) {
      const m = line.match(new RegExp(`(?:^|[\\s,{])${attr.replace("-", "\\-")}\\s*[=:]\\s*"([^"]*)"`));
      if (m && isProse(m[1])) literalHits.push(`${where} ${attr}: ${m[1].slice(0, 60)}`);
    }
  });
  // A bare prose line: a string constant sitting in an array or object of labels.
  raw.split("\n").forEach((line, i) => {
    const t = line.trim();
    const m = t.match(/^"([^"]{4,})",?$/);
    if (m && isProse(m[1]) && /\s/.test(m[1])) literalHits.push(`${f}:${i + 1} bare string: ${m[1].slice(0, 60)}`);
  });
}
check("no user-visible English literal under the three trees", literalHits.length === 0,
  literalHits.length
    ? `${literalHits.length} hit(s)\n      ${literalHits.slice(0, 25).join("\n      ")}${literalHits.length > 25 ? `\n      … ${literalHits.length - 25} more` : ""}`
    : `${FILES.length} files clean`);

/* ------------------------------------------- 4. the glossary, and its banned synonyms */

const GLOSSARY = [
  ["de", "abrechenbar", /abrechenbar/i],
  ["de", "Auslastung", /Auslastung/],
  ["de", "erfasst (for tracked/logged)", /erfasst/i],
  ["de", "Zeitraum", /Zeitraum/i],
  ["de", "Mitarbeiter", /Mitarbeiter/],
  ["de", "Kunde", /Kunde/],
  ["de", "Projekt", /Projekt/],
];
const deBlob = Object.keys(NAMESPACES).map((ns) => JSON.stringify(de[ns] ?? {})).join(" ");
const enBlob = Object.keys(NAMESPACES).map((ns) => JSON.stringify(en[ns] ?? {})).join(" ");
for (const [, term, re] of GLOSSARY) check(`the German uses the canonical term: ${term}`, re.test(deBlob));

// One concept, one word. These are the synonyms a fresh translator reaches for.
const BANNED_DE = [
  ["fakturierbar", /fakturierbar/i, "the catalogue says abrechenbar"],
  ["Nutzungsgrad", /Nutzungsgrad|Auslastungsgrad/i, "the catalogue says Auslastung"],
  ["Zeiterfassung as a stand-in for tracked hours", /Zeiterfassungsstunden/i, "the catalogue says erfasste Stunden"],
  ["Angestellte", /Angestellte/i, "the catalogue says Mitarbeiter"],
  ["Klient", /Klient/i, "the catalogue says Kunde"],
  // "Std" is admin/system-health's abbreviation, where it contrasts with Min
  // and Tg to size a duration. The unit on these pages is "h" in both
  // languages (overview.billableSplit.legendBillable, management.values.hours);
  // German carrying both reads as two different units.
  ["Std for hours", /\bStd\b|\bSTD\b/, "the catalogue's hours unit is h / H"],
];
for (const [name, re, why] of BANNED_DE) check(`no synonym drift: ${name}`, !re.test(deBlob), why);
const american = /utilization/i.test(enBlob);
check("utilisation is spelled the overview way (British, one word)", !american,
  american ? "American spelling found" : "");

/* ------------------------- 4b. one English string, one German word (anti-drift) */

/**
 * The brief's rule: "two translations for one concept reads as two features."
 * Case is a design choice here (a tile label SHOUTS, a card title does not), so
 * German forms are compared case-insensitively — "PROJEKTE" and "Projekte" are
 * the same word, "Mitarbeiter" and "Personen" are not.
 *
 * Only pairs that involve one of the four namespaces are judged, so this gate
 * does not inherit the six divergences that already exist between management,
 * systemHealth and nav at HEAD. Those are someone else's to settle.
 */
const OWNED = new RegExp(`^(${Object.keys(NAMESPACES).join("|")})\\.`);
const DELIBERATE = new Set([
  // management pins the literal "n/a" in both languages; its own gate asserts
  // it. The rest of the app says "k. A.". Both are intentional, so a clash
  // between them is not drift this gate should fail on.
  "n/a",
  // Genuine homonyms: one English string, two senses, so two German words is
  // CORRECT here and collapsing them would be the bug. Keep this list tiny and
  // keep the reason attached — it is the one way to launder drift past this
  // check, so an entry without a defensible second sense does not belong.
  //   "To date"  — the end of a date range (Bis-Datum) vs "logged to date",
  //                meaning so far (bis heute).
  "to date",
  //   "Records"  — the sidebar SECTION grouping several pages
  //                (AUFZEICHNUNGEN) vs the timesheet tab listing individual
  //                entries (Einträge).
  "records",
]);
const byEnglish = new Map();
for (const [k, v] of flat(en)) {
  if (typeof v !== "string" || v.trim().length < 2) continue;
  const d = get(de, k);
  if (typeof d !== "string") continue;
  const ek = v.trim().toLowerCase();
  if (DELIBERATE.has(ek)) continue;
  if (!byEnglish.has(ek)) byEnglish.set(ek, new Map());
  const forms = byEnglish.get(ek);
  const dk = d.trim().toLowerCase();
  if (!forms.has(dk)) forms.set(dk, []);
  forms.get(dk).push(k);
}
const divergent = [];
for (const [eng, forms] of byEnglish) {
  if (forms.size < 2) continue;
  // Split the German forms by who introduced them. A pre-existing disagreement
  // between two namespaces we do not own (nav vs management on "People") is not
  // this gate's business, even when one of our keys happens to share the group.
  const ownForms = [...forms.entries()].filter(([, ks]) => ks.some((k) => OWNED.test(k)));
  const otherForms = [...forms.entries()].filter(([, ks]) => ks.some((k) => !OWNED.test(k)));
  if (ownForms.length === 0) continue;
  const ownSet = new Set(ownForms.map(([d]) => d));
  const otherSet = new Set(otherForms.map(([d]) => d));
  // Fail when our own namespaces disagree with each other, or when we coined a
  // German word for a concept the catalogue had already named.
  const weDisagree = ownSet.size > 1;
  const weCoined = otherSet.size > 0 && [...ownSet].some((d) => !otherSet.has(d));
  if (!weDisagree && !weCoined) continue;
  divergent.push(`"${eng}" -> ${[...forms.entries()].map(([d, ks]) => `"${d}" (${ks[0]})`).join(" vs ")}`);
}
check("one English string, one German word across the catalogue", divergent.length === 0,
  divergent.length ? `\n      ${divergent.slice(0, 12).join("\n      ")}` : `${byEnglish.size} distinct English strings checked`);

/* ------------------------------------------------- 5. de actually differs from en */

for (const ns of Object.keys(NAMESPACES)) {
  const e = flat(en[ns]), d = flat(de[ns]);
  const same = e.filter(([k, v]) => get(de[ns], k) === v);
  // Some leaves are legitimately identical in both languages: a proper noun, a
  // unit, an ICU-only string. But a namespace where MOST leaves match is a
  // namespace that was copied rather than translated — the /projects failure.
  const ratio = e.length ? same.length / e.length : 0;
  check(`${ns} is genuinely translated, not copied`, ratio < 0.5,
    `${same.length}/${e.length} leaves identical in en and de (${Math.round(ratio * 100)}%)`);
  void d;
}

/* ---------------------------------------- 6. numbers and dates follow the locale */

const hardCoded = [];
for (const f of FILES) {
  const src = stripComments(read(f));
  for (const m of src.matchAll(/"(en-GB|en-US|de-DE)"/g)) {
    hardCoded.push(`${f}: "${m[1]}"`);
  }
}
check("no hard-coded locale tag in the three trees", hardCoded.length === 0,
  hardCoded.length ? `${hardCoded.length}: ${hardCoded.slice(0, 10).join(", ")} — use ${FORMAT_MODULE}` : "all figures go through the locale");

const formatUsers = FILES.filter((f) => read(f).includes(FORMAT_MODULE));
check("the pages format through the shared locale helper", formatUsers.length >= 8,
  `${formatUsers.length} files import ${FORMAT_MODULE}`);

/* ------------------------------------------------------- 7. proper nouns untranslated */

const NOUNS = ["TrackingTime", "Factorial", "Asana", "Samdock", "Lexware"];
const mangled = NOUNS.filter((n) => {
  const inEn = enBlob.includes(n);
  return inEn && !deBlob.includes(n);
});
check("product nouns are not translated", mangled.length === 0, mangled.join(", "));

/* -------------------------------------------------------- 8. a missing number is n/a */

check("a missing number renders n/a in both languages, never 0",
  get(en, "common.notAvailable") === "n/a" && get(de, "common.notAvailable") === "k. A.",
  `en "${get(en, "common.notAvailable")}" / de "${get(de, "common.notAvailable")}"`);

console.log(`\n${failures === 0 ? "I18N TIME/PROJECTS/PEOPLE: OK" : `I18N TIME/PROJECTS/PEOPLE: ${failures} FAILURE(S)`}`);
process.exit(failures ? 1 : 0);
