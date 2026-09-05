// Gate: does every linked order's stored burn match its inputs, and is the
// refresh that writes it actually running?
//
// check-management-data.mjs asserts hour truth for the single HEAVIEST order,
// selected with `.gt("logged_hours", 0)` -- a filter that excludes every
// stale-zero row by construction. This checks EVERY linked order.
//
// WHAT CHANGED ON 2026-09-05, and why it is a tightening and not a tolerance.
//
// Until then this gate compared public.projects.logged_hours with the live sum
// of time.entry at now() and allowed zero difference. That assertion can only
// hold at the instant of a refresh: every sync lands entries, some of them
// back-dated (26 of the 160 imported 2026-09-02..05 were), and each one made
// an order "understated" until the next refresh. So the gate was red 1, 13, 19,
// 21 orders on four consecutive nights, the vault filed it as "the gate, not the
// data", and the actual fault went unnamed: the nightly refresh step had NEVER
// run (skipped behind a red parity check since 2026-09-02; the column was frozen
// at the 2026-09-02 10:12Z hand-run while eight pages kept rendering it).
// A gate that is red for an expected reason cannot also be red for a real one.
//
// The rows now carry logged_hours_as_of (migration 20260905130000), so the
// question splits. The rule lives in scripts/lib/order-hours-freshness.mjs and
// is shared with check-order-hours-freshness-discriminates.mjs, which proves in
// PGlite that every assertion below can fail:
//
//   FAIL  a linked order with no as_of              (nothing has refreshed it)
//   FAIL  more than one as_of across the orders     (a run died midway)
//   FAIL  as_of older than MAX_AGE_HOURS            (the nightly step is dead)
//   FAIL  as_of older than the last ok sync         (the step did not follow it)
//   FAIL  stored != entries that existed at as_of   (drift, or a hand write)
//   FAIL  stored > every entry that exists at all   (fabrication)
//   note  entries in range now but newer than as_of (lag; sized, worst named)
//
// The tradeoff, stated: an order may understate by up to one refresh cycle of
// newly logged work before this fails on it, and it prints how much and where.
//
// Until the migration is pasted this gate FAILS by name -- it does not skip,
// and it does not fall back to the old comparison, because the old comparison
// is the thing that could not say what was wrong.
//
// READ-ONLY: one transaction, `begin read only`, statement_timeout 30s.

import pg from "pg";
import { loadEnv } from "./lib/gate-env.mjs";
import {
  MIGRATION, COLUMN_EXISTS_SQL, ORDER_HOURS_SQL, LAST_SYNC_SQL, classify, MAX_AGE_HOURS,
} from "./lib/order-hours-freshness.mjs";

const env = loadEnv();

// No database URL means no live database to check -- on CI without secrets, or
// on a clean checkout. Skipping says so; passing pg an undefined connection
// string makes it default to localhost:5432 and fail with ECONNREFUSED, which
// reads like a broken gate rather than an absent credential.
if (!env.SUPABASE_DB_URL) {
  console.log("SKIP: no SUPABASE_DB_URL, so there is no live database to check");
  process.exit(0);
}

const c = new pg.Client({
  connectionString: env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 20_000,
});
await c.connect();

const failures = [];
const print = ({ ok, label, detail }) => {
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
};

console.log("check-order-hours-freshness: does every linked order tell the truth about hours, and is the refresh alive?\n");

try {
  await c.query("begin read only");
  await c.query("set local statement_timeout = '30s'");

  const { rows: col } = await c.query(COLUMN_EXISTS_SQL);
  print({
    ok: col.length === 1,
    label: "public.projects carries logged_hours_as_of",
    detail: col.length === 1 ? "present" : `MISSING -- paste ${MIGRATION}, then run \`node scripts/refresh-order-hours.mjs\``,
  });

  if (col.length === 1) {
    const now = new Date();
    const { rows } = await c.query(ORDER_HOURS_SQL, [now.toISOString()]);
    const { rows: [sync] } = await c.query(LAST_SYNC_SQL);
    const lastSyncFinishedAt = sync?.finished_at ?? null;

    const result = classify({ rows, now, lastSyncFinishedAt });

    const withAsOf = rows.length - result.never.length;
    console.log(`  ${rows.length} linked orders, ${withAsOf} with an as_of`
      + (result.instants.length ? ` (latest ${result.instants.at(-1)})` : "")
      + `, last ok sync ${lastSyncFinishedAt ? new Date(lastSyncFinishedAt).toISOString() : "n/a"}`
      + `, now ${now.toISOString()}, max age ${MAX_AGE_HOURS}h\n`);

    for (const line of result.notes) console.log(`  ${line}`);
    if (result.notes.length) console.log("");
    for (const ch of result.checks) print(ch);
  }
} finally {
  await c.query("rollback").catch(() => {});
  await c.end();
}

console.log(`\n${failures.length === 0 ? "PASS" : `FAIL (${failures.length})`}`);
if (failures.length) for (const f of failures) console.log(`  - ${f}`);
process.exit(failures.length ? 1 : 0);
