/*
 * `anon` may not hold a write-shaped privilege on anything.
 *
 * ── The failure this exists to catch ────────────────────────────────────────
 *
 * Measured on production 2026-09-03, read-only: `anon` held
 *
 *     DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
 *
 * on 33 tables in `public`, including `people`, `weekly_employee_summary`,
 * `timesheet_entries`, `leave_requests`, `leave_balances` and
 * `app_role_permission`.
 *
 * The INSERT/UPDATE/DELETE half was inert, because RLS is on everywhere and no
 * policy names anon. TRUNCATE was not, because ROW-LEVEL SECURITY IS NOT
 * EVALUATED FOR TRUNCATE. Neither is REFERENCES, nor TRIGGER. Postgres checks
 * the table privilege and executes. Demonstrated rather than argued in
 * scripts/check-anon-grants-migration.mjs, which truncates an RLS-protected
 * table as anon in PGlite and then shows the equivalent DELETE being refused.
 *
 * It arrived by nobody's decision: Supabase's stock DEFAULT PRIVILEGES on
 * schema public grant `arwdDxtm` (all seven) to anon, so every table created
 * since inherited it at CREATE time. That is why this gate checks the CURRENT
 * grants rather than trusting a migration to have covered a list — the list
 * grows every time somebody writes `create table`.
 *
 * ── Why this reads pg_class.relacl and not information_schema ─────────────
 *
 * The first version of this gate used information_schema.role_table_grants, and
 * it reported six write privileges per table. The real ACL on the same rows is
 * `anon=arwdDxtm/postgres` — eight letters. The missing one is `m`, MAINTAIN,
 * added in PostgreSQL 17 (production runs 17.6): VACUUM, ANALYZE, CLUSTER,
 * REINDEX, REFRESH MATERIALIZED VIEW, LOCK TABLE. information_schema only
 * describes SQL-standard privileges, so a gate built on it cannot see MAINTAIN
 * at all — the same shape of blindness as testing for TRUNCATE over HTTP.
 *
 * So the source of truth here is pg_class.relacl, decoded letter by letter:
 *
 *     a INSERT   r SELECT   w UPDATE   d DELETE
 *     D TRUNCATE x REFERENCES  t TRIGGER  m MAINTAIN
 *
 * `r` is the only one anon may hold.
 *
 * ── Relationship to check-no-anonymous-read.mjs ────────────────────────────
 *
 * That gate asks what an anonymous caller can READ, and answers it the way an
 * attacker would: a live unauthenticated HTTP request against every relation.
 * It is the better test for reads and it stays the authority there.
 *
 * It cannot see this defect. An HTTP probe cannot issue TRUNCATE — PostgREST
 * has no verb for it — so the privilege that ignores RLS is exactly the one a
 * behavioural read test is blind to. This gate is structural on purpose, and
 * the two are complements: one proves the policy layer holds, this one proves
 * we are not relying on the policy layer for the operations it never sees.
 *
 * ── Read-only. SKIPs without SUPABASE_DB_URL, so CI runs without secrets. ──
 *
 * Run: npm run check:anon-grants
 */
import pg from "pg";
import { loadEnv } from "./lib/gate-env.mjs";

const env = loadEnv();

if (!env.SUPABASE_DB_URL) {
  console.log("SKIP: no SUPABASE_DB_URL, so there is no live database to check");
  process.exit(0);
}

/**
 * ACL letters that are not a read. SELECT (`r`) is deliberately absent, and so
 * are the `*` grant-option markers, which are handled by stripping.
 */
const WRITE_LETTERS = {
  a: "INSERT", w: "UPDATE", d: "DELETE", D: "TRUNCATE",
  x: "REFERENCES", t: "TRIGGER", m: "MAINTAIN",
};

/** For the information_schema control below, which cannot see MAINTAIN. */
const WRITE_PRIVS = ["INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"];

/** Pull anon's letters out of a relacl / defaclacl text array. */
const anonLetters = (acl) => (/(?:^|[{,])anon=([a-zA-Z*]*)\//.exec(acl ?? "")?.[1] ?? "").replace(/\*/g, "");

const SCHEMAS = ["public", "time", "crm", "projects", "raw", "stg"];

/**
 * The ONLY permitted exceptions. Every entry needs a written reason, and the
 * reason has to say what would break without it — "legacy" is not a reason,
 * and neither is "it was already there", which is how the 33 grants above
 * survived for months.
 *
 * Empty on purpose. `anon` is the role attached to the API key that ships in
 * the browser bundle; there is no operation this product performs before
 * sign-in that writes to the database. If that ever changes, the entry belongs
 * here with the endpoint named.
 *
 * Shape: { schema, table, privilege, reason }
 */
const ALLOW = [
  // {
  //   schema: "public", table: "example", privilege: "INSERT",
  //   reason: "Named endpoint X writes here before sign-in because ...; RLS policy Y bounds it.",
  // },
];

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

try {
  // Never let this gate write, whatever a future edit does to it.
  await c.query("set default_transaction_read_only = on");

  /* ---------------------------------------------- 1. the grants themselves */

  const { rows: relations } = await c.query(
    `select n.nspname as schema, c.relname as table, c.relkind, c.relacl::text as acl
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = any($1)
        and c.relkind in ('r','p','v','m','f')
      order by 1, 2`,
    [SCHEMAS],
  );

  const allowed = new Set(ALLOW.map((a) => `${a.schema}.${a.table}:${a.privilege}`));
  const byTable = new Map();
  let violationCount = 0;
  for (const rel of relations) {
    const held = [...anonLetters(rel.acl)]
      .filter((ch) => WRITE_LETTERS[ch])
      .map((ch) => WRITE_LETTERS[ch])
      .filter((priv) => !allowed.has(`${rel.schema}.${rel.table}:${priv}`));
    if (!held.length) continue;
    byTable.set(`${rel.schema}.${rel.table}`, held.sort());
    violationCount += held.length;
  }
  check(
    `anon holds no write-shaped privilege in ${SCHEMAS.join(", ")}`,
    violationCount === 0,
    violationCount
      ? `${violationCount} grant(s) across ${byTable.size} of ${relations.length} relation(s)`
      : `${relations.length} relations checked for INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN`,
  );
  for (const [table, privs] of [...byTable].sort()) {
    console.log(`        ${table.padEnd(44)} ${privs.join(", ")}`);
  }
  if (violationCount) {
    console.log("\n        Fix: supabase/migrations/20260903120000_anon_holds_no_write_privileges.sql");
    console.log("        TRUNCATE is not subject to RLS, so a policy is not a defence against it.");
  }

  /* --------------------------------- 2. and the defaults that regrant them */

  const { rows: defaults } = await c.query(
    `select n.nspname as schema, pg_get_userbyid(d.defaclrole) as owner,
            d.defaclobjtype as objtype, d.defaclacl::text as acl
       from pg_default_acl d
       join pg_namespace n on n.oid = d.defaclnamespace
      where n.nspname = any($1) and d.defaclobjtype = 'r'`,
    [SCHEMAS],
  );

  /*
   * `anon=` followed by any of the write letters. `r` alone is the state this
   * gate wants; anything else is a regrant waiting for the next `create table`.
   *
   * supabase_admin's own default ACL is reported but not failed on: `postgres`
   * is not a member of that role and cannot alter it, and nothing in this repo
   * is owned by it (all 36 relations in public are postgres-owned). Failing on
   * something no migration this project can write would fix is a gate nobody
   * can ever make green.
   */
  const regrants = (d) => [...anonLetters(d.acl)].some((ch) => WRITE_LETTERS[ch]);
  const regranting = defaults.filter((d) => regrants(d) && d.owner !== "supabase_admin");
  const informational = defaults.filter((d) => regrants(d) && d.owner === "supabase_admin");

  check(
    "no DEFAULT PRIVILEGE re-grants writes to anon on a future table",
    regranting.length === 0,
    regranting.length
      ? regranting.map((d) => `${d.schema} (owner ${d.owner}): ${d.acl}`).join("; ")
      : `${defaults.length} default ACL(s) inspected`,
  );
  for (const d of informational) {
    console.log(`        NOTE ${d.schema}: supabase_admin's default ACL still grants anon writes`);
    console.log("             — not failed: postgres cannot alter it and owns every relation here anyway.");
  }

  /* ---------------------------------------------------------- 3. controls */

  /*
   * Two of them, because every assertion above is satisfied by a database that
   * has no grants at all, no tables at all, or an unreachable information_schema.
   */
  const { rows: [authRow] } = await c.query(
    `select count(*)::int as n from information_schema.role_table_grants
      where grantee = 'authenticated' and table_schema = 'public' and privilege_type = any($1)`,
    [WRITE_PRIVS],
  );
  check(
    "control: authenticated DOES hold write privileges in public",
    authRow.n > 0,
    `${authRow.n} grant(s) — if this were 0 the check above would pass on an empty database`,
  );

  const { rows: [tableRow] } = await c.query(
    `select count(*)::int as n from information_schema.tables
      where table_schema = 'public' and table_type in ('BASE TABLE','VIEW')`,
  );
  check(
    "control: public actually contains relations",
    tableRow.n > 0,
    `${tableRow.n} relation(s) in public`,
  );
} finally {
  await c.end();
}

console.log(failures === 0
  ? "\nANON HOLDS NO WRITE PRIVILEGES: truncate, insert, update, delete, references and trigger are all closed"
  : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
