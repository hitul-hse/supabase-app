/**
 * One person, one account — the Phase 0 exit test.
 *
 * PLATFORM-ARCHITECTURE.md §7 states the criterion in one sentence:
 *
 *   "a colleague signs in with Microsoft, then Google, and lands on ONE account
 *    — proven by a single auth.users row with two identities."
 *
 * Nothing asserted it. Grep the other OAuth checks for `identities` and there
 * are no hits: check-oauth-callback covers the URL contract, check-oauth-access
 * covers what an unprovisioned user may read, check-oauth-success-path covers
 * the code exchange. All of them exercise ONE sign-in. None asks whether a
 * SECOND sign-in by the same human converges on the same row.
 *
 * ── Why this failure deserves a gate of its own ───────────────────────────
 *
 * It is not a crash, and that is exactly the problem. If Microsoft and Google
 * fork Björn into two auth.users rows, nothing errors. He signs in on Tuesday,
 * the app looks normal, and:
 *
 *   - app_user_profile is keyed on user_id, so the second row has no profile,
 *     no role and no department;
 *   - time.member.user_id points at the FIRST row, so time.current_member_id()
 *     returns NULL and every hour he has ever tracked becomes invisible to him;
 *   - an admin "fixes" it by provisioning the second row, and now one human owns
 *     two accounts with two permission sets, diverging from that day on.
 *
 * The corruption is silent, and it compounds: the longer both rows accumulate
 * profile edits and links, the less recoverable the merge becomes.
 *
 * ── What is proven where ──────────────────────────────────────────────────
 *
 * The linking itself happens inside GoTrue, which is Supabase's code and cannot
 * be run in PGlite. So this splits along the line of what each half can prove
 * honestly:
 *
 *   MODELLED (PGlite, always runs, no credentials)
 *     What a fork COSTS in our schema, and that our own defences hold when one
 *     happens. Real schema.sql, real RLS, real helper functions.
 *
 *   OBSERVED (live project, SKIPS without .env.local)
 *     Whether a fork exists right now, and whether the exit test is even
 *     performable yet — a provider that is disabled cannot be signed in with.
 *
 * Read-only against live: it lists users and reads their identities. It never
 * writes, and never prints a token.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, existsSync } from "node:fs";

let failed = false;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed = true;
};

// ═══════════════════════════════════════════════════════════════════════════
// PART 1 — MODELLED: what a fork costs, against the real schema
// ═══════════════════════════════════════════════════════════════════════════

console.log("MODELLED — real schema.sql in PGlite, two sign-ins by one colleague\n");

/**
 * auth.identities is included deliberately, shaped as GoTrue really shapes it.
 * The exit test is a claim about that table's CONTENTS, so a shim that omits it
 * could not express the difference between "linked" and "forked" at all — the
 * test would be about nothing.
 */
const preamble = `
  create schema if not exists auth;
  create table auth.users (
    id uuid primary key,
    email text,
    email_confirmed_at timestamptz
  );
  create table auth.identities (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    provider text not null,
    provider_id text not null,
    email text,
    unique (provider, provider_id)
  );
  do $$ begin
    if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
    if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
  end $$;
  create or replace function auth.uid() returns uuid
    language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
`;

const db = await new PGlite();
await db.exec(preamble);
await db.exec(readFileSync("supabase/schema.sql", "utf8"));

// Supabase's default grants. Without them every read below fails with
// "permission denied for table", which LOOKS like a pass ("the forked account
// saw nothing!") while proving nothing — the healthy account is blocked
// identically. On a real project `authenticated` holds table privileges and RLS
// alone decides which rows come back. Same reasoning as check-oauth-access-model.
await db.exec(`
  grant usage on schema public to authenticated;
  grant select, insert, update, delete on all tables in schema public to authenticated;
  grant usage on schema time to authenticated;
`);

// One human, Björn. LINKED is the account he should always land on.
// FORK is the second auth.users row that appears if linking does not happen.
const LINKED = "11111111-1111-1111-1111-111111111111";
const FORK = "22222222-2222-2222-2222-222222222222";
const EMAIL = "bjoern.schoenemann@hs-experts.com";

await db.exec(`
  insert into auth.users (id, email, email_confirmed_at) values
    ('${LINKED}', '${EMAIL}', now());

  -- The healthy shape the exit test demands: ONE row, TWO identities.
  insert into auth.identities (user_id, provider, provider_id, email) values
    ('${LINKED}', 'azure',  'ms-oid-0001', '${EMAIL}'),
    ('${LINKED}', 'google', 'gg-sub-0001', '${EMAIL}');

  insert into people (id, name, department, is_active)
    values ('p-bjoern', 'Björn Schönemann', 'HSE', true);

  insert into app_user_profile (user_id, role_key, department, person_id, is_active)
    values ('${LINKED}', 'exec', 'HSE', 'p-bjoern', true);

  -- His tracked time, linked to the account he was provisioned on.
  -- An explicit id needs OVERRIDING SYSTEM VALUE and a setval afterwards, or the
  -- next insert collides on id=1 and reports a plain unique violation that reads
  -- exactly like an RLS rejection.
  insert into time.member (id, source_id, display_name, email, user_id, hub_person_id)
    overriding system value
    values (1, 'tt-3', 'Björn Schönemann', '${EMAIL}', '${LINKED}', 'p-bjoern');
  select setval(pg_get_serial_sequence('time.member','id'), 1, true);

  insert into time.entry
      (source_id, member_id, started_at, ended_at, duration_seconds, is_billable, source_system)
    values
      ('e-1', 1, '2026-08-10T09:00:00Z', '2026-08-10T11:00:00Z', 7200, true, 'trackingtime'),
      ('e-2', 1, '2026-08-11T09:00:00Z', '2026-08-11T12:00:00Z', 10800, true, 'trackingtime');
`);

/** Run a query as a given authenticated user, under RLS. */
async function asUser(userId, sql) {
  await db.exec("begin");
  await db.exec("set local role authenticated");
  await db.exec(`select set_config('request.jwt.claim.sub', '${userId}', true)`);
  let rows = [];
  let error = null;
  try {
    rows = (await db.query(sql)).rows;
  } catch (e) {
    error = e.message;
  }
  await db.exec("rollback");
  return { rows, error };
}

// ── 1a. The healthy shape ──────────────────────────────────────────────────
// The positive control. If these fail, every "the fork sees nothing" assertion
// below would pass for the wrong reason.
const ids = await db.query(
  `select provider from auth.identities where user_id = '${LINKED}' order by provider`,
);
check(
  "one account carries BOTH providers (the exit-test shape)",
  ids.rows.length === 2 && ids.rows.map((r) => r.provider).join(",") === "azure,google",
  ids.rows.map((r) => r.provider).join(",") || "none",
);

const rows = await db.query(
  `select count(*)::int as n from auth.users where lower(email) = lower('${EMAIL}')`,
);
check("and it is a SINGLE auth.users row", rows.rows[0].n === 1, `${rows.rows[0].n} rows`);

const healthyRole = await asUser(LINKED, "select app_user_role() as r");
check(
  "positive control: whichever provider he used, he resolves to exec",
  healthyRole.rows[0]?.r === "exec",
  `got ${JSON.stringify(healthyRole.rows[0]?.r)}`,
);

const healthyMember = await asUser(LINKED, "select time.current_member_id() as m");
check(
  "positive control: his time.member resolves",
  Number(healthyMember.rows[0]?.m) === 1,
  `got ${JSON.stringify(healthyMember.rows[0]?.m)}`,
);

const healthyEntries = await asUser(LINKED, "select * from time.entry");
check(
  "positive control: he sees his own tracked hours",
  healthyEntries.rows.length === 2,
  `${healthyEntries.rows.length} entries`,
);

// ── 1b. The fork, and what it costs ────────────────────────────────────────
// Now the same human arrives on a second row: same verified email, a Google
// identity that did NOT attach to the existing account.
console.log("\n  ...linking fails, so the Google sign-in creates a second row:\n");

await db.exec(`
  insert into auth.users (id, email, email_confirmed_at) values
    ('${FORK}', '${EMAIL}', now());
  insert into auth.identities (user_id, provider, provider_id, email) values
    ('${FORK}', 'google', 'gg-sub-0002', '${EMAIL}');
`);

const forkedRows = await db.query(
  `select count(*)::int as n from auth.users where lower(email) = lower('${EMAIL}')`,
);
check(
  "the fork is DETECTABLE: one verified email now spans two auth.users rows",
  forkedRows.rows[0].n === 2,
  `${forkedRows.rows[0].n} rows — this is the state the live probe below hunts for`,
);

// The security half. A forked account is, to our app, an unprovisioned
// stranger. It must fail CLOSED — this is the assertion that breaks if someone
// ever loosens RLS or keys a policy on email instead of user_id.
const forkRole = await asUser(FORK, "select app_user_role() as r");
check(
  "the forked account holds NO role (RLS keys on user_id, never on email)",
  forkRole.rows[0]?.r === null,
  `got ${JSON.stringify(forkRole.rows[0]?.r)}`,
);

for (const table of ["people", "projects", "timesheet_entries"]) {
  const res = await asUser(FORK, `select * from ${table}`);
  check(
    `the forked account reads 0 rows from ${table}`,
    res.error === null && res.rows.length === 0,
    res.error ? `error: ${res.error}` : `${res.rows.length} rows`,
  );
}

// The data-loss half, and the reason this matters more than a login annoyance.
const forkMember = await asUser(FORK, "select time.current_member_id() as m");
check(
  "the forked account resolves to NO time.member",
  forkMember.rows[0]?.m === null,
  `got ${JSON.stringify(forkMember.rows[0]?.m)}`,
);

const forkEntries = await asUser(FORK, "select * from time.entry");
check(
  "so 100% of his tracked hours are invisible on that account — silent, not an error",
  forkEntries.rows.length === 0,
  `${forkEntries.rows.length} of 2 entries visible`,
);

// The trap an admin walks into next: provisioning the fork "fixes" the symptom
// and makes the corruption permanent — two accounts, two profiles, one human.
await db.exec(`
  insert into app_user_profile (user_id, role_key, department, person_id, is_active)
    values ('${FORK}', 'employee', 'HSE', 'p-bjoern', true);
`);
const doubled = await db.query(
  `select count(*)::int as n from app_user_profile p
     join auth.users u on u.id = p.user_id
    where lower(u.email) = lower('${EMAIL}')`,
);
check(
  "provisioning the fork yields ONE human with TWO profiles and two role sets",
  doubled.rows[0].n === 2,
  `${doubled.rows[0].n} profiles for ${EMAIL} — exec on one row, employee on the other`,
);

await db.close();

// ═══════════════════════════════════════════════════════════════════════════
// PART 2 — OBSERVED: the live project
// ═══════════════════════════════════════════════════════════════════════════

console.log("\nOBSERVED — the live project\n");

const envPath = ".env.local";
if (!existsSync(envPath)) {
  console.log("SKIP: no .env.local — the modelled half above still ran");
  console.log(
    failed
      ? "\nIDENTITY LINKING: the modelled defences do NOT hold"
      : "\nIDENTITY LINKING: defences hold; live state unverified (no credentials)",
  );
  process.exit(failed ? 1 : 0);
}

const env = readFileSync(envPath, "utf8");
const get = (k) => (env.match(new RegExp(`^${k}=(.+)$`, "m")) || [])[1]?.trim();
const url = get("NEXT_PUBLIC_SUPABASE_URL");
const anon = get("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const serviceKey = get("SUPABASE_SERVICE_ROLE_KEY");

if (!url || !serviceKey) {
  console.log("SKIP: need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  console.log("      (auth.users is reachable only through the Admin API, never PostgREST)");
  process.exit(failed ? 1 : 0);
}

const H = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
console.log(`live project: ${url}\n`);

// Is the exit test even performable? A disabled provider cannot be signed in
// with, so "no fork observed" would be vacuously true — nobody has tried.
let providersOn = 0;
let providerNote = "could not read /auth/v1/settings";
if (anon) {
  try {
    const s = await (await fetch(`${url}/auth/v1/settings`, { headers: { apikey: anon } })).json();
    const google = Boolean(s.external?.google);
    const azure = Boolean(s.external?.azure);
    providersOn = Number(google) + Number(azure);
    providerNote = `google=${google} azure=${azure}`;
  } catch (e) {
    providerNote = `probe failed: ${e.message}`;
  }
}

/**
 * Identities are NOT included in the admin LIST response — only in the
 * single-user GET. Reading the list alone reports every user as having zero
 * identities, which reads exactly like "OAuth has never been used" whether or
 * not it has. Each user is therefore fetched individually.
 */
const listRes = await fetch(`${url}/auth/v1/admin/users?per_page=200`, { headers: H });
if (!listRes.ok) {
  console.log(`SKIP: admin list returned HTTP ${listRes.status}`);
  process.exit(failed ? 1 : 0);
}
const listBody = await listRes.json();
const users = listBody.users ?? listBody;

const detailed = [];
for (const u of Array.isArray(users) ? users : []) {
  const one = await (await fetch(`${url}/auth/v1/admin/users/${u.id}`, { headers: H })).json();
  detailed.push({
    id: u.id,
    email: (u.email ?? "").trim().toLowerCase(),
    identities: (one.identities ?? []).map((i) => ({
      provider: i.provider,
      email: (i.email ?? "").trim().toLowerCase(),
    })),
  });
}

console.log(`${detailed.length} auth user(s):`);
for (const u of detailed) {
  const provs = u.identities.map((i) => i.provider).join("+") || "-";
  console.log(`  ${u.email.padEnd(42)} identities=${u.identities.length} [${provs}]`);
}
console.log("");

// ── THE EXIT TEST ASSERTION ────────────────────────────────────────────────
// One human must never span two rows. This is the check that was missing.
const byEmail = new Map();
for (const u of detailed) {
  if (!u.email) continue;
  if (!byEmail.has(u.email)) byEmail.set(u.email, []);
  byEmail.get(u.email).push(u);
}
const forks = [...byEmail].filter(([, list]) => list.length > 1);

check(
  "no email address spans more than one auth.users row",
  forks.length === 0,
  forks.length
    ? forks.map(([e, l]) => `${e} -> ${l.map((u) => u.id.slice(0, 8)).join(", ")}`).join(" | ")
    : `${byEmail.size} distinct addresses, ${detailed.length} rows`,
);

// A linked account's identities must all carry the SAME address. Divergence
// here means something was linked that should not have been, which is the
// pre-account-takeover shape the verified-email rule exists to prevent.
const mismatched = detailed.filter(
  (u) => u.identities.length > 1 && new Set(u.identities.map((i) => i.email).filter(Boolean)).size > 1,
);
check(
  "every multi-identity account has all identities on one address",
  mismatched.length === 0,
  mismatched.length ? mismatched.map((u) => u.email).join(", ") : "no cross-address links",
);

// ── Readiness, reported rather than asserted ───────────────────────────────
// Deliberately not a hard failure: check:sso-providers already exits 1 on this
// and duplicating it would train people to ignore two red lines for one cause.
// But the exit test cannot be CLOSED while it is true, so it is stated plainly.
const oauthUsers = detailed.filter((u) => u.identities.some((i) => i.provider !== "email"));
const linkedUsers = detailed.filter(
  (u) => new Set(u.identities.map((i) => i.provider)).size > 1,
);

console.log("");
console.log(`  OAuth providers enabled: ${providersOn}/2  (${providerNote})`);
console.log(`  users with any OAuth identity: ${oauthUsers.length}`);
console.log(`  users with two or more providers linked: ${linkedUsers.length}`);

const exitTestMet = providersOn === 2 && linkedUsers.length > 0 && forks.length === 0;
console.log("");
if (exitTestMet) {
  console.log("  PHASE 0 EXIT TEST: MET — a real colleague holds one account with two providers.");
} else if (providersOn < 2) {
  console.log(
    "  PHASE 0 EXIT TEST: NOT YET PERFORMABLE.\n" +
      "    Google and/or Microsoft are not enabled on this project, so nobody can\n" +
      "    sign in with them. 'No fork found' above is therefore true but vacuous —\n" +
      "    every account here was created by email invite.\n" +
      "    Enable them (docs/architecture/SSO-GOOGLE-MICROSOFT.md), then have one\n" +
      "    colleague sign in with BOTH and re-run this.",
  );
} else {
  console.log(
    "  PHASE 0 EXIT TEST: NOT YET DEMONSTRATED.\n" +
      "    Both providers are enabled and no fork exists, but no account yet carries\n" +
      "    two linked providers — so linking has not actually been exercised.\n" +
      "    Have one colleague sign in with Microsoft, then Google, and re-run.",
  );
}

console.log(
  failed
    ? "\nIDENTITY LINKING: one human is spanning more than one account — fix before it compounds"
    : "\nIDENTITY LINKING: no forked accounts, and a fork would fail closed if one occurred",
);
process.exit(failed ? 1 : 0);
