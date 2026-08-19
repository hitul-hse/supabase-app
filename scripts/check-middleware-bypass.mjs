// The real test for bug #2. CVE-2025-29927 lets an attacker skip Next.js
// middleware entirely via the x-middleware-subrequest header. If the pages have
// no gate of their own, that header exposes them. Before the fix, "/" and
// /people /projects /timesheets returned full dashboard HTML here.
//
// The route list is DERIVED, not hardcoded. It used to be a literal array of six
// paths, which meant every route added afterwards was exempt from the only check
// for this bypass: /leave, /admin/roles, /time and /time/dashboard were all
// unprobed, and /time serves real tracked hours. A hardcoded list fails in the
// worst direction here -- it stays green while coverage shrinks. Mirrors the same
// fix in check-auth-gates.mjs.
import { readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Every page under src/app/(app), the authenticated route group.
 *
 * Parenthesised directories are route groups and contribute nothing to the URL.
 * Dynamic segments are skipped: probing `/projects/[id]` literally would 404 for
 * reasons that say nothing about a middleware bypass.
 */
function discoverRoutes(dir = "src/app/(app)", prefix = "") {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name === "page.tsx") {
      found.push(prefix === "" ? "/" : prefix);
      continue;
    }
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith("[")) continue;
    const segment = entry.name.startsWith("(") ? "" : `/${entry.name}`;
    found.push(...discoverRoutes(join(dir, entry.name), prefix + segment));
  }
  return found;
}

const protectedRoutes = discoverRoutes().sort();
if (protectedRoutes.length === 0) {
  console.log("FAIL: found no pages under src/app/(app) — the route scan is broken");
  process.exit(1);
}

// Depth-padded value covering the known variants of the bypass.
const payloads = [
  "proxy",
  "middleware",
  "src/middleware",
  "proxy:proxy:proxy:proxy:proxy:proxy",
  "middleware:middleware:middleware:middleware:middleware:middleware",
];

console.log(
  `probing ${protectedRoutes.length} routes x ${payloads.length} bypass payloads: ` +
    protectedRoutes.join(", "),
);

let failed = false;

for (const path of protectedRoutes) {
  for (const payload of payloads) {
    const res = await fetch("http://localhost:3000" + path, {
      redirect: "manual",
      headers: { "x-middleware-subrequest": payload },
    });

    const body = res.status === 200 ? await res.text() : "";
    // Match on real record data, not on shared chrome. "HSE HUB" appears in the
    // logo wordmark on the public login page too, so keying off it produces
    // false alarms; these strings only ever appear in rendered table rows.
    // "Utilisation by person", not "Business overview": the Overview H1 was
    // renamed to the plain noun "Overview", which also appears in the sidebar
    // and is therefore not a leak signal. This card heading renders only on the
    // authenticated page.
    const leaked =
      /Needs your decision|EMPLOYEE NUMBER|Users &amp; Roles|Utilisation by person/.test(
        body,
      );

    if (leaked) {
      console.log(`FAIL ${path} [${payload}] -> 200 LEAKED PROTECTED CONTENT`);
      failed = true;
    }
  }
}

if (!failed) {
  console.log(
    `PASS: no protected content leaked across ${protectedRoutes.length} routes x ${payloads.length} bypass payloads`,
  );
}

process.exit(failed ? 1 : 0);
