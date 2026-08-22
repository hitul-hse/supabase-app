/**
 * Execute the contract-period migration against a REAL Postgres (PGlite)
 * before asking the user to apply it, and prove the behaviour the feature
 * depends on rather than just "it ran".
 *
 * The user applies migrations themselves, so a migration that fails halfway on
 * their database is a bad outcome: it leaves them mid-apply with no obvious way
 * back. The HR migration failed exactly that way twice (a NOT NULL column, then
 * a non-idempotent `create policy`), which is why every claim here is executed.
 *
 * What actually matters about this migration, and so is asserted below:
 *   - the no-overlap exclusion constraint really rejects an overlap
 *   - a renewal preserves the previous period's budget AND its hours
 *   - hours are attributed by date window, in Europe/Berlin
 *   - the vendor sync's estimated_hours is untouched by any of it
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? `\n        ${detail}` : ""}`);
};

const preamble = `
  create schema if not exists auth;
  create table auth.users (id uuid primary key, email text);
  do $$ begin
    if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
    if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
  end $$;
  create or replace function auth.uid() returns uuid
    language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
`;

const schema = readFileSync("supabase/schema.sql", "utf8");
const migration = readFileSync("supabase/migrations/add_contract_periods.sql", "utf8");

const fresh = async () => {
  const db = await new PGlite();
  await db.exec(preamble);
  await db.exec(schema);
  return db;
};

const db = await fresh();
console.log("base schema applied\n");

try {
  await db.exec(migration);
  check("the migration executes without error", true);
} catch (e) {
  check("the migration executes without error", false, e.message);
  console.log("\nCONTRACT PERIODS: FAILED");
  process.exit(1);
}

// Idempotence on a separate database: a failed statement aborts the
// surrounding transaction, which would make every later assertion fail for the
// wrong reason.
{
  const d2 = await fresh();
  await d2.exec(migration);
  let ok = true;
  let detail = "";
  try {
    await d2.exec(migration);
  } catch (e) {
    ok = false;
    detail = e.message;
  }
  await d2.close();
  check("re-running it is safe (idempotent)", ok, detail);
}

/* ------------------------------------------------------------ the structure */

const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const all = async (sql, params) => (await db.query(sql, params)).rows;

const tbl = await one(`
  select count(*)::int as n from information_schema.tables
  where table_schema = 'time' and table_name = 'project_contract_period'
`);
check("the contract period table exists", tbl.n === 1);

const cols = await all(`
  select column_name, is_nullable, data_type
  from information_schema.columns
  where table_schema = 'time' and table_name = 'project_contract_period'
  order by ordinal_position
`);
const names = cols.map((c) => c.column_name);
for (const needed of [
  "project_id", "period_no", "budget_hours", "starts_on", "ends_on",
  "warn_at_percent", "contract_reference", "renewed_from_id",
  "confirmed_by", "confirmed_at",
]) {
  check(`column ${needed} exists`, names.includes(needed));
}

const budgetCol = cols.find((c) => c.column_name === "budget_hours");
check(
  "budget_hours is NOT NULL (a period without a budget is not a period)",
  budgetCol.is_nullable === "NO",
);

/* ---------------------------------------------- seed a project and a period */

await db.exec(`
  insert into time.customer (id, name) overriding system value values (1, 'WorkMotion Software GmbH');
  insert into time.project (id, source_id, customer_id, name, estimated_hours)
    overriding system value
    values (1, 'tt-1', 1, '10303_WorkMotion Software GmbH / 25/26 GU', 5);
  insert into time.member (id, source_id, display_name) overriding system value values (1, 'm-1', 'Test Person');
`);

// Period 1: the real WorkMotion contract, 5h.
await db.exec(`
  insert into time.project_contract_period
    (project_id, period_no, budget_hours, starts_on, ends_on, warn_at_percent, contract_reference)
  values (1, 1, 5, '2025-07-01', '2026-06-30', 80, 'WM-2025-GU');
`);

// Hours inside period 1: 21.1h, the real overrun.
await db.exec(`
  insert into time.entry (member_id, project_id, started_at, ended_at, duration_seconds)
  values (1, 1, '2025-09-15 09:00+02', '2025-09-15 09:00+02'::timestamptz + interval '21.1 hours', 21.1*3600);
`);

const p1 = await one(`select * from time.contract_period_status where project_id = 1 and period_no = 1`);
check(
  "period 1 reports its real budget and burn",
  Number(p1.budget_hours) === 5 && Math.abs(Number(p1.logged_hours) - 21.1) < 0.01,
  `budget=${p1.budget_hours}h logged=${Number(p1.logged_hours).toFixed(2)}h burn=${p1.burn_percent}%`,
);
check(
  "burn percent matches the 422% the UI showed",
  Math.round(Number(p1.burn_percent)) === 422,
  `burn=${p1.burn_percent}%`,
);

/* ------------------------------------------------ the no-overlap constraint */

let overlapRejected = false;
let overlapErr = "";
try {
  await db.exec(`
    insert into time.project_contract_period
      (project_id, period_no, budget_hours, starts_on, ends_on)
    values (1, 99, 10, '2026-01-01', '2026-12-31');
  `);
} catch (e) {
  overlapRejected = true;
  overlapErr = e.message.split("\n")[0];
}
check(
  "an OVERLAPPING period is rejected by the database",
  overlapRejected,
  overlapErr || "the insert succeeded, so two periods could claim the same date",
);

// A non-overlapping period must still be allowed, or the constraint is useless.
let adjacentOk = true;
try {
  await db.exec(`
    insert into time.project_contract_period
      (project_id, period_no, budget_hours, starts_on, ends_on, renewed_from_id)
    values (1, 2, 8, '2026-07-01', '2027-06-30', 1);
  `);
} catch (e) {
  adjacentOk = false;
  overlapErr = e.message;
}
check("an adjacent, non-overlapping period IS allowed", adjacentOk, adjacentOk ? "" : overlapErr);

/* ------------------------------- THE REQUIREMENT: renewal preserves history */

const after = await all(`select * from time.contract_period_status where project_id = 1 order by period_no`);
check("both periods exist after the renewal", after.length === 2, `${after.length} periods`);

const oldP = after.find((r) => r.period_no === 1);
const newP = after.find((r) => r.period_no === 2);

check(
  "the OLD period keeps its 5h budget after the renewal",
  Number(oldP.budget_hours) === 5,
  `old budget=${oldP.budget_hours}h`,
);
check(
  "the OLD period keeps its 21.1h of booked time",
  Math.abs(Number(oldP.logged_hours) - 21.1) < 0.01,
  `old logged=${Number(oldP.logged_hours).toFixed(2)}h`,
);
check(
  "the NEW period starts at ZERO hours, not inheriting the overrun",
  Number(newP.logged_hours) === 0,
  `new logged=${Number(newP.logged_hours).toFixed(2)}h of ${newP.budget_hours}h`,
);
check(
  "the renewal chain is navigable (period 2 points at period 1)",
  Number(newP.renewed_from_id) === Number(oldP.id),
  `renewed_from_id=${newP.renewed_from_id} vs period1 id=${oldP.id}`,
);

// Hours land in the period whose window contains them.
await db.exec(`
  insert into time.entry (member_id, project_id, started_at, ended_at, duration_seconds)
  values (1, 1, '2026-08-10 09:00+02', '2026-08-10 12:00+02', 3*3600);
`);
const after2 = await all(`select * from time.contract_period_status where project_id = 1 order by period_no`);
check(
  "a new entry counts against the CURRENT period only",
  Math.abs(Number(after2[0].logged_hours) - 21.1) < 0.01 &&
    Math.abs(Number(after2[1].logged_hours) - 3) < 0.01,
  `period1=${Number(after2[0].logged_hours).toFixed(2)}h period2=${Number(after2[1].logged_hours).toFixed(2)}h`,
);

/* --------------------------------------------------- the timezone boundary */

// 23:30 Berlin on the last day of period 2's predecessor window must count
// against that period, not the next. In UTC that instant is 21:30 the same day,
// but a naive UTC date would still be right here; the trap is the other way --
// 00:30 Berlin on 1 July is 22:30 UTC on 30 June, and must land in period 2.
await db.exec(`
  insert into time.entry (member_id, project_id, started_at, ended_at, duration_seconds)
  values (1, 1, '2026-07-01 00:30+02', '2026-07-01 01:30+02', 3600);
`);
const tz = await all(`select * from time.contract_period_status where project_id = 1 order by period_no`);
check(
  "an entry at 00:30 Berlin on the first contract day counts in the NEW period",
  Math.abs(Number(tz[1].logged_hours) - 4) < 0.01 && Math.abs(Number(tz[0].logged_hours) - 21.1) < 0.01,
  `period1=${Number(tz[0].logged_hours).toFixed(2)}h period2=${Number(tz[1].logged_hours).toFixed(2)}h (UTC would put it in period 1)`,
);

/* ------------------------------------------------------- active period fn */

const activeNow = await one(`select * from time.active_contract_period(1, '2026-08-22'::date)`);
check(
  "active_contract_period picks the period covering a date",
  Number(activeNow.period_no) === 2,
  `period_no=${activeNow.period_no}`,
);
const activeOld = await one(`select * from time.active_contract_period(1, '2025-09-15'::date)`);
check(
  "and picks the historical period for a historical date",
  Number(activeOld.period_no) === 1,
  `period_no=${activeOld.period_no}`,
);
const activeNone = await one(`select * from time.active_contract_period(1, '2020-01-01'::date)`);
check(
  "a date outside every contract returns no period rather than guessing",
  !activeNone || activeNone.id === null,
  JSON.stringify(activeNone),
);

/* ------------------------------------------------------------- constraints */

const badBudget = async (sql) => {
  try { await db.exec(sql); return false; } catch { return true; }
};
check(
  "a zero or negative budget is rejected",
  await badBudget(`insert into time.project_contract_period (project_id, period_no, budget_hours, starts_on, ends_on) values (1, 50, 0, '2030-01-01', '2030-12-31')`),
);
check(
  "an end date before the start date is rejected",
  await badBudget(`insert into time.project_contract_period (project_id, period_no, budget_hours, starts_on, ends_on) values (1, 51, 5, '2030-12-31', '2030-01-01')`),
);
check(
  "a warn threshold outside 1..100 is rejected",
  await badBudget(`insert into time.project_contract_period (project_id, period_no, budget_hours, starts_on, ends_on, warn_at_percent) values (1, 52, 5, '2031-01-01', '2031-12-31', 150)`),
);
check(
  "a duplicate period number for the same project is rejected",
  await badBudget(`insert into time.project_contract_period (project_id, period_no, budget_hours, starts_on, ends_on) values (1, 1, 5, '2032-01-01', '2032-12-31')`),
);

/* ------------------------------------------- the sync must remain unaffected */

const proj = await one(`select estimated_hours from time.project where id = 1`);
check(
  "time.project.estimated_hours is untouched (the sync still owns it)",
  Number(proj.estimated_hours) === 5,
  `estimated_hours=${proj.estimated_hours} — contract terms live in their own table, so a sync cannot overwrite them`,
);

/* ------------------------------------------------------------- permissions */

const perms = await all(`
  select permission_key as key, resource, action from public.app_permission
  where permission_key like 'projects:contracts:%' order by permission_key
`);
check("both contract permission keys exist", perms.length === 2, JSON.stringify(perms));
check(
  "resource and action are populated (the bug that broke the HR migration)",
  perms.every((p) => p.resource && p.action),
  perms.map((p) => `${p.key} -> ${p.resource}/${p.action}`).join(", "),
);
check(
  "they group under the 'projects' resource so /admin/roles shows them",
  perms.every((p) => p.resource === "projects"),
);

const writers = await all(`
  select role_key from public.app_role_permission
  where permission_key = 'projects:contracts:write' order by role_key
`);
check(
  "only exec and dept_head may write contract terms",
  writers.length === 2 && writers.map((r) => r.role_key).sort().join(",") === "dept_head,exec",
  writers.map((r) => r.role_key).join(", "),
);
const readers = await all(`
  select role_key from public.app_role_permission
  where permission_key = 'projects:contracts:read' order by role_key
`);
check(
  "an employee can READ the terms without being able to change them",
  readers.some((r) => r.role_key === "employee") && !writers.some((r) => r.role_key === "employee"),
  `readers: ${readers.map((r) => r.role_key).join(", ")}`,
);

const policies = await all(`
  select policyname, cmd from pg_policies
  where schemaname = 'time' and tablename = 'project_contract_period'
  order by policyname
`);
check(
  "RLS covers select, insert, update and delete",
  ["SELECT", "INSERT", "UPDATE", "DELETE"].every((c) => policies.some((p) => p.cmd === c)),
  policies.map((p) => `${p.policyname} (${p.cmd})`).join(" | "),
);
const del = policies.find((p) => p.cmd === "DELETE");
check(
  "DELETE stays exec-only (deleting a period destroys the history)",
  del && /exec/.test(JSON.stringify(await all(`select qual from pg_policies where policyname = $1`, [del.policyname]))),
  del ? del.policyname : "no delete policy",
);

const rls = await one(`
  select relrowsecurity from pg_class
  where oid = 'time.project_contract_period'::regclass
`);
check("row level security is enabled", rls.relrowsecurity === true);

/* ------------------------------------------------------ the renewal function */

const fn = await one(`
  select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'time' and p.proname = 'renew_contract_period'
`);
check("the renewal function exists", fn.n === 1);

await db.close();
console.log(
  failed === 0
    ? "\nCONTRACT PERIODS: the migration executes, preserves history on renewal, and refuses overlaps"
    : `\n${failed} check(s) failed`,
);
process.exit(failed === 0 ? 0 : 1);
