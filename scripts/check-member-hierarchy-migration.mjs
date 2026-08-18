/**
 * Does the hierarchy migration actually work, and do its constraints bite?
 *
 * Run against PGlite -- a real Postgres engine -- rather than the live database,
 * because the live one needs the SQL Editor and I would rather know the migration
 * is correct BEFORE someone pastes it there. A migration that half-applies on a
 * production database is a bad way to discover a typo.
 *
 * Asserts the constraints REJECT the mistakes they exist for, not merely that the
 * columns appear. A check constraint nobody has seen fire is a comment.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const db = await new PGlite();

let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? `\n        ${detail}` : ""}`);
};

// Minimal stand-in for the parts of the real schema this migration touches.
// Deliberately not the whole schema.sql: this tests the MIGRATION, and a failure
// here should point at the migration rather than at 2,500 unrelated lines.
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
    created_at timestamptz default now()
  );
`);

const migration = readFileSync("supabase/migrations/add_member_hierarchy_and_team.sql", "utf8");
try {
  await db.exec(migration);
  console.log("migration executed with no errors\n");
} catch (e) {
  console.log(`FATAL: migration failed -- ${e.message}`);
  process.exit(1);
}

// Re-running must be safe: this file will be pasted into the SQL Editor, possibly
// twice, and "add column if not exists" is only half the story -- the DO blocks
// guard the constraints.
try {
  await db.exec(migration);
  check("the migration is safe to run twice", true, "no error on a second execution");
} catch (e) {
  check("the migration is safe to run twice", false, e.message.slice(0, 140));
}

// Columns exist with the right types.
const cols = await db.query(`
  select column_name, data_type, is_nullable
  from information_schema.columns
  where table_schema = 'time' and table_name = 'member'
    and column_name in ('supervisor_member_id', 'supervisor_source', 'team', 'job_title')
  order by column_name
`);
check(
  "all four columns were added",
  cols.rows.length === 4,
  cols.rows.map((r) => `${r.column_name} ${r.data_type} nullable=${r.is_nullable}`).join(", "),
);
check(
  "every new column is nullable, so unknown stays visibly unknown",
  cols.rows.every((r) => r.is_nullable === "YES"),
  "a NOT NULL default would silently invent a team or a manager",
);

// Seed two members to exercise the constraints.
await db.exec(`
  insert into time.member (source_id, display_name, email, role)
  values ('1', 'Alice', 'alice@example.com', 'MANAGER'),
         ('2', 'Bob', 'bob@example.com', 'CO_WORKER');
`);
const ids = await db.query("select id, display_name from time.member order by id");
const alice = ids.rows[0].id;
const bob = ids.rows[1].id;

// A legitimate reporting line must be accepted.
try {
  await db.exec(`update time.member set supervisor_member_id = ${alice}, supervisor_source = 'manual' where id = ${bob};`);
  check("a real reporting line is accepted", true, "Bob -> Alice");
} catch (e) {
  check("a real reporting line is accepted", false, e.message.slice(0, 120));
}

// Self-reference must be rejected.
let rejected = false;
try {
  await db.exec(`update time.member set supervisor_member_id = ${alice}, supervisor_source = 'manual' where id = ${alice};`);
} catch { rejected = true; }
check("reporting to yourself is REJECTED", rejected, "member_supervisor_not_self");

// A link without provenance must be rejected.
rejected = false;
try {
  await db.exec(`update time.member set supervisor_member_id = ${alice}, supervisor_source = null where id = ${bob};`);
} catch { rejected = true; }
check("a reporting line with no source is REJECTED", rejected, "member_supervisor_has_source");

// Provenance without a link is NORMALISED, not rejected.
//
// The first version of the migration rejected it, with a both-or-neither CHECK.
// That looked tidier and made deleting a manager impossible: the FK's SET NULL
// left an orphaned 'manual' behind, Postgres re-checked the constraint on that
// update, and the DELETE aborted. So the trigger clears the source instead.
await db.exec(`update time.member set supervisor_member_id = null, supervisor_source = 'manual' where id = ${bob};`);
const normalised = await db.query(`select supervisor_source from time.member where id = ${bob}`);
check(
  "a source with no reporting line is cleared, not rejected",
  normalised.rows[0].supervisor_source === null,
  `supervisor_source=${JSON.stringify(normalised.rows[0].supervisor_source)} -- rejecting this made deleting a manager impossible`,
);

// An unknown provenance value must be rejected.
rejected = false;
try {
  await db.exec(`update time.member set supervisor_member_id = ${alice}, supervisor_source = 'guessed' where id = ${bob};`);
} catch { rejected = true; }
check("an unrecognised supervisor_source is REJECTED", rejected, "only 'manual' or 'trackingtime'");

// Deleting a manager must NOT delete their reports.
await db.exec(`update time.member set supervisor_member_id = ${alice}, supervisor_source = 'manual' where id = ${bob};`);
await db.exec(`delete from time.member where id = ${alice};`);
const survivors = await db.query("select id, display_name, supervisor_member_id, supervisor_source from time.member");
check(
  "deleting a manager leaves their report in place",
  survivors.rows.length === 1 && survivors.rows[0].display_name === "Bob",
  `${survivors.rows.length} row(s) remain: ${survivors.rows.map((r) => r.display_name).join(", ")}`,
);
check(
  "the orphaned link is cleared, not left dangling",
  survivors.rows[0].supervisor_member_id === null,
  `supervisor_member_id=${survivors.rows[0].supervisor_member_id}`,
);
// ON DELETE SET NULL clears the id but not the source, which would violate the
// pairing constraint. Postgres does not re-check CHECK constraints on the
// referential action, so this is worth knowing about explicitly rather than
// discovering later.
console.log(
  survivors.rows[0].supervisor_source === null
    ? "        (and the trigger cleared the orphaned source with it)"
    : `        FAIL: supervisor_source is still '${survivors.rows[0].supervisor_source}' after the FK nulled the id.`,
);
if (survivors.rows[0].supervisor_source !== null) failed += 1;

console.log(failed ? "\nMIGRATION: not sound yet\n" : "\nMIGRATION: executes, re-runs safely, and its constraints reject real mistakes\n");
process.exit(failed ? 1 : 0);
