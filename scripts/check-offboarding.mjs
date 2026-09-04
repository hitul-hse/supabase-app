/*
 * Offboarding gate: does a departure actually END, in the database and in the code?
 *
 * WHAT THIS IS FOR
 * ----------------
 * Four people have left. Three (fq-kamila-evangelista-da-silva, fq-liliia-ganeeva,
 * fq-pablo-guerra-ares) were modelled correctly. The fourth, md-serhii, was
 * `is_active = true` in both public.people and public.app_user_profile with a live
 * auth account, months after TrackingTime archived him. This gate exists so that
 * cannot drift back, and so the two halves of "deactivate" are both provable:
 *
 *   DATA  -- supabase/migrations/20260904090000_offboard_departed_user.sql, run
 *            twice in PGlite against a miniature of the measured live state.
 *   CODE  -- setUserActive() in src/app/(app)/admin/users/actions.ts must revoke
 *            the SESSION as well as the profile flag, and must TELL the operator
 *            when only half of that succeeded.
 *   HISTORY -- and none of it may cost a single logged hour.
 *
 * WHY THE ASSERTIONS ABOUT setUserActive ARE SOURCE-LEVEL, AND WHY THAT IS ENOUGH
 * ------------------------------------------------------------------------------
 * Proving the ban behaviourally means banning a real Supabase auth account. There
 * is no test project. check-admin-user-writes.mjs does drive the real action
 * end-to-end against a throwaway probe account and now exercises the ban path as a
 * side effect; this gate deliberately does NOT create or mutate any auth user, so
 * it is safe to run anywhere, including without credentials. The claim it makes is
 * narrower and honest: the ban call is present, in the right place, in both
 * directions, and its failure is reported rather than swallowed.
 *
 * The source assertions carry their own DISCRIMINATOR (section 3): they are re-run
 * against a copy of actions.ts with the ban call stripped out, and are required to
 * go RED. A source assertion nobody has watched fail is a substring search with a
 * green tick.
 *
 * THE LIVE SECTION IS RED UNTIL THE MIGRATION IS PASTED. That is deliberate and
 * precedented here (check-projects-admit-unmeasured stays red until its migration
 * is applied; check-new-gates-can-fail has a whole mode for it). A merged migration
 * is not a deployed one, and this is what says so out loud. It SKIPs, loudly, with
 * no credentials.
 *
 * Run: npm run check:offboarding
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { loadEnv } from "./lib/gate-env.mjs";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const read = (...p) => readFileSync(join(REPO, ...p), "utf8");

const MIGRATION = "supabase/migrations/20260904090000_offboard_departed_user.sql";
const migration = read(MIGRATION);
const actionsSrc = read("src/app/(app)/admin/users/actions.ts");
const userRowSrc = read("src/app/(app)/admin/users/UserRow.tsx");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${detail ? `\n        ${detail}` : ""}`);
  if (!ok) failures += 1;
  return ok;
};

/* The four departures, with the numbers measured on production 2026-09-04. */
const DEPARTED = [
  { person: "fq-kamila-evangelista-da-silva", member: 16, entries: 111, seconds: 222780 },
  { person: "fq-liliia-ganeeva", member: 19, entries: 2, seconds: 3000 },
  { person: "fq-pablo-guerra-ares", member: 33, entries: 427, seconds: 1560542 },
  { person: "md-serhii", member: 38, entries: 408, seconds: 2266620 },
];
const SERHII_UID = "26154ec6-5018-45f8-bada-f4506b5d03a6";
const MATHIAS_UID = "11111111-1111-1111-1111-111111111111";

/* ========================================================================== */
/* 1. THE MIGRATION, IN A REAL ENGINE                                         */
/* ========================================================================== */

console.log("\n=== 1. migration in PGlite (measured live pre-state) ===\n");

const db = await new PGlite();
await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key, email text);
  do $$ begin
    if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
    if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
  end $$;
  create or replace function auth.uid() returns uuid
    language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
`);
await db.exec(read("supabase", "schema.sql"));

/*
 * DRIFT, found while writing this gate and worth recording rather than working
 * around silently: supabase/schema.sql:171 still declares
 *
 *     source text not null default 'seed' check (source in ('seed', 'factorial'))
 *
 * while production allows 'masterdata' and 'external' -- widened by
 * 20260824100000_allow_masterdata_people_source.sql and then
 * 20260828120000_external_staff_are_people.sql, neither of which was folded back
 * into schema.sql. Every md-* person on production (including md-serhii) carries
 * source = 'masterdata', so a fresh project built from schema.sql alone would
 * reject the real roster. Widened here so the miniature matches the database this
 * migration will actually be pasted into; fixing schema.sql is a separate change.
 *
 * A second gap, same cause: public.project_responsibility exists only in
 * 20260824160000_create_project_responsibility.sql and was never folded into
 * schema.sql either, so it is created here from that migration's own DDL.
 */
await db.exec(`
  alter table public.people drop constraint if exists people_source_check;
  alter table public.people add constraint people_source_check
    check (source in ('seed', 'factorial', 'masterdata', 'external'));

  create table if not exists public.project_responsibility (
    project_id text not null references public.projects (id) on delete cascade,
    person_id  text not null references public.people (id)   on delete restrict,
    role       text not null check (role in ('responsible', 'replacement')),
    source     text not null default 'masterdata',
    order_no   text,
    created_at timestamptz not null default now(),
    unique (project_id, person_id, role)
  );
`);

/*
 * The pre-state, exactly as production reads today. md-mathias is seeded as the
 * CONTROL: an active colleague who must be untouched, so the migration cannot pass
 * by deactivating everyone.
 */
await db.exec(`
  insert into auth.users (id, email) values
    ('${SERHII_UID}', 'serhii@hs-experts.com'),
    ('${MATHIAS_UID}', 'mathias@hs-experts.com');

  insert into public.people (id, name, is_active, source, role) values
    ('md-serhii', 'Serhii', true, 'masterdata', 'Consultant'),
    ('md-mathias', 'Mathias', true, 'masterdata', 'Consultant'),
    ('fq-kamila-evangelista-da-silva', 'Kamila Evangelista da Silva', false, 'factorial', null),
    ('fq-liliia-ganeeva', 'Liliia Ganeeva', false, 'factorial', null),
    ('fq-pablo-guerra-ares', 'Pablo Guerra Ares', false, 'factorial', null);

  -- Only md-serhii has a Hub account. The three fq- people have none at all,
  -- which is what "no login" means for them.
  insert into public.app_user_profile (user_id, person_id, role_key, department, is_active) values
    ('${SERHII_UID}', 'md-serhii', 'employee', 'OPERATIONS', true),
    ('${MATHIAS_UID}', 'md-mathias', 'exec', 'OPERATIONS', true);

  insert into public.projects
    (id, code, name, customer, lead, status, contract_hours, billable_hours,
     consumed_percent, due, owner_person_id, department)
  values
    ('10483_00298_601_01', '10483_00298_601_01', 'HEC Solar / construction site supervision',
     'HEC Solar LTD', 'Serhii', 'CRITICAL', 3, 30.5, 1017, 'n/a', 'md-serhii', 'OPERATIONS');

  insert into public.project_responsibility (project_id, person_id, role, source, order_no) values
    ('10483_00298_601_01', 'md-serhii',  'responsible', 'masterdata', '10483_00298_601_01'),
    ('10483_00298_601_01', 'md-mathias', 'replacement', 'masterdata', '10483_00298_601_01');

  insert into public.person_assignments
    (person_id, project_name, project_id, logged_hours, tasks_count, share_percent, sort_order)
  values ('md-serhii', 'HEC Solar / construction site supervision', '10483_00298_601_01', 0, 0, 100, 0);

  -- All four are ARCHIVED on the vendor side already; only md-serhii still
  -- carries a sign-in link.
  insert into time.member (id, source_id, email, display_name, hub_person_id, user_id, is_archived)
    overriding system value values
    (16, 'tt-16', 'kamila@hs-experts.com', 'Kamila Evangelista da Silva', 'fq-kamila-evangelista-da-silva', null, true),
    (19, 'tt-19', 'liliia@hs-experts.com', 'Liliia Ganeeva',              'fq-liliia-ganeeva',             null, true),
    (33, 'tt-33', 'pablo@hs-experts.com',  'Pablo Guerra Ares',           'fq-pablo-guerra-ares',          null, true),
    (38, 'tt-38', 'serhii@hs-experts.com', 'Serhii Vylianskyi',           'md-serhii',                     '${SERHII_UID}', true),
    (99, 'tt-99', 'mathias@hs-experts.com','Mathias Schwenteit',          'md-mathias',                    '${MATHIAS_UID}', false);
`);

/*
 * The hours. Seeded at the measured row counts and total seconds so the
 * "history survives" assertions below are about real magnitudes, not one token
 * row. Every entry is is_billed = false, as measured (408/408 for md-serhii).
 */
for (const d of DEPARTED) {
  // n-1 equal entries plus one carrying the remainder, so the seeded total is
  // EXACTLY the measured second count rather than a rounded approximation of it.
  const each = Math.floor(d.seconds / d.entries);
  const remainder = d.seconds - each * (d.entries - 1);
  await db.exec(`
    insert into time.entry (member_id, started_at, ended_at, duration_seconds, is_billed, notes)
    select ${d.member},
           timestamptz '2026-01-01 09:00:00+00' + (g * interval '1 day'),
           timestamptz '2026-01-01 09:00:00+00' + (g * interval '1 day')
             + interval '1 second' * (case when g = 1 then ${remainder} else ${each} end),
           case when g = 1 then ${remainder} else ${each} end, false, 'seeded'
      from generate_series(1, ${d.entries}) g;
  `);
}

const scalar = async (sql, params = []) => (await db.query(sql, params)).rows[0];

/** Run one statement as a signed-in user, exactly as PostgREST would. */
async function asUser(uid, sql) {
  await db.exec("begin");
  try {
    await db.exec("set local role authenticated");
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [uid]);
    const res = await db.query(sql);
    await db.exec("commit");
    return { rows: res.rows, error: null };
  } catch (e) {
    await db.exec("rollback");
    return { rows: [], error: String(e.message).split("\n")[0] };
  }
}

const entryCount = async (member) =>
  Number((await scalar("select count(*)::int n from time.entry where member_id = $1", [member])).n);
const entrySeconds = async (member) =>
  Number((await scalar("select coalesce(sum(duration_seconds),0)::bigint s from time.entry where member_id = $1", [member])).s);

const beforeCounts = {};
for (const d of DEPARTED) beforeCounts[d.person] = await entryCount(d.member);

// If this ever fails the miniature has stopped reproducing the defect, and
// nothing below it proves anything.
check(
  "pre-state matches production: md-serhii is ACTIVE in people and app_user_profile",
  (await scalar("select is_active from public.people where id='md-serhii'")).is_active === true
    && (await scalar("select is_active from public.app_user_profile where person_id='md-serhii'")).is_active === true,
  `people.is_active=${(await scalar("select is_active from public.people where id='md-serhii'")).is_active}, `
    + `profile.is_active=${(await scalar("select is_active from public.app_user_profile where person_id='md-serhii'")).is_active}, `
    + `time.member.user_id=${(await scalar("select user_id from time.member where hub_person_id='md-serhii'")).user_id}`,
);

/* ------------------------------------------------------------------------- */
/* 1a. NEGATIVE CONTROL: the profile flag ALONE does not end access           */
/* ------------------------------------------------------------------------- */
/*
 * This is the reason the migration has a third statement and the reason
 * setUserActive now bans. Do exactly what the OLD setUserActive did -- flip
 * app_user_profile.is_active and nothing else -- and then act as the deactivated
 * user. If he can still rewrite his own hours, "deactivated" was cosmetic.
 */
await db.exec("update public.app_user_profile set is_active = false where person_id = 'md-serhii'");

const stillReads = await asUser(SERHII_UID, "select id from time.entry where member_id = 38");
check(
  "negative control: a profile-only deactivation still lets him READ his 408 entries",
  stillReads.error === null && stillReads.rows.length === 408,
  stillReads.error ?? `${stillReads.rows.length} rows visible — time.current_member_id() resolves off time.member.user_id, which no is_active filter reaches`,
);

const stillWrites = await asUser(
  SERHII_UID,
  "update time.entry set notes = 'rewritten while deactivated' where member_id = 38 returning id",
);
check(
  "negative control: and still lets him REWRITE them — \"own entry update\" calls no permission function",
  stillWrites.error === null && stillWrites.rows.length === 408,
  stillWrites.error ?? `${stillWrites.rows.length} of 408 rows rewritten by an account the Hub considers deactivated`,
);

// Remember the row about to be destroyed, so the pre-state can be restored to the
// second afterwards and the "history survives" assertions stay exact.
const doomed = await scalar(
  "select id, duration_seconds from time.entry where member_id = 38 order by id limit 1",
);
const stillDeletes = await asUser(
  SERHII_UID,
  "delete from time.entry where member_id = 38 and id = (select min(id) from time.entry where member_id = 38) returning id",
);
check(
  "negative control: and DELETE them — 629.6h of history reachable from a dead account",
  stillDeletes.error === null && stillDeletes.rows.length === 1,
  stillDeletes.error ?? `${stillDeletes.rows.length} row(s) deleted`,
);

// Put the pre-state back so the migration runs against production's real shape.
await db.exec("update public.app_user_profile set is_active = true where person_id = 'md-serhii'");
await db.exec("update time.entry set notes = 'seeded' where member_id = 38");
await db.query(
  `insert into time.entry (member_id, started_at, ended_at, duration_seconds, is_billed, notes)
   values (38, timestamptz '2026-01-01 08:00:00+00',
           timestamptz '2026-01-01 08:00:00+00' + interval '1 second' * $1, $1, false, 'seeded')`,
  [doomed.duration_seconds],
);
check(
  "pre-state restored before the migration runs",
  (await entryCount(38)) === 408 && (await entrySeconds(38)) === 2266620,
  `${await entryCount(38)} entries / ${await entrySeconds(38)}s`,
);

/* ------------------------------------------------------------------------- */
/* 1b. run the migration TWICE                                               */
/* ------------------------------------------------------------------------- */

for (const pass of [1, 2]) {
  let err = null;
  try { await db.exec(migration); } catch (e) { err = String(e.message).split("\n")[0]; }
  if (!check(`run ${pass}: the migration executes`, err === null, err ?? "")) break;

  check(
    `run ${pass}: public.people.is_active = false for md-serhii`,
    (await scalar("select is_active from public.people where id='md-serhii'")).is_active === false,
  );
  check(
    `run ${pass}: public.app_user_profile.is_active = false for md-serhii`,
    (await scalar("select is_active from public.app_user_profile where person_id='md-serhii'")).is_active === false,
  );
  check(
    `run ${pass}: time.member no longer carries his sign-in link`,
    (await scalar("select user_id from time.member where hub_person_id='md-serhii'")).user_id === null,
  );

  // All four, together — the state the gate is named for.
  const activeDeparted = (await db.query(
    `select id from public.people where id = any($1) and is_active`, [DEPARTED.map((d) => d.person)],
  )).rows.map((r) => r.id);
  check(
    `run ${pass}: none of the four departed people is active`,
    activeDeparted.length === 0,
    activeDeparted.length ? `still active: ${activeDeparted.join(", ")}` : "",
  );

  const activeLogins = (await db.query(
    `select p.person_id from public.app_user_profile p where p.person_id = any($1) and p.is_active`,
    [DEPARTED.map((d) => d.person)],
  )).rows.map((r) => r.person_id);
  check(
    `run ${pass}: none of them has an active Hub login`,
    activeLogins.length === 0,
    activeLogins.length ? `still able to sign in: ${activeLogins.join(", ")}` : "",
  );

  // HISTORY. The point of offboarding this way rather than deleting.
  for (const d of DEPARTED) {
    const n = await entryCount(d.member);
    const s = await entrySeconds(d.member);
    check(
      `run ${pass}: ${d.person} keeps all ${d.entries} time entries (${(d.seconds / 3600).toFixed(1)}h)`,
      n === beforeCounts[d.person] && n > 0 && s > 0,
      `${n} rows / ${(s / 3600).toFixed(1)}h`,
    );
  }
  check(
    `run ${pass}: his assignment and responsibility rows are retained, not reassigned`,
    Number((await scalar("select count(*)::int n from public.person_assignments where person_id='md-serhii'")).n) === 1
      && Number((await scalar("select count(*)::int n from public.project_responsibility where person_id='md-serhii'")).n) === 1
      && (await scalar("select owner_person_id from public.projects where id='10483_00298_601_01'")).owner_person_id === "md-serhii",
    "the migration must not silently hand his customer to somebody else",
  );

  // SCOPING. One id, and only that id.
  check(
    `run ${pass}: the control colleague md-mathias is untouched`,
    (await scalar("select is_active from public.people where id='md-mathias'")).is_active === true
      && (await scalar("select is_active from public.app_user_profile where person_id='md-mathias'")).is_active === true
      && (await scalar("select user_id from time.member where hub_person_id='md-mathias'")).user_id === MATHIAS_UID,
    "a migration that deactivates everyone would pass every assertion above this one",
  );

  // The access path the negative control demonstrated, now closed.
  const nowReads = await asUser(SERHII_UID, "select id from time.entry where member_id = 38");
  check(
    `run ${pass}: he can no longer read his own entries with that session`,
    nowReads.error === null && nowReads.rows.length === 0,
    nowReads.error ?? `${nowReads.rows.length} rows still visible`,
  );
  const nowWrites = await asUser(
    SERHII_UID, "update time.entry set notes = 'rewritten' where member_id = 38 returning id",
  );
  check(
    `run ${pass}: and can no longer rewrite them (0 rows affected, no error — check the count)`,
    nowWrites.error === null && nowWrites.rows.length === 0,
    nowWrites.error ?? `${nowWrites.rows.length} rows rewritten`,
  );
  check(
    `run ${pass}: the entries are all still there after that attempt`,
    (await entryCount(38)) === 408,
    `${await entryCount(38)} of 408`,
  );
}

/* ------------------------------------------------------------------------- */
/* 1c. the DOCUMENTED reversal really reverses                                */
/* ------------------------------------------------------------------------- */
/*
 * Read out of the migration's own comment block rather than retyped here, so the
 * comment cannot rot into SQL that does not work. A reversal nobody has run is a
 * promise, not a rollback plan.
 */
const reversalRegion = migration.slice(
  migration.indexOf("REVERSAL. The exact SQL to undo this file"),
  migration.indexOf("That uuid is auth.users.id"),
);
const deCommented = reversalRegion
  .split("\n")
  .filter((l) => l.trim().startsWith("--"))
  .map((l) => l.replace(/^\s*--\s?/, ""))
  .join("\n");
/*
 * Matched as `update ... ;` blocks rather than split on ";". Splitting glued the
 * first statement onto the prose above it, so it silently vanished from the list
 * and the gate reported "not three UPDATEs" -- the right verdict for the wrong
 * reason. None of these statements contains a semicolon of its own.
 */
const reversalSql = (deCommented.match(/\bupdate\s[\s\S]*?;/gi) ?? []).map((s) => s.trim());

check(
  "the migration documents a reversal, and it is three UPDATEs",
  reversalSql.length === 3,
  reversalSql.length ? reversalSql.join("\n        ") : "no reversal statements found in the header",
);

if (reversalSql.length === 3) {
  let revErr = null;
  try { await db.exec(reversalSql.join("\n")); } catch (e) { revErr = String(e.message).split("\n")[0]; }
  check("the documented reversal executes", revErr === null, revErr ?? "");
  check(
    "and restores exactly the pre-state (active, active, linked)",
    (await scalar("select is_active from public.people where id='md-serhii'")).is_active === true
      && (await scalar("select is_active from public.app_user_profile where person_id='md-serhii'")).is_active === true
      && (await scalar("select user_id from time.member where hub_person_id='md-serhii'")).user_id === SERHII_UID,
  );
  check(
    "and the reversal costs no history either",
    (await entryCount(38)) === 408,
    `${await entryCount(38)} of 408`,
  );
}

/* ------------------------------------------------------------------------- */
/* 1d. the migration is a clean no-op where the person does not exist         */
/* ------------------------------------------------------------------------- */
{
  const fresh = await new PGlite();
  await fresh.exec(`
    create schema if not exists auth;
    create table auth.users (id uuid primary key, email text);
    do $$ begin
      if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
      if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
    end $$;
    create or replace function auth.uid() returns uuid
      language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  `);
  await fresh.exec(read("supabase", "schema.sql"));
  let e = null;
  try { await fresh.exec(migration); } catch (x) { e = String(x.message).split("\n")[0]; }
  check(
    "it runs cleanly on a database that has never had md-serhii (notice, not abort)",
    e === null,
    e ?? "skipped and finished",
  );
  await fresh.close();
}

await db.close();

/* ========================================================================== */
/* 2. THE CODE: setUserActive must end the session, and say so when it cannot */
/* ========================================================================== */

console.log("\n=== 2. setUserActive source ===\n");

/**
 * Slice out the body of setUserActive, so an occurrence of `ban_duration`
 * anywhere else in a 500-line file cannot satisfy these assertions.
 */
function bodyOf(src, name) {
  const start = src.indexOf(`export async function ${name}(`);
  if (start < 0) return null;
  const open = src.indexOf("{", src.indexOf(")", start));
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return null;
}

/** The assertions, as a function so section 3 can re-run them on a mutated copy. */
function sourceChecks(src, rowSrc, emit) {
  /** Detail that reads correctly whether the assertion passed or failed. */
  const found = (ok, yes, no) => (ok ? yes : no);

  const body = bodyOf(src, "setUserActive");
  emit("setUserActive exists and parses", Boolean(body));
  if (!body) return;

  const callsAdmin = /auth\.admin\.updateUserById\s*\(/.test(body);
  emit(
    "it calls the Auth Admin API to change the account, not only the profile row",
    callsAdmin,
    found(callsAdmin, "admin.auth.admin.updateUserById(...) present",
      "NO updateUserById call — the profile flag alone leaves the session alive"),
  );
  const hasDuration = /ban_duration\s*:/.test(body);
  emit(
    "it passes ban_duration",
    hasDuration,
    found(hasDuration, "ban_duration is set", "ban_duration appears nowhere in setUserActive"),
  );

  // Both directions, from one expression: deactivate bans, reactivate lifts.
  const banArg = /ban_duration\s*:\s*([^,\n}]+)/.exec(body)?.[1]?.trim() ?? "";
  emit(
    "the ban is conditional on isActive, so reactivating LIFTS it",
    /isActive\s*\?/.test(banArg) && /["']none["']/.test(banArg),
    `ban_duration: ${banArg || "(not found)"} — reactivation must pass "none" or a reactivated colleague stays locked out`,
  );
  const banConst = /const\s+INDEFINITE_BAN\s*=\s*["']([^"']+)["']/.exec(src)?.[1] ?? "";
  const durationOk = /^\d+(ns|us|µs|ms|s|m|h)$/.test(banConst) && banArg.includes("INDEFINITE_BAN");
  emit(
    "and deactivating bans for a real duration",
    durationOk,
    // Names the constant AND whether it is actually used: declaring 876000h and
    // never passing it is exactly the shape a stripped ban call leaves behind.
    `INDEFINITE_BAN = ${banConst || "(absent)"}, ${banArg.includes("INDEFINITE_BAN") ? "passed to ban_duration" : "NOT passed to ban_duration"}`,
  );

  /*
   * Order: the profile write first, the ban after. Failing the other way round
   * leaves an account that keeps its role while the UI says it reverted.
   *
   * Located on the CALL, not the bare identifier `updateUserById` -- the body
   * also mentions it in a comment, and matching the word made this assertion
   * (and the try/catch one below) stay green with the call deleted, which is the
   * one thing a negative control exists to catch.
   */
  const profileAt = body.indexOf(".update({ is_active: isActive })");
  const banAt = body.search(/auth\.admin\.updateUserById\s*\(/);
  emit(
    "the profile write happens BEFORE the ban (a failed ban leaves the fail-closed half)",
    profileAt > -1 && banAt > profileAt,
    `profile write at ${profileAt}, ban call at ${banAt < 0 ? "(absent)" : banAt}`,
  );

  // The half-succeeded state must reach the operator.
  const reports = /banError/.test(body) && /warning\s*:/.test(body);
  emit(
    "a failed ban is REPORTED, not swallowed into a success",
    reports,
    found(reports, "returns a `warning` when the ban fails",
      "can return {} with the profile written and the session still alive"),
  );
  const wording = /SIGN-IN WAS NOT REVOKED|was NOT revoked/i.test(body);
  emit(
    "the failure message says the sign-in was not revoked, in words",
    wording,
    found(wording, "the operator is told what did NOT happen",
      "no plain-words message — an error code is not an explanation"),
  );
  const guarded = /try\s*\{[\s\S]*auth\.admin\.updateUserById\s*\([\s\S]*\}\s*catch/.test(body);
  emit(
    "the ban call cannot throw past the caller",
    guarded,
    found(guarded, "wrapped in try/catch",
      "a transport failure would surface as a generic action error, profile already written"),
  );

  // The guard that predates this change must survive it.
  const selfGuard = /guard\.userId === userId && !isActive/.test(body);
  emit(
    "the self-deactivation guard is still in place",
    selfGuard,
    found(selfGuard, "an admin still cannot deactivate themselves",
      "an admin could now ban their own sign-in"),
  );

  // The UI must not undo the toggle on a warning: the account really IS deactivated.
  const handler = /function handleToggleActive\(\)[\s\S]*?\n  \}/.exec(rowSrc)?.[0] ?? "";
  const uiOk = /res\.warning/.test(handler) && /res\.error\)\s*\{\s*setLocalActive\(!next\)/.test(handler);
  emit(
    "the UI keeps the new state on a warning and only reverts on a real error",
    uiOk,
    found(uiOk, "UserRow distinguishes 'nothing happened' from 'half of it happened'",
      "UserRow would revert the toggle and hide a half-succeeded revocation"),
  );
}

sourceChecks(actionsSrc, userRowSrc, check);

/* ========================================================================== */
/* 3. DISCRIMINATOR: those assertions must go RED without the ban             */
/* ========================================================================== */

console.log("\n=== 3. negative control: strip the ban call and require red ===\n");

/*
 * No file is written. The stripped source exists only in memory, which is why
 * this is safe to run in CI and cannot leave the repo mutated by a killed run.
 */
const stripped = actionsSrc.replace(
  /const \{ error: authError \} = await admin\.auth\.admin\.updateUserById\([\s\S]*?\}\);/,
  "const authError = null;",
);
const strippedOk =
  stripped !== actionsSrc
  && !/auth\.admin\.updateUserById\s*\(/.test(bodyOf(stripped, "setUserActive") ?? "");
check(
  // The CALL, not the word: the body also mentions updateUserById in a comment,
  // and matching on the bare identifier made this fail while the strip had in
  // fact worked.
  "the discriminator actually removed the ban call",
  strippedOk,
  strippedOk
    ? "setUserActive now writes the profile and nothing else, as it did before this PR"
    : "the mutation matched nothing, so section 3 proves nothing",
);

const strippedResults = [];
sourceChecks(stripped, userRowSrc, (label, ok) => strippedResults.push({ label, ok }));
const wouldFail = strippedResults.filter((r) => !r.ok);
check(
  "with the ban call removed, the source assertions FAIL",
  wouldFail.length > 0,
  wouldFail.length
    ? `${wouldFail.length} assertion(s) go red, e.g. "${wouldFail[0].label}"`
    : "every assertion still passed without the ban call — they assert nothing",
);

/* ========================================================================== */
/* 4. LIVE: is the migration actually deployed?                               */
/* ========================================================================== */

console.log("\n=== 4. live database ===\n");

const env = loadEnv();
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.log("SKIP: no live credentials — sections 1-3 above still ran and are the");
  console.log("      deterministic part of this gate. The live half cannot be faked green.");
} else {
  const rest = async (path, schema) => {
    const headers = {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      Prefer: "count=exact",
    };
    if (schema) headers["Accept-Profile"] = schema;
    const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${path}`, { headers });
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = text; }
    return { ok: res.status === 200, body, range: res.headers.get("content-range") };
  };

  const ids = DEPARTED.map((d) => d.person).join(",");

  const people = await rest(`people?select=id,name,is_active&id=in.(${ids})`);
  const stillActive = (people.body || []).filter((p) => p.is_active).map((p) => p.id);
  check(
    "LIVE: all four departed people are is_active = false in public.people",
    people.ok && people.body.length === 4 && stillActive.length === 0,
    stillActive.length
      ? `still active: ${stillActive.join(", ")} — paste supabase/migrations/20260904090000_offboard_departed_user.sql into the SQL editor`
      : JSON.stringify(people.body),
  );

  const profiles = await rest(`app_user_profile?select=user_id,person_id,is_active&person_id=in.(${ids})`);
  const liveLogins = (profiles.body || []).filter((p) => p.is_active).map((p) => p.person_id);
  check(
    "LIVE: none of them has an active Hub login",
    profiles.ok && liveLogins.length === 0,
    liveLogins.length
      ? `still able to sign in: ${liveLogins.join(", ")} — same migration`
      : `${(profiles.body || []).length} profile row(s), none active`,
  );

  const members = await rest(`member?select=id,display_name,hub_person_id,user_id,is_archived&hub_person_id=in.(${ids})`, "time");
  const linked = (members.body || []).filter((m) => m.user_id).map((m) => m.hub_person_id);
  check(
    "LIVE: no departed person's TrackingTime record still carries a sign-in link",
    members.ok && linked.length === 0,
    linked.length
      ? `still linked: ${linked.join(", ")} — time.current_member_id() resolves off this column and no is_active filter reaches it`
      : `${(members.body || []).length} member row(s), all unlinked`,
  );

  // HISTORY. The whole point: offboarding must not cost an hour.
  for (const d of DEPARTED) {
    const r = await rest(`entry?select=duration_seconds&member_id=eq.${d.member}`, "time");
    const rows = Array.isArray(r.body) ? r.body : [];
    const seconds = rows.reduce((a, e) => a + (e.duration_seconds || 0), 0);
    check(
      `LIVE: ${d.person} still has their hours (${d.entries} entries, ${(d.seconds / 3600).toFixed(1)}h)`,
      r.ok && rows.length >= d.entries && seconds >= d.seconds,
      `${rows.length} entries / ${(seconds / 3600).toFixed(1)}h${rows.length < d.entries ? " — HISTORY WAS LOST" : ""}`,
    );
  }
}

console.log(
  failures === 0
    ? "\nOFFBOARDING IS COMPLETE (migration proved twice, session revocation present and discriminating, history intact)"
    : `\n${failures} check(s) failed`,
);
process.exit(failures === 0 ? 0 : 1);
