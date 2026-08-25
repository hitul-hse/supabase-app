// A policy named "Allow anon read access to netflix_users" with USING (true) is
// a finding only if the table is actually reachable from the internet. Prove it
// with an unauthenticated request against the live API, using the public anon
// key exactly as any visitor could.
//
// This is the difference between a scary-looking policy and a live exposure.
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync("C:/Supabase/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// The anon key is designed to be public - it ships in the browser bundle - so
// this is exactly what an unauthenticated visitor can do.
const get = async (path) => {
  const r = await fetch(`${URL_}/rest/v1/${path}`, { headers: { apikey: ANON } });
  const body = await r.text();
  return { status: r.status, len: body.length, sample: body.slice(0, 180) };
};

console.log("UNAUTHENTICATED requests with the public anon key:\n");

for (const t of [
  "netflix_users?select=*&limit=3",
  "netflix_overview?select=*",
  "netflix_country_stats?select=*&limit=3",
  "netflix_genre_stats?select=*&limit=3",
  "netflix_subscription_stats?select=*",
]) {
  const r = await get(t);
  const reachable = r.status === 200 && r.sample.trim() !== "[]";
  console.log(`  ${r.status} ${reachable ? "READABLE" : "blocked/empty"}  ${t.split("?")[0]}`);
  if (reachable) console.log(`        ${r.sample.replace(/\s+/g, " ").slice(0, 150)}`);
}

console.log("\nControl - the real business tables must NOT be readable anonymously:");
for (const t of ["projects?select=id&limit=2", "people?select=id&limit=2", "app_user_profile?select=user_id&limit=2"]) {
  const r = await get(t);
  const leaked = r.status === 200 && r.sample.trim() !== "[]";
  console.log(`  ${r.status} ${leaked ? "*** LEAKED ***" : "correctly blocked"}  ${t.split("?")[0]}`);
}

// How many rows can one anonymous request pull?
const bulk = await fetch(`${URL_}/rest/v1/netflix_users?select=*`, {
  headers: { apikey: ANON, Prefer: "count=exact", Range: "0-0" },
});
console.log(`\nrow count advertised to an anonymous caller: ${bulk.headers.get("content-range") ?? "(none)"}`);
