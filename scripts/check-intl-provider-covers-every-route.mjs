/*
 * Can every route render, or only the ones inside the (app) group?
 *
 * THE INCIDENT (2026-09-11). Production answered 500 six times on
 * /access-pending at 16:32. That is the page an account with no provisioned role
 * is redirected to, so the person seeing the crash was somebody signing in for
 * the first time, told nothing at all instead of "ask an admin to provision your
 * access". hitul hit it himself with his second address.
 *
 * The cause was structural rather than local. `NextIntlClientProvider` was
 * mounted in `src/app/(app)/layout.tsx` and nowhere else, so every route OUTSIDE
 * that group -- /access-pending, /portal, /auth/*, /demo, /video -- rendered with
 * no message context above it. Any client component under them calling
 * `useTranslations()` threw at render, and the whole route answered 500.
 * /access-pending and /portal both render `LogoutButton`, which does exactly
 * that. /portal had simply not been opened.
 *
 * Nothing caught it because nothing looked. The i18n gates check that keys exist
 * and match between catalogues; none of them asks whether the component that
 * reads a key is underneath a provider.
 *
 * WHAT THIS ASSERTS
 *
 *   1. The ROOT layout mounts the provider, so every route in the app is covered
 *      rather than only one group.
 *   2. Every page outside (app) is enumerated, and for each one, every client
 *      component it imports that calls useTranslations is listed. If the root
 *      provider is ever removed, that list becomes the blast radius and the
 *      first assertion fails.
 *
 * WHAT IT DOES NOT ASSERT. That the page renders. That needs a server and a
 * session, and the browser gates own that. This is the cheap, always-runnable
 * half: the structural precondition without which those pages cannot render at
 * all.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, dirname, resolve } from "node:path";
import { REPO_ROOT } from "./lib/repo-root.mjs";
import { record } from "./lib/gate-result.mjs";

let failures = 0;
const check = (label, ok, detail = "") => {
  record(ok);
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${!ok && detail ? `\n        ${detail}` : ""}`);
  if (!ok) failures += 1;
};

const APP = join(REPO_ROOT, "src", "app");
const read = (p) => readFileSync(p, "utf8");
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

/* ------------------------------------------------- 1. the root layout covers */

const rootLayout = join(APP, "layout.tsx");
check("the root layout exists", existsSync(rootLayout));

const rootSrc = stripComments(read(rootLayout));
const providesAtRoot = (s) =>
  /<NextIntlClientProvider\b/.test(s) &&
  /from\s+["']next-intl["']/.test(s) &&
  /getMessages\s*\(/.test(s);

check(
  "the root layout mounts NextIntlClientProvider with real messages",
  providesAtRoot(rootSrc),
  "without this, every route outside the (app) group renders with no message context and any client component calling useTranslations throws",
);

/* The provider must wrap the children, not sit beside them. */
check(
  "and it wraps {children}",
  /<NextIntlClientProvider[^>]*>[\s\S]*\{children\}[\s\S]*<\/NextIntlClientProvider>/.test(rootSrc),
);

/* ---------------------------------- 2. what depends on it, named explicitly */

const pagesOutsideApp = walk(APP)
  .filter((f) => /[/\\]page\.tsx$/.test(f))
  .filter((f) => !f.includes(`${join("src", "app", "(app)")}`))
  .map((f) => relative(REPO_ROOT, f));

check(
  "there are routes outside the (app) group at all",
  pagesOutsideApp.length >= 3,
  `${pagesOutsideApp.length} found; if this is 0 the walk is broken and the rest is vacuous`,
);

/** Resolve a relative or @/ import to a file on disk, if it is one of ours. */
function resolveImport(fromFile, spec) {
  let base;
  if (spec.startsWith("@/")) base = join(REPO_ROOT, "src", spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(join(REPO_ROOT, fromFile)), spec);
  else return null;
  for (const ext of [".tsx", ".ts", "/index.tsx", "/index.ts"]) {
    if (existsSync(base + ext)) return relative(REPO_ROOT, base + ext);
  }
  return existsSync(base) ? relative(REPO_ROOT, base) : null;
}

const dependants = [];
for (const page of pagesOutsideApp) {
  const src = stripComments(read(join(REPO_ROOT, page)));
  for (const m of src.matchAll(/import\s+[^"']*?from\s+["']([^"']+)["']/g)) {
    const target = resolveImport(page, m[1]);
    if (!target) continue;
    const t = stripComments(read(join(REPO_ROOT, target)));
    if (/^\s*["']use client["']/m.test(t) && /useTranslations\s*\(/.test(t)) {
      dependants.push({ page, component: target });
    }
  }
}

console.log(
  dependants.length
    ? `NOTE: ${dependants.length} page/component pair(s) outside (app) depend on the root provider:\n` +
        dependants.map((d) => `        ${d.page} -> ${d.component}`).join("\n")
    : "NOTE: no page outside (app) currently imports a translating client component directly.",
);

check(
  "the pages that depend on the root provider are the ones this gate knows about",
  dependants.every((d) => pagesOutsideApp.includes(d.page)),
);

/* ------------------------------------------------------- negative controls */

check(
  "[control] a layout with no provider WOULD be caught",
  providesAtRoot(rootSrc.replace(/<NextIntlClientProvider[\s\S]*?>/, "<div>")) === false,
);
check(
  "[control] a layout that imports the provider but never mounts it WOULD be caught",
  providesAtRoot(
    rootSrc.replace(/<NextIntlClientProvider\b/g, "<SomethingElse").replace(/<\/NextIntlClientProvider>/g, "</SomethingElse>"),
  ) === false,
);
check(
  "[control] a layout that mounts it with no messages WOULD be caught",
  providesAtRoot(rootSrc.replace(/getMessages\s*\(/g, "noMessages(")) === false,
);

console.log(failures === 0 ? "\nINTL PROVIDER COVERAGE: OK" : `\nINTL PROVIDER COVERAGE: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
