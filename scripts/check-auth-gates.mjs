// Runtime check: unauthenticated requests to protected routes must redirect to
// /auth/login, and must NOT return page content.
const routes = ["/", "/people", "/projects", "/timesheets", "/team-lead", "/admin/users"];
const publicRoutes = ["/auth/login"];

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
  const leaked = status === 200 && /HSE HUB|Business overview|PENDING/.test(body);

  if (redirected && !leaked) {
    console.log(`PASS ${path} -> ${status} ${loc}`);
  } else {
    console.log(`FAIL ${path} -> ${status} ${loc}${leaked ? " (LEAKED CONTENT)" : ""}`);
    failed = true;
  }
}

for (const path of publicRoutes) {
  const { status } = await probe(path);
  if (status === 200) {
    console.log(`PASS ${path} -> 200 (public, reachable)`);
  } else {
    console.log(`FAIL ${path} -> ${status} (public route should be reachable)`);
    failed = true;
  }
}

process.exit(failed ? 1 : 0);
