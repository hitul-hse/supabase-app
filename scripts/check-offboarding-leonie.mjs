/*
 * Offboarding gate, departure five: fq-leonie-roitsch (Leonie Roitsch).
 *
 * WHY THIS IS A SIBLING OF check-offboarding.mjs AND NOT A FIFTH ROW IN IT
 * ------------------------------------------------------------------------
 * That gate is built around the thing md-serhii had and the three before him did
 * not: a live sign-in link and 629.6 hours reachable through it. Its miniature
 * seeds time.entry per DEPARTED member, its live loop reads time.entry by member
 * id, and its reversal parser requires exactly three UPDATEs. Leonie has NO
 * time.member row (measured 2026-09-05, by id, by email and by name), so there is
 * no member id to seed or to query, no attribution path for hours at all, and her
 * reversal is one statement. Forcing her into that shape would mean inventing a
 * member row she never had -- the plausible-zero failure, in table form.
 *
 * Her departure is also the first that runs AGAINST the vendor. Factorial still
 * says active: contract to 2027-03-02, fed 2026-09-04, and a review note from
 * hitul on 2026-09-01 calling her a current employee. The four precedents were
 * the Hub catching up with Factorial; this is the Hub going ahead of it. So this
 * gate asserts the Hub's decision AND keeps the contradiction visible on every
 * run, instead of letting the identity queue quietly disagree with the roster.
 *
 * WHAT IT PROVES
 * --------------
 *   1. The migration, in PGlite, against the measured pre-state plus an active
 *      control colleague who must be untouched: twice, with the second run a
 *      clean no-op that SAYS so in its own NOTICE; the receipt row the file
 *      returns; the two crm rows byte-identical afterwards; the reversal in the
 *      header really reverses; and a database without her row gets a NOTICE and
 *      ZERO receipt rows, not an abort and not a quiet success.
 *   2. NEGATIVE CONTROLS, two kinds.
 *        (a) The migration's second and third statements are live code: seed the
 *            hypothetical profile-and-linked-member case and require the WARNING
 *            to fire and both rows to be ended.
 *        (b) The gate's own assertions can fail: the assertion set is re-run
 *            against two mutated copies of the migration -- one with the wrong
 *            id (a clean NOTICE and nothing done), one with statement 1's WHERE
 *            widened to everybody -- and is required to go RED in the right
 *            place each time. The mutations exist in memory only.
 *   3. LIVE, over a direct read-only connection (SUPABASE_DB_URL, `begin read
 *      only`, 30 s statement timeout, rolled back): people.is_active = false for
 *      her, her profile and member row counts still at the measured zero, all
 *      FIVE departed people inactive -- and, as information rather than a
 *      verdict, what Factorial currently says about her.
 *
 * THE LIVE SECTION IS RED UNTIL THE MIGRATION IS PASTED. Deliberate and
 * precedented (check-offboarding.mjs; check-projects-admit-unmeasured). A merged
 * migration is not a deployed one, and this is what says so out loud. It SKIPs,
 * loudly, with no credentials.
 *
 * Run: npm run check:offboarding-leonie
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import { loadEnv } from "./lib/gate-env.mjs";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const read = (...p) => readFileSync(join(REPO, ...p), "utf8");

const MIGRATION = "supabase/migrations/20260905130000_offboard_leonie.sql";
const migration = read(MIGRATION);
const schemaSql = read("supabase", "schema.sql");

const PERSON = "fq-leonie-roitsch";
const FACTORIAL_ID = "3417011";
const CONTROL = "md-mathias";
const MATHIAS_UID = "11111111-1111-1111-1111-111111111111";
const SERHII_UID = "26154ec6-5018-45f8-bada-f4506b5d03a6";
/* Only used by the negative control that gives her the account she does not have. */
const HYPOTHETICAL_LEONIE_UID = "22222222-2222-2222-2222-222222222222";

/* All five departures. The first four are also asserted by check-offboarding.mjs. */
const DEPARTED = [
  "fq-kamila-evangelista-da-silva",
  "fq-liliia-ganeeva",
  "fq-pablo-guerra-ares",
  "md-serhii",
  PERSON,
];

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${detail ? `\n        ${detail}` : ""}`);
  if (!ok) failures += 1;
  return ok;
};
const firstLine = (e) => String(e?.message ?? e).split("\n")[0];

/* ========================================================================== */
/* the miniature                                                              */
/* ========================================================================== */

/**
 * A fresh PGlite with supabase/schema.sql loaded, the same two schema.sql gaps
 * bridged that check-offboarding.mjs documents (people.source is narrower in
 * schema.sql than on production), and a MINIMAL crm pair so the gate can prove
 * the migration leaves her Factorial rows alone. Minimal on purpose: the real
 * DDL lives in 20260822130000 / 20260826140000 and is attacked by
 * check-factorial-identity-migration.mjs; here only the columns the header
 * talks about are needed, and the claim made is "unchanged", not "valid".
 */
async function freshDb({ seed = true } = {}) {
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
  await db.exec(schemaSql);
  await db.exec(`
    alter table public.people drop constraint if exists people_source_check;
    alter table public.people add constraint people_source_check
      check (source in ('seed', 'factorial', 'masterdata', 'external'));

    create schema if not exists crm;
    create table crm.factorial_person_reference (
      person_id     text not null references public.people(id) on delete cascade,
      source_system text not null,
      entity_type   text not null,
      external_id   text not null,
      is_active     boolean not null default true,
      match_method  text
    );
    create table crm.factorial_identity_review (
      factorial_employee_id text not null,
      factorial_login_email text,
      factorial_active      boolean,
      terminated_on         date,
      candidate_member_id   bigint,
      candidate_person_id   text references public.people(id) on delete set null,
      status                text not null,
      resolution_note       text
    );
  `);
  if (seed) await seedMeasured(db);
  return db;
}

/**
 * The pre-state exactly as production read on 2026-09-05. Leonie is the one
 * active factorial-source row with no profile and no member; the four earlier
 * departures are in their post-offboarding shape (20260904090000 is pasted, so
 * md-serhii's profile row is inactive and member 38 is unlinked); md-mathias is
 * the CONTROL, active with a profile and a linked member, who must be untouched
 * so the migration cannot pass by deactivating everyone.
 */
async function seedMeasured(db) {
  await db.exec(`
    insert into auth.users (id, email) values
      ('${MATHIAS_UID}', 'mathias@hs-experts.com'),
      ('${SERHII_UID}',  'serhii@hs-experts.com');

    insert into public.people
      (id, name, is_active, source, factorial_employee_id, contract_hours, trackingtime_user_id, role, department, manager_id)
    values
      ('${PERSON}', 'Leonie Roitsch', true, 'factorial', '${FACTORIAL_ID}', 20, null, null, null, null),
      ('fq-kamila-evangelista-da-silva', 'Kamila Evangelista da Silva', false, 'factorial', null, null, null, null, null, null),
      ('fq-liliia-ganeeva',              'Liliia Ganeeva',              false, 'factorial', null, null, null, null, null, null),
      ('fq-pablo-guerra-ares',           'Pablo Guerra Ares',           false, 'factorial', null, null, null, null, null, null),
      ('md-serhii',  'Serhii',  false, 'masterdata', null, null, null, 'Consultant', 'OPERATIONS', null),
      ('${CONTROL}', 'Mathias', true,  'masterdata', null, 40,   null, 'Consultant', 'OPERATIONS', null);

    -- Hub accounts: the control's, active; md-serhii's, ended by 20260904090000.
    -- Leonie has none, and neither do the three fq- precedents.
    insert into public.app_user_profile (user_id, person_id, role_key, department, is_active) values
      ('${MATHIAS_UID}', '${CONTROL}', 'exec',     'OPERATIONS', true),
      ('${SERHII_UID}',  'md-serhii',  'employee', 'OPERATIONS', false);

    -- Vendor records: four archived and unlinked departures, one live control.
    -- No row for Leonie, by id, email or name -- the measured fact this whole
    -- gate is shaped around.
    insert into time.member (id, source_id, email, display_name, hub_person_id, user_id, is_archived)
      overriding system value values
      (16, 'tt-16', 'kamila@hs-experts.com',  'Kamila Evangelista da Silva', 'fq-kamila-evangelista-da-silva', null, true),
      (19, 'tt-19', 'liliia@hs-experts.com',  'Liliia Ganeeva',              'fq-liliia-ganeeva',             null, true),
      (33, 'tt-33', 'pablo@hs-experts.com',   'Pablo Guerra Ares',           'fq-pablo-guerra-ares',          null, true),
      (38, 'tt-38', 'serhii@hs-experts.com',  'Serhii Vylianskyi',           'md-serhii',                     null, true),
      (99, 'tt-99', 'mathias@hs-experts.com', 'Mathias Schwenteit',          '${CONTROL}', '${MATHIAS_UID}', false);

    -- Her Factorial identity, as measured: a manual reference and a resolved
    -- review row that still says active. Both must survive the migration.
    insert into crm.factorial_person_reference (person_id, source_system, entity_type, external_id, is_active, match_method)
      values ('${PERSON}', 'factorial', 'person', '${FACTORIAL_ID}', true, 'manual');
    insert into crm.factorial_identity_review
      (factorial_employee_id, factorial_login_email, factorial_active, terminated_on, candidate_member_id, candidate_person_id, status, resolution_note)
      values ('${FACTORIAL_ID}', 'leonie@hs-experts.com', true, null, null, '${PERSON}', 'resolved_manual',
              'Current Factorial employee without a TrackingTime account -- profile created so hours planning, leave and analytics can see them; no time.member to link');
  `);
}

const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];
const count = async (db, sql, params = []) => Number((await one(db, `select count(*)::int n from ${sql}`, params)).n);

const crmSnapshot = async (db) => JSON.stringify([
  (await db.query("select * from crm.factorial_person_reference order by person_id, external_id")).rows,
  (await db.query("select * from crm.factorial_identity_review order by factorial_employee_id")).rows,
]);

/**
 * The END STATE the migration must leave, as one reusable assertion set: run
 * against the real file (must be all green) and against the mutated copies in
 * section 2b (must go red in a named place). `emit` is `check` or a collector.
 */
async function assertEndState(db, tag, emit) {
  const leonie = await one(db, "select is_active, contract_hours from public.people where id = $1", [PERSON]);
  emit(
    `${tag}: public.people.is_active = false for ${PERSON}`,
    leonie?.is_active === false,
    `is_active = ${leonie ? leonie.is_active : "(no row)"}`,
  );
  emit(
    `${tag}: contract_hours untouched at 20 (vendor-owned; the nightly contract sync keeps writing it)`,
    Number(leonie?.contract_hours) === 20,
    `contract_hours = ${leonie?.contract_hours}`,
  );

  const profiles = await count(db, "public.app_user_profile where person_id = $1", [PERSON]);
  const members = await count(db, "time.member where hub_person_id = $1", [PERSON]);
  emit(
    `${tag}: still no app_user_profile row and no time.member row for her (the migration creates nothing)`,
    profiles === 0 && members === 0,
    `${profiles} profile row(s), ${members} member row(s)`,
  );

  const activeDeparted = (await db.query(
    "select id from public.people where id = any($1) and is_active order by id", [DEPARTED],
  )).rows.map((r) => r.id);
  emit(
    `${tag}: none of the five departed people is active`,
    activeDeparted.length === 0,
    activeDeparted.length ? `still active: ${activeDeparted.join(", ")}` : "kamila, liliia, pablo, serhii, leonie",
  );

  const precedentsIntact =
    (await count(db, "public.app_user_profile where person_id = any($1) and is_active", [DEPARTED])) === 0
    && (await count(db, "time.member where hub_person_id = any($1) and user_id is not null", [DEPARTED])) === 0
    && (await count(db, "time.member where id in (16, 19, 33, 38) and is_archived")) === 4;
  emit(
    `${tag}: the four precedents keep their shape (no active login, no sign-in link, members 16/19/33/38 still archived)`,
    precedentsIntact,
  );

  // SCOPING. One id, and only that id.
  const control = await one(db, "select is_active from public.people where id = $1", [CONTROL]);
  const controlProfile = await one(db, "select is_active from public.app_user_profile where person_id = $1", [CONTROL]);
  const controlMember = await one(db, "select user_id from time.member where hub_person_id = $1", [CONTROL]);
  emit(
    `${tag}: the control colleague ${CONTROL} is untouched`,
    control?.is_active === true && controlProfile?.is_active === true && controlMember?.user_id === MATHIAS_UID,
    `people.is_active=${control?.is_active}, profile.is_active=${controlProfile?.is_active}, member.user_id=${controlMember?.user_id}`
      + " — a migration that deactivates everyone would pass every assertion above this one",
  );
}

/** Run the migration text, collecting its NOTICE/WARNING output and its receipt row. */
async function runMigration(db, text) {
  const notices = [];
  let results = [];
  let error = null;
  try {
    results = await db.exec(text, { onNotice: (n) => notices.push({ severity: n.severity, message: n.message ?? "" }) });
  } catch (e) {
    error = firstLine(e);
  }
  const receipt = results.length ? (results[results.length - 1].rows ?? []) : [];
  return { notices, receipt, error };
}

/* ========================================================================== */
/* 1. THE MIGRATION, IN A REAL ENGINE, TWICE                                  */
/* ========================================================================== */

console.log("\n=== 1. migration in PGlite (measured live pre-state of 2026-09-05) ===\n");

const db = await freshDb();
const crmBefore = await crmSnapshot(db);

// If this ever fails the miniature has stopped reproducing the pre-state, and
// nothing below it proves anything.
{
  const pre = await one(db, "select is_active, source, contract_hours from public.people where id = $1", [PERSON]);
  const profiles = await count(db, "public.app_user_profile where person_id = $1", [PERSON]);
  const members = await count(db, "time.member where hub_person_id = $1", [PERSON]);
  const activePeople = await count(db, "public.people where is_active");
  check(
    "pre-state matches production: Leonie ACTIVE, factorial-source, 20 h, no profile row, no member row",
    pre?.is_active === true && pre?.source === "factorial" && Number(pre?.contract_hours) === 20 && profiles === 0 && members === 0,
    `is_active=${pre?.is_active}, source=${pre?.source}, contract_hours=${pre?.contract_hours}, profiles=${profiles}, members=${members}; `
      + `${activePeople} active people in the miniature (her and the control)`,
  );
}

for (const pass of [1, 2]) {
  const { notices, receipt, error } = await runMigration(db, migration);
  if (!check(`run ${pass}: the migration executes`, error === null, error ?? "")) break;

  await assertEndState(db, `run ${pass}`, check);

  // The DO block's own report. Run 1 must say it changed one people row; run 2
  // must say it changed none -- a no-op that ANNOUNCES itself as one.
  const report = notices.find((n) => n.message.startsWith("offboarded "));
  const expectPeople = pass === 1 ? "people 1 row(s)" : "people 0 row(s)";
  check(
    `run ${pass}: the DO block reports "${expectPeople}" and "0 row(s) of 0 present" for profile and member`,
    Boolean(report)
      && report.message.includes(expectPeople)
      && report.message.includes("app_user_profile 0 row(s) of 0 present")
      && report.message.includes("time.member unlinked 0 row(s) of 0 present"),
    report ? report.message : "no 'offboarded ...' NOTICE received — the block returned early or its report changed shape",
  );

  const warnings = notices.filter((n) => n.severity === "WARNING");
  check(
    `run ${pass}: no pre-state WARNING (profile and member counts are the measured zeros)`,
    warnings.length === 0,
    warnings.length ? warnings.map((w) => w.message).join(" | ") : "",
  );

  // The receipt row is what hitul reads in the SQL editor, where NOTICEs are
  // easy to miss. It must come back, and it must say false / 20 / 0 / 0.
  const r = receipt[0];
  check(
    `run ${pass}: the receipt SELECT returns one row reading is_active=false, contract_hours=20, profile_rows=0, member_rows=0`,
    receipt.length === 1
      && r.id === PERSON && r.is_active === false && Number(r.contract_hours) === 20
      && Number(r.profile_rows) === 0 && Number(r.member_rows) === 0,
    JSON.stringify(receipt),
  );

  check(
    `run ${pass}: her two crm rows (reference, review) are byte-identical to before — the Factorial side is not this file's to change`,
    (await crmSnapshot(db)) === crmBefore,
  );
}

/* ------------------------------------------------------------------------- */
/* 1c. the DOCUMENTED reversal really reverses                                */
/* ------------------------------------------------------------------------- */
/*
 * Read out of the migration's own comment block rather than retyped here, so the
 * comment cannot rot into SQL that does not work. Matched as `update ... ;`
 * blocks, as check-offboarding.mjs does and for the reason it documents there.
 */
const reversalRegion = migration.slice(
  migration.indexOf("REVERSAL. The exact SQL to undo this file"),
  migration.indexOf("That is the whole reversal"),
);
const deCommented = reversalRegion
  .split("\n")
  .filter((l) => l.trim().startsWith("--"))
  .map((l) => l.replace(/^\s*--\s?/, ""))
  .join("\n");
const reversalSql = (deCommented.match(/\bupdate\s[\s\S]*?;/gi) ?? []).map((s) => s.trim());

check(
  "the migration documents a reversal, and it is ONE update (no auth account exists, so there is no uuid to restore)",
  reversalSql.length === 1 && /update public\.people/i.test(reversalSql[0]) && reversalSql[0].includes(`'${PERSON}'`),
  reversalSql.length ? reversalSql.join("\n        ") : "no reversal statements found in the header",
);

if (reversalSql.length === 1) {
  let revErr = null;
  try { await db.exec(reversalSql[0]); } catch (e) { revErr = firstLine(e); }
  check("the documented reversal executes", revErr === null, revErr ?? "");
  const after = await one(db, "select is_active from public.people where id = $1", [PERSON]);
  const profiles = await count(db, "public.app_user_profile where person_id = $1", [PERSON]);
  const members = await count(db, "time.member where hub_person_id = $1", [PERSON]);
  check(
    "and restores exactly the pre-state (active; still no profile row, still no member row)",
    after?.is_active === true && profiles === 0 && members === 0,
    `is_active=${after?.is_active}, profiles=${profiles}, members=${members}`,
  );
  check(
    "and touches neither the control nor the crm rows",
    (await one(db, "select is_active from public.people where id = $1", [CONTROL]))?.is_active === true
      && (await crmSnapshot(db)) === crmBefore,
  );

  // The pair round-trips: forward once more after the reversal lands back on false.
  const third = await runMigration(db, migration);
  check(
    "and the migration applied again after the reversal lands back on is_active = false",
    third.error === null && (await one(db, "select is_active from public.people where id = $1", [PERSON]))?.is_active === false,
    third.error ?? "",
  );
}

await db.close();

/* ------------------------------------------------------------------------- */
/* 1d. a database that never had her: NOTICE, zero receipt rows, no abort     */
/* ------------------------------------------------------------------------- */
{
  const fresh = await freshDb({ seed: false });
  const { notices, receipt, error } = await runMigration(fresh, migration);
  check(
    "it runs cleanly on a database that has never had her (notice, not abort)",
    error === null && notices.some((n) => n.message.includes("nothing to offboard")),
    error ?? (notices.map((n) => n.message).join(" | ") || "no NOTICE received"),
  );
  check(
    "and the receipt SELECT returns ZERO rows there — a paste that did nothing cannot look like one that did",
    error === null && receipt.length === 0,
    `${receipt.length} receipt row(s)`,
  );
  await fresh.close();
}

/* ========================================================================== */
/* 2. NEGATIVE CONTROLS                                                       */
/* ========================================================================== */

console.log("\n=== 2a. negative control: statements 2 and 3 are live code, not decoration ===\n");

/*
 * Give her what she does not have -- a Hub account and a linked, un-archived
 * vendor record -- and run the SAME file. The WARNING must fire (the pre-state
 * differs from the header), and both rows must be ended. If this stayed green
 * with the two statements deleted, the header's promise about the gap between
 * measuring and pasting would be a promise only.
 */
{
  const hyp = await freshDb();
  await hyp.exec(`
    insert into auth.users (id, email) values ('${HYPOTHETICAL_LEONIE_UID}', 'leonie@hs-experts.com');
    insert into public.app_user_profile (user_id, person_id, role_key, department, is_active)
      values ('${HYPOTHETICAL_LEONIE_UID}', '${PERSON}', 'employee', 'MARKETING', true);
    insert into time.member (id, source_id, email, display_name, hub_person_id, user_id, is_archived)
      overriding system value values
      (77, 'tt-77', 'leonie@hs-experts.com', 'Leonie Roitsch', '${PERSON}', '${HYPOTHETICAL_LEONIE_UID}', false);
  `);
  const { notices, receipt, error } = await runMigration(hyp, migration);
  check("hypothetical pre-state: the migration still executes", error === null, error ?? "");

  const warning = notices.find((n) => n.severity === "WARNING");
  check(
    "hypothetical pre-state: the WARNING fires and names the counts (profile 1, member 1) against the measured zeros",
    Boolean(warning) && /app_user_profile rows = 1 \(measured 0\)/.test(warning.message) && /time\.member rows = 1 \(measured 0\)/.test(warning.message),
    warning ? warning.message : "no WARNING — a changed pre-state would pass silently",
  );
  const report = notices.find((n) => n.message.startsWith("offboarded "));
  check(
    "hypothetical pre-state: the report says \"1 row(s) of 1 present\" for both, so a real change cannot read as a zero",
    Boolean(report) && report.message.includes("app_user_profile 1 row(s) of 1 present") && report.message.includes("time.member unlinked 1 row(s) of 1 present"),
    report ? report.message : "no report NOTICE",
  );

  const profile = await one(hyp, "select is_active from public.app_user_profile where person_id = $1", [PERSON]);
  const member = await one(hyp, "select user_id from time.member where hub_person_id = $1", [PERSON]);
  const person = await one(hyp, "select is_active from public.people where id = $1", [PERSON]);
  check(
    "hypothetical pre-state: profile ended, sign-in link cleared, person inactive — statements 2 and 3 do real work when there is work",
    profile?.is_active === false && member?.user_id === null && person?.is_active === false,
    `profile.is_active=${profile?.is_active}, member.user_id=${member?.user_id}, people.is_active=${person?.is_active}`,
  );
  check(
    "hypothetical pre-state: the receipt row shows profile_rows=1, member_rows=1 — the SQL editor sees the difference too",
    receipt.length === 1 && Number(receipt[0].profile_rows) === 1 && Number(receipt[0].member_rows) === 1 && receipt[0].is_active === false,
    JSON.stringify(receipt),
  );
  check(
    "hypothetical pre-state: the control colleague is still untouched",
    (await one(hyp, "select is_active from public.people where id = $1", [CONTROL]))?.is_active === true
      && (await one(hyp, "select user_id from time.member where hub_person_id = $1", [CONTROL]))?.user_id === MATHIAS_UID,
  );
  await hyp.close();
}

console.log("\n=== 2b. discriminator: the gate's own assertions must go RED against a broken file ===\n");

/*
 * No file is written. Each mutation is applied to the migration text in memory,
 * run in its own fresh miniature, and the SAME assertEndState() is required to
 * fail at a named assertion. A gate whose failure nobody has watched is a green
 * tick over a substring search.
 */
const MUTATIONS = [
  {
    label: "wrong id — the DO block finds no row, NOTICEs, returns cleanly",
    mutate: (s) => s.replaceAll(`'${PERSON}'`, `'${PERSON}-typo'`),
    mustRedden: /public\.people\.is_active = false/,
    why: "a typo in the id is a NOTICE and a clean exit; only the end-state assertion catches it",
  },
  {
    label: "scope widened — statement 1 deactivates everybody",
    mutate: (s) => s.replace(
      /update public\.people\s+set is_active = false\s+where id = v_person_id\s+and is_active;/,
      "update public.people set is_active = false where is_active;",
    ),
    mustRedden: /control colleague/,
    why: "every assertion about HER still passes; only the control catches it",
  },
];

for (const m of MUTATIONS) {
  const mutated = m.mutate(migration);
  if (!check(`discriminator (${m.label}): the mutation actually changed the file`, mutated !== migration, m.why)) continue;

  const mdb = await freshDb();
  const { error } = await runMigration(mdb, mutated);
  check(`discriminator (${m.label}): the broken file still executes without error — so the exit code alone would not catch it`, error === null, error ?? "");

  const collected = [];
  await assertEndState(mdb, "mutated", (label, ok, detail) => collected.push({ label, ok, detail }));
  const red = collected.filter((r) => !r.ok);
  const rightPlace = red.some((r) => m.mustRedden.test(r.label));
  check(
    `discriminator (${m.label}): the assertions go RED, in the right place`,
    rightPlace,
    red.length
      ? `${red.length} red: ${red.map((r) => `"${r.label.replace(/^mutated: /, "")}"`).join("; ")}`
      : "every assertion still passed against the broken file — they assert nothing",
  );
  await mdb.close();
}

/* ========================================================================== */
/* 3. LIVE: is the migration actually deployed?                               */
/* ========================================================================== */

console.log("\n=== 3. live database ===\n");

const env = loadEnv();
let liveRan = false;
if (!env.SUPABASE_DB_URL) {
  console.log("SKIP: no SUPABASE_DB_URL — sections 1-2 above still ran and are the deterministic");
  console.log("      part of this gate. The live half cannot be faked green.");
} else {
  liveRan = true;
  const c = new pg.Client({
    connectionString: env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 20000,
  });
  let opened = false;
  try {
    await c.connect();
    await c.query("begin read only");
    await c.query("set local statement_timeout = '30s'");
    opened = true;

    const person = (await c.query(
      "select id, is_active, source, contract_hours from public.people where id = $1", [PERSON],
    )).rows[0];
    check(
      `LIVE: ${PERSON} exists in public.people`,
      Boolean(person),
      person ? JSON.stringify(person) : "no row — the exact key from 2026-09-05 no longer resolves; re-measure before pasting anything",
    );
    check(
      `LIVE: public.people.is_active = false for ${PERSON}`,
      person?.is_active === false,
      person?.is_active
        ? `still active — paste ${MIGRATION} into the SQL editor and read the receipt row it returns`
        : `is_active = ${person?.is_active}`,
    );

    const profiles = Number((await c.query(
      "select count(*)::int n from public.app_user_profile where person_id = $1", [PERSON],
    )).rows[0].n);
    const members = Number((await c.query(
      "select count(*)::int n from time.member where hub_person_id = $1", [PERSON],
    )).rows[0].n);
    check(
      "LIVE: still no app_user_profile row and no time.member row for her (measured 0 / 0 on 2026-09-05)",
      profiles === 0 && members === 0,
      `${profiles} profile row(s), ${members} member row(s)`
        + (profiles || members ? " — the pre-state moved: the migration's WARNING path is now the real path, and the reversal is no longer one statement" : ""),
    );

    const active = (await c.query(
      "select id from public.people where id = any($1) and is_active order by id", [DEPARTED],
    )).rows.map((r) => r.id);
    check(
      "LIVE: none of the five departed people is active",
      active.length === 0,
      active.length ? `still active: ${active.join(", ")}` : DEPARTED.join(", "),
    );

    // INFORMATION, NOT A VERDICT. Factorial is expected to disagree until HR
    // closes her contract there, and her review row is human-held
    // (resolved_manual), so the nightly sync will never move factorial_active
    // even after that. Printed every run so the contradiction stays visible.
    try {
      // Dates are cast to text IN SQL. node-postgres hands a `date` back as a JS
      // Date at local midnight, and toISOString() then shifts it a day when the
      // machine is east of UTC -- this line printed 2027-03-01 for a 2027-03-02
      // contract end the first time it ran.
      const review = (await c.query(
        `select factorial_active, terminated_on::text as terminated_on, status
           from crm.factorial_identity_review where factorial_employee_id = $1`, [FACTORIAL_ID],
      )).rows[0];
      const contract = (await c.query(
        `select ends_on::text as ends_on, job_title, is_active,
                to_char(last_seen_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC' as last_seen
           from crm.factorial_contract_version where factorial_employee_id = $1`, [FACTORIAL_ID],
      )).rows[0];
      console.log(
        `INFO: Factorial says — review row: ${review
          ? `factorial_active=${review.factorial_active}, terminated_on=${review.terminated_on ?? "null"}, status=${review.status}`
          : "n/a (no review row for employee " + FACTORIAL_ID + ")"}; contract: ${contract
          ? `ends_on=${contract.ends_on ?? "null"}, is_active=${contract.is_active}, job_title=${contract.job_title}, last_seen=${contract.last_seen}`
          : "n/a (no contract row)"}`,
      );
      if (review?.factorial_active === true && person?.is_active === false) {
        console.log("      The Hub is ahead of the vendor here on purpose — see the migration header. Not a failure.");
      }
    } catch (e) {
      console.log(`INFO: Factorial's view is n/a — ${firstLine(e)}`);
    }
  } catch (e) {
    check("LIVE: the read-only connection and queries completed", false, firstLine(e));
  } finally {
    if (opened) { try { await c.query("rollback"); } catch {} }
    try { await c.end(); } catch {}
  }
}

console.log(
  failures === 0
    ? (liveRan
      ? "\nOFFBOARDING IS COMPLETE (migration proved twice, no-op announced, receipt read, both negative controls discriminate, live state matches)"
      : "\nMIGRATION PROVED IN PGLITE ONLY (twice, no-op announced, receipt read, both negative controls discriminate) — the live half did not run, so nothing here says it is deployed")
    : `\n${failures} check(s) failed`,
);
process.exit(failures === 0 ? 0 : 1);
