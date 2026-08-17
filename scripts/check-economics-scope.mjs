/**
 * Does the money panel answer the question the filter bar asked?
 *
 * TWO BUGS THIS EXISTS TO PREVENT COMING BACK
 * -------------------------------------------
 * 1. THE PANEL IGNORED THE DATE RANGE ENTIRELY. Until 3e4d840 the page called
 *    `getProjectEconomics(supabase, { canSeeMoney, limit: 15 })` — no p_from, no
 *    p_to. The RPC defaults both to null and its predicates are written
 *    `(p_from is null or ...)`, so null means NO CONSTRAINT. Every date range
 *    rendered the same all-time revenue. A June report showed June's hours
 *    beside all-time money and a margin belonging to neither period.
 *
 *    Nothing caught it: the RPC took the arguments all along, so the signature
 *    was right, the types were right, the build was green, and the panel was
 *    full of plausible numbers. It was reported by a human who noticed the
 *    figures never moved.
 *
 * 2. UNATTRIBUTED TIME WAS DROPPED WITHOUT SAYING SO. The function inner-joined
 *    time.project, and 1,691 of 4,194 live entries (40%) carry no project_id.
 *    Their cost is real — a member rate times hours worked is money the business
 *    spent whether or not anyone filed it against a project — but it vanished
 *    from the only panel that reports cost. Economics and the totals strip then
 *    disagreed on the same period (866.9h vs 649h for July) with nothing on
 *    screen to explain the difference.
 *
 * HOW THIS IS TESTED: the SQL half runs supabase/schema.sql in PGlite (real
 * Postgres compiled to WASM, not a simulation), seeds entries either side of a
 * date boundary plus one with no project, and calls time.project_economics()
 * for real. The wiring half asserts the page still passes the dates, with a
 * negative control proving the check detects the exact shape of the old bug.
 *
 * Run: node scripts/check-economics-scope.mjs
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

let failed = false;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed = true;
};

const db = await new PGlite();

await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key, email text);
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then
      create role anon nologin;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then
      create role authenticated nologin;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then
      create role service_role nologin bypassrls;
    end if;
  end $$;
  create or replace function auth.uid() returns uuid
    language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
`);

await db.exec(readFileSync("supabase/schema.sql", "utf8"));

// The function is gated on app_user_has_permission('overview:export'), which
// reads the caller's JWT. There is no request context here, so stand in a true
// version: this gate is about WHICH ROWS the maths covers, and the permission
// gate is proven separately by check-oauth-access-model.mjs.
await db.exec(`
  create or replace function public.app_user_has_permission(p_key text)
  returns boolean language sql stable as $$ select true $$;
`);

// ── Fixture: one member on a known rate, three entries ──────────────────────
// JUNE and JULY on the same project, plus a JULY entry with NO project.
await db.exec(`
  insert into time.customer (id, source_id, name)
    overriding system value values (1, 'c1', 'Acme');
  insert into time.project (id, source_id, name, customer_id)
    overriding system value values (1, 'p1', 'Bridge survey', 1);
  insert into time.member (id, source_id, display_name)
    overriding system value values (1, 'm1', 'Test Person');

  -- 100/h billed, 60/h cost, open-ended so both months match.
  insert into time.member_rate (member_id, hourly_rate, hourly_cost, valid_from, valid_to)
    values (1, 100, 60, '2020-01-01', null);

  -- ended_at is required: a null end means "running", and the schema allows
  -- only one running entry per member.
  insert into time.entry
    (source_id, member_id, project_id, started_at, ended_at,
     duration_seconds, is_billable, is_calendar)
  values
    ('e-jun', 1, 1,    '2026-06-15T09:00:00Z', '2026-06-15T10:00:00Z', 3600, true, false),
    ('e-jul', 1, 1,    '2026-07-15T09:00:00Z', '2026-07-15T11:00:00Z', 7200, true, false),
    ('e-nop', 1, null, '2026-07-16T09:00:00Z', '2026-07-16T10:00:00Z', 3600, true, false);
`);

const econ = async (from, to) => {
  const { rows } = await db.query(
    `select * from time.project_economics($1::date, $2::date)`,
    [from, to],
  );
  return rows;
};

const hours = (rows) =>
  Math.round((rows.reduce((a, r) => a + Number(r.total_seconds), 0) / 3600) * 10) / 10;
const revenue = (rows) => rows.reduce((a, r) => a + Number(r.revenue), 0);

console.log("\nThe date range actually narrows the result:\n");

const july = await econ("2026-07-01", "2026-07-31");
const june = await econ("2026-06-01", "2026-06-30");
const all = await econ(null, null);

check("July and June do NOT return the same hours", hours(july) !== hours(june), `${hours(july)}h vs ${hours(june)}h`);
check("June sees only June's hour", hours(june) === 1, `${hours(june)}h`);
check(
  "a narrowed range returns LESS than all-time",
  hours(july) < hours(all),
  `${hours(july)}h of ${hours(all)}h`,
);
check("June revenue is one hour at 100", revenue(june) === 100, String(revenue(june)));

console.log("\nA single day is not a whole month — the boundary is real:\n");
const oneDay = await econ("2026-07-15", "2026-07-15");
check("15 July alone excludes the 16th", hours(oneDay) === 2, `${hours(oneDay)}h`);
check(
  "the last day of a range is INCLUDED (a `< to` bound would drop it)",
  hours(await econ("2026-07-01", "2026-07-16")) === 3,
  `${hours(await econ("2026-07-01", "2026-07-16"))}h`,
);

console.log("\nTime with no project is money the business still spent:\n");
const julyRows = await econ("2026-07-01", "2026-07-31");
check(
  "July's 3 hours are ALL accounted for, including the unattributed one",
  hours(julyRows) === 3,
  `${hours(julyRows)}h of 3h logged`,
);
const unattributed = julyRows.find((r) => r.project_id === null);
check("the unattributed hour appears as its own row", Boolean(unattributed));
check(
  "it is labelled, not blank",
  Boolean(unattributed?.project_name),
  unattributed?.project_name ?? "(missing)",
);
check(
  "its cost is counted — 1h at 60",
  Number(unattributed?.cost ?? 0) === 60,
  String(unattributed?.cost),
);

console.log("\nNegative control — the harness can observe a wrong answer:\n");
check(
  "an impossible range returns nothing",
  (await econ("2030-01-01", "2030-01-02")).length === 0,
);

console.log("\nThe wiring: the page still passes the dates it filtered by\n");

const pageSrc = readFileSync("src/app/(app)/time/dashboard/page.tsx", "utf8");
// Anchored on the CALL, not on a neighbouring name: `getSyncFreshness` also
// appears in the import block above it, and slicing between them ran backwards
// and silently produced an empty string that passed nothing.
const callAt = pageSrc.indexOf("getProjectEconomics(supabase");
const call = callAt === -1 ? "" : pageSrc.slice(callAt, callAt + 300);

check("the page calls getProjectEconomics", call.length > 0);
check("it forwards the filtered `from`", /from:\s*filters\.from/.test(call), call.includes("from:") ? "" : "no from:");
check("it forwards the filtered `to`", /to:\s*filters\.to/.test(call), call.includes("to:") ? "" : "no to:");

// The exact shape of the bug: canSeeMoney and a limit, and no dates at all.
const OLD = `getProjectEconomics(supabase, { canSeeMoney: canSeeMoney === true, limit: 15 }),`;
check(
  "negative control: the old un-scoped call WOULD be caught",
  !/from:\s*filters\.from/.test(OLD) && !/to:\s*filters\.to/.test(OLD),
);

console.log(
  failed
    ? "\nECONOMICS SCOPE: the money panel is not answering the question the filters asked\n"
    : "\nECONOMICS SCOPE: money is scoped to the selected period, and unattributed time is counted\n",
);

process.exitCode = failed ? 1 : 0;
