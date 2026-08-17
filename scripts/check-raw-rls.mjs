// Coverage for the raw connector landing zone (supabase/schema.sql §7).
//
// One claim in that schema is load-bearing and is NOT obvious from reading it:
//
//   raw.vendor_record has RLS enabled and DELIBERATELY ZERO POLICIES.
//
// That is only safe if "RLS on, no policy" means denied-by-default in Postgres.
// It does -- but the failure mode if that assumption were wrong is the worst
// one available here: raw payloads carry personal data from every vendor and
// salary data from Factorial, so an accidental grant exposes all of it to any
// signed-in colleague. A comment asserting "no policy = denied" is not proof.
// This gate proves it against a real Postgres.
//
// The second claim: raw.sync_run IS readable, because the Hub sync bar needs
// freshness. So the gate must show the two tables behave DIFFERENTLY -- if a
// future edit adds a blanket policy across the schema, "sync_run is readable"
// would still pass while the important boundary had silently gone.
//
// Run: node scripts/check-raw-rls.mjs
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const db = await new PGlite();

await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key, email text);
  do $$ begin
    if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  end $$;
  create or replace function auth.uid() returns uuid
    language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
`);

await db.exec(readFileSync("supabase/schema.sql", "utf8"));

const EXEC = "11111111-1111-1111-1111-111111111111";

await db.exec(`
  insert into auth.users (id, email) values ('${EXEC}','exec@x.com');
  insert into app_user_profile (user_id, person_id, role_key, department, is_active)
    values ('${EXEC}', null, 'exec', null, true);

  grant usage on schema public to authenticated;
  grant select, insert, update, delete on all tables in schema public to authenticated;
  grant usage, select on all sequences in schema public to authenticated;
`);

let failed = false;
const check = (label, ok, detail = "") => {
  if (!ok) failed = true;
  console.log(`${ok ? "PASS" : "FAIL"} | ${label}${!ok && detail ? `\n       ${detail}` : ""}`);
};

/** Run as a signed-in user, exactly as PostgREST would. */
async function asUser(uid, sql) {
  await db.exec("begin");
  try {
    await db.exec(`set local role authenticated`);
    await db.exec(`select set_config('request.jwt.claim.sub', '${uid}', true)`);
    const res = await db.query(sql);
    await db.exec("commit");
    return { rows: res.rows, error: null };
  } catch (e) {
    await db.exec("rollback");
    return { rows: [], error: e.message };
  }
}

// --- seed as the service role (bypasses RLS, as the connector does) --------
await db.exec(`
  insert into raw.vendor_record (source, entity, endpoint, source_id, account_ref, payload, payload_hash)
  values
    ('trackingtime','users','/1725/users','88','1725',
     '{"email":"anna@hs-experts.com","name":"Anna Schmidt"}'::jsonb,'h1'),
    ('factorial','employees','/employees','42',null,
     '{"salary":91000,"iban":"DE89370400440532013000"}'::jsonb,'h2');

  insert into raw.sync_run (source, entity, status, record_count, finished_at)
  values ('trackingtime','users','ok', 2, now());
`);

// --- the structure exists ---------------------------------------------------
const schema = await db.query(`select 1 from information_schema.schemata where schema_name='raw'`);
check("the raw schema exists", schema.rows.length === 1);

const tables = await db.query(
  `select table_name from information_schema.tables where table_schema='raw' order by 1`,
);
check(
  "raw holds exactly vendor_record and sync_run",
  tables.rows.map((r) => r.table_name).join(",") === "sync_run,vendor_record",
  `found: ${tables.rows.map((r) => r.table_name).join(",")}`,
);

const rls = await db.query(
  `select relname, relrowsecurity from pg_class c
   join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='raw' and relkind='r' order by 1`,
);
check(
  "RLS is enabled on both raw tables",
  rls.rows.length === 2 && rls.rows.every((r) => r.relrowsecurity === true),
);

// --- THE claim: vendor_record has no policy, and that means denied ---------
const vrPolicies = await db.query(
  `select policyname from pg_policies where schemaname='raw' and tablename='vendor_record'`,
);
check(
  "vendor_record has zero policies (by design)",
  vrPolicies.rows.length === 0,
  `found ${vrPolicies.rows.length}: ${vrPolicies.rows.map((r) => r.policyname).join(", ")}`,
);

const readVendor = await asUser(EXEC, `select count(*)::int as n from raw.vendor_record`);
check(
  "an EXEC cannot read raw.vendor_record",
  readVendor.error !== null || Number(readVendor.rows[0]?.n ?? -1) === 0,
  "exec is the most privileged role -- if it can read raw, everyone can",
);
check(
  "...and no salary or IBAN is reachable through it",
  readVendor.error !== null || readVendor.rows.length === 0,
  "Factorial payloads carry salary and bank details",
);

const writeVendor = await asUser(
  EXEC,
  `insert into raw.vendor_record (source, entity, endpoint, source_id, payload, payload_hash)
   values ('asana','x','/x','1','{}'::jsonb,'h')`,
);
check("an EXEC cannot write to raw.vendor_record", writeVendor.error !== null);

const delVendor = await asUser(EXEC, `delete from raw.vendor_record`);
check(
  "an EXEC cannot delete from raw.vendor_record (append-only)",
  delVendor.error !== null,
  "the audit trail must not be erasable from the app",
);

// --- the service role still works, or the connector cannot land data -------
const svc = await db.query(`select count(*)::int as n from raw.vendor_record`);
check(
  "the service role (RLS bypass) still sees the rows",
  Number(svc.rows[0].n) === 2,
  "if this fails, raw is not just private -- it is unusable",
);

// --- sync_run is deliberately DIFFERENT ------------------------------------
const readRuns = await asUser(EXEC, `select status, record_count from raw.sync_run`);
check(
  "an authenticated user CAN read raw.sync_run",
  readRuns.error === null && readRuns.rows.length === 1,
  `the sync bar needs freshness: ${readRuns.error ?? "no rows"}`,
);
check(
  "the two raw tables genuinely differ in access",
  (readVendor.error !== null || readVendor.rows.length === 0) && readRuns.rows.length === 1,
  "if both were readable, a blanket grant has been added and the boundary is gone",
);

const writeRun = await asUser(
  EXEC,
  `insert into raw.sync_run (source, entity, status) values ('asana','x','ok')`,
);
check(
  "an authenticated user cannot WRITE sync_run (read-only surface)",
  writeRun.error !== null,
  "sync health is reported by the connector, never claimed by a browser",
);

// --- idempotency: a re-sync must update, not duplicate ---------------------
const dupe = await db
  .query(
    `insert into raw.vendor_record (source, entity, endpoint, source_id, account_ref, payload, payload_hash)
     values ('trackingtime','users','/1725/users','88','1725','{"changed":true}'::jsonb,'h9')`,
  )
  .then(() => null)
  .catch((e) => e.message);
check(
  "re-inserting the same vendor record is rejected (unique key holds)",
  dupe !== null,
  "without this a nightly sync duplicates every row it re-reads",
);

// The same source_id in a DIFFERENT workspace must still be allowed, or a
// multi-workspace account collapses two real records into one.
const otherAccount = await db
  .query(
    `insert into raw.vendor_record (source, entity, endpoint, source_id, account_ref, payload, payload_hash)
     values ('trackingtime','users','/999/users','88','999','{"other":true}'::jsonb,'h10')`,
  )
  .then(() => null)
  .catch((e) => e.message);
check(
  "the same source_id in another workspace is still allowed",
  otherAccount === null,
  `account_ref must be part of the key: ${otherAccount}`,
);

// --- NEGATIVE CONTROL -------------------------------------------------------
// Prove the read assertions above are not vacuous: grant a policy and the same
// query must start returning rows. If it does not, the test is measuring
// nothing.
await db.exec(`
  create policy "temp leak" on raw.vendor_record for select to authenticated using (true);
  grant select on raw.vendor_record to authenticated;
`);
const leaked = await asUser(EXEC, `select count(*)::int as n from raw.vendor_record`);
check(
  "NEGATIVE CONTROL: adding a policy DOES expose the rows",
  leaked.error === null && Number(leaked.rows[0]?.n) === 3,
  `the deny assertions only mean something if this leaks: ${leaked.error ?? leaked.rows[0]?.n}`,
);
await db.exec(`drop policy "temp leak" on raw.vendor_record;`);

console.log(failed ? "\nRAW LANDING ZONE: checks failed" : "\nRAW LANDING ZONE: all checks passed");
process.exit(failed ? 1 : 0);
