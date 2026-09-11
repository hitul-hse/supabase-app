/*
 * Render the app's real client components to HTML from a bare Node script.
 *
 * WHY THIS EXISTS
 * ---------------
 * check-table-width.mjs has to measure the tables that SHIP -- their real
 * column definitions, their real class strings, their real header words -- in
 * a real browser, and it has to be able to do that without production
 * credentials, or its before/after evidence could only ever be produced on the
 * one machine that holds them. Asserting on source text would prove nothing
 * about widths; a reimplementation of a table would prove things about the
 * reimplementation.
 *
 * So this transpiles the actual .tsx with the real TypeScript compiler
 * (the same approach check-data-table-primitive.mjs takes inline), resolves
 * "@/..." the way tsconfig does, and replaces ONLY the modules that exist
 * solely inside a Next request:
 *
 *   next-intl        -> a translator over the real messages/<locale>.json, so the
 *                       headers measured are the words the page prints
 *   next/link        -> a plain <a>
 *   next/navigation  -> useSearchParams over a string the caller sets, so a
 *                       URL-driven view (/my-work?view=customers) can be chosen
 *   server actions,  -> inert stubs: nothing here is ever invoked, the module
 *   request caches      only has to load for the component to render
 *
 * Every stub is listed by name in STUB below rather than caught by a blanket
 * "if it fails to load, fake it", because a blanket fallback would also fake a
 * genuinely broken import in a table, which is a real defect.
 */
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createTranslator } from "next-intl";

const require_ = createRequire(pathToFileURL(resolvePath("scripts/_x.cjs")));

/** Per-render context the shims read. Set through `renderWith`. */
const ctx = { locale: "en", search: "" };

const messagesFor = (() => {
  const cache = {};
  return (locale) =>
    (cache[locale] ??= JSON.parse(readFileSync(resolvePath(`messages/${locale}.json`), "utf8")));
})();

/** A module whose every export is an inert function. Only for modules named in STUB. */
const inert = () =>
  new Proxy(
    { __esModule: true },
    { get: (target, key) => (key in target ? target[key] : () => undefined) },
  );

const SHIMS = {
  "next-intl": () => ({
    __esModule: true,
    // Resolved at CALL time, so one loaded module can render in either locale.
    useTranslations: (namespace) =>
      createTranslator({ locale: ctx.locale, messages: messagesFor(ctx.locale), namespace }),
    useLocale: () => ctx.locale,
  }),
  "next/link": () => ({
    __esModule: true,
    // next/link's routing props (prefetch, scroll, replace) are not attributes
    // an <a> can carry, so only the ones an anchor understands pass through.
    default: ({ href, children, className, title, target, rel, onClick, ...routing }) =>
      React.createElement(
        "a",
        {
          href: typeof href === "string" ? href : String(href),
          className, title, target, rel, onClick,
          "aria-label": routing["aria-label"],
        },
        children,
      ),
  }),
  "next/navigation": () => ({
    __esModule: true,
    useSearchParams: () => new URLSearchParams(ctx.search),
    usePathname: () => "/",
    useRouter: () => ({ push() {}, replace() {}, refresh() {}, back() {}, prefetch() {} }),
  }),
  "server-only": () => ({}),
};

/**
 * Modules replaced by an inert stub, matched on the resolved path. Each is a
 * server boundary: a "use server" action file or the request-scoped Supabase
 * plumbing. None of them contributes a single element to a table's markup.
 */
const STUB = [
  /\/actions\.tsx?$/,
  /\/lib\/queries\/request-cache\.ts$/,
  /\/lib\/queries\/paged\.ts$/,
  /\/lib\/supabase\//,
  /\/lib\/budget-visibility\.ts$/,
];

const cache = new Map();

function load(abs) {
  if (cache.has(abs)) return cache.get(abs);
  if (STUB.some((re) => re.test(abs.replace(/\\/g, "/")))) {
    const stub = inert();
    cache.set(abs, stub);
    return stub;
  }
  const out = ts.transpileModule(readFileSync(abs, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.React,
      esModuleInterop: true,
    },
    fileName: abs,
  }).outputText;

  const module_ = { exports: {} };
  cache.set(abs, module_.exports);
  const localRequire = (spec) => {
    if (spec === "react") return React;
    if (SHIMS[spec]) return SHIMS[spec]();
    if (spec.startsWith("@/")) return loadAny(resolvePath("src", spec.slice(2)));
    if (spec.startsWith(".")) return loadAny(resolvePath(dirname(abs), spec));
    return require_(spec);
  };
  // `jsx: React` emits bare React.createElement calls in sources that never
  // import React (the automatic runtime makes that unnecessary in the app), so
  // React is injected as a scope parameter.
  new Function("require", "module", "exports", "React", out)(
    localRequire, module_, module_.exports, React,
  );
  if (abs.replace(/\\/g, "/").endsWith("/components/data-table/DataTable.tsx")) {
    openEveryPanel(module_.exports);
  }
  cache.set(abs, module_.exports);
  return module_.exports;
}

/**
 * Render every collapsible DataTable OPEN.
 *
 * Three of the four /time/dashboard tables ship `defaultOpen={false}`, and a
 * shut panel renders no <table> at all -- so a static render would measure
 * nothing and call it a pass. Open is the state in which a reader actually
 * meets the columns, so it is the state measured. The consumers read
 * `DataTable_1.DataTable` at call time (TypeScript's CommonJS emit, and the
 * barrel's re-export getter), so replacing the export here reaches all of them.
 */
function openEveryPanel(exports) {
  const Original = exports.DataTable;
  const Opened = (props) => React.createElement(Original, { ...props, defaultOpen: true });
  exports.DataTable = Opened;
}

function loadAny(base) {
  for (const ext of ["", ".tsx", ".ts", "/index.ts", "/index.tsx"]) {
    const candidate = base + ext;
    if (ext === "" && !/\.(tsx?|mjs|js)$/.test(candidate)) continue;
    if (existsSync(candidate)) return load(candidate);
  }
  throw new Error(`cannot resolve ${base}`);
}

/** Load a .ts/.tsx module from the repo, e.g. "src/components/x.tsx". */
export function loadTsx(file) {
  return loadAny(resolvePath(file));
}

/**
 * Render an element to static markup with the shims pointed at `locale` and
 * `search` (a query string, without the "?").
 */
export function renderWith(element, { locale = "en", search = "" } = {}) {
  ctx.locale = locale;
  ctx.search = search;
  return renderToStaticMarkup(element);
}

export { React };
