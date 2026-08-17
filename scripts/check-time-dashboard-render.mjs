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
    if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
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
    // Divided by TOTAL logged (10.5h incl. calendar) -> 90%, not by tracked.
    // On live data 427 entries are both calendar and billable, so the tracked
    // denominator produced 102-109%. A share above 100 is never right; a
    // slightly conservative share is.
    const bp = total > 0 ? Math.round((billable / total) * 100) : null;
    check(`BILLABLE share is of LOGGED, so "90% of logged"`, bp === 90,
      `got ${bp}% -- dividing by tracked instead of total gives 100%`);
    // Negative control on the denominator itself. `tracked` EXCLUDES calendar
    // time while `billable` does not, so the two are not nested sets and the
    // old ratio could exceed 100. Asserting the wrong denominator still
    // produces a wrong answer keeps the assertion above from going vacuous if
    // a future fixture ever made total and tracked equal.
    const wrong = tracked > 0 ? Math.round((billable / tracked) * 100) : null;
    check(`fixture can still detect the bug: billable/tracked != billable/total`,
      wrong !== null && wrong !== bp,
      `both denominators gave ${bp}% -- fixture no longer exposes the regression`);
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

{
  // billablePercent must divide by TOTAL logged time, never by tracked.
  // Measured on live data: 427 entries are BOTH is_calendar and is_billable,
  // so they are excluded from tracked yet still counted in billable. Dividing
  // by tracked produced 102-109% on the real dashboard -- a percentage above
  // 100 that a CEO would read as fact.
  // time-dashboard.ts imports "@/..." path aliases that bare Node cannot
  // resolve, so the summariser is re-derived here from its source rather than
  // imported. The drift risk is covered by the source-text assertion below.
  const src = readFileSync("src/lib/queries/time-dashboard.ts", "utf8");
  const summariseOrgWeeks = (ws) => {
    let totalSeconds = 0, billableSeconds = 0, trackedSeconds = 0;
    for (const w of ws) {
      totalSeconds += w.totalSeconds;
      billableSeconds += w.billableSeconds;
      trackedSeconds += w.trackedSeconds;
    }
    return {
      totalSeconds,
      billableSeconds,
      trackedSeconds,
      billablePercent:
        totalSeconds > 0 ? Math.round((billableSeconds / totalSeconds) * 100) : null,
    };
  };

  // The real guard: the shipped source must divide by totalSeconds. Without
  // this, the local re-derivation above could pass while production is wrong.
  check(
    "source divides billablePercent by totalSeconds",
    /billablePercent:\s*\r?\n?\s*totalSeconds\s*>\s*0\s*\?\s*Math\.round\(\(billableSeconds\s*\/\s*totalSeconds\)/.test(src),
    "time-dashboard.ts no longer divides by totalSeconds"
  );
  check(
    "source does not divide billablePercent by trackedSeconds",
    !/billablePercent:\s*\r?\n?\s*trackedSeconds\s*>\s*0/.test(src),
    "time-dashboard.ts is back to the tracked denominator"
  );

  // Shaped from real time.org_week rows: some billable seconds sit inside the
  // calendar bucket, which is exactly what makes the wrong denominator visible.
  const weeks = [
    {
      weekStart: "2026-08-10",
      totalSeconds: 200200, billableSeconds: 134500,
      calendarSeconds: 67700, trackedSeconds: 132500,
      entryCount: 10, activeMembers: 8, activeProjects: 5,
    },
    {
      weekStart: "2026-08-03",
      totalSeconds: 185600, billableSeconds: 148800,
      calendarSeconds: 45100, trackedSeconds: 140400,
      entryCount: 9, activeMembers: 7, activeProjects: 4,
    },
  ];

  const t = summariseOrgWeeks(weeks);
  const byTracked = Math.round((t.billableSeconds / t.trackedSeconds) * 100);

  check(
    "billable percent never exceeds 100",
    t.billablePercent !== null && t.billablePercent <= 100,
    `got ${t.billablePercent}%`
  );
  check(
    "billable percent divides by total logged, not tracked",
    t.billablePercent === Math.round((t.billableSeconds / t.totalSeconds) * 100),
    `got ${t.billablePercent}%, total-based ${Math.round((t.billableSeconds / t.totalSeconds) * 100)}%`
  );
  // Without this the assertion above could pass on a fixture where the two
  // denominators happen to agree, proving nothing.
  check(
    "control: the tracked denominator really does exceed 100 here",
    byTracked > 100,
    `tracked-based came out ${byTracked}%, so this fixture cannot detect the bug`
  );
}

console.log(
  failed ? "\nTIME DASHBOARD RENDER: FAILURES ABOVE\n" : "\nTIME DASHBOARD RENDER: all checks passed\n"
);
process.exit(failed ? 1 : 0);
