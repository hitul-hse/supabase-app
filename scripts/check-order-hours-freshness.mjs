// Gate: no linked order may report fewer hours than its time entries prove.
//
// check-management-data.mjs already asserts hour truth, but only for the single
// HEAVIEST order, selected with `.gt("logged_hours", 0)`. That filter excludes
// every stale-zero row by construction, so the worst cases cannot be sampled:
// 60 of 177 linked orders store logged_hours = 0 while time.entry sums to real
// work, up to 390.4h on 10110_00358_104_01 alone. The existing gate passes and
// always would.
//
// This checks EVERY linked order. The stored column is a snapshot maintained by
// scripts/refresh-order-hours.mjs and public.projects carries no refreshed_at,
// so there is no way for a page to say how stale it is -- which makes an
// understated figure indistinguishable from a real one.
//
// Direction matters. Understating is the dangerous case: a project reading 0h
// against 800h contracted looks perfectly on-budget while a third of the
// contract has been burned. Overstating would be a different bug (invented
// hours) and is asserted separately.
//
// READ-ONLY.

import pg from "pg";
import { loadEnv } from "./lib/gate-env.mjs";

// Measured 2026-08-27, AFTER `node scripts/refresh-order-hours.mjs` was run.
//
// Before the refresh: 59 understated, 51 reading exactly 0h against 1,206h of
// real work, 4 already over contract while showing 0h. After: 3 understated (all
// 0.1h rounding) and 0 silently over contract. The refresh did its job.
//
// It also changed what the column MEANS. refresh-order-hours.mjs sums all-time
// by design (see its header), so `logged_hours` is now "planned + logged" rather
// than "logged to date": 4 orders store more than their to-date entries support,
// and all 4 differences are exactly their future-dated entries. Mirantis is the
// clearest -- 398h stored, 201.5h actually worked, 24 future entries.
//
// That is a defensible product decision, not a bug, but it means a burn figure
// includes work not yet done. KNOWN_OVERSTATED is pinned at the measured 4 so
// the count cannot drift; the fabrication test below is the one that must stay
// at zero.
const KNOWN_STALE = 3;
const KNOWN_OVERSTATED = 4;
const KNOWN_OVER_CONTRACT = 0;
// Hours tolerance. Below this a difference is rounding, not staleness.
const EPSILON = 0.05;

const env = loadEnv();

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const failures = [];
const check = (ok, label, detail) => {
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
};

console.log("check-order-hours-freshness: does every linked order tell the truth about hours?\n");

/*
 * Bounded at now(): time.entry holds future-dated planned entries out to
 * 2026-12-31, and an unbounded sum would report planned work as burned.
 */
const { rows } = await c.query(`
  select p.id, p.name, p.contract_hours,
         p.logged_hours as stored,
         round(coalesce(sum(e.duration_seconds), 0) / 3600.0, 1) as actual
  from public.projects p
  join time.project t on t.hub_project_id = p.id
  left join time.entry e on e.project_id = t.id and e.started_at <= now()
  group by p.id, p.name, p.contract_hours, p.logged_hours`);

const understated = rows.filter((r) => r.stored !== null && Number(r.actual) - Number(r.stored) >= EPSILON);
const overstated = rows.filter((r) => r.stored !== null && Number(r.stored) - Number(r.actual) >= EPSILON);
const nulls = rows.filter((r) => r.stored === null);

console.log(`  ${rows.length} linked orders: ${understated.length} understated, ${overstated.length} overstated, ${nulls.length} honestly null\n`);

if (understated.length) {
  console.log("  UNDERSTATED — the order looks less consumed than it is:");
  for (const r of [...understated].sort((a, b) => (b.actual - b.stored) - (a.actual - a.stored)).slice(0, 8)) {
    const pct = Number(r.contract_hours) > 0 ? ` (${Math.round((r.actual / r.contract_hours) * 100)}% of ${r.contract_hours}h contract)` : "";
    console.log(`    ${r.id}  shows ${r.stored}h, actually ${r.actual}h${pct}  "${String(r.name).slice(0, 34)}"`);
  }
  console.log("");
}

check(rows.length > 0, "there are linked orders to check", `${rows.length}`);

check(understated.length <= KNOWN_STALE,
  `understated orders have not grown beyond the known ${KNOWN_STALE}`,
  `${understated.length} orders report fewer hours than their entries prove`);

if (understated.length < KNOWN_STALE) {
  console.log(`  note  understated SHRANK to ${understated.length}; lower KNOWN_STALE to lock it in.`);
}

/*
 * Overstating relative to a TODAY-BOUNDED sum is not an invented number. It is
 * the snapshot having counted FUTURE-dated planned entries: 10388_00372_60107_01
 * stores 306h, sums to 307.6h unbounded and 300.6h to date, so the snapshot was
 * taken against the unbounded figure. time.entry holds planned work out to
 * 2026-12-31.
 *
 * That still matters -- a burn figure that includes work not yet done overstates
 * consumption -- but it is a different defect from fabrication, so it gets its own
 * pinned tolerance rather than a hard zero that would be misleading about cause.
 */
const overstatedVsUnbounded = [];
for (const r of overstated) {
  const { rows: [u] } = await c.query(`
    select round(coalesce(sum(e.duration_seconds),0)/3600.0, 1) as unbounded
    from time.project t join time.entry e on e.project_id = t.id
    where t.hub_project_id = $1`, [r.id]);
  if (Number(r.stored) - Number(u.unbounded) >= EPSILON) overstatedVsUnbounded.push(r);
}

check(overstated.length <= KNOWN_OVERSTATED,
  `orders counting future-dated work have not grown beyond ${KNOWN_OVERSTATED}`,
  `${overstated.length} store more than their to-date entries support`);

// THIS is the fabrication test: more hours than exist even counting the future.
check(overstatedVsUnbounded.length === 0,
  "no order claims hours that no entry supports at all",
  overstatedVsUnbounded.length
    ? `${overstatedVsUnbounded.length} fabricated, e.g. ${overstatedVsUnbounded[0].id}`
    : "none — every stored figure is explained by real entries");

/*
 * The specific trap a detail page would fall into: a project reading exactly 0
 * while real work exists reads as untouched, and consumed_percent agrees.
 */
const zeroButWorked = rows.filter((r) => Number(r.stored) === 0 && Number(r.actual) >= EPSILON);
if (zeroButWorked.length) {
  const hidden = zeroButWorked.reduce((s, r) => s + Number(r.actual), 0);
  console.log(`\n  note  ${zeroButWorked.length} orders read exactly 0h while ${hidden.toFixed(1)}h of real work exists.`);
  console.log(`  note  Those are the rows that look on-budget while being consumed. Run`);
  console.log(`  note  \`node scripts/refresh-order-hours.mjs\` to reconcile them.`);
}
check(zeroButWorked.length <= KNOWN_STALE,
  `orders reading 0h despite real work have not grown beyond ${KNOWN_STALE}`,
  `${zeroButWorked.length}`);

/*
 * The operationally worst case, worth naming separately: an order that has
 * already exceeded its contract while displaying 0h consumed. Every budget
 * signal in the product reads it as untouched, so nobody is warned.
 */
const overContractButSilent = rows.filter((r) =>
  Number(r.stored) === 0 && Number(r.contract_hours) > 0 && Number(r.actual) > Number(r.contract_hours));

if (overContractButSilent.length) {
  console.log(`\n  ALREADY OVER CONTRACT while showing 0h consumed:`);
  for (const r of overContractButSilent.sort((a, b) => (b.actual / b.contract_hours) - (a.actual / a.contract_hours))) {
    console.log(`    ${r.id}  ${r.actual}h against a ${r.contract_hours}h contract` +
      ` (${Math.round((r.actual / r.contract_hours) * 100)}%)  "${String(r.name).slice(0, 30)}"`);
  }
  console.log(`  These are invisible to every budget alert until the refresh runs.`);
}

check(overContractButSilent.length <= KNOWN_OVER_CONTRACT,
  `orders silently over contract have not grown beyond ${KNOWN_OVER_CONTRACT}`,
  `${overContractButSilent.length} exceed their contract while reporting 0h`);

console.log(`\n${failures.length === 0 ? "PASS" : `FAIL (${failures.length})`}`);
if (failures.length) for (const f of failures) console.log(`  - ${f}`);
await c.end();
process.exit(failures.length ? 1 : 0);
