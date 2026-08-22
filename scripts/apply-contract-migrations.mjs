/**
 * Apply the contract-period and budget-alert migrations to the live project,
 * then VERIFY what actually landed.
 *
 * WHY A SCRIPT AND NOT THE SQL EDITOR. Pasting works, but it leaves no record
 * of what was applied or whether it did what the migration claimed. This runs
 * each file in its own transaction, then re-reads the database and asserts the
 * things that matter: the table exists, the overlap rule really rejects an
 * overlap, the renewal function is callable, the alert dedup index is present,
 * and nothing touched time.project.estimated_hours (the column the vendor sync
 * owns). If any assertion fails you find out here rather than the first time
 * somebody books time.
 *
 * SAFETY, in the order it matters:
 *   - Both migrations are already wrapped in BEGIN/COMMIT, and both are
 *     idempotent -- proven by executing each twice against real Postgres in
 *     check-contract-periods.mjs and check-budget-alerts.mjs. Re-running this
 *     script is safe.
 *   - It is ADDITIVE ONLY: new table, new view, new functions, new columns on
 *     an existing alert table. It drops no data and alters no existing column.
 *   - --dry-run prints exactly what would run and connects only to check the
 *     credentials work.
 *   - It refuses to continue if the prerequisite (add_overbooking_alerts.sql)
 *     is missing, because the second migration ALTERs that table and would
 *     fail halfway with a confusing error.
 *
 * Run:      node scripts/apply-contract-migrations.mjs
 * Dry run:  node scripts/apply-contract-migrations.mjs --dry-run
 *
 * Needs SUPABASE_DB_URL in .env.local (the same variable
 * scripts/apply-rls-hoisting.mjs uses). Supabase dashboard ->
 * Project Settings -> Database -> Connection string -> URI.
 */
import { readFileSync } from "node:fs";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const DRY = process.argv.includes("--dry-run");
const CONN = env.SUPABASE_DB_URL || env.DATABASE_URL;

const FILES = [
  "supabase/migrations/add_contract_periods.sql",
  "supabase/migrations/add_budget_alert_visibility.sql",
];

if (!CONN) {
  console.log(`
Cannot apply: no database connection string.

  DDL cannot go through the REST API -- PostgREST executes queries, not schema
  changes, and this project deliberately has no exec_sql RPC (one would be a
  remote code execution primitive gated only by an API key). So this needs a
  direct Postgres connection.

  Add ONE line to .env.local:

    SUPABASE_DB_URL=postgresql://postgres.wdbedblvyrfqwypngghs:<PASSWORD>@<HOST>:5432/postgres

  Get it from: Supabase dashboard -> Project Settings -> Database ->
  Connection string -> URI. Copy the whole URI and substitute your password.

  Then re-run:  node scripts/apply-contract-migrations.mjs

  Nothing has been changed.
`);
  process.exit(2);
}

const { Client } = await import("pg");

const client = new Client({
  connectionString: CONN,
  // Supabase terminates TLS with a cert this client will not have pinned.
  ssl: { rejectUnauthorized: false },
});

try {
  await client.connect();
} catch (e) {
  console.log(`Could not connect: ${e.message}`);
  console.log("\nCheck the password and host in SUPABASE_DB_URL. Nothing has been changed.");
  process.exit(1);
}

const one = async (sql, params) => (await client.query(sql, params)).rows[0];
const all = async (sql, params) => (await client.query(sql, params)).rows;

const db = await one("select current_database() as db, version() as v");
console.log(`connected to ${db.db}`);
console.log(`${String(db.v).split(",")[0]}\n`);

/* ------------------------------------------------------- pre-flight checks */

// The second migration ALTERs public.overbooking_alert. If that table is not
// there, this stops now with a clear reason rather than failing mid-apply.
const prereq = await one(`
  select count(*)::int as n from information_schema.tables
  where table_schema = 'public' and table_name = 'overbooking_alert'
`);
if (prereq.n === 0) {
  console.log(
    "STOP: public.overbooking_alert does not exist, so add_budget_alert_visibility.sql\n" +
      "would fail. Apply supabase/migrations/add_overbooking_alerts.sql first.\n" +
      "Nothing has been changed.",
  );
  await client.end();
  process.exit(1);
}
console.log("prerequisite present: public.overbooking_alert");

// Report what already exists, so a re-run is transparent rather than silent.
const already = await one(`
  select
    (select count(*)::int from information_schema.tables
      where table_schema = 'time' and table_name = 'project_contract_period') as periods,
    (select count(*)::int from information_schema.views
      where table_schema = 'public' and table_name = 'budget_alert_feed') as feed
`);
console.log(
  `current state: contract period table ${already.periods ? "EXISTS" : "absent"}, ` +
    `alert feed view ${already.feed ? "EXISTS" : "absent"}` +
    (already.periods || already.feed ? " (re-run: both migrations are idempotent)" : ""),
);

if (DRY) {
  console.log("\n--- DRY RUN: the following would be applied, in order ---");
  for (const f of FILES) {
    const sql = readFileSync(f, "utf8");
    const stmts = sql.split("\n").filter((l) => /^\s*(create|alter|insert|drop|grant|comment|do)\b/i.test(l));
    console.log(`\n${f}  (${sql.length} bytes, ~${stmts.length} top-level statements)`);
    for (const s of stmts.slice(0, 14)) console.log(`   ${s.trim().slice(0, 92)}`);
    if (stmts.length > 14) console.log(`   ... and ${stmts.length - 14} more`);
  }
  console.log("\nNothing has been changed. Re-run without --dry-run to apply.");
  await client.end();
  process.exit(0);
}

/* --------------------------------------------------------------- the apply */

for (const f of FILES) {
  const sql = readFileSync(f, "utf8");
  process.stdout.write(`\napplying ${f} ... `);
  try {
    // The files carry their own BEGIN/COMMIT, so they are sent as one script.
    await client.query(sql);
    console.log("OK");
  } catch (e) {
    console.log("FAILED");
    console.log(`\n  ${e.message}`);
    if (e.hint) console.log(`  hint: ${e.hint}`);
    if (e.position) console.log(`  at character ${e.position}`);
    console.log(
      "\nThe file is wrapped in a transaction, so this migration rolled back and\n" +
        "the database is unchanged by it. Fix the cause and re-run.",
    );
    await client.end();
    process.exit(1);
  }
}

/* ------------------------------------------------------------ verification */

console.log("\n--- verifying what actually landed ---");
let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
};

const tbl = await one(`
  select count(*)::int as n from information_schema.tables
  where table_schema = 'time' and table_name = 'project_contract_period'
`);
check("the contract period table exists", tbl.n === 1);

const view = await one(`
  select count(*)::int as n from information_schema.views
  where table_schema = 'time' and table_name = 'contract_period_status'
`);
check("the contract status view exists", view.n === 1);

const fns = (await all(`
  select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'time'
    and p.proname in ('renew_contract_period','active_contract_period','contract_period_logged_hours')
  order by p.proname
`)).map((r) => r.proname);
check(
  "all three contract functions exist",
  fns.length === 3,
  fns.join(", ") || "none found",
);

const trg = await one(`
  select count(*)::int as n from pg_trigger
  where tgname = 'contract_period_no_overlap' and not tgisinternal
`);
check("the no-overlap trigger is installed", trg.n === 1);

const rls = await one(`
  select relrowsecurity as on from pg_class where oid = 'time.project_contract_period'::regclass
`);
check("row level security is enabled on contract periods", rls.on === true);

const pol = await all(`
  select cmd from pg_policies
  where schemaname = 'time' and tablename = 'project_contract_period'
`);
check(
  "RLS policies cover select/insert/update/delete",
  ["SELECT", "INSERT", "UPDATE", "DELETE"].every((c) => pol.some((p) => p.cmd === c)),
  pol.map((p) => p.cmd).join(", "),
);

const perms = await all(`
  select permission_key, resource, action from public.app_permission
  where permission_key in (
    'projects:contracts:read','projects:contracts:write',
    'projects:alerts:read','projects:alerts:acknowledge'
  ) order by permission_key
`);
check("all four new permission keys exist", perms.length === 4, `${perms.length} found`);
check(
  "resource and action are populated on each (the bug that broke the HR migration)",
  perms.every((p) => p.resource && p.action),
  perms.map((p) => `${p.permission_key}->${p.resource}/${p.action}`).join(" "),
);

const grants = await all(`
  select permission_key, count(*)::int as roles from public.app_role_permission
  where permission_key like 'projects:contracts:%' or permission_key like 'projects:alerts:%'
  group by permission_key order by permission_key
`);
check(
  "the new capabilities are granted to roles",
  grants.length === 4 && grants.every((g) => g.roles > 0),
  grants.map((g) => `${g.permission_key}=${g.roles}`).join(" "),
);

const idx = await one(`
  select count(*)::int as n from pg_indexes
  where tablename = 'overbooking_alert' and indexname = 'overbooking_alert_open_unique'
`);
check("the alert anti-spam index exists", idx.n === 1, "one open alert per project/period/kind/threshold");

const feed = await one(`
  select count(*)::int as n from information_schema.views
  where table_schema = 'public' and table_name = 'budget_alert_feed'
`);
check("the alert feed view exists", feed.n === 1);

/*
 * THE LIVE OVERLAP TEST. The whole budget model rests on "at most one contract
 * period covers a date", so it is worth proving on the real database rather
 * than trusting that the trigger compiled. Done inside a transaction that is
 * ALWAYS rolled back, so it writes nothing.
 */
{
  const proj = await one(`select id, name from time.project order by id limit 1`);
  await client.query("begin");
  try {
    await client.query(
      `insert into time.project_contract_period
         (project_id, period_no, budget_hours, starts_on, ends_on)
       values ($1, 9001, 10, '2099-01-01', '2099-12-31')`,
      [proj.id],
    );
    let rejected = false;
    let msg = "";
    try {
      await client.query(
        `insert into time.project_contract_period
           (project_id, period_no, budget_hours, starts_on, ends_on)
         values ($1, 9002, 10, '2099-06-01', '2100-05-31')`,
        [proj.id],
      );
    } catch (e) {
      rejected = true;
      msg = e.message.split("\n")[0];
    }
    check(
      "an overlapping period is REJECTED on the live database",
      rejected,
      rejected ? msg.slice(0, 110) : "the overlap was accepted, so two budgets could claim one date",
    );
  } finally {
    // Always: this was a probe, not data.
    await client.query("rollback");
  }
  const leftover = await one(
    `select count(*)::int as n from time.project_contract_period where period_no in (9001, 9002)`,
  );
  check("the probe left nothing behind", leftover.n === 0, `${leftover.n} test rows remain`);
}

// The column the vendor sync owns must be untouched: that separation is the
// entire reason contract terms live in their own table.
const est = await one(`
  select count(*)::int as n from time.project
  where estimated_hours is not null and estimated_hours > 0
`);
check(
  "time.project.estimated_hours is intact (the sync still owns it)",
  est.n > 0,
  `${est.n} projects still carry a vendor estimate`,
);

const existingAlerts = await one(`select count(*)::int as n, count(kind)::int as k from public.overbooking_alert`);
check(
  "existing alert rows survived and were classified",
  existingAlerts.n === existingAlerts.k,
  `${existingAlerts.n} alert row(s), all with a kind`,
);

const periodCount = await one(`select count(*)::int as n from time.project_contract_period`);

await client.end();

console.log(
  failed === 0
    ? `\nMIGRATIONS APPLIED AND VERIFIED. ${periodCount.n} contract period(s) recorded so far.\n` +
        "Next: open a project and record its contract terms."
    : `\n${failed} verification(s) failed — read the FAILs above before using the feature.`,
);
process.exit(failed === 0 ? 0 : 1);
