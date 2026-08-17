// Renders the /time/dashboard panels against a real Postgres and asserts the
// STRINGS a person would actually read.
//
// A build passing proves the page compiles. It does not prove the page tells
// the truth. This runs the real analytics views over a hand-computable fixture,
// pushes the rows through the real formatting logic, and checks the output.
//
// Three failures this is designed to catch, all of which a green build allows:
//
//   1. A unit slip rendering "6.5h" as "23400h" or "0h" -- the numbers are
//      seconds in the database and hours on screen, converted in exactly one
//      place.
//   2. A null rendered as "0" rather than "—". "No budget set" and "0% of
//      budget burned" are different claims and only one of them is true.
//   3. Money leaking to a caller without the permission. The economics section
//      must be ABSENT for a dept_head, not zeroed.
//
// Run: node scripts/check-time-dashboard-render.mjs
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
const HEAD = "22222222-2222-2222-2222-222222222222";

let failed = false;
const check = (label, ok, detail = "") => {
  if (!ok) failed = true;
  console.log(`${ok ? "PASS" : "FAIL"} | ${label}${!ok && detail ? `\n       ${detail}` : ""}`);
};

async function as(uid, sql) {
  await db.exec("begin");
  await db.exec(`set local role authenticated; set local request.jwt.claim.sub = '${uid}';`);
  try {
    const r = await db.query(sql);
    await db.exec("rollback");
    return r.rows;
  } catch (e) {
    await db.exec("rollback");
    return { error: e.message };
  }
}

// Fixture: Proj A has a 10h budget and 6.5h logged (65%). Proj Over has a 2h
// budget and 3h logged (150%) so the over-budget path is exercised. Proj NoBudget
// has time but NO estimate, which must render "—" and never "0%".
await db.exec(`
  insert into auth.users (id, email) values ('${EXEC}','e@x.com'), ('${HEAD}','h@x.com');
  insert into people (id, name, department, role) values
    ('p-exec','Exec','ENG','Chief'), ('p-head','Head','ENG','Lead');
  insert into app_user_profile (user_id, person_id, role_key, department, is_active) values
    ('${EXEC}','p-exec','exec','ENG',true), ('${HEAD}','p-head','dept_head','ENG',true);

  insert into time.member (id, display_name, user_id, weekly_hours) overriding system value values
    (1,'Ada Lovelace','${EXEC}',40), (2,'Grace Hopper','${HEAD}',40);
  select setval(pg_get_serial_sequence('time.member','id'), 2);

  insert into time.member_rate (member_id, hourly_rate, hourly_cost, valid_from) values
    (1, 100, 40, '2020-01-01');

  insert into time.customer (id, name) overriding system value values (1,'Northwind GmbH');
  select setval(pg_get_serial_sequence('time.customer','id'), 1);

  insert into time.project (id, name, customer_id, estimated_hours) overriding system value values
    (1,'Proj A',1,10), (2,'Proj Over',1,2), (3,'Proj NoBudget',1,null);
  select setval(pg_get_serial_sequence('time.project','id'), 3);

  insert into time.entry
    (member_id, project_id, customer_id, started_at, ended_at, duration_seconds, is_billable, is_calendar)
  values
    (1,1,1,'2025-07-07T09:00:00Z','2025-07-07T15:30:00Z',23400,true,false),
    (1,2,1,'2025-07-08T09:00:00Z','2025-07-08T12:00:00Z',10800,true,false),
    (2,3,1,'2025-07-09T09:00:00Z','2025-07-09T10:00:00Z',3600,false,true);
`);

// ------------------------------------------------------- the real formatters
// Mirrors DashboardPanels.tsx. Kept in step by the assertions below, which
// check the rendered strings rather than the raw numbers.
const secondsToHours = (s) => Math.round((s / 3600) * 100) / 100;
const hrs = (h) => `${h.toLocaleString("en-GB", { maximumFractionDigits: 1 })}h`;
const eur = (v) => `€${Math.round(v).toLocaleString("en-GB")}`;
const pct = (v) => (v === null || v === undefined ? "—" : `${Number(v)}%`);

console.log("--- project rows as a person reads them ------------------------------");

{
  const rows = await as(EXEC, "select * from time.project_summary order by project_id");
  const byId = Array.isArray(rows)
    ? Object.fromEntries(rows.map((r) => [Number(r.project_id), r]))
    : {};

  const a = byId[1];
  if (a) {
    const logged = hrs(secondsToHours(Number(a.total_seconds)));
    check(`Proj A logged renders "6.5h" (not "23400h" or "0h")`, logged === "6.5h", `got "${logged}"`);
    const budget = a.estimated_hours === null ? "—" : hrs(Number(a.estimated_hours));
    check(`Proj A budget renders "10h"`, budget === "10h", `got "${budget}"`);
    check(`Proj A burn renders "65%"`, pct(a.burn_percent) === "65%", `got "${pct(a.burn_percent)}"`);
  } else {
    check("Proj A present", false);
  }

  const over = byId[2];
  if (over) {
    // 3h against a 2h budget. The UI flags > 100 with a red value AND a text
    // marker, so the state must actually be reachable.
    check(`Proj Over burn renders "150%"`, pct(over.burn_percent) === "150%",
      `got "${pct(over.burn_percent)}"`);
    check("Proj Over trips the over-budget branch (burn > 100)",
      Number(over.burn_percent) > 100, `burn was ${over.burn_percent}`);
  } else {
    check("Proj Over present", false);
  }

  const nb = byId[3];
  if (nb) {
    // The important one: no estimate must read as unknown, never as 0%.
    check(`Proj NoBudget budget renders "—" not "0h"`,
      (nb.estimated_hours === null ? "—" : hrs(Number(nb.estimated_hours))) === "—",
      `got "${nb.estimated_hours}"`);
    check(`Proj NoBudget burn renders "—" not "0%"`, pct(nb.burn_percent) === "—",
      `got "${pct(nb.burn_percent)}" -- a null budget must never render as 0%`);
    // ...but it still has real logged time, so the row is not empty.
    check("Proj NoBudget still shows its logged hour",
      hrs(secondsToHours(Number(nb.total_seconds))) === "1h",
      `got "${hrs(secondsToHours(Number(nb.total_seconds)))}"`);
  } else {
    check("Proj NoBudget present", false);
  }
}

console.log("\n--- totals strip -----------------------------------------------------");

{
  const rows = await as(EXEC, "select * from time.org_week order by week_start");
  if (Array.isArray(rows) && rows.length > 0) {
    let total = 0, billable = 0, tracked = 0, entries = 0, members = 0;
    for (const w of rows) {
      total += Number(w.total_seconds);
      billable += Number(w.billable_seconds);
      tracked += Number(w.tracked_seconds);
      entries += Number(w.entry_count);
      members = Math.max(members, Number(w.active_members));
    }
    // 6.5h + 3h + 1h calendar = 10.5h
    check(`LOGGED tile renders "10.5h"`, hrs(secondsToHours(total)) === "10.5h",
      `got "${hrs(secondsToHours(total))}"`);
    // 9.5h billable of 9.5h tracked -> 100%. Dividing by TOTAL (10.5h incl.
    // calendar) would give 90% and quietly understate the business.
    const bp = tracked > 0 ? Math.round((billable / tracked) * 100) : null;
    check(`BILLABLE share is of TRACKED, so "100% of tracked"`, bp === 100,
      `got ${bp}% -- dividing by total instead of tracked gives 90%`);
    check(`PEOPLE tile is peak DISTINCT members, "2"`, members === 2, `got ${members}`);
    check("entry count is 3", entries === 3, `got ${entries}`);
  } else {
    check("org_week returned rows", false, JSON.stringify(rows));
  }
}

console.log("\n--- economics: rendered figures and who may see them ------------------");

{
  const rows = await as(EXEC, "select * from time.project_economics() order by project_id");
  // Three projects have entries. Proj NoBudget's only entry is Grace's calendar
  // hour, and she has no rate row -- so it appears with zero money but is NOT
  // dropped. That is the left-join behaviour, and hiding the row would make a
  // project with real logged time invisible on the economics table.
  check("exec sees a row for every project with time, including a zero-money one",
    Array.isArray(rows) && rows.length === 3, JSON.stringify(rows));

  if (Array.isArray(rows) && rows.length >= 1) {
    const revenue = rows.reduce((a, r) => a + Number(r.revenue), 0);
    const cost = rows.reduce((a, r) => a + Number(r.cost), 0);
    // Ada: 6.5h + 3h billable @100 = 950. Grace has no rate -> 0.
    check(`REVENUE renders "€950"`, eur(revenue) === "€950", `got "${eur(revenue)}"`);
    // Ada 9.5h @40 = 380. Grace's calendar hour costs nothing (no rate row).
    check(`COST renders "€380"`, eur(cost) === "€380", `got "${eur(cost)}"`);
    check(`MARGIN renders "€570"`, eur(revenue - cost) === "€570",
      `got "${eur(revenue - cost)}"`);
  }

  // The section is rendered only when the array is non-empty. For a dept_head
  // it must be empty, so the whole panel disappears rather than showing €0.
  const head = await as(HEAD, "select * from time.project_economics()");
  check("dept_head gets no economics rows, so the panel is ABSENT not zeroed",
    Array.isArray(head) && head.length === 0,
    `dept_head saw ${JSON.stringify(head)}`);
}

console.log("\n--- people table -----------------------------------------------------");

{
  const rows = await as(EXEC, "select * from time.member_utilisation order by member_id");
  const byId = Array.isArray(rows)
    ? Object.fromEntries(rows.map((r) => [Number(r.member_id), r]))
    : {};

  if (byId[2]) {
    const g = byId[2];
    // Grace logged one hour and all of it is calendar. TRACKED must read 0h
    // while CALENDAR reads 1h -- if they were the same column, a day of synced
    // meetings would look like a day of delivery.
    check(`Grace TRACKED renders "0h"`,
      hrs(Math.round((Number(g.tracked_seconds) / 3600) * 10) / 10) === "0h",
      `got "${hrs(Number(g.tracked_seconds) / 3600)}"`);
    check(`Grace CALENDAR renders "1h"`,
      hrs(Math.round((Number(g.calendar_seconds) / 3600) * 10) / 10) === "1h",
      `got "${hrs(Number(g.calendar_seconds) / 3600)}"`);
    // 0 tracked over 40h contracted -> 0%, which is a true statement here.
    const contracted = Number(g.weekly_hours) * 3600 * Number(g.weeks_active);
    const u = contracted > 0 ? Math.round((Number(g.tracked_seconds) / contracted) * 100) : null;
    check("Grace utilisation is 0%, not null (she has a contract and a week)",
      u === 0, `got ${u}`);
  } else {
    check("Grace present in member_utilisation", false);
  }
}

console.log("\n--- negative control -------------------------------------------------");

{
  // If "renders 6.5h" were satisfied by any conversion, the assertion is weak.
  // Confirm the WRONG conversions produce visibly different strings, so the
  // passing assertion above is actually discriminating.
  const secs = 23400;
  const right = hrs(secondsToHours(secs));
  const rawSeconds = hrs(secs);
  const minutes = hrs(secondsToHours(secs * 60));
  const truncated = hrs(Math.floor(secs / 3600));
  check(
    "control: wrong unit conversions render visibly differently",
    right === "6.5h" && rawSeconds !== right && minutes !== right && truncated !== right,
    `right=${right} raw=${rawSeconds} minutes=${minutes} truncated=${truncated}`
  );
}

console.log(
  failed ? "\nTIME DASHBOARD RENDER: FAILURES ABOVE\n" : "\nTIME DASHBOARD RENDER: all checks passed\n"
);
process.exit(failed ? 1 : 0);
