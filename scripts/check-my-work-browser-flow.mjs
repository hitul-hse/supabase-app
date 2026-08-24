// Consume a real link the way a browser does: follow /auth/callback with a
// cookie jar, then GET /my-work with those cookies and confirm his data is in
// the HTML. This is the last check before handing a link to a human.
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const SB = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const SITE = "https://hseportal.hs-experts.com";
const EMAIL = process.argv[2] ?? "mathias@hs-experts.com";

const gen = await fetch(`${SB}/auth/v1/admin/generate_link`, {
  method: "POST",
  headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" },
  body: JSON.stringify({ type: "magiclink", email: EMAIL, options: { redirect_to: `${SITE}/auth/callback` } }),
});
const body = await gen.json();
const hashed = body?.properties?.hashed_token ?? body?.hashed_token;

// A minimal cookie jar. Next.js sets the session as chunked sb-* cookies.
const jar = new Map();
const absorb = (res) => {
  for (const raw of (res.headers.getSetCookie?.() ?? [])) {
    const [pair] = raw.split(";");
    const i = pair.indexOf("=");
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
};
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");

let url = `${SITE}/auth/callback?token_hash=${hashed}&type=magiclink&next=${encodeURIComponent("/my-work")}`;
console.log(`following the link as a browser would:\n`);

for (let hop = 0; hop < 6; hop++) {
  const res = await fetch(url, { headers: { cookie: cookieHeader() }, redirect: "manual" });
  absorb(res);
  const loc = res.headers.get("location");
  console.log(`  ${res.status}  ${url.replace(SITE, "").split("?")[0]}${loc ? `  ->  ${loc}` : ""}`);
  if (!loc) break;
  url = loc.startsWith("http") ? loc : `${SITE}${loc}`;
  if (url.includes("/auth/login?error")) {
    console.log(`\n  LANDED ON AN ERROR: ${decodeURIComponent(url.split("error=")[1] ?? "")}`);
    process.exit(1);
  }
}

console.log(`\n  session cookies obtained: ${[...jar.keys()].filter((k) => k.startsWith("sb-")).length}`);

const page = await fetch(`${SITE}/my-work`, { headers: { cookie: cookieHeader() } });
const html = await page.text();
console.log(`\nGET /my-work with that session -> ${page.status}, ${html.length} bytes`);

// Look for his real data in the rendered markup, not for strings I hope exist.
const needles = [
  ["HOCHTIEF Infrastructure GmbH", "a customer he is responsible for"],
  ["BerlinAnalytix GmbH", "a customer he is responsible for"],
  ["On Cloud Service GmbH", "a customer he is responsible for"],
  ["Stiftung Topographie des Terrors", "a customer he is responsible for"],
];
console.log("");
for (const [n, why] of needles) {
  console.log(`  ${html.includes(n) ? "FOUND  " : "missing"}  ${n}   (${why})`);
}
// RoleBadge renders UPPERCASE labels (read from the component, not guessed).
const roleWords = ["RESPONSIBLE", "REPLACEMENT", "OWNER", "ASSIGNED"];
console.log(`\n  role labels present: ${roleWords.filter((w) => html.includes(w)).join(", ") || "none"}`);
if (page.status === 200 && !html.includes("HOCHTIEF")) {
  console.log(`\n  page rendered but his data is absent - dumping a slice for diagnosis:`);
  const i = Math.max(0, html.indexOf("my-work"));
  console.log(html.slice(i, i + 600).replace(/\s+/g, " "));
}
