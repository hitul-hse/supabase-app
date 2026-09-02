/**
 * The developer health portal speaks both languages — and keeps speaking them.
 *
 * WHY THIS GATE EXISTS
 * --------------------
 * /admin/system-health was written bilingual from the start: every label,
 * kicker, footer and reason the page composes lives in messages/{en,de}.json
 * under `systemHealth`, and the panels only draw what view.ts and drills.ts
 * hand them. That is a state that drifts backwards one literal at a time — a
 * new `<span>ROWS</span>` passes tsc, eslint and the design-system gate and
 * quietly puts an English word on the German page. And a catalogue drifts
 * forwards too: a key nobody reads any more is a translation nobody sees, and
 * a de leaf that still says "cache hit" is English wearing a German key.
 *
 * WHAT IT PINS (static, no network, no browser)
 * ---------------------------------------------
 *   1. Catalogue parity: en and de carry identical key sets; `systemHealth`
 *      is at least as large as when it was written (196 leaves); no empty
 *      message in either language.
 *   2. Every message is valid ICU (parsed with the same parser next-intl
 *      uses), and en and de name the same placeholders for the same key — a
 *      `{count}` the German forgot is a "{count}" on screen.
 *   3. No English leaks into de: a stop-list of English function words and
 *      page vocabulary that has a German equivalent in this catalogue. Terms
 *      the catalogue keeps in English on purpose (Read Model, Policies,
 *      Commits, Rollbacks, Shared Buffers, Sync, SLA, Row Level Security) are
 *      not on the list. A de leaf byte-identical to its en leaf is
 *      untranslated unless it is code-only (allow-listed by key).
 *   4. Every key the page files reference resolves in BOTH catalogues; the
 *      only namespace those files bind is `systemHealth`.
 *   5. Every leaf in the namespace is referenced somewhere under the page
 *      directory (dead keys fail). Template-literal keys mark their whole
 *      subtree used; a bare string literal equal to a key (the SUB_LABEL_KEY /
 *      KICKER maps) marks that key used.
 *   6. No user-visible literal in a page file: no JSX text, no title /
 *      aria-label / placeholder / label literal, no diacritics, no prose
 *      line. Wording lives in the catalogue or it does not ship. Diagnostic
 *      sentences the read model writes (src/lib/health-score.ts `detail`,
 *      a Metric's `reason`) pass through verbatim by design and are not in
 *      scope here.
 *
 * The `gallery/` subdirectory is the chart gallery, a developer fixture with
 * no catalogue binding; it is deliberately not scanned.
 */
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { parse } = require("@formatjs/icu-messageformat-parser");

const NAMESPACE = "systemHealth";
const MIN_LEAVES = 196;
const DIR = "src/app/(app)/admin/system-health/";
const FILES = readdirSync(DIR).filter((f) => /\.(tsx?|mts)$/.test(f)).sort();

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const read = (path) => readFileSync(path, "utf8");
const flat = (obj, prefix = "") =>
  Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object" ? flat(v, `${prefix}${k}.`) : [[`${prefix}${k}`, v]]);
const list = (items, cap = 20) =>
  items.length ? `\n      ${items.slice(0, cap).join("\n      ")}${items.length > cap ? `\n      … ${items.length - cap} more` : ""}` : "";

const en = JSON.parse(read("messages/en.json"));
const de = JSON.parse(read("messages/de.json"));
const enKeys = new Set(flat(en).map(([k]) => k));
const deKeys = new Set(flat(de).map(([k]) => k));
const enNs = Object.fromEntries(flat(en[NAMESPACE] ?? {}));
const deNs = Object.fromEntries(flat(de[NAMESPACE] ?? {}));
const nsKeys = Object.keys(enNs);

// ── 1. parity ────────────────────────────────────────────────────────────────
const onlyEn = [...enKeys].filter((k) => !deKeys.has(k));
const onlyDe = [...deKeys].filter((k) => !enKeys.has(k));
check("en and de carry identical key sets", onlyEn.length === 0 && onlyDe.length === 0,
  onlyEn.length || onlyDe.length ? `only en: ${onlyEn.join(", ") || "-"}; only de: ${onlyDe.join(", ") || "-"}` : `${enKeys.size} keys each`);
check(`the ${NAMESPACE} namespace is intact`, nsKeys.length >= MIN_LEAVES && Object.keys(deNs).length === nsKeys.length,
  `${nsKeys.length} leaves en, ${Object.keys(deNs).length} de`);
const empty = [...Object.entries(enNs).map(([k, v]) => ["en", k, v]), ...Object.entries(deNs).map(([k, v]) => ["de", k, v])]
  .filter(([, , v]) => typeof v !== "string" || v.trim().length === 0)
  .map(([loc, k]) => `${loc} ${k}`);
check(`no empty ${NAMESPACE} message in either language`, empty.length === 0, empty.join(", "));

// ── 2. ICU validity and placeholder parity ───────────────────────────────────
const argNames = (ast, out = new Set()) => {
  for (const el of ast) {
    if (el.value !== undefined && typeof el.value === "string" && el.type !== 0) out.add(el.value);
    if (el.options) for (const opt of Object.values(el.options)) argNames(opt.value, out);
  }
  return out;
};
const icuErrors = [];
const argMismatch = [];
for (const key of nsKeys) {
  let enArgs = null;
  let deArgs = null;
  try { enArgs = argNames(parse(enNs[key])); } catch (e) { icuErrors.push(`en ${key}: ${e.message}`); }
  try { deArgs = argNames(parse(deNs[key] ?? "")); } catch (e) { icuErrors.push(`de ${key}: ${e.message}`); }
  if (enArgs && deArgs) {
    const a = [...enArgs].sort().join(",");
    const b = [...deArgs].sort().join(",");
    if (a !== b) argMismatch.push(`${key}: en {${a}} vs de {${b}}`);
  }
}
check("every message parses as ICU in both languages", icuErrors.length === 0, icuErrors.length ? list(icuErrors) : `${nsKeys.length * 2} messages`);
check("en and de name the same placeholders for every key", argMismatch.length === 0, list(argMismatch));

// ── 3. no English in de ──────────────────────────────────────────────────────
// Function words and page vocabulary that have a German word in this
// catalogue. Not on the list: Read Model, Policy/Policies, Commit(s),
// Rollback(s), Shared Buffers, Buffer-Cache, Sync, SLA, Row Level Security,
// Statement(s), Gate, Reset, Sparkline, Mockup, TOAST, WAL, ANALYZE — the
// page keeps those in English in both languages, as the rest of the app does.
const ENGLISH = [
  "of", "the", "and", "with", "from", "for", "not", "never", "is", "are", "was", "by", "at", "to", "on", "off",
  "run", "runs", "rows", "table", "tables", "hours", "hour", "sample", "samples", "failed", "missing", "set",
  "active", "inactive", "user", "users", "role", "roles", "weight", "score", "scores", "total", "connections", "connection",
  "latest", "since", "without", "every", "each", "other", "none", "database", "size", "growth", "day", "days",
  "largest", "expected", "measured", "connector", "connectors", "free", "hit", "hits", "cap", "capped", "weakest",
  "coverage", "schedule", "documented", "read", "unreachable", "records", "relations", "profiles",
  "mean", "calls", "heaviest", "presence", "shown", "penalised", "rounded", "excluded", "composite", "freshness",
  "efficiency", "security", "consumption",
];
// Not on the list because they are German words too: Budget, Relation, Profile
// (plural of Profil), Status, Cache, Reset. Phrases the page keeps in English
// by design are removed before the scan so their words cannot trip it.
const ENGLISH_PHRASES = /Row Level Security|Row Security|Read Model|Shared Buffers|Buffer-Cache/gi;
const englishRe = new RegExp(`(?<![\\wÄÖÜäöüß-])(?:${ENGLISH.join("|")})(?![\\wÄÖÜäöüß-])`, "i");
const stripCode = (s) =>
  s
    .replace(ENGLISH_PHRASES, " ")
    // ICU selectors and argument heads: `{count, plural, =0 {` / `one {` / `other {`
    .replace(/\{\s*\w+\s*,\s*(?:plural|select|selectordinal)\s*,/g, " ")
    .replace(/(?:^|\s)(?:=\d+|zero|one|two|few|many|other)\s*\{/g, " {")
    .replace(/\{\s*\w+\s*\}/g, " ")
    // identifiers: anything with _ . ( / or a SQL/pg token
    .replace(/\S*[_.(/]\S*/g, " ")
    .replace(/\b(?:select|count|min|max_connections|blks_hit|blks_read|total_exec_time)\b/g, " ");
const leaks = [];
for (const [key, value] of Object.entries(deNs)) {
  const m = stripCode(value).match(englishRe);
  if (m) leaks.push(`${key}: "${m[0]}" in "${value.slice(0, 70)}"`);
}
check("no English word from the stop-list in a de message", leaks.length === 0, list(leaks));

// A de leaf identical to its en leaf is untranslated — unless it is code-only.
const IDENTICAL_OK = new Set([
  "details", "header.serverMs", "freshness.slaRule", "freshness.slaShort", "freshness.runStatus.ok",
  "efficiency.statementsQualifierNa", "efficiency.postgrest",
  "security.profilesQualifierNa", "security.headersQualifier", "drills.pointsTimesWeight",
]);
const identical = nsKeys.filter((k) => enNs[k] === deNs[k] && !IDENTICAL_OK.has(k));
check("no de message is byte-identical to its en message outside the code-only allow-list", identical.length === 0, list(identical));
const staleAllow = [...IDENTICAL_OK].filter((k) => enNs[k] !== undefined && enNs[k] !== deNs[k]);
check("the identical-message allow-list only names messages that are still identical", staleAllow.length === 0, staleAllow.join(", "));

// ── 4 + 5. references resolve; every leaf is referenced ──────────────────────
const stripComments = (src) =>
  src.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const refs = [];        // exact keys referenced, with file
const prefixes = [];    // template-literal prefixes, with file
const literalKeys = []; // bare "a.b.c" literals that equal a key
const badNamespaces = [];
for (const file of FILES) {
  const src = stripComments(read(DIR + file));
  // Namespace bindings: this page binds exactly one.
  for (const m of src.matchAll(/(?:useTranslations|getTranslations)\(\s*"([^"]*)"\s*\)/g)) {
    if (m[1] !== NAMESPACE) badNamespaces.push(`${file}: ${m[1] || "(root)"}`);
  }
  // t("key") and t(`prefix.${x}`) — `t` is either the bound translator or the
  // `T` parameter view.ts / drills.ts receive from page.tsx.
  for (const m of src.matchAll(/\bt\(\s*"([^"]+)"/g)) refs.push({ file, key: m[1] });
  for (const m of src.matchAll(/\bt\(\s*`([^`]+)`/g)) {
    const tpl = m[1];
    const head = tpl.split("${")[0];
    if (!head.endsWith(".")) refs.push({ file, key: tpl });
    else prefixes.push({ file, prefix: head });
  }
  // Key maps: `freshness: "subs.freshness"`.
  for (const m of src.matchAll(/(?<!t\(\s*)"([a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)+)"/g)) {
    if (enNs[m[1]] !== undefined) literalKeys.push({ file, key: m[1] });
  }
}
check(`the page files bind only the ${NAMESPACE} namespace`, badNamespaces.length === 0, badNamespaces.length ? badNamespaces.join("; ") : `${FILES.length} files`);

const unresolved = [];
for (const { file, key } of refs) {
  if (!enKeys.has(`${NAMESPACE}.${key}`) || !deKeys.has(`${NAMESPACE}.${key}`)) unresolved.push(`${file}: ${key}`);
}
for (const { file, prefix } of prefixes) {
  const hasEn = nsKeys.some((k) => k.startsWith(prefix));
  const hasDe = Object.keys(deNs).some((k) => k.startsWith(prefix));
  if (!hasEn || !hasDe) unresolved.push(`${file}: ${prefix}* (template prefix)`);
}
check("every referenced key resolves in both catalogues", unresolved.length === 0,
  unresolved.length ? list(unresolved) : `${refs.length} references, ${prefixes.length} template prefixes, ${literalKeys.length} mapped keys`);

const used = new Set([...refs.map((r) => r.key), ...literalKeys.map((r) => r.key)]);
for (const { prefix } of prefixes) for (const k of nsKeys) if (k.startsWith(prefix)) used.add(k);
const dead = nsKeys.filter((k) => !used.has(k));
check(`every ${NAMESPACE} leaf is referenced by a page file (no dead keys)`, dead.length === 0, dead.length ? list(dead) : `${nsKeys.length} leaves used`);

// ── 6. no user-visible literal in a page file ────────────────────────────────
const VISIBLE_ATTRS = ["title", "aria-label", "placeholder", "label", "hint", "qualifier", "centreLabel", "centre", "caption", "readout", "kicker", "footer", "subline", "headline", "name", "sub", "value", "text", "reason", "meta", "description", "summary", "ariaLabel"];
const literalHits = [];
for (const file of FILES) {
  const src = stripComments(read(DIR + file));
  const lines = src.split("\n");
  lines.forEach((line, i) => {
    const where = `${file}:${i + 1}`;
    if (/[äöüÄÖÜß]/.test(line)) literalHits.push(`${where} diacritic: ${line.trim().slice(0, 80)}`);
    for (const m of line.matchAll(/>([^<>{}]*?[A-Za-z]{3,}[^<>{}]*?)</g)) {
      literalHits.push(`${where} JSX text: ${m[1].trim().slice(0, 60)}`);
    }
    for (const attr of VISIBLE_ATTRS) {
      const m = line.match(new RegExp(`(?:^|[\\s,{(])${attr.replace("-", "\\-")}\\s*[=:]\\s*"([^"]*[A-Za-z]{3,}[^"]*)"`));
      // `key`-like identifiers ("active", "commit") are segment keys, not text: require a space or a capital.
      if (m && (/\s/.test(m[1]) || /[A-Z]/.test(m[1]))) literalHits.push(`${where} ${attr} literal: ${m[1].slice(0, 60)}`);
    }
    const t = line.trim();
    if (/^[A-Za-z„"][^<>{}=;()]*$/.test(t) && t.split(/\s+/).length >= 3 && !/,$/.test(t) && !/^(import|export|return|const|let|type|case|default|else|if|function|async)\b/.test(t)) {
      literalHits.push(`${where} prose: ${t.slice(0, 60)}`);
    }
  });
}
check("no user-visible string literal in a page file", literalHits.length === 0,
  literalHits.length ? list(literalHits) : `${FILES.length} files clean`);

console.log(`\n${failures === 0 ? "I18N SYSTEM HEALTH: OK" : `I18N SYSTEM HEALTH: ${failures} FAILURE(S)`}`);
process.exit(failures ? 1 : 0);
