/**
 * Does the org chart view expose the right columns, and nothing sensitive?
 *
 * Two things worth proving before this runs on live, both against a real Postgres
 * engine rather than by reading the SQL:
 *
 *   1. it executes, and its columns match what the query selects -- a mismatch
 *      would break /people on first load, and the query is what ships;
 *   2. it does NOT project user_id, hours, rates or cost. This view is deliberately
 *      company-wide (that is the whole point: an org chart only an exec can see is
 *      not an org chart), so what it omits IS the security boundary.
 *
 * Run: npm run check:org-chart-view
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const db = await new PGlite();

let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? `\n        ${detail}` : ""}`);
};

// Enough of the real table for the view to build on, including the sensitive
// columns it must NOT surface.
await db.exec(`
  create schema if not exists time;
  create table time.member (
    id bigint generated always as identity primary key,
    source_id text unique not null,
    email text,
    display_name text,
    hub_person_id text,
    user_id uuid,
    role text,
    status text,
    is_archived boolean default false,
    weekly_hours numeric,
    created_at timestamptz default now(),
    supervisor_member_id bigint references time.member(id) on delete set null,
    supervisor_source text,
    team text,
    job_title text
  );
`);

const migration = readFileSync("supabase/migrations/add_org_chart_view.sql", "utf8");
// GRANT to a role PGlite does not provision; strip only that line.
const executable = migration
  .split("\n")
  .filter((l) => !/^\s*grant\s/i.test(l))
  .join("\n");

try {
  await db.exec(executable);
  console.log("view created with no errors\n");
} catch (e) {
  console.log(`FATAL: ${e.message}`);
  process.exit(1);
}

try {
  await db.exec(executable);
  check("the migration is safe to run twice", true, "create or replace");
} catch (e) {
  check("the migration is safe to run twice", false, e.message.slice(0, 120));
}

const cols = await db.query(`
  select column_name from information_schema.columns
  where table_schema = 'time' and table_name = 'org_chart'
  order by column_name
`);
const names = cols.rows.map((r) => r.column_name);
console.log(`columns: ${names.join(", ")}\n`);

// Exactly what src/lib/queries/org-chart-live.ts selects.
const REQUIRED = [
  "member_id", "display_name", "email", "account_role", "job_title", "team",
  "supervisor_member_id", "supervisor_source", "is_archived", "has_account",
];
const missing = REQUIRED.filter((c) => !names.includes(c));
check(
  "every column the query selects exists",
  missing.length === 0,
  missing.length ? `missing: ${missing.join(", ")}` : REQUIRED.join(", "),
);

// The boundary: what must never appear here.
const FORBIDDEN = ["user_id", "weekly_hours", "hourly_rate", "hourly_cost", "hub_person_id"];
const leaked = FORBIDDEN.filter((c) => names.includes(c));
check(
  "no sensitive column is exposed by a company-wide view",
  leaked.length === 0,
  leaked.length
    ? `LEAKED: ${leaked.join(", ")} -- this view is readable by every signed-in user`
    : `absent as intended: ${FORBIDDEN.join(", ")}`,
);

// has_account must be a boolean derived from user_id, not the uuid itself.
await db.exec(`
  insert into time.member (source_id, display_name, email, role, user_id)
  values ('1', 'Alice', 'alice@example.com', 'ADMIN', '11111111-1111-1111-1111-111111111111'),
         ('2', 'Bob', 'bob@example.com', 'CO_WORKER', null);
`);
const rows = await db.query("select display_name, has_account from time.org_chart order by display_name");
check(
  "has_account is true for a linked member",
  rows.rows.find((r) => r.display_name === "Alice")?.has_account === true,
  JSON.stringify(rows.rows),
);
check(
  "has_account is false for an unlinked member",
  rows.rows.find((r) => r.display_name === "Bob")?.has_account === false,
  "",
);
check(
  "has_account is a boolean, not the uuid",
  typeof rows.rows[0].has_account === "boolean",
  `type is ${typeof rows.rows[0].has_account}`,
);

// It must show EVERY member, which is the reason the view exists.
const count = await db.query("select count(*)::int as n from time.org_chart");
check(
  "the view returns every member, not a scoped subset",
  count.rows[0].n === 2,
  `${count.rows[0].n} of 2 rows -- a scoped view would defeat the purpose`,
);

console.log(failed ? "\nORG CHART VIEW: not safe to apply yet\n" : "\nORG CHART VIEW: exposes structure company-wide, and nothing sensitive\n");
process.exit(failed ? 1 : 0);
