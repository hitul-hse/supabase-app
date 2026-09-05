/*
 * The order-hours freshness rule, in one place, so the live gate
 * (check-order-hours-freshness.mjs, against production) and its negative
 * control (check-order-hours-freshness-discriminates.mjs, against PGlite) run
 * the SAME SQL and the SAME classification. A gate whose logic is only ever
 * exercised against a database it cannot break has never been shown to fail.
 *
 * WHAT IS MEASURED, and why it is these things and not one.
 *
 * public.projects.logged_hours is a snapshot written by
 * scripts/refresh-order-hours.mjs. Since migration
 * 20260905130000_order_hours_carry_their_as_of.sql every linked row also
 * carries logged_hours_as_of, the instant the sum was bounded at. That splits
 * the old single question ("does stored equal the live sum at now()?") -- which
 * could only be answered yes at the instant of a refresh -- into questions with
 * different answers:
 *
 *   DRIFT    stored differs from the entries that existed at as_of. The refresh
 *            wrote a figure its own inputs do not support -- or an entry it
 *            counted has since been edited or deleted, which time.entry cannot
 *            tell apart from here (updated_at is never maintained) -- or some
 *            other writer (import-masterdata-projects.mjs also sets
 *            logged_hours) overwrote the column without touching as_of. Every
 *            one of those leaves the page wrong, and none of them is lag.
 *   LAG      entries in range now that were not in the snapshot: imported since
 *            the refresh, back-dated by a late timesheet, or pre-logged and
 *            since crossed into range. Expected inside one refresh cycle; the
 *            next refresh folds them in. Reported with its size, never failed on
 *            its own.
 *
 * and the refresh cycle itself becomes checkable:
 *
 *   NEVER    a linked order with no as_of: no refresh has recorded itself on
 *            it. Also what a newly linked order looks like until the next
 *            refresh -- deliberately red, so the refresh is run after linking.
 *   STALE    as_of older than MAX_AGE_HOURS, or older than the last successful
 *            TrackingTime sync. The workflow promises a refresh after every
 *            sync; a refresh that predates the sync it should have followed is
 *            the step not running -- which is exactly what happened on
 *            2026-09-02..05, when the step was skipped four nights running
 *            behind a red parity check and nothing on the rig said so.
 *   PARTIAL  more than one as_of across the linked orders: a run died midway
 *            and the orders disagree about which instant they describe.
 *
 * Fabrication (stored exceeds every entry that exists, planned work included)
 * stays its own assertion; it is worse than any of the above.
 *
 * THE TRADEOFF, stated once. An order may understate by up to one refresh
 * cycle of newly logged work (MAX_AGE_HOURS at the outside) before this rule
 * fails on it, and the rule prints how much and on which orders. The previous
 * rule allowed zero lag and so was red at every instant except the one the
 * refresh ran at. That is not a measurement of the data; it is a clock.
 */

export const MIGRATION = "supabase/migrations/20260905130000_order_hours_carry_their_as_of.sql";

/*
 * Hours tolerance. stored and snapshot are both rounded to 0.1 h from the same
 * integer seconds, so equal inputs give equal outputs; half a rounding step is
 * the widest gap that can still be rounding, and anything at or above it is a
 * real hour difference.
 */
export const EPSILON = 0.05;

/*
 * Reasoned, not picked. The refresh is cron 04:17 UTC and GitHub has delivered
 * it up to 08:50 UTC (2026-09-04); the night shift on the rig runs 20:01 UTC
 * and again through to 04:01 UTC. A refresh that ran on day D is 11-16 h old
 * at that evening's run and 19-24 h old the following dawn -- both green. If
 * day D+1's refresh does not happen at all, the D+1 evening run sees 35-40 h
 * and fails: one missed night is caught the same evening, and the ordinary
 * cron delay is not.
 */
export const MAX_AGE_HOURS = 30;

export const COLUMN_EXISTS_SQL = `
  select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'projects' and column_name = 'logged_hours_as_of'`;

/*
 * One row per LINKED order (a public.projects row that at least one
 * time.project points at). $1 is "now", passed in rather than read from the
 * server so the negative control can move the clock.
 *
 *   snapshot   what the refresh at as_of should have written: entries that had
 *              started by as_of AND had been imported by as_of.
 *   actual     the to-date sum a page bounded at now() shows.
 *   unbounded  everything, planned work included -- the fabrication ceiling.
 *   arrived    entries in range now that the snapshot could not have counted.
 *
 * The join order matters: from the order, through every time.project that
 * links to it, LEFT to entries, so an order with two linked projects sums both
 * and an order with none still appears with zeroes. The duration filter is in
 * the join, not a WHERE, for the same reason.
 */
export const ORDER_HOURS_SQL = `
  with linked as (
    select p.id, p.name, p.contract_hours,
           p.logged_hours as stored, p.logged_hours_as_of as as_of
    from public.projects p
    where exists (select 1 from time.project t where t.hub_project_id = p.id)
  ),
  sums as (
    select l.id,
           coalesce(sum(e.duration_seconds) filter (
             where l.as_of is not null and e.started_at <= l.as_of and e.created_at <= l.as_of), 0) as snapshot_sec,
           coalesce(sum(e.duration_seconds) filter (where e.started_at <= $1::timestamptz), 0) as now_sec,
           coalesce(sum(e.duration_seconds), 0) as all_sec,
           count(e.id) filter (
             where e.started_at <= $1::timestamptz
               and (l.as_of is null or e.started_at > l.as_of or e.created_at > l.as_of)) as arrived
    from linked l
    join time.project t on t.hub_project_id = l.id
    left join time.entry e on e.project_id = t.id and e.duration_seconds is not null
    group by l.id
  )
  select l.id, l.name, l.contract_hours, l.stored, l.as_of,
         round(s.snapshot_sec / 3600.0, 1) as snapshot,
         round(s.now_sec / 3600.0, 1) as actual,
         round(s.all_sec / 3600.0, 1) as unbounded,
         s.arrived
  from linked l
  join sums s on s.id = l.id
  order by l.id`;

export const LAST_SYNC_SQL = `
  select max(finished_at) as finished_at
  from raw.sync_run
  where source = 'trackingtime' and status = 'ok'`;

const n = (v) => Number(v);
const iso = (d) => new Date(d).toISOString();
const h = (v) => `${n(v).toFixed(1)}h`;
const name = (r) => `"${String(r.name).slice(0, 34)}"`;

/**
 * Classify the rows ORDER_HOURS_SQL returned. Pure: no I/O, no clock of its
 * own. Returns the ordered assertions (each {ok, label, detail}), the notes to
 * print between them, and the buckets, so a caller can print or assert.
 *
 * @param {object} args
 * @param {Array} args.rows              rows from ORDER_HOURS_SQL
 * @param {Date}  args.now               the same instant passed as $1
 * @param {Date|string|null} args.lastSyncFinishedAt  from LAST_SYNC_SQL, or null
 * @param {number} [args.maxAgeHours]
 */
export function classify({ rows, now, lastSyncFinishedAt, maxAgeHours = MAX_AGE_HOURS }) {
  const checks = [];
  const notes = [];
  const check = (ok, label, detail = "") => checks.push({ ok, label, detail });

  check(rows.length > 0, "there are linked orders to check", `${rows.length}`);

  /* NEVER -- no refresh has recorded itself on the row. */
  const never = rows.filter((r) => r.as_of === null);
  check(never.length === 0,
    "every linked order carries the instant its hours were computed at",
    never.length
      ? `${never.length} of ${rows.length} have no logged_hours_as_of -- no refresh has recorded itself on them `
        + `(${MIGRATION} not applied, or an order linked since the last refresh); run \`node scripts/refresh-order-hours.mjs\``
      : `all ${rows.length}`);

  /* PARTIAL -- the linked orders must describe one instant. */
  const instants = [...new Set(rows.filter((r) => r.as_of !== null).map((r) => iso(r.as_of)))].sort();
  const latest = instants.at(-1) ?? null;
  check(instants.length <= 1,
    "one refresh instant across every linked order",
    instants.length > 1
      ? `${instants.length} instants (${instants[0]} .. ${latest}): a run died midway and the orders disagree about when they were computed`
      : latest ? `as of ${latest}` : "no refresh recorded");

  /* STALE -- age, and order relative to the sync it should have followed. */
  if (latest) {
    const ageH = (now.getTime() - new Date(latest).getTime()) / 3_600_000;
    check(ageH <= maxAgeHours,
      `the refresh is not older than ${maxAgeHours}h`,
      `${ageH.toFixed(1)}h old (as of ${latest})`
      + (ageH > maxAgeHours ? " -- the nightly step is not running; see 'Refresh order hours' in .github/workflows/sync-trackingtime.yml" : ""));

    if (lastSyncFinishedAt) {
      const sync = new Date(lastSyncFinishedAt);
      const after = new Date(latest).getTime() >= sync.getTime();
      check(after,
        "the refresh ran after the last successful TrackingTime sync",
        after
          ? `refresh ${latest} >= sync ${sync.toISOString()}`
          : `refresh ${latest} PREDATES the sync that finished ${sync.toISOString()} -- the step that folds a sync into the orders did not run after it`);
    } else {
      notes.push("n/a   no successful TrackingTime sync in raw.sync_run to order the refresh against; check-sync-freshness owns that");
    }
  }

  /* DRIFT -- stored must equal what its inputs summed to at as_of. */
  const withAsOf = rows.filter((r) => r.as_of !== null);
  const drifted = withAsOf
    .filter((r) => r.stored === null || Math.abs(n(r.stored) - n(r.snapshot)) >= EPSILON)
    .sort((a, b) => Math.abs(n(b.stored) - n(b.snapshot)) - Math.abs(n(a.stored) - n(a.snapshot)));
  if (drifted.length) {
    notes.push("DRIFT -- stored does not match the entries that existed at its as_of:");
    for (const r of drifted.slice(0, 8)) {
      notes.push(`    ${r.id}  stores ${r.stored === null ? "null" : h(r.stored)}, its inputs at ${iso(r.as_of)} sum to ${h(r.snapshot)}  ${name(r)}`);
    }
    notes.push("  Either the refresh wrote a figure its inputs do not support, an entry it counted has since been edited or deleted");
    notes.push("  (time.entry.updated_at is not maintained, so the two cannot be told apart here), or another writer set logged_hours");
    notes.push("  without as_of. Re-run the refresh; a difference that survives a refresh is the refresh losing hours.");
  }
  check(drifted.length === 0,
    "every stored figure equals the entries that existed at its as_of",
    drifted.length
      ? `${drifted.length} differ, worst ${drifted[0].id}: ${drifted[0].stored === null ? "null" : h(drifted[0].stored)} stored vs ${h(drifted[0].snapshot)} at as_of`
      : `${withAsOf.length} orders re-derived exactly`);

  /* FABRICATION -- more hours than exist even counting the future. */
  const fabricated = rows.filter((r) => r.stored !== null && n(r.stored) - n(r.unbounded) >= EPSILON);
  check(fabricated.length === 0,
    "no order claims hours that no entry supports at all",
    fabricated.length
      ? `${fabricated.length} fabricated, e.g. ${fabricated[0].id} stores ${h(fabricated[0].stored)} against ${h(fabricated[0].unbounded)} in existence`
      : "every stored figure is explained by real entries");

  /* LAG -- reported, sized, not failed. */
  const lagging = withAsOf
    .filter((r) => n(r.actual) - n(r.snapshot) >= EPSILON)
    .sort((a, b) => (n(b.actual) - n(b.snapshot)) - (n(a.actual) - n(a.snapshot)));
  const lagHours = lagging.reduce((s, r) => s + (n(r.actual) - n(r.snapshot)), 0);
  if (lagging.length) {
    notes.push(`LAG   ${lagging.length} orders have ${lagHours.toFixed(1)}h logged since the refresh at ${latest} `
      + `(${lagging.reduce((s, r) => s + n(r.arrived), 0)} entries) -- expected within one cycle; the next refresh folds them in:`);
    for (const r of lagging.slice(0, 5)) {
      notes.push(`    ${r.id}  shows ${h(r.snapshot)}, to date ${h(r.actual)} (+${(n(r.actual) - n(r.snapshot)).toFixed(1)}h)  ${name(r)}`);
    }
    // The case worth naming even when it is only lag: an order that crossed
    // its contract since the refresh reads as under contract on every page.
    const crossed = lagging.filter((r) => n(r.contract_hours) > 0 && n(r.actual) > n(r.contract_hours) && n(r.snapshot) <= n(r.contract_hours));
    for (const r of crossed) {
      notes.push(`    NOTE  ${r.id} crossed its ${h(r.contract_hours)} contract since the refresh (${h(r.actual)} to date) and reads under contract until the next one`);
    }
  } else if (withAsOf.length) {
    notes.push(`LAG   none -- every linked order's stored figure is also its to-date sum at ${now.toISOString()}`);
  }

  return { checks, notes, never, instants, drifted, fabricated, lagging, lagHours };
}
