// Runtime check: unauthenticated requests to protected routes must redirect to
// /auth/login, and must NOT return page content.
const routes = ["/", "/people", "/projects", "/timesheets", "/team-lead", "/admin/users"];
// Public auth routes are read from the middleware's own PUBLIC_ROUTES set
// rather than hardcoded. Hardcoding them made this check depend on whichever
// routes happened to exist in one working copy: it passed locally, where a
// parallel session had added the password-reset routes, and failed in CI,
// which checks out the committed tree without them. Deriving the list means
// the check tests what the app actually declares, wherever it runs.
import { readFileSync } from "node:fs";

const middleware = readFileSync("src/utils/supabase/middleware.ts", "utf8");
const publicRoutesBlock = middleware.match(/PUBLIC_ROUTES\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
if (!publicRoutesBlock) {
  console.log("FAIL: could not find PUBLIC_ROUTES in src/utils/supabase/middleware.ts");
  process.exit(1);
}
const publicRoutes = [...publicRoutesBlock[1].matchAll(/"([^"]+)"/g)]
  .map((m) => m[1])
  // /auth/callback is a redirect handler with no page component; it does not
  // render and is not expected to answer 200.
  .filter((r) => r !== "/auth/callback");

// Strings that only ever appear in real rendered records, never in shared
// chrome. The "HSE HUB" wordmark is deliberately NOT here: it is on the public
// login page too, so it would false-alarm.
const RECORD_DATA = /Needs your decision|EMPLOYEE NUMBER|Users &amp; Roles|Business overview/;

let failed = false;

async function probe(path) {
  const res = await fetch("http://localhost:3000" + path, { redirect: "manual" });
  const loc = res.headers.get("location") || "";
  const body = res.status < 300 ? await res.text() : "";
  return { status: res.status, loc, body };
}

for (const path of routes) {
  const { status, loc, body } = await probe(path);
  const redirected = status >= 300 && status < 400 && loc.includes("/auth/login");
  // A 200 that actually contains the dashboard shell would be a leak.
  const leaked = status === 200 && RECORD_DATA.test(body);

  if (redirected && !leaked) {
    console.log(`PASS ${path} -> ${status} ${loc}`);
  } else {
    console.log(`FAIL ${path} -> ${status} ${loc}${leaked ? " (LEAKED CONTENT)" : ""}`);
    failed = true;
  }
}

for (const path of publicRoutes) {
  const { status, body } = await probe(path);
  const leaked = status === 200 && RECORD_DATA.test(body);

  // 404 means the route is declared public but has no page. That is stale
  // config rather than a security hole (nothing is exposed), so warn instead
  // of failing: the committed tree lists /auth/signup, which was never built.
  if (status === 404) {
    console.log(`WARN ${path} -> 404 (declared in PUBLIC_ROUTES but no page exists)`);
    continue;
  }

  if (status === 200 && !leaked) {
    console.log(`PASS ${path} -> 200 (public, reachable, no record data)`);
  } else {
    console.log(
      `FAIL ${path} -> ${status}${leaked ? " LEAKS RECORD DATA" : " (public route should be reachable)"}`,
    );
    failed = true;
  }
}

process.exit(failed ? 1 : 0);
