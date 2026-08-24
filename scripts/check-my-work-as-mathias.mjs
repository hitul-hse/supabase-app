// The acceptance test for the whole session: sign in as Mathias for real, over
// PostgREST with a genuine user JWT (not a service-role key, not a direct
// superuser connection), and read exactly what the /my-work page reads.
//
// This is the only check that proves the browser will show him his customers.
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const EMAIL = "mathias@hs-experts.com";

// Mint a real session for Mathias without knowing his password: ask the admin
// API for a magiclink, then verify it. Nothing is changed and no password is reset.
const linkRes = await fetch(`${URL}/auth/v1/admin/generate_link`, {
  method: "POST",
  headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" },
  body: JSON.stringify({ type: "magiclink", email: EMAIL }),
});
if (!linkRes.ok) { console.log(`could not generate link: ${linkRes.status} ${(await linkRes.text()).slice(0, 200)}`); process.exit(1); }
const link = await linkRes.json();
// GoTrue versions differ on shape: some nest under `properties`, some are flat.
const hashed = link?.properties?.hashed_token ?? link?.hashed_token;
if (!hashed) { console.log(`unexpected link shape: ${JSON.stringify(link).slice(0, 300)}`); process.exit(1); }

const verify = await fetch(`${URL}/auth/v1/verify?token=${hashed}&type=magiclink`, {
  method: "GET", headers: { apikey: ANON }, redirect: "manual",
});
const loc = verify.headers.get("location") ?? "";
const token = new URLSearchParams(loc.split("#")[1] ?? "").get("access_token");
if (!token) { console.log(`no access_token in redirect: ${loc.slice(0, 200)}`); process.exit(1); }
console.log(`Signed in as ${EMAIL} with a real user JWT (not service-role).\n`);

const H = { apikey: ANON, Authorization: `Bearer ${token}` };
const get = async (path) => {
  const r = await fetch(`${URL}/rest/v1/${path}`, { headers: H });
  if (!r.ok) return { error: `${r.status} ${(await r.text()).slice(0, 160)}` };
  return r.json();
};

const profile = await get(`app_user_profile?select=person_id,role_key,department`);
console.log("his profile as the app sees it:", JSON.stringify(profile));
const personId = Array.isArray(profile) && profile[0] ? profile[0].person_id : null;

const owned = await get(`projects?select=id,name,customer&owner_person_id=eq.${personId}`);
const assigns = await get(`person_assignments?select=project_id&person_id=eq.${personId}`);
const resp = await get(`project_responsibility?select=project_id,role&person_id=eq.${personId}`);
const all = await get(`projects?select=id,name,customer,customer_legal_entity_id,department&limit=1000`);

const n = (x) => (Array.isArray(x) ? x.length : `ERR ${JSON.stringify(x).slice(0, 120)}`);
console.log(`\nOver PostgREST, as Mathias:`);
console.log(`   projects visible ........... ${n(all)}`);
console.log(`   he owns .................... ${n(owned)}`);
console.log(`   he is assigned to .......... ${n(assigns)}`);
console.log(`   responsibility rows ........ ${n(resp)}`);

if (Array.isArray(all) && Array.isArray(resp)) {
  const byId = new Map(all.map((p) => [p.id, p]));
  const responsible = resp.filter((r) => r.role === "responsible");
  const replacement = resp.filter((r) => r.role === "replacement");
  const custOf = (rows) => new Set(rows.map((r) => byId.get(r.project_id)?.customer).filter(Boolean));

  console.log(`\nMY CUSTOMERS, the question he actually asks:`);
  console.log(`   responsible for ............ ${custOf(responsible).size} customers`);
  console.log(`   replacement on ............. ${custOf(replacement).size} customers`);
  console.log(`   total distinct customers ... ${new Set(all.map((p) => p.customer).filter(Boolean)).size}`);
  console.log(`   projects with a department . ${all.filter((p) => p.department).length}/${all.length}`);
  console.log(`   projects FK-linked to entity ${all.filter((p) => p.customer_legal_entity_id).length}/${all.length}`);

  console.log(`\n   customers he is RESPONSIBLE for:`);
  for (const c of [...custOf(responsible)].sort()) console.log(`      - ${c}`);
}

// Negative control: the same anonymous endpoint must reveal nothing.
const anonRes = await fetch(`${URL}/rest/v1/projects?select=id&limit=5`, { headers: { apikey: ANON } });
const anonRows = anonRes.ok ? (await anonRes.json()).length : `blocked ${anonRes.status}`;
console.log(`\nnegative control - anonymous caller sees: ${anonRows} (must be 0 or blocked)`);
