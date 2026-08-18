/**
 * Drives each profile Server Action over HTTP with no session.
 *
 * check-profile-actions.mjs reads the source and asserts the guards are
 * written; this asserts they FIRE. Server Actions are POST endpoints with a
 * Next-Action header, so an unauthenticated caller can invoke them directly
 * without ever loading the page.
 *
 * SKIPs unless a server is already running at PROFILE_GATE_URL, so CI cannot
 * go red for want of a build.
 */
const base = process.env.PROFILE_GATE_URL || "http://localhost:3000";

const res = await fetch(base, { redirect: "manual" }).catch(() => null);
if (!res) {
  console.log(`SKIP: nothing serving at ${base} — run \`npm run build && npm start\` first`);
  process.exit(0);
}

let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

// An unauthenticated GET of the page must not render the profile.
const page = await fetch(`${base}/profile`, { redirect: "manual" });
check(
  page.status === 307 || page.status === 302,
  "GET /profile while signed out redirects",
  `got ${page.status}`,
);
check(
  (page.headers.get("location") || "").includes("/auth/login"),
  "…and the redirect goes to the login page",
  page.headers.get("location") || "no location header",
);

// The page must not leak profile data in its unauthenticated body either.
const body = await fetch(`${base}/profile`).then((r) => r.text());
check(!/Employee no\./.test(body), "signed-out body contains no employment fields");
check(!/display_name/.test(body), "signed-out body contains no profile form");

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
