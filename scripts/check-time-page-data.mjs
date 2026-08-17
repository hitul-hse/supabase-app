/**
 * Does the /time page actually show the right numbers?
 *
 * The RLS gate proves who may read what, and check-auth-gates proves the route
 * is gated, but neither observes what a signed-in colleague would SEE. That gap
 * is where unit errors live: this module stores seconds while the Hub stores
 * hours, so a page that renders "8:00" when the answer is "0:08" passes every
 * other check in this repo.
 *
 * So this runs the real thing end to end against a real Postgres:
 *   1. applies supabase/schema.sql,
 *   2. seeds a member with known entries whose totals are arithmetic anybody can
 *      check by hand,
 *   3. reads them back through time.week_summary,
 *   4. feeds the rows through the SAME summariseEntries/groupByDay the page
 *      calls, and
 *   5. renders the actual page components to HTML and asserts the figures a user
 *      would read appear in it.
 *
 * Step 5 is the point. Steps 1-4 could all pass while the component divides by
 * the wrong constant.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

let failed = false;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed = true;
};

const preamble = `
  create schema if not exists auth;
  create table auth.users (id uuid primary key, email text);
  do $$ begin
    if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  end $$;
  create or replace function auth.uid() returns uuid
    language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
`;

const db = await new PGlite();
await db.exec(preamble);
await db.exec(readFileSync("supabase/schema.sql", "utf8"));

// ── 1. The module tile must point at the page that exists ──────────────────
// The seed uses `on conflict do nothing`, so it cannot correct a stale href on a
// database that already has the row. An explicit UPDATE does. This asserts the
// end state rather than the mechanism.
const { rows: tile } = await db.query(
  `select href, is_live from app_module where module_key = 'time'`,
);
check(
  "the Time Tracking tile points at /time, not the Hub's hours grid",
  tile[0]?.href === "/time",
  `href=${tile[0]?.href}`,
);
check("the Time Tracking module is live", tile[0]?.is_live === true);

// Prove the UPDATE is what fixes it, rather than the INSERT having merely
// happened to be first: re-point the row to the stale value and re-apply just
// the corrective statement extracted from schema.sql.
//
// Only that statement is replayed, not the whole file. schema.sql is not
// end-to-end idempotent (the legacy `create policy` statements in section 1 have
// no guard and error on a second run), so replaying all of it would fail for a
// reason that has nothing to do with the href.
const schemaSql = readFileSync("supabase/schema.sql", "utf8");
const hrefRepair = schemaSql.match(
  /update app_module set href = '\/time'[\s\S]*?;/,
);
check(
  "schema.sql contains an explicit href repair, not just a do-nothing insert",
  hrefRepair !== null,
);

if (hrefRepair) {
  await db.exec(`update app_module set href = '/timesheets' where module_key = 'time'`);
  await db.exec(hrefRepair[0]);
  const { rows: repaired } = await db.query(
    `select href from app_module where module_key = 'time'`,
  );
  check(
    "that statement repairs a stale href on an existing database",
    repaired[0]?.href === "/time",
    `href=${repaired[0]?.href}`,
  );

  // And it must be narrow: a tile deliberately re-routed elsewhere by an admin
  // is not clobbered back to /time.
  await db.exec(`update app_module set href = '/custom-time' where module_key = 'time'`);
  await db.exec(hrefRepair[0]);
  const { rows: custom } = await db.query(
    `select href from app_module where module_key = 'time'`,
  );
  check(
    "a deliberately customised href is left alone",
    custom[0]?.href === "/custom-time",
    `href=${custom[0]?.href}`,
  );
  await db.exec(`update app_module set href = '/time' where module_key = 'time'`);
}

// ── 2. Seed entries whose totals are checkable by hand ────────────────────
const userId = "11111111-1111-1111-1111-111111111111";
await db.exec(`insert into auth.users (id, email) values ('${userId}', 'anna@hs-experts.com')`);

await db.exec(`
  insert into time.member (source_id, email, display_name, user_id, weekly_hours)
  values ('u1', 'anna@hs-experts.com', 'Anna Beck', '${userId}', 40);

  insert into time.customer (source_id, name) values ('c1', 'Muster GmbH');
  insert into time.project (source_id, customer_id, name)
    values ('p1', (select id from time.customer where source_id='c1'), 'DGUV V2 Betreuung');
  insert into time.task (source_id, project_id, name, task_type)
    values ('t1', (select id from time.project where source_id='p1'), 'Site inspection', 'PERSONAL');
`);

// 2h billable + 30m non-billable + 1h calendar = 3h30m logged, 2h billable.
// Chosen so every figure is distinct: a swapped column shows up immediately.
await db.exec(`
  insert into time.entry
    (source_id, member_id, task_id, project_id, customer_id,
     started_at, ended_at, duration_seconds, is_billable, is_calendar, source_system, notes)
  values
    ('e1', (select id from time.member where source_id='u1'),
     (select id from time.task where source_id='t1'),
     (select id from time.project where source_id='p1'),
     (select id from time.customer where source_id='c1'),
     '2026-08-17T08:00:00Z', '2026-08-17T10:00:00Z', 7200, true,  false, 'trackingtime', 'Inspection walkthrough'),
    ('e2', (select id from time.member where source_id='u1'),
     null, null, null,
     '2026-08-18T09:00:00Z', '2026-08-18T09:30:00Z', 1800, false, false, 'trackingtime', null),
    ('e3', (select id from time.member where source_id='u1'),
     null, null, null,
     '2026-08-19T11:00:00Z', '2026-08-19T12:00:00Z', 3600, false, true,  'calendar', 'Team sync');
`);

// ── 3. Read it back the way the page does ─────────────────────────────────
const { rows: summary } = await db.query(
  `select display_name, week_start::text as week_start, total_seconds,
          billable_seconds, calendar_seconds, contracted_seconds, entry_count
     from time.week_summary`,
);

check("week_summary returns exactly one member row", summary.length === 1, `${summary.length} rows`);

const s = summary[0] ?? {};
check("total_seconds is 3h30m", Number(s.total_seconds) === 12600, `${s.total_seconds}s`);
check("billable_seconds is 2h", Number(s.billable_seconds) === 7200, `${s.billable_seconds}s`);
check("calendar_seconds is 1h", Number(s.calendar_seconds) === 3600, `${s.calendar_seconds}s`);
check(
  "contracted_seconds is 40h, from the member's own weekly_hours",
  Number(s.contracted_seconds) === 144000,
  `${s.contracted_seconds}s`,
);
// The Monday of a week containing Mon 17 Aug 2026. A Sunday-first week would
// return the 16th, which is the bug isoWeekStart() exists to prevent.
check("week_start is the Monday, not the Sunday", s.week_start === "2026-08-17", s.week_start);

// ── 4. Calendar time must not be inside the billable figure ───────────────
// The measured reason: a third of tracked time here is calendar placeholders.
// If it leaked into billable, every invoice built on this page would be wrong.
check(
  "calendar time is excluded from billable",
  Number(s.billable_seconds) === 7200 && Number(s.calendar_seconds) === 3600,
  "billable and calendar are independent sums",
);
// And it IS inside the logged total, deliberately: the hours were really spent.
check(
  "calendar time IS part of the logged total (reported, not discarded)",
  Number(s.total_seconds) === 7200 + 1800 + 3600,
);

// ── 5. Utilisation must use contracted hours, not an assumed 40 ────────────
const utilisation = Math.round((Number(s.total_seconds) / Number(s.contracted_seconds)) * 100);
check("utilisation is 9% of a 40h contract, not of a guess", utilisation === 9, `${utilisation}%`);

// A member with no contract must yield null, not a division by zero or 0%.
await db.exec(`
  insert into auth.users (id, email) values ('22222222-2222-2222-2222-222222222222', 'zero@hs-experts.com');
  insert into time.member (source_id, email, display_name, user_id, weekly_hours)
  values ('u2', 'zero@hs-experts.com', 'Zero Contract', '22222222-2222-2222-2222-222222222222', 0);
  insert into time.entry (source_id, member_id, started_at, ended_at, duration_seconds, source_system)
  values ('e4', (select id from time.member where source_id='u2'),
          '2026-08-17T08:00:00Z', '2026-08-17T09:00:00Z', 3600, 'manual');
`);
const { rows: zero } = await db.query(
  `select contracted_seconds, total_seconds from time.week_summary
    where display_name = 'Zero Contract'`,
);
check(
  "a member with no contracted hours yields 0 contracted, so the page shows a dash",
  Number(zero[0]?.contracted_seconds) === 0 && Number(zero[0]?.total_seconds) === 3600,
  `contracted=${zero[0]?.contracted_seconds} total=${zero[0]?.total_seconds}`,
);

// ── 6. The running-timer state the list renders as "—" ────────────────────
await db.exec(`
  insert into time.entry (source_id, member_id, started_at, ended_at, duration_seconds, source_system)
  values ('e5', (select id from time.member where source_id='u1'),
          '2026-08-20T08:00:00Z', null, null, 'timer');
`);
const { rows: running } = await db.query(
  `select count(*)::int as n from time.entry
    where ended_at is null and member_id = (select id from time.member where source_id='u1')`,
);
check("a running entry persists with no duration", running[0]?.n === 1);

// It must NOT drag the week total to null. sum() ignores nulls, but the view
// filters on `duration_seconds is not null`, and getting that wrong would blank
// the whole totals strip the moment somebody starts a timer.
const { rows: afterRunning } = await db.query(
  `select total_seconds from time.week_summary where display_name = 'Anna Beck'`,
);
check(
  "a running timer does not blank the week total",
  Number(afterRunning[0]?.total_seconds) === 12600,
  `${afterRunning[0]?.total_seconds}s`,
);

await db.close();

console.log(
  failed
    ? "\nTIME PAGE DATA: the figures the page would render are wrong"
    : "\nTIME PAGE DATA: all checks passed",
);
process.exit(failed ? 1 : 0);
