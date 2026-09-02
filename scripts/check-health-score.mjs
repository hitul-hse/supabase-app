/**
 * The health score's formulas, pinned against the SHIPPED module.
 *
 * Two things are under test:
 *
 *   1. src/lib/health-score.ts implements the brief's "Score model" exactly:
 *      the mappings, the renormalisation over measurable components, the
 *      49 cap while any measurable sub-score is below 25, n/a when fewer than
 *      two sub-scores are measurable, and that the points listed in every
 *      drill-down reconcile with the score in the hero (rounding once).
 *
 *   2. scripts/sample-system-health.mjs -- which duplicates those formulas so
 *      the rig's hourly history can be written without the repo -- agrees
 *      with the TypeScript on a grid of inputs and on fixtures. If someone
 *      changes one and not the other, this is where it shows.
 *
 * Runs with a plain `node scripts/check-health-score.mjs`: Node strips the
 * types itself, and ts-resolve.mjs is registered first so health-score.ts's
 * extensionless `./health-history` import resolves.
 */
import "./ts-resolve.mjs";

const score = await import("../src/lib/health-score.ts");
const history = await import("../src/lib/health-history.ts");
const sampler = await import("./sample-system-health.mjs");

let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
};
const okv = (m) => (m.ok ? m.value : null);

/* ---------------------------------------------------------------- fixtures */

const AT = "2026-09-02T12:00:00.000Z";
const hoursAgo = (h) => new Date(Date.parse(AT) - h * 3_600_000).toISOString();
const run = (status, ageH, extra = {}) => ({
  entity: "entries", startedAt: hoursAgo(ageH + 0.1), finishedAt: status === "running" ? null : hoursAgo(ageH),
  status, recordCount: 361, errorMessage: status === "failed" ? "HTTP 502 from vendor" : null, ...extra,
});
const ok = (value) => ({ ok: true, value });
const na = (reason) => ({ ok: false, reason });

/** A healthy snapshot; each case overrides what it needs. */
function fixture(o = {}) {
  const sources = o.sources ?? [
    { source: "trackingtime", lastRun: ok(run("ok", 8)), raw: ok({ count: 5530, lastFetchedAt: hoursAgo(8) }) },
    { source: "factorial", lastRun: ok(null), raw: ok({ count: 0, lastFetchedAt: null }) },
    { source: "asana", lastRun: ok(null), raw: ok({ count: 0, lastFetchedAt: null }) },
    { source: "samdock", lastRun: ok(null), raw: ok({ count: 0, lastFetchedAt: null }) },
  ];
  return {
    sampledAt: AT,
    dbError: null,
    freshness: o.freshness === null ? null : {
      sources,
      sla: sources.map((s) => score.slaFor(s.source)),
      runs30d: o.runs30d ?? ok([]),
      typed: [],
      legacy: na("not needed"),
    },
    efficiency: o.efficiency === null ? null : {
      gateRuns: na("not persisted"),
      requestTimings: na("not instrumented"),
      dbLatencyMs: o.dbLatencyMs ?? ok(12),
      dbStats: o.dbStats ?? ok({ xactCommit: 100000, xactRollback: 500, cacheHitPct: 99.6, deadlocks: 0, statsReset: "2026-08-01 00:00:00+00" }),
      connections: o.connections ?? ok({ active: 17, max: 60 }),
      statements: na("not needed"),
    },
    security: {
      usersWithoutRole: o.usersWithoutRole ?? ok(0),
      profilesByRole: na("not needed"),
      rls: o.rls ?? ok({ total: 56, enabled: 56, off: [], lockedNoPolicy: [{ relation: "raw.vendor_record", policies: 0 }] }),
      envFlags: o.envFlags ?? ["A", "B", "C", "D", "E"].map((name) => ({ name, set: true })),
      headers: o.headers ?? ok({ url: "http://localhost:3002/login", status: 200, checks: [
        { name: "x-frame-options", expected: "DENY", observed: "DENY" },
        { name: "x-content-type-options", expected: "nosniff", observed: "nosniff" },
        { name: "referrer-policy", expected: "strict-origin-when-cross-origin", observed: "strict-origin-when-cross-origin" },
        { name: "permissions-policy", expected: "camera=(), microphone=(), geolocation=()", observed: "camera=(), microphone=(), geolocation=()" },
        { name: "strict-transport-security", expected: null, observed: "max-age=63072000" },
      ] }),
    },
    consumption: o.consumption === null ? null : {
      dbSize: o.dbSize ?? ok({ bytes: 66088083, pretty: "63 MB" }),
      largest: ok([]), otherBytes: ok(0), relationsTotalBytes: ok(0), relationCount: ok(0),
      budgetBytes: o.budgetBytes ?? ok(500 * 1024 * 1024),
      budgetSource: "fixture",
    },
    deploy: { deploymentId: null, env: null, commit: null, region: null },
    timings: { serverMs: 0 },
  };
}
const NO_HISTORY = na("no history on this host — fixture");

/* --------------------------------------------------------- 1. all measured */

const all = score.computeHealthScore(fixture(), NO_HISTORY);
check("all-ok: every sub-score is measurable", all.freshness.ok && all.efficiency.ok && all.security.ok && all.consumption.ok,
  [all.freshness, all.efficiency, all.security, all.consumption].map((s) => (s.ok ? s.value.score : `n/a: ${s.reason}`)).join(" / "));
check("all-ok: freshness 100 (trackingtime 8 h old vs SLA 24 h)", okv(all.freshness)?.score === 100);
check("all-ok: efficiency 100 (cache 99.6 %, rollbacks 0.5 %, 17/60 connections, 12 ms)", okv(all.efficiency)?.score === 100);
check("all-ok: security 100 (RLS 56/56, 0 users without role, 5/5 env, 5/5 headers)", okv(all.security)?.score === 100);
check("all-ok: consumption 87 (63 MB of 500 MB = 12.6 % used → 87.4 → 87)", okv(all.consumption)?.score === 87, String(okv(all.consumption)?.score));
check("all-ok: composite 97 = round((100·30 + 100·30 + 100·20 + 87·20) ÷ 100), 4 measured, no cap, weakest consumption",
  all.composite.ok && all.composite.value.score === 97 && all.composite.value.measured === 4 && !all.composite.value.capApplied && all.composite.value.weakest === "consumption",
  JSON.stringify(all.composite));

const unscheduled = okv(all.freshness)?.components.filter((c) => c.excludedReason === "no documented SLA") ?? [];
check("freshness lists factorial, asana, samdock as excluded (no documented SLA) with points null",
  unscheduled.length === 3 && unscheduled.every((c) => c.points === null && c.detail.includes("no documented schedule")),
  unscheduled.map((c) => c.label).join(", "));
const ttDetail = okv(all.freshness)?.components.find((c) => c.key === "source:trackingtime")?.detail ?? "";
check("trackingtime detail states the input, the mapping and the grace", /8 h ago vs SLA 24 h → 100/.test(ttDetail) && /≤ SLA \+ 2 h grace is 100/.test(ttDetail) && ttDetail.includes("GitHub cron runs up to 90 min late"), ttDetail);
check("FRESHNESS_GRACE_HOURS is exported as 2", score.FRESHNESS_GRACE_HOURS === 2);
const cacheDetail = okv(all.efficiency)?.components.find((c) => c.key === "cacheHit")?.detail ?? "";
check("cache-hit detail reads like the brief's example", cacheDetail.includes("cache hit 99.6 % → 100") && cacheDetail.includes("≥ 99 % is 100"), cacheDetail);

/* --------------------------------------------------- 2. one sub-score n/a */

const noBudget = score.computeHealthScore(fixture({ budgetBytes: na("no budget defined — set SYSTEM_HEALTH_DB_BUDGET_GB or document the plan") }), NO_HISTORY);
check("no budget: consumption is n/a and names the reason", !noBudget.consumption.ok && noBudget.consumption.reason.includes("no budget defined"), noBudget.consumption.reason);
check("no budget: composite renormalises over the other three → 100, measured 3",
  noBudget.composite.ok && noBudget.composite.value.score === 100 && noBudget.composite.value.measured === 3, JSON.stringify(noBudget.composite));

const partialEff = score.computeHealthScore(fixture({
  dbStats: ok({ xactCommit: 100000, xactRollback: 500, cacheHitPct: null, deadlocks: 0, statsReset: null }),
  dbLatencyMs: ok(275),
}), NO_HISTORY);
const pe = okv(partialEff.efficiency);
check("renormalisation inside a sub-score: cache hit excluded (undefined), latency 275 ms → 50; mean of 100, 100, 50 = 83.3 → 83",
  pe?.score === 83 && pe.components.find((c) => c.key === "cacheHit")?.points === null && pe.components.find((c) => c.key === "cacheHit")?.excludedReason,
  `score=${pe?.score} cacheHit=${JSON.stringify(pe?.components.find((c) => c.key === "cacheHit"))}`);

const deadlocked = score.computeHealthScore(fixture({ dbStats: ok({ xactCommit: 100000, xactRollback: 500, cacheHitPct: 99.6, deadlocks: 2, statsReset: null }) }), NO_HISTORY);
check("deadlocks > 0 subtract 10 after the mean: 100 → 90", okv(deadlocked.efficiency)?.score === 90, String(okv(deadlocked.efficiency)?.score));

/* -------------------------------------------------------------- 3. the cap */

const capped = score.computeHealthScore(fixture({
  rls: ok({ total: 56, enabled: 5, off: [], lockedNoPolicy: [] }),
  usersWithoutRole: ok(4),
  envFlags: ["A", "B", "C", "D", "E"].map((name) => ({ name, set: false })),
  headers: ok({ url: "u", status: 200, checks: [{ name: "x-frame-options", expected: "DENY", observed: null }] }),
}), NO_HISTORY);
check("cap case: security = round((8.9·50 + 0·20 + 0·15 + 0·15) ÷ 100) = 4", okv(capped.security)?.score === 4, String(okv(capped.security)?.score));
check("cap case: weighted mean 68.6 → 69 is capped to 49 because security < 25; capApplied true; weakest security",
  capped.composite.ok && capped.composite.value.score === 49 && capped.composite.value.capApplied && capped.composite.value.weakest === "security",
  JSON.stringify(capped.composite));

const lowButUncapped = score.computeHealthScore(fixture({ usersWithoutRole: ok(2) }), NO_HISTORY);
check("a sub-score at 90 (2 users → 50 × 20 %) does not trigger the cap", lowButUncapped.composite.ok && !lowButUncapped.composite.value.capApplied && lowButUncapped.composite.value.score === 94,
  JSON.stringify(lowButUncapped.composite));

/* ------------------------------------------- 4. fewer than two measurable */

const down = score.computeHealthScore({
  ...fixture({ freshness: null, efficiency: null, consumption: null }),
  dbError: "connect ETIMEDOUT",
  security: { ...fixture().security, usersWithoutRole: na("database unreachable"), rls: na("database unreachable") },
}, NO_HISTORY);
check("database down: freshness, efficiency, consumption are n/a naming dbError",
  !down.freshness.ok && down.freshness.reason.includes("ETIMEDOUT") && !down.efficiency.ok && !down.consumption.ok, down.freshness.reason);
check("database down: security still measurable from env + headers alone (renormalised)", down.security.ok && okv(down.security).score === 100);
check("database down: composite n/a — only 1 of 4 measurable", !down.composite.ok && down.composite.reason.startsWith("only 1 of 4"), down.composite.reason);

const noSla = score.computeHealthScore(fixture({ sources: [{ source: "asana", lastRun: ok(null), raw: ok({ count: 0, lastFetchedAt: null }) }] }), NO_HISTORY);
check("no connector with an SLA → freshness n/a with the reason", !noSla.freshness.ok && noSla.freshness.reason.includes("no connector has a documented schedule"), noSla.freshness.reason);

/* ------------------------------------------------------ 5. freshness rules */

const fresh = (lastRun, runs30d) => okv(score.computeHealthScore(fixture({
  sources: [{ source: "trackingtime", lastRun, raw: ok({ count: 0, lastFetchedAt: null }) }], runs30d,
}), NO_HISTORY).freshness)?.score;
check("freshness: ok run 25.5 h old (within SLA + 2 h grace) → 100", fresh(ok(run("ok", 25.5))) === 100);
check("freshness: ok run 26.1 h old (past the grace) → 50", fresh(ok(run("ok", 26.1))) === 50);
check("freshness: ok run 30 h old (≤ 2×SLA) → 50", fresh(ok(run("ok", 30))) === 50);
check("freshness: ok run 50 h old (> 2×SLA) → 0", fresh(ok(run("ok", 50))) === 0);
check("freshness: failed latest run → 0", fresh(ok(run("failed", 1))) === 0);
check("freshness: never run with an SLA → 0", fresh(ok(null)) === 0);
check("freshness: running for 7 h (> 6 h) → 0", fresh(ok(run("running", 7))) === 0);
check("freshness: running for 1 h, previous ok run 5 h ago in runs30d → 100",
  fresh(ok(run("running", 1)), ok([{ source: "trackingtime", ...run("running", 1) }, { source: "trackingtime", ...run("ok", 5) }])) === 100);
check("freshness: running for 1 h with no ok run in 30 days → 0", fresh(ok(run("running", 1)), ok([])) === 0);
check("freshness: latest run unreadable → excluded, sub-score n/a", fresh(na("permission denied")) === undefined);

/* ---------------------------------------------------- 6. reconciliation */

for (const [name, hs] of [["all-ok", all], ["no budget", noBudget], ["partial efficiency", partialEff], ["deadlocked", deadlocked], ["capped", capped]]) {
  for (const key of ["freshness", "efficiency", "security", "consumption"]) {
    const s = hs[key];
    if (!s.ok) continue;
    const recomputed = score.scoreFromComponents(s.value.components);
    check(`${name}: ${key} score ${s.value.score} reconciles with its components`, recomputed === s.value.score, `scoreFromComponents → ${recomputed}`);
    check(`${name}: ${key} points are one-decimal numbers or null`, s.value.components.every((c) => c.points === null || Math.round(c.points * 10) / 10 === c.points));
    check(`${name}: ${key} every component has a non-empty detail`, s.value.components.every((c) => typeof c.detail === "string" && c.detail.length > 10));
  }
  if (hs.composite.ok) {
    const nums = Object.fromEntries(["freshness", "efficiency", "security", "consumption"].map((k) => [k, hs[k].ok ? hs[k].value.score : null]));
    const recomposed = score.composeScores(nums);
    check(`${name}: composite ${hs.composite.value.score} reconciles with composeScores`, recomposed?.score === hs.composite.value.score && recomposed.capApplied === hs.composite.value.capApplied);
  }
}

/* ---------------------------------------------------------------- 7. tone */

check("tone: 80 good, 79 warning, 50 warning, 49 critical, 0 critical",
  all.tone(80) === "good" && all.tone(79) === "warning" && all.tone(50) === "warning" && all.tone(49) === "critical" && all.tone(0) === "critical");

/* ------------------------------------------- 8. the sampler's duplicate */

check("sampler SLA table matches SYNC_SLA (scored sources)",
  JSON.stringify(Object.fromEntries(score.SYNC_SLA.filter((s) => s.slaHours !== null).map((s) => [s.source, s.slaHours]))) === JSON.stringify(sampler.SLA_HOURS),
  JSON.stringify(sampler.SLA_HOURS));
check("sampler budget constant matches DOCUMENTED_DB_BUDGET_BYTES", sampler.DOCUMENTED_DB_BUDGET_BYTES === score.DOCUMENTED_DB_BUDGET_BYTES);
check("sampler weights, cap and running-stale constants match",
  JSON.stringify(sampler.SUBSCORE_WEIGHTS) === JSON.stringify(score.SUBSCORE_WEIGHTS) && sampler.CAP_THRESHOLD === score.CAP_THRESHOLD && sampler.CAP_SCORE === score.CAP_SCORE && sampler.RUNNING_STALE_HOURS === score.RUNNING_STALE_HOURS && sampler.FRESHNESS_GRACE_HOURS === score.FRESHNESS_GRACE_HOURS);

const grid = (name, a, b, inputs) => {
  const bad = inputs.filter((args) => Math.abs(a(...args) - b(...args)) > 1e-9);
  check(`sampler ${name} agrees with health-score on ${inputs.length} inputs`, bad.length === 0, bad.map((x) => JSON.stringify(x)).join(" "));
};
const range = (from, to, step) => Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => [from + i * step]);
grid("mapCacheHit", score.mapCacheHit, sampler.mapCacheHit, range(80, 100, 0.5));
grid("mapLatency", score.mapLatency, sampler.mapLatency, range(0, 600, 10));
grid("mapConnections", score.mapConnections, sampler.mapConnections, range(0, 60, 1).map(([a]) => [a, 60]));
grid("mapRollbackShare", score.mapRollbackShare, sampler.mapRollbackShare, range(0, 1500, 25).map(([r]) => [10000, r]));
grid("mapRunAge", score.mapRunAge, sampler.mapRunAge, range(0, 60, 0.5).map(([h]) => [h, 24]));
grid("mapUsersWithoutRole", score.mapUsersWithoutRole, sampler.mapUsersWithoutRole, range(0, 6, 1));
grid("mapBudgetUse", score.mapBudgetUse, sampler.mapBudgetUse, range(0, 600, 20).map(([mb]) => [mb * 1024 * 1024, 500 * 1024 * 1024]));
grid("mapShare", score.mapShare, sampler.mapShare, range(0, 56, 1).map(([n]) => [n, 56]));

const composeGrid = [];
for (const f of [null, 0, 24, 25, 60, 100]) for (const s of [null, 4, 100]) for (const e of [null, 83]) for (const c of [null, 87]) composeGrid.push({ freshness: f, security: s, efficiency: e, consumption: c });
const composeBad = composeGrid.filter((g) => JSON.stringify(score.composeScores(g)) !== JSON.stringify(sampler.composeScores(g)));
check(`sampler composeScores agrees with health-score on ${composeGrid.length} combinations`, composeBad.length === 0, composeBad.slice(0, 3).map((g) => JSON.stringify(g)).join(" "));

/** The sample the sampler would write for the `all` fixture. */
const sampleOf = (o = {}) => ({
  at: AT, host: "fixture",
  dbLatencyMs: 12, cacheHitPct: 99.6, xactCommit: 100000, xactRollback: 500, deadlocks: 0,
  connActive: 17, connMax: 60, dbSizeBytes: 66088083, dbBudgetBytes: 500 * 1024 * 1024,
  rlsEnabled: 56, rlsTotal: 56, usersWithoutRole: 0,
  sources: [
    { source: "trackingtime", status: "ok", startedAt: hoursAgo(8.1), finishedAt: hoursAgo(8), ageHours: 8, lastOkAgeHours: 8 },
    { source: "factorial", status: null, startedAt: null, finishedAt: null, ageHours: null, lastOkAgeHours: null },
  ],
  ...o,
});
const dbOnlySecurity = (hs) => (hs.security.ok ? score.scoreFromComponents(hs.security.value.components.filter((c) => c.key === "rls" || c.key === "usersWithoutRole")) : null);
const agree = (name, hs, sample) => {
  const ss = sampler.scoreSample(sample);
  const want = { freshness: okv(hs.freshness)?.score ?? null, efficiency: okv(hs.efficiency)?.score ?? null, security: dbOnlySecurity(hs), consumption: okv(hs.consumption)?.score ?? null };
  const got = { freshness: ss.freshness, efficiency: ss.efficiency, security: ss.security, consumption: ss.consumption };
  check(`sampler scoreSample agrees with computeHealthScore (${name})`, JSON.stringify(want) === JSON.stringify(got), `ts=${JSON.stringify(want)} sampler=${JSON.stringify(got)}`);
  const wantComposite = score.composeScores(want);
  check(`sampler composite agrees (${name})`, (wantComposite?.score ?? null) === ss.composite && (wantComposite?.capApplied ?? null) === ss.capApplied, `ts=${wantComposite?.score ?? "n/a"} sampler=${ss.composite ?? "n/a"}`);
};
agree("all-ok", all, sampleOf());
agree("partial efficiency", partialEff, sampleOf({ cacheHitPct: null, dbLatencyMs: 275 }));
agree("deadlocked", deadlocked, sampleOf({ deadlocks: 2 }));
agree("stale run", score.computeHealthScore(fixture({ sources: [{ source: "trackingtime", lastRun: ok(run("ok", 30)), raw: ok({ count: 0, lastFetchedAt: null }) }] }), NO_HISTORY),
  sampleOf({ sources: [{ source: "trackingtime", status: "ok", startedAt: hoursAgo(30.1), finishedAt: hoursAgo(30), ageHours: 30, lastOkAgeHours: 30 }] }));
agree("running with fallback", score.computeHealthScore(fixture({
  sources: [{ source: "trackingtime", lastRun: ok(run("running", 1)), raw: ok({ count: 0, lastFetchedAt: null }) }],
  runs30d: ok([{ source: "trackingtime", ...run("running", 1) }, { source: "trackingtime", ...run("ok", 5) }]),
}), NO_HISTORY), sampleOf({ sources: [{ source: "trackingtime", status: "running", startedAt: hoursAgo(1.1), finishedAt: null, ageHours: 1.1, lastOkAgeHours: 5 }] }));
agree("rls 5/56, 4 users", score.computeHealthScore(fixture({ rls: ok({ total: 56, enabled: 5, off: [], lockedNoPolicy: [] }), usersWithoutRole: ok(4) }), NO_HISTORY),
  sampleOf({ rlsEnabled: 5, usersWithoutRole: 4 }));
agree("database down", { freshness: na("x"), efficiency: na("x"), security: { ok: false, reason: "x" }, consumption: na("x") },
  sampleOf({ dbLatencyMs: null, cacheHitPct: null, xactCommit: null, xactRollback: null, deadlocks: null, connActive: null, connMax: null, dbSizeBytes: null, rlsEnabled: null, rlsTotal: null, usersWithoutRole: null, sources: [] }));

/* ------------------------------------------------------------ 9. history */

const parsed = history.parseHealthSamples([
  JSON.stringify(sampleOf({ at: hoursAgo(30) })),
  "not json at all",
  JSON.stringify({ nope: true }),
  JSON.stringify(sampleOf({ at: hoursAgo(0), dbSizeBytes: 66088083 + 10 * 1024 * 1024 })),
  "",
].join("\n"));
check("history: malformed lines are skipped and counted, samples sorted oldest first", parsed.samples.length === 2 && parsed.skipped === 2 && parsed.samples[0].at === hoursAgo(30), `samples=${parsed.samples.length} skipped=${parsed.skipped}`);
const growth = history.growthPerDay(parsed.samples, "dbSizeBytes");
check("history: growth over 30 h of +10 MB = +8 MB/day", growth.ok && Math.abs(growth.value.perDay - (10 * 1024 * 1024) / (30 / 24)) < 1 && growth.value.samples === 2, JSON.stringify(growth));
const tooClose = history.growthPerDay(history.parseHealthSamples([JSON.stringify(sampleOf({ at: hoursAgo(1) })), JSON.stringify(sampleOf())].join("\n")).samples);
check("history: two samples 1 h apart → growth n/a (needs ≥ 6 h)", !tooClose.ok && tooClose.reason.includes("≥ 6 h"), tooClose.reason);
check("history: one sample → growth n/a", !history.growthPerDay(parsed.samples.slice(0, 1)).ok);
check("history: latestSamples returns newest first", history.latestSamples(ok({ path: "x", samples: parsed.samples, skipped: 0 }), 5)[0].at === hoursAgo(0));
check("history: latestSamples on n/a history is empty", history.latestSamples(NO_HISTORY, 5).length === 0);
const withGrowth = score.computeHealthScore(fixture(), ok({ path: "x", samples: parsed.samples, skipped: 0 }));
check("consumption detail carries the growth sentence when history exists", /growth \+8 MB\/day over 2 samples/.test(okv(withGrowth.consumption)?.components[0].detail ?? ""), okv(withGrowth.consumption)?.components[0].detail);

const pruned = sampler.pruneLines([JSON.stringify({ at: hoursAgo(24 * 91) }), JSON.stringify({ at: hoursAgo(1) }), "garbage", ""], Date.parse(AT));
check("sampler prune: drops lines older than 90 days and malformed ones, keeps the rest", pruned.kept.length === 1 && pruned.old === 1 && pruned.malformed === 1, JSON.stringify({ kept: pruned.kept.length, old: pruned.old, malformed: pruned.malformed }));

/* ------------------------------------------------------------- verdict */

console.log(`\nHEALTH SCORE: ${failed === 0 ? "formulas match the brief, drill-downs reconcile, sampler agrees" : `${failed} check(s) failed`}`);
process.exit(failed === 0 ? 0 : 1);
