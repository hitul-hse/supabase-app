/**
 * Every message key the app ASKS FOR must exist in BOTH catalogues.
 *
 * THE BUG THIS EXISTS FOR. A branch gave the Overview a new hero band and put
 * its six strings under `overview.hero.*` -- a namespace that was already
 * occupied by the ten strings of the week drill-down dialog. Both catalogues
 * were rewritten, the ten old keys were deleted, and `OverviewHero.tsx` went on
 * calling every one of them. next-intl has no fallback configured in
 * src/i18n/request.ts, so its default applies: the dialog rendered the literal
 * text `overview.hero.totals` where "201.9h billable of 276.1h · 17 people ·
 * 216 entries" had been, and `overview.hero.footer` where the scope caveat had
 * been. The page still built, still type-checked, still rendered, and every
 * existing gate stayed green -- check-i18n-system-health.mjs walks only the
 * `systemHealth` namespace, so nothing in the suite looked at the other ~1,900
 * keys. It was found by reading a diff.
 *
 * WHAT THIS ASSERTS. A static sweep, not a render:
 *   1. Every LITERAL key referenced through a `useTranslations`/`getTranslations`
 *      binding resolves in en.json AND in de.json.
 *   2. Every DYNAMIC key (`t(`status.${x}`)`) has at least its static prefix
 *      present in both -- the interpolated leaf cannot be known statically, but
 *      a namespace that has been renamed out from under it can.
 *   3. en.json and de.json hold the SAME key set. A key present in one and not
 *      the other is a page that renders its own key path to half the company.
 *
 * WHY STATIC. The failure is a REFERENCE that no longer resolves, and that is a
 * property of the source plus the catalogues -- reachable without a browser, a
 * session or a database, so it costs a second and runs in CI with no secrets.
 * A render check would only catch the pages a gate happens to visit; this
 * catches the ones nobody thought to look at.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./lib/repo-root.mjs";
import { record } from "./lib/gate-result.mjs";

let failed = 0;
const check = (name, ok, detail = "") => {
  record(ok);
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? `\n        ${detail}` : ""}`);
};

const cat = Object.fromEntries(
  ["en", "de"].map((l) => [l, JSON.parse(readFileSync(join(REPO_ROOT, `messages/${l}.json`), "utf8"))]),
);

/** Walk a dotted path. Returns the node, or undefined. */
const at = (obj, path) =>
  path.split(".").reduce((o, seg) => (o && typeof o === "object" ? o[seg] : undefined), obj);
const isLeaf = (v) => typeof v === "string";
const isBranch = (v) => v !== null && typeof v === "object";

/* ---------------------------------------------- 1 + 2: source references */

const files = [];
(function walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(tsx?|jsx?)$/.test(e)) files.push(p);
  }
})(join(REPO_ROOT, "src"));

/*
 * The binding form the app actually uses, in every file that uses one:
 *   const t  = useTranslations("overview.hero");
 *   const tc = await getTranslations("common");
 * A binding with no argument is a ROOT translator; its keys are absolute.
 */
const BIND = /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*(?:"([^"]*)"|'([^']*)'|`([^`${]*)`)?\s*\)/g;

const missing = [];   // { file, key, locales }
const dynamic = [];   // { file, prefix }
let literalCount = 0;
const unverifiable = [];

/*
 * NEAREST PRECEDING BINDING, not "the file's binding".
 *
 * One file routinely declares `const t = useTranslations(...)` more than once —
 * OverviewQueues.tsx has one per queue component, with different namespaces —
 * so a map keyed by variable name alone resolves the first component's keys
 * against the last component's namespace and reports 50 references missing that
 * are all present. Bindings are kept with their offset and each call site takes
 * the closest one above it, which is what lexical scope means here in practice.
 */
for (const file of files) {
  const src = readFileSync(file, "utf8");
  const binds = [];
  for (const m of src.matchAll(BIND)) {
    binds.push({ name: m[1], prefix: m[2] ?? m[3] ?? m[4] ?? "", at: m.index });
  }
  if (binds.length === 0) continue;
  const rel = file.slice(REPO_ROOT.length + 1);
  /*
   * A translator can also arrive as a FUNCTION PARAMETER
   * (`function f(row, t: (k: string) => string)`), and then its namespace is
   * the caller's, not anything this file states. Such a name is skipped rather
   * than resolved against whichever `useTranslations` happens to sit above it
   * -- which is how five real keys were first reported missing here. The count
   * is printed so the hole is visible instead of silent.
   */
  const names = [...new Set(binds.map((b) => b.name))].filter((n) => {
    const isParam = new RegExp(`\\b${n}\\s*:\\s*\\(`).test(src);
    if (isParam) unverifiable.push(`${rel}: ${n} (arrives as a parameter)`);
    return !isParam;
  });
  const prefixFor = (name, index) => {
    let best = null;
    for (const b of binds) if (b.name === name && b.at < index) best = b;
    return best?.prefix ?? null;
  };

  for (const name of names) {
    const full = (prefix, k) => (prefix ? `${prefix}.${k}` : k);
    const lit = new RegExp(`\\b${name}(?:\\.(?:rich|markup|has|raw))?\\(\\s*["']([^"'\\n]+)["']`, "g");
    for (const m of src.matchAll(lit)) {
      // `t.has` is a deliberate existence probe: a false answer is the point.
      if (m[0].includes(".has(")) continue;
      const prefix = prefixFor(name, m.index);
      if (prefix === null) continue; // a call above every binding is not one of ours
      literalCount += 1;
      const key = full(prefix, m[1]);
      const gone = ["en", "de"].filter((l) => !isLeaf(at(cat[l], key)));
      if (gone.length) missing.push({ file: rel, key, locales: gone.join(", ") });
    }
    // t(`a.b.${x}`) -- assert the static prefix is a real BRANCH.
    const dyn = new RegExp(`\\b${name}(?:\\.(?:rich|markup|raw))?\\(\\s*\`([^\`$]*)\\$\\{`, "g");
    for (const m of src.matchAll(dyn)) {
      const stem = m[1].replace(/\.$/, "");
      if (!stem) continue;
      const prefix = prefixFor(name, m.index);
      if (prefix === null) continue;
      const key = full(prefix, stem);
      const gone = ["en", "de"].filter((l) => !isBranch(at(cat[l], key)));
      dynamic.push({ file: rel, key, gone });
      if (gone.length) missing.push({ file: rel, key: `${key}.*`, locales: gone.join(", ") });
    }
  }
}

console.log(`\n--- 1. Literal key references resolve in both catalogues ---`);
console.log(`swept ${files.length} source files, ${literalCount} literal references, ${dynamic.length} dynamic ones`);
if (unverifiable.length) console.log(`not statically resolvable (${unverifiable.length}): ${unverifiable.join('; ')}`);
check(
  "every key the app asks for exists in en.json and de.json",
  missing.length === 0,
  missing.slice(0, 25).map((m) => `${m.file}: ${m.key} — missing in ${m.locales}`).join("\n        ") +
    (missing.length > 25 ? `\n        …and ${missing.length - 25} more` : ""),
);

/* --------------------------------------------------- 3: catalogue parity */

console.log(`\n--- 2. The two catalogues hold the same keys ---`);
const flatten = (obj, prefix = "", out = new Set()) => {
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (isLeaf(v)) out.add(path);
    else if (isBranch(v)) flatten(v, path, out);
  }
  return out;
};
const en = flatten(cat.en);
const de = flatten(cat.de);
const onlyEn = [...en].filter((k) => !de.has(k));
const onlyDe = [...de].filter((k) => !en.has(k));
console.log(`en ${en.size} keys, de ${de.size} keys`);
check(
  "no key exists in one language and not the other",
  onlyEn.length === 0 && onlyDe.length === 0,
  [
    onlyEn.length ? `EN only: ${onlyEn.slice(0, 15).join(", ")}${onlyEn.length > 15 ? ` …+${onlyEn.length - 15}` : ""}` : "",
    onlyDe.length ? `DE only: ${onlyDe.slice(0, 15).join(", ")}${onlyDe.length > 15 ? ` …+${onlyDe.length - 15}` : ""}` : "",
  ].filter(Boolean).join("\n        "),
);

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILURE(S)`);
process.exit(failed === 0 ? 0 : 1);
