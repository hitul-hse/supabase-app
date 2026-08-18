/**
 * WHAT THIS GATE PROVES, AND WHAT IT DOES NOT.
 *
 * Proves:
 *   - The avatars bucket is PRIVATE, not merely empty: an unauthenticated
 *     (anon) caller is refused both the direct object route and the
 *     /object/public/ route -- the one that bypasses RLS entirely when a
 *     bucket's `public` flag is true -- against a fixture object that
 *     DEFINITELY EXISTS (uploaded with the service-role key immediately
 *     before the assertion). A guessed, never-uploaded path would return
 *     "not found" regardless of whether any policy exists at all, so it
 *     would prove nothing; a fixture that is really there and still
 *     refused is the only signal that means anything.
 *
 * Does NOT and CANNOT prove:
 *   - Per-user isolation, i.e. that authenticated employee A cannot read
 *     employee B's avatar. All four avatars_* policies are declared
 *     `to authenticated`. This gate's prober carries the ANON key, whose
 *     JWT has `role: "anon"` and no `auth.uid()` at all. Postgres matches
 *     RLS policies by role BEFORE evaluating their `using`/`with check`
 *     clause -- a policy scoped `to authenticated` simply does not apply
 *     to a request presenting role `anon`, no matter what that clause
 *     says. So an anon-only prober cannot distinguish a correctly
 *     isolated policy (`... and (storage.foldername(name))[1] =
 *     auth.uid()::text`) from a broken one that grants every authenticated
 *     user access to every avatar (`using (bucket_id = 'avatars')` alone)
 *     -- both are equally invisible to `anon`, both give the exact same
 *     result here.
 *
 *   This was not a theoretical concern: a mutation test was run against
 *   this exact gate -- the `auth.uid()` clause was temporarily dropped
 *   from `avatars_select_own` on the live project, the gate was re-run,
 *   and it stayed GREEN. The policy was restored immediately afterward
 *   (verified byte-identical to the migration -- see task-1-report.md).
 *   That confirmed, empirically, that no rewording of this gate's anon-only
 *   assertions can ever catch that class of bug. Proving isolation for
 *   real would require a second genuine authenticated identity (a real
 *   sign-in or a minted JWT), which this invite-only production project
 *   has no safe way to do from a Node script -- see
 *   scripts/try-policy-verification-paths.mjs. Per-user isolation of the
 *   `auth.uid()` clause is therefore verified out of band, by reading the
 *   live policy catalog directly, by someone with a tool this script does
 *   not have -- not by this gate.
 *
 * WHAT THIS GATE DOES:
 *   1. Uploads a real fixture object with the SERVICE ROLE key (bypasses
 *      RLS -- correct for seeding test data) at a SENTINEL path:
 *      avatars/00000000-0000-0000-0000-000000000000/avatar.png. All-zero
 *      uuid, because no real auth.uid() can ever equal it, so this fixture
 *      can never collide with an actual employee's photo.
 *   2. With ONLY the anon key -- an unauthenticated caller -- asserts a GET
 *      of that exact, now-existing key is refused.
 *   3. Also asserts the /object/public/ route refuses the same existing
 *      key -- the check that actually proves the bucket is private rather
 *      than merely empty.
 *   4. Deletes the fixture in a `finally`, so a failed or interrupted run
 *      leaves nothing behind.
 *
 * This is a BEHAVIOURAL probe, not a catalog inspection. There is no working
 * RPC on this project for reading pg_policies or information_schema from a
 * Node script -- every route was tried and is blocked; see
 * scripts/try-policy-verification-paths.mjs for the exhaustive, tested
 * account of exactly what fails and why (no exec-SQL RPC exists, PostgREST
 * doesn't expose pg_policies, neither the Supabase CLI nor psql is
 * installed, and there is no SUPABASE_JWT_SECRET to mint a session). Column
 * list, constraints, and the exact policy expressions -- including the
 * per-user auth.uid() isolation this gate cannot observe -- are verified
 * out of band, directly against the database, by someone with a tool this
 * script does not have.
 *
 * SKIPs without a Supabase URL and anon key, same as every other gate here.
 * It also SKIPs -- honestly, saying so -- without a service-role key, since
 * without one it cannot create the fixture and has nothing meaningful to
 * assert. A gate that quietly fell back to probing a nonexistent path would
 * look green while proving nothing; this one says plainly that it did
 * nothing instead.
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
const service = get("SUPABASE_SERVICE_ROLE_KEY");

if (!url || !anon) {
  console.log("SKIP: need NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY");
  process.exit(0);
}
if (!service) {
  console.log(
    "SKIP: need SUPABASE_SERVICE_ROLE_KEY to create the fixture this gate\n" +
      "      probes. Without it there is no way to tell a correctly-enforced\n" +
      "      policy apart from a missing one, so this gate refuses to fall\n" +
      "      back to a weaker probe that would look green either way -- it\n" +
      "      SKIPs and says so, rather than silently proving nothing.",
  );
  process.exit(0);
}

let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

// All-zero sentinel: no real auth.uid() can ever equal this, so the fixture
// can never collide with a real employee's photo.
const SENTINEL_USER = "00000000-0000-0000-0000-000000000000";
const objectPath = `${SENTINEL_USER}/avatar.png`;
// Contents are irrelevant -- the migration sets no MIME/size restriction on
// this bucket -- only that a real object exists at this key.
const fixtureBytes = Buffer.from("check-profile-rls fixture, safe to delete");

async function uploadFixture() {
  const res = await fetch(`${url}/storage/v1/object/avatars/${objectPath}`, {
    method: "POST",
    headers: {
      apikey: service,
      Authorization: `Bearer ${service}`,
      "Content-Type": "application/octet-stream",
      "x-upsert": "true",
    },
    body: fixtureBytes,
  });
  if (!res.ok) {
    throw new Error(`fixture upload failed: HTTP ${res.status} ${await res.text()}`);
  }
}

async function deleteFixture() {
  const res = await fetch(`${url}/storage/v1/object/avatars/${objectPath}`, {
    method: "DELETE",
    headers: { apikey: service, Authorization: `Bearer ${service}` },
  });
  if (!res.ok) {
    console.log(`WARNING: fixture teardown failed: HTTP ${res.status} ${await res.text()}`);
  }
}

// This is what an unauthenticated supabase-js client actually sends: the
// anon key as both apikey and the bearer token, decoding to role "anon".
const anonHeaders = { apikey: anon, Authorization: `Bearer ${anon}` };

async function getAsAnon(path) {
  const res = await fetch(`${url}/storage/v1${path}`, { headers: anonHeaders });
  let body = null;
  try {
    body = await res.json();
  } catch {
    // non-JSON body, leave null
  }
  return { status: res.status, body };
}

try {
  await uploadFixture();

  // 1. The fixture DEFINITELY exists. If this comes back 200, the SELECT
  // policy either does not restrict by auth.uid() or is missing entirely --
  // exactly the failure this task exists to prevent.
  {
    const { status, body } = await getAsAnon(`/object/avatars/${objectPath}`);
    check(
      status !== 200,
      "unauthenticated GET of an EXISTING private avatar is refused",
      `HTTP ${status}${body?.message ? ` (${body.message})` : ""}`,
    );
  }

  // 2. The /object/public/ route bypasses RLS entirely for a bucket with
  // public=true. Refusal here, against a file that definitely exists, is
  // what proves the bucket is private rather than merely empty.
  {
    const { status, body } = await getAsAnon(`/object/public/avatars/${objectPath}`);
    check(
      status !== 200,
      "unauthenticated GET of the EXISTING file via the public route is refused (bucket is private)",
      `HTTP ${status}${body?.message ? ` (${body.message})` : ""}`,
    );
  }
} finally {
  await deleteFixture();
}

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
