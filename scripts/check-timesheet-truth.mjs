/**
 * The Hub's timesheet grid must show measured time or nothing.
 *
 * WHAT THIS GUARDS, AND WHY THE TWO EXISTING GATES BOTH MISSED IT
 * ---------------------------------------------------------------
 * public.timesheet_entries held 28 rows and all 28 were fiction, in five
 * independent ways at once: one seeded person ('emp-1' / 'Anna Brandt',
 * is_active=false, source='seed') with no account linked to them, project_id NULL
 * on every row, free-text project_names matching no row in time.project OR
 * public.projects, a single week, and status already 'approved' so the approval
 * flow they appear to document had never run. Meanwhile time.entry held 5,322 real
 * entries and 8,458.7 h.
 *
 * check:no-mockup-people did not catch them, and could not have. It greps for the
 * eight seeded NAMES in rendering source, and forbids a LISTED set of files from
 * querying a LISTED set of tables (people, weekly_bookings, org_chart_nodes).
 * 'timesheet_entries' is not in that table list and /timesheets is not in that
 * file list — and crucially, no file in src/ ever spells "Anna Brandt": the name
 * arrives through a `people(name)` FK embed at request time. A name-grep cannot
 * see a name that only exists in the database.
 *
 * check:no-mock-data did not catch them either, and says so out loud: "the seeded
 * rows are NOT deleted -- other pages (timesheets, leave, team-lead) still
 * legitimately read `people` and `timesheet_entries` ... `people`/
 * `timesheet_entries` pages are deliberately out of scope: they are a separate
 * migration". This gate is the missing half of that sentence.
 *
 * WHY THIS GATE IS PART DATA AND PART SOURCE
 * ------------------------------------------
 * The other two are deliberately source-only, because their failure mode is a
 * fallback branch that only fires when the real source is empty — invisible to a
 * runtime test against a populated database.
 *
 * This failure mode is the opposite. The fiction was not in any branch; the code
 * was correct and the ROWS were wrong. No amount of reading src/ could have found
 * it, which is precisely how it survived 120+ gates. So section 2 queries the live
 * table and asserts a property of its CONTENTS: every row belongs to a real,
 * active, non-seed person who actually holds an account.
 *
 * That property, not a row count of zero. A count-zero assertion would fail the
 * moment a colleague legitimately logs their first week, training everyone to
 * ignore it. The rule is "no mockup rows", so that is what is asserted.
 *
 * Section 1 stays source-level so the structural half runs in CI with no
 * credentials, and fails on the commit rather than after a deploy.
 *
 * Run: npm run test:timesheet-truth   (DB half skipped without SUPABASE_DB_URL)
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

let failed = false;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? `\n        ${detail}` : ""}`);
  if (!ok) failed = true;
};

const read = (rel) => {
  const p = fileURLToPath(new URL(`../${rel}`, import.meta.url));
  return existsSync(p) ? readFileSync(p, "utf8").replace(/\r\n/g, "\n") : null;
};

/**
 * Source with comments stripped.
 *
 * Same reasoning as the two sibling gates: every file involved here DOCUMENTS the
 * mockup it replaced, naming 'emp-1' and 'Anna Brandt' in prose so the next reader
 * knows what was removed and why. Matching raw source would report those
 * explanations as the very regressions they document, and the obvious "fix" —
 * deleting the explanation — loses the reason the code looks like this.
 */
const codeOnly = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");

console.log("--- 1. The grid reads its own module, and the old reader is gone ---");

const page = read("src/app/(app)/timesheets/page.tsx");
check("the timesheets page exists", page !== null);

if (page) {
  const code = codeOnly(page);
  check(
    "the page reads getTimesheetWeek from queries/timesheets",
    /getTimesheetWeek/.test(code) && /@\/lib\/queries\/timesheets/.test(code),
    "anything else means it is back on the pre-move reader",
  );
  /*
   * The distinction the old reader could not express. getTimesheetEntries returned
   * [] both for "this week is empty" and for "your account has no linked person",
   * and the grid rendered one sentence for both — inviting somebody to click an
   * Add-entry button whose server action can only ever answer "No linked person
   * profile". Asserted on the RENDER, not on the type: a union that is fetched and
   * then collapsed with `.entries` at the call site is the same bug with extra
   * steps.
   */
  check(
    'the page distinguishes "no linked person" from an empty week',
    /week\.state === "no-person"/.test(code),
    "an unlinked account must not be shown an editable grid it cannot write to",
  );
  check(
    "the unlinked state is not laundered into an empty grid",
    !/state === "no-person" \? \[\]/.test(code) && /EmptyState/.test(code),
    "collapsing the two states back together restores the original dead end",
  );
}

const hse = read("src/lib/queries/hse.ts");
if (hse) {
  // The lesson check-no-mockup-people paid for with getTeamLeadBoard: a dead
  // export returning the same rows is how mockup data survives a rewire.
  check(
    "getTimesheetEntries (the pre-move reader) is gone from hse.ts",
    !/export async function getTimesheetEntries/.test(hse),
    "leaving it exported invites the next page to call it",
  );
}

const mod = read("src/lib/queries/timesheets.ts");
check("src/lib/queries/timesheets.ts exists", mod !== null);

if (mod) {
  const code = codeOnly(mod);
  check(
    "the reader scopes to the caller's own person_id",
    /\.eq\("person_id", profile\.person_id\)/.test(code),
    "RLS is can_view_person(), so an exec may SELECT everyone; 'my timesheet' must still filter",
  );
  check(
    "the reader also filters to the requested week",
    /\.eq\("week_start", weekStart\)/.test(code),
    "without it the grid sums every week a person ever logged into one seven-day row",
  );
  /*
   * RLS must stay intact. The service-role key bypasses every policy on this
   * table, including the six that decide who may read, submit, withdraw and
   * approve a week. A reader that reaches for it would show every colleague's
   * hours to everyone.
   */
  check(
    "the reader uses the normal RLS-bound client, never service-role",
    !/SERVICE_ROLE|service_role|createServiceClient/.test(code),
    "service-role bypasses all six timesheet_entries policies at once",
  );
}

console.log("\n--- 2. No mockup row may exist in the table ---");

const dbUrl = (() => {
  if (process.env.SUPABASE_DB_URL) return process.env.SUPABASE_DB_URL;
  const env = read(".env.local");
  return env?.match(/^SUPABASE_DB_URL=(.*)$/m)?.[1]?.replace(/^["']|["']$/g, "") ?? null;
})();

if (!dbUrl) {
  console.log("SKIP: no SUPABASE_DB_URL — structural half only (this is the CI path)");
} else {
  const pg = (await import("pg")).default;
  const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();

  /*
   * A mockup row, defined by what made all 28 of them mockups rather than by
   * their ids or their count:
   *
   *   - seeded  : the person is source='seed' AND is_active=false. The eight
   *               seeded people the sibling gate already guards.
   *   - orphan  : no row in public.people at all. person_id is text with no FK
   *               to people, so a typo or a stale import lands here.
   *   - unlinked: no app_user_profile points at that person. A timesheet is
   *               somebody's testimony about their own week; nobody can testify
   *               without an account.
   *
   * Deliberately NOT "project_id is null". A colleague typing a project name the
   * Hub does not know yet is doing something legitimate, and failing them for it
   * would make this gate the thing people route around.
   */
  const { rows: bad } = await client.query(`
    select te.person_id,
           count(*) as rows,
           sum(te.hours) as hours,
           bool_or(p.id is null) as orphan,
           bool_or(p.source = 'seed' and not p.is_active) as seeded,
           bool_or(aup.user_id is null) as unlinked
      from public.timesheet_entries te
      left join public.people p on p.id = te.person_id
      left join public.app_user_profile aup on aup.person_id = te.person_id
     where p.id is null
        or (p.source = 'seed' and not p.is_active)
        or aup.user_id is null
     group by te.person_id
     order by 2 desc`);

  check(
    "no timesheet row belongs to a seeded, orphaned or unlinked person",
    bad.length === 0,
    bad
      .slice(0, 8)
      .map(
        (r) =>
          `${r.person_id}: ${r.rows} rows / ${r.hours} h` +
          `${r.orphan ? " [not in people]" : ""}${r.seeded ? " [seeded+inactive]" : ""}` +
          `${r.unlinked ? " [no account]" : ""}`,
      )
      .join("\n        ") || "the table holds only rows a real colleague logged",
  );

  // weekly_bookings backed the old getTeamLeadBoard, which team-lead-live.ts
  // replaced with measured time. Nothing in src/ reads it; 20 seeded rows for five
  // fictional people is a loaded gun for the next person who greps for a workload
  // table and finds one already populated.
  const { rows: wb } = await client.query(`select count(*)::int as n from public.weekly_bookings`);
  check(
    "public.weekly_bookings is empty",
    wb[0].n === 0,
    `${wb[0].n} seeded booking row(s) remain; the board reads time.entry now`,
  );

  /*
   * The negative control. Every assertion above is also satisfied by an empty
   * table, so on its own this section cannot tell "clean" from "there is nothing
   * to be wrong". Naming the real source keeps the gate honest about which of the
   * two it just proved.
   */
  const { rows: real } = await client.query(`
    select count(*)::int as entries,
           round(sum(duration_seconds) / 3600.0)::int as hours
      from time.entry
     where started_at::date <= current_date`);
  check(
    "the real source is populated, so an empty grid is a fact about this table only",
    real[0].entries > 0,
    `time.entry: ${real[0].entries} entries / ${real[0].hours} h — this is what /time renders`,
  );

  const { rows: mine } = await client.query(`select count(*)::int as n from public.timesheet_entries`);
  console.log(
    `\n        public.timesheet_entries: ${mine[0].n} row(s). ` +
      `An employee with none sees the empty state, which is the truth.`,
  );

  await client.end();
}

console.log(
  failed
    ? "\nTIMESHEET TRUTH: the grid can still show somebody who does not exist\n"
    : "\nTIMESHEET TRUTH: the grid shows measured time or an honest empty state\n",
);
process.exit(failed ? 1 : 0);
