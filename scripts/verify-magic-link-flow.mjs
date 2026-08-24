// Prove the magic link works end to end against PRODUCTION and that /my-work
// renders Mathias's real data, before handing a link to a human. Testing the
// link myself would consume it (single use), so this mints a second one.
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const SB = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const SITE = "https://hseportal.hs-experts.com";
const EMAIL = "mathias@hs-experts.com";

// 1. mint + consume a link, exactly as the browser would
const gen = await fetch(`${SB}/auth/v1/admin/generate_link`, {
  method: "POST",
  headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" },
  body: JSON.stringify({ type: "magiclink", email: EMAIL, options: { redirect_to: `${SITE}/auth/callback` } }),
});
const body = await gen.json();
const hashed = body?.properties?.hashed_token ?? body?.hashed_token;

const verify = await fetch(`${SB}/auth/v1/verify?token=${hashed}&type=magiclink&redirect_to=${encodeURIComponent(`${SITE}/auth/callback`)}`,
  { headers: { apikey: ANON }, redirect: "manual" });

const loc = verify.headers.get("location") ?? "";
console.log(`verify -> ${verify.status}`);
console.log(`redirects to: ${loc.split("#")[0]}${loc.includes("#") ? "#<tokens>" : ""}`);

// The callback route may receive the session either as a hash fragment or as a
// ?code= to exchange. Report which, since it decides whether the browser flow
// completes.
const hasHashTokens = loc.includes("access_token=");
const hasCode = /[?&]code=/.test(loc);
console.log(`carries: ${hasHashTokens ? "hash tokens" : ""}${hasCode ? "?code= (PKCE exchange)" : ""}`);

const token = new URLSearchParams(loc.split("#")[1] ?? "").get("access_token");
if (!token) {
  console.log("\nNo access_token in the fragment. If it carried ?code=, the browser flow still works");
  console.log("because /auth/callback exchanges it server-side; this script just cannot follow that.");
  process.exit(0);
}

// 2. read what the page reads, with that session
const H = { apikey: ANON, Authorization: `Bearer ${token}` };
const get = async (p) => { const r = await fetch(`${SB}/rest/v1/${p}`, { headers: H }); return r.ok ? r.json() : { err: r.status }; };

const prof = await get("app_user_profile?select=person_id,role_key,department");
const projects = await get("projects?select=id,customer&limit=1000");
const resp = await get(`project_responsibility?select=project_id,role&person_id=eq.${prof[0]?.person_id}`);

console.log(`\nWith that session, over the live API:`);
console.log(`   profile ............ ${JSON.stringify(prof)}`);
console.log(`   projects visible ... ${Array.isArray(projects) ? projects.length : JSON.stringify(projects)}`);
console.log(`   customers .......... ${Array.isArray(projects) ? new Set(projects.map((p) => p.customer).filter(Boolean)).size : "?"}`);
if (Array.isArray(resp)) {
  const byId = new Map(projects.map((p) => [p.id, p]));
  const cust = (role) => new Set(resp.filter((r) => r.role === role).map((r) => byId.get(r.project_id)?.customer).filter(Boolean));
  console.log(`   responsible for .... ${cust("responsible").size} customers`);
  console.log(`   replacement on ..... ${cust("replacement").size} customers`);
}

// 3. does the deployed bundle actually contain the page?
const page = await fetch(`${SITE}/my-work`, { redirect: "manual" });
console.log(`\nGET ${SITE}/my-work (no cookie) -> ${page.status} ${page.headers.get("location") ?? ""}`);
console.log(page.status === 307 ? "   307 to login = route EXISTS and is auth-gated (404 would mean not deployed)" : "");
