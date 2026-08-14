// Runtime check: unauthenticated requests to protected routes must redirect to
// /auth/login, and must NOT return page content.
const routes = ["/", "/people", "/projects", "/timesheets", "/team-lead", "/admin/users"];
// Public auth routes must be reachable without a session AND must not render
// any record data. Password-reset routes have to be public because the invite
// credential arrives in the URL fragment, which never reaches the server.
const publicRoutes = ["/auth/login", "/auth/forgot-password", "/auth/set-password"];

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
