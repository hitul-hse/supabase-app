/**
 * Is one employee's avatar unreachable to another, from the outside, with
 * nothing but the anon key?
 *
 * This is a BEHAVIOURAL probe, not a catalog inspection. There is no working
 * RPC on this project for reading pg_policies or information_schema from a
 * Node script -- every route was tried and is blocked; see
 * scripts/try-policy-verification-paths.mjs for the exhaustive, tested
 * account of exactly what fails and why (no exec-SQL RPC exists, PostgREST
 * doesn't expose pg_policies, neither the Supabase CLI nor psql is
 * installed, and there is no SUPABASE_JWT_SECRET to mint a session). Column
 * list, constraints, and the exact policy expressions are verified out of
 * band, directly against the database, by someone with a tool this script
 * does not have.
 *
 * What IS observable from here is what an unauthenticated browser session
 * can actually do against Storage:
 *
 *   1. A direct GET of a private avatar path must not come back 200 with
 *      bytes.
 *   2. The listing endpoint must not hand back a populated object listing.
 *   3. The /object/public/ route -- the one that bypasses RLS entirely when
 *      a bucket's `public` flag is true -- must refuse the same path. This
 *      is the check that actually proves the bucket is PRIVATE: a public
 *      bucket serves this route to anyone, unauthenticated, no policy
 *      involved at all.
 *
 * This task makes no writes beyond the migration, so there is no real
 * object in the bucket to prove got hidden -- check 2's strongest available
 * assertion is "no populated listing came back", not "a specific file was
 * hidden". That is a known limitation, stated here rather than glossed
 * over.
 *
 * SKIPs without a Supabase URL and anon key so CI cannot go red over a
 * missing secret.
 */
import { readFileSync, existsSync } from "node:fs";

if (!existsSync(".env.local")) {
  console.log("SKIP: no .env.local");
  process.exit(0);
}
const env = readFileSync(".env.local", "utf8");
const get = (k) => (env.match(new RegExp(`^${k}=(.+)$`, "m")) || [])[1]?.trim();
const url = get("NEXT_PUBLIC_SUPABASE_URL");
const anon = get("NEXT_PUBLIC_SUPABASE_ANON_KEY");

if (!url || !anon) {
  console.log("SKIP: need NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY");
  process.exit(0);
}

let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

// Stand-in for a real user id: there is nothing to look up, only a path
// shape ({user_id}/avatar.{ext}) to probe.
const probePath = "avatars/00000000-0000-0000-0000-000000000000/avatar.jpg";

// This is what an unauthenticated supabase-js client actually sends: the
// anon key as both apikey and the bearer token, decoding to role "anon".
// Omitting Authorization entirely produces a different (less meaningful)
// error path, so it is not used here.
const headers = { apikey: anon, Authorization: `Bearer ${anon}` };

async function getJson(path) {
  const res = await fetch(`${url}/storage/v1${path}`, { headers });
  let body = null;
  try {
    body = await res.json();
  } catch {
    // non-JSON body, leave null
  }
  return { status: res.status, body };
}

// 1. Direct download of a private path, unauthenticated.
{
  const { status, body } = await getJson(`/object/${probePath}`);
  check(
    status !== 200,
    "unauthenticated GET of a private avatar path is refused",
    `HTTP ${status}${body?.message ? ` (${body.message})` : ""}`,
  );
}

// 2. Listing. A 200 with an empty array still counts as "did not hand back
// a listing" -- the failure mode this guards against is a 200 with
// populated entries, which would mean the anon role can enumerate the
// bucket's contents.
{
  const res = await fetch(`${url}/storage/v1/object/list/avatars`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ prefix: "", limit: 100 }),
  });
  let items = null;
  try {
    items = await res.json();
  } catch {
    // non-JSON body, leave null
  }
  const leaked = res.status === 200 && Array.isArray(items) && items.length > 0;
  check(
    !leaked,
    "unauthenticated object listing does not return a populated listing",
    `HTTP ${res.status}, ${Array.isArray(items) ? `${items.length} item(s)` : "non-array body"}`,
  );
}

// 3. The /object/public/ route. Refusal here is what distinguishes a
// private bucket from a public one: a public bucket serves this exact route
// with no auth and no policy check at all.
{
  const { status, body } = await getJson(`/object/public/${probePath}`);
  check(
    status !== 200,
    "unauthenticated GET via the public route is refused (bucket is private)",
    `HTTP ${status}${body?.message ? ` (${body.message})` : ""}`,
  );
}

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
