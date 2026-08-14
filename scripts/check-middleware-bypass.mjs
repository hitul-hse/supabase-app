// The real test for bug #2. CVE-2025-29927 lets an attacker skip Next.js
// middleware entirely via the x-middleware-subrequest header. If the pages have
// no gate of their own, that header exposes them. Before the fix, "/" and
// /people /projects /timesheets returned full dashboard HTML here.
const protectedRoutes = ["/", "/people", "/projects", "/timesheets", "/team-lead", "/admin/users"];

// Depth-padded value covering the known variants of the bypass.
const payloads = [
  "proxy",
  "middleware",
  "src/middleware",
  "proxy:proxy:proxy:proxy:proxy:proxy",
  "middleware:middleware:middleware:middleware:middleware:middleware",
];

let failed = false;

for (const path of protectedRoutes) {
  for (const payload of payloads) {
    const res = await fetch("http://localhost:3000" + path, {
      redirect: "manual",
      headers: { "x-middleware-subrequest": payload },
    });

    const body = res.status === 200 ? await res.text() : "";
    const leaked = /Business overview|Needs your decision|EMPLOYEE NUMBER|Users &amp; Roles|PENDING/.test(
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
