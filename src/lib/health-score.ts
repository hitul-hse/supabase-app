/**
 * The health score for /admin/system-health. Pure functions, no I/O.
 *
 * THE CONTRACT
 * ------------
 * docs/proposals/system-health-redesign.md, "Score model" (decision C):
 *
 *   composite = weighted mean of the MEASURABLE sub-scores
 *               (Freshness 30, Security 30, Efficiency 20, Consumption 20,
 *                weights renormalised over the sub-scores that are ok),
 *               capped at 49 while any measurable sub-score is below 25,
 *               n/a when fewer than two sub-scores are measurable.
 *
 * Every sub-score lists its components -- including the ones it excluded and
 * why -- and every component's `detail` is a human sentence stating the input
 * value and the mapping, because the drill-down shows it verbatim. The score a
 * sub-score shows is `scoreFromComponents(components)`: rounding happens once,
 * at the end, so the arithmetic on the drill-down reconciles exactly with the
 * number in the hero. scripts/check-health-score.mjs pins that.
 *
 * The same formulas are duplicated in scripts/sample-system-health.mjs so the
 * hourly history agrees with the live page; the gate asserts the two agree.
 * This file is the source of truth.
 *
 * WHY PURE
 * --------
 * `computeHealthScore(health, history)` takes the snapshot the page already
 * fetched and the history it already read. It never looks at the clock (ages
 * are measured against `health.sampledAt`), so the same inputs always give the
 * same score, and the gate can pin behaviour with fixtures.
 */
import type { Metric, SystemHealth, SyncRun } from "./queries/system-health";
import type { HealthHistory } from "./health-history";
import { growthPerDay } from "./health-history";

// ─── Sync SLAs (the evidence for every number) ───────────────────────────────

export type SourceSla = {
  source: string;
  /** Hours between scheduled runs; null when nothing schedules this source. */
  slaHours: number | null;
  /** Where the schedule (or its absence) was read, so anyone can re-check it. */
  evidence: string;
};

/**
 * The documented schedule of each connector, read on 2026-09-02 from the
 * workflows, the user systemd timers, the crontab and the vault.
 *
 * - `.github/workflows/sync-trackingtime.yml:16-20` -- `schedule: cron: "17 4 * * *"`,
 *   i.e. daily at 04:17 UTC. Restated in `docs/MACHINE-TRANSFER.md:126` ("the
 *   nightly TrackingTime sync at 04:17 UTC") and asserted by
 *   `scripts/check-sync-schedule-alive.mjs` (a scheduled run lands 03:00-09:00
 *   UTC with a ≤ 7-day window; the gate fails after two missed cycles).
 *   The vault agrees: `20 HSE Hub/Number definitions.md:15`.
 * - `scripts/sync-factorial-identity.mjs` exists but is only invoked by hand
 *   (`package.json` → `sync:factorial-identity`); no workflow, no
 *   `~/.config/systemd/user/*.timer` (only llm-lab and night-shift exist),
 *   `crontab -l` is empty. So: no SLA.
 * - asana, samdock: named in raw.sync_run's check constraint
 *   (`supabase/schema.sql:1742`) but no sync script writes them. No SLA.
 * - lexware: joined the customer-master constraints on 2026-08-22
 *   (`supabase/migrations/20260822*`), no sync script. No SLA.
 *
 * A source with `slaHours: null` is listed in the Freshness drill-down but
 * does not enter the score: scoring "never scheduled" as "late" would make
 * the composite red for a connector nobody has promised to run.
 */
export const SYNC_SLA: readonly SourceSla[] = [
  {
    source: "trackingtime",
    slaHours: 24,
    evidence: ".github/workflows/sync-trackingtime.yml:20 cron \"17 4 * * *\" (daily 04:17 UTC); docs/MACHINE-TRANSFER.md:126; scripts/check-sync-schedule-alive.mjs",
  },
  {
    source: "factorial",
    slaHours: null,
    evidence: "scripts/sync-factorial-identity.mjs runs by hand only (package.json sync:factorial-identity); no workflow, systemd timer or crontab schedules it",
  },
  {
    source: "asana",
    slaHours: null,
    evidence: "no sync script; raw.sync_run's check constraint admits the source (supabase/schema.sql:1742) but nothing writes it",
  },
  {
    source: "samdock",
    slaHours: null,
    evidence: "no sync script; raw.sync_run's check constraint admits the source (supabase/schema.sql:1742) but nothing writes it",
  },
  {
    source: "lexware",
    slaHours: null,
    evidence: "customer-master source since 2026-08-22 (supabase/migrations/20260822*); no sync script",
  },
];

export function slaFor(source: string): SourceSla {
  return SYNC_SLA.find((s) => s.source === source) ?? {
    source,
    slaHours: null,
    evidence: "no documented schedule for this source (not in SYNC_SLA in src/lib/health-score.ts)",
  };
}

// ─── Disk budget ─────────────────────────────────────────────────────────────

/**
 * The Supabase plan's database-size limit.
 *
 * The only plan statement in the repo or the vault is
 * `docs/superpowers/specs/2026-08-16-real-hub-replacement-design.md:32`:
 * "Everything ships on the current free tier (Supabase Cloud + Vercel)". The
 * Free plan's database limit is 500 MB (supabase.com/pricing); the live
 * database measured 63 MB on 2026-09-02, consistent with that plan. Nothing
 * in `~/vault/HSE-Hub` records an upgrade. Because that document is dated and
 * a plan can change without a commit, `SYSTEM_HEALTH_DB_BUDGET_GB` overrides
 * this constant when set (see readBudget in queries/system-health.ts).
 */
export const DOCUMENTED_DB_BUDGET_BYTES = 500 * 1024 * 1024;
export const DOCUMENTED_DB_BUDGET_SOURCE =
  "docs/superpowers/specs/2026-08-16-real-hub-replacement-design.md:32 (Supabase free tier → 500 MB database limit)";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ScoreComponent = {
  key: string;
  label: string;
  /** 0-100 (one decimal), a negative adjustment when weight is 0, or null when excluded. */
  points: number | null;
  /** Share in the weighted mean. 0 marks an adjustment added after the mean (the deadlock penalty). */
  weight: number;
  /** Input value and mapping, in one human sentence. Shown verbatim. */
  detail: string;
  excludedReason?: string;
};

export type SubScore = Metric<{ score: number; components: ScoreComponent[] }>;

export type SubScoreKey = "freshness" | "efficiency" | "security" | "consumption";

export type Tone = "good" | "warning" | "critical";

export type CompositeScore = {
  score: number;
  /** The measurable sub-score with the lowest score (ties: first in weight order). */
  weakest: SubScoreKey;
  /** True while any measurable sub-score is below 25: the composite is then min(mean, 49). */
  capApplied: boolean;
  /** How many of the four sub-scores were measurable. */
  measured: number;
};

export type HealthScore = {
  composite: Metric<CompositeScore>;
  freshness: SubScore;
  efficiency: SubScore;
  security: SubScore;
  consumption: SubScore;
  tone: (score: number) => Tone;
};

/** Weights of the composite, in the order ties are broken. */
export const SUBSCORE_WEIGHTS: readonly { key: SubScoreKey; weight: number }[] = [
  { key: "freshness", weight: 30 },
  { key: "security", weight: 30 },
  { key: "efficiency", weight: 20 },
  { key: "consumption", weight: 20 },
];

export const CAP_THRESHOLD = 25;
export const CAP_SCORE = 49;
export const RUNNING_STALE_HOURS = 6;

// ─── Mappings (each one is a sentence in the brief) ──────────────────────────

/**
 * Piecewise-linear through `anchors` ([x, y] pairs, any order), flat beyond
 * the outermost anchors. Every "≥ a → 100, b → 50, ≤ c → 0, linear between"
 * rule in the brief is one call to this.
 */
export function interpolate(x: number, anchors: readonly (readonly [number, number])[]): number {
  const pts = [...anchors].sort((a, b) => a[0] - b[0]);
  if (x <= pts[0][0]) return pts[0][1];
  const last = pts[pts.length - 1];
  if (x >= last[0]) return last[1];
  for (let i = 0; i + 1 < pts.length; i += 1) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    if (x >= x0 && x <= x1) return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
  }
  return last[1];
}

/** Buffer cache hit %: ≥ 99 → 100, 95 → 50, ≤ 90 → 0. */
export const mapCacheHit = (pct: number): number => interpolate(pct, [[90, 0], [95, 50], [99, 100]]);
/** Connections in use as % of max: ≤ 50 → 100, ≥ 90 → 0. */
export const mapConnections = (active: number, max: number): number => interpolate((active / max) * 100, [[50, 100], [90, 0]]);
/** Rollback share % of all transactions: ≤ 1 → 100, ≥ 10 → 0. */
export const mapRollbackShare = (commits: number, rollbacks: number): number =>
  interpolate((rollbacks / (commits + rollbacks)) * 100, [[1, 100], [10, 0]]);
/** DB round trip in ms: ≤ 50 → 100, ≥ 500 → 0. */
export const mapLatency = (ms: number): number => interpolate(ms, [[50, 100], [500, 0]]);
/** Age of the last ok run against the SLA: ≤ SLA → 100, ≤ 2×SLA → 50, older → 0. */
export const mapRunAge = (ageHours: number, slaHours: number): number =>
  ageHours <= slaHours ? 100 : ageHours <= 2 * slaHours ? 50 : 0;
/** enabled ÷ total × 100. */
export const mapShare = (part: number, whole: number): number => (part / whole) * 100;
/** 0 users → 100, each user −25, floor 0. */
export const mapUsersWithoutRole = (n: number): number => Math.max(0, 100 - 25 * n);
/** 100 − used %, floor 0. */
export const mapBudgetUse = (bytes: number, budgetBytes: number): number => Math.max(0, 100 - (bytes / budgetBytes) * 100);

const round1 = (n: number): number => Math.round(n * 10) / 10;
const fmt = (n: number, dp = 1): string => n.toLocaleString("en-GB", { maximumFractionDigits: dp });
const fmtMb = (bytes: number): string => `${fmt(bytes / 1024 / 1024, 1)} MB`;

/**
 * The one reconciliation rule: round(Σ points×weight ÷ Σ weight over the
 * measurable weighted components) + Σ points of the weight-0 adjustments,
 * clamped to 0-100. Null when nothing weighted was measurable.
 */
export function scoreFromComponents(components: readonly ScoreComponent[]): number | null {
  const weighted = components.filter((c) => c.points !== null && c.weight > 0);
  if (weighted.length === 0) return null;
  const sumW = weighted.reduce((a, c) => a + c.weight, 0);
  const mean = weighted.reduce((a, c) => a + (c.points as number) * c.weight, 0) / sumW;
  const adjustments = components
    .filter((c) => c.points !== null && c.weight === 0)
    .reduce((a, c) => a + (c.points as number), 0);
  return Math.max(0, Math.min(100, Math.round(mean + adjustments)));
}

/**
 * The composite from four (possibly null) sub-scores. Exported so the sampler
 * gate can assert its duplicate agrees on a grid of inputs.
 */
export function composeScores(scores: Record<SubScoreKey, number | null>): CompositeScore | null {
  const measured = SUBSCORE_WEIGHTS.filter((w) => scores[w.key] !== null);
  if (measured.length < 2) return null;
  const sumW = measured.reduce((a, w) => a + w.weight, 0);
  const mean = measured.reduce((a, w) => a + (scores[w.key] as number) * w.weight, 0) / sumW;
  const capApplied = measured.some((w) => (scores[w.key] as number) < CAP_THRESHOLD);
  const rounded = Math.round(mean);
  let weakest = measured[0];
  for (const w of measured) if ((scores[w.key] as number) < (scores[weakest.key] as number)) weakest = w;
  return {
    score: capApplied ? Math.min(rounded, CAP_SCORE) : rounded,
    weakest: weakest.key,
    capApplied,
    measured: measured.length,
  };
}

export function scoreTone(score: number): Tone {
  return score >= 80 ? "good" : score >= 50 ? "warning" : "critical";
}

// ─── Sub-scores ──────────────────────────────────────────────────────────────

function subScore(components: ScoreComponent[], naReason: string): SubScore {
  const score = scoreFromComponents(components);
  if (score === null) return { ok: false, reason: naReason };
  return { ok: true, value: { score, components } };
}

const hoursBetween = (fromIso: string, toIso: string): number => (Date.parse(toIso) - Date.parse(fromIso)) / 3_600_000;

function freshnessScore(health: SystemHealth): SubScore {
  const f = health.freshness;
  if (!f) return { ok: false, reason: `database unreachable — ${health.dbError ?? "no snapshot"}` };
  const runs30d = f.runs30d;
  const components: ScoreComponent[] = f.sources.map((s): ScoreComponent => {
    const sla = f.sla.find((x) => x.source === s.source) ?? slaFor(s.source);
    const base = { key: `source:${s.source}`, label: s.source, weight: 1 };
    if (sla.slaHours === null) {
      return { ...base, points: null, detail: `no documented schedule — listed, not scored (${sla.evidence})`, excludedReason: "no documented SLA" };
    }
    const rule = `(≤ SLA is 100, ≤ 2×SLA is 50, older is 0; SLA ${sla.slaHours} h from ${sla.evidence.split(";")[0]})`;
    if (!s.lastRun.ok) {
      return { ...base, points: null, detail: `latest run could not be read: ${s.lastRun.reason}`, excludedReason: s.lastRun.reason };
    }
    const run: SyncRun | null = s.lastRun.value;
    if (run === null) {
      return { ...base, points: 0, detail: `never run, SLA ${sla.slaHours} h → 0 (a scheduled connector with no run at all scores 0)` };
    }
    if (run.status === "failed") {
      const age = hoursBetween(run.finishedAt ?? run.startedAt, health.sampledAt);
      return { ...base, points: 0, detail: `latest run failed ${fmt(age)} h ago (${run.entity}${run.errorMessage ? `: ${run.errorMessage.slice(0, 80)}` : ""}) → 0 (a failed latest run scores 0)` };
    }
    if (run.status === "running") {
      const runningFor = hoursBetween(run.startedAt, health.sampledAt);
      if (runningFor > RUNNING_STALE_HOURS) {
        return { ...base, points: 0, detail: `latest run has been running for ${fmt(runningFor)} h (> ${RUNNING_STALE_HOURS} h) → 0 (a run that never finishes counts as dead)` };
      }
      const lastOk = runs30d.ok ? runs30d.value.find((r) => r.source === s.source && r.status === "ok") : undefined;
      if (!lastOk) {
        return { ...base, points: 0, detail: `latest run is in flight (${fmt(runningFor)} h) and no ok run exists in the last 30 days to fall back on → 0` };
      }
      const age = hoursBetween(lastOk.finishedAt ?? lastOk.startedAt, health.sampledAt);
      const points = mapRunAge(age, sla.slaHours);
      return { ...base, points, detail: `latest run is in flight (${fmt(runningFor)} h); previous ok run finished ${fmt(age)} h ago vs SLA ${sla.slaHours} h → ${points} ${rule}` };
    }
    const age = hoursBetween(run.finishedAt ?? run.startedAt, health.sampledAt);
    const points = mapRunAge(age, sla.slaHours);
    return { ...base, points, detail: `last ok run (${run.entity}, ${run.recordCount ?? "?"} records) finished ${fmt(age)} h ago vs SLA ${sla.slaHours} h → ${points} ${rule}` };
  });
  const scheduled = components.filter((c) => c.excludedReason !== "no documented SLA");
  const naReason = scheduled.length === 0
    ? "no connector has a documented schedule — nothing to measure against"
    : `no scheduled connector could be read: ${scheduled.map((c) => c.excludedReason).filter(Boolean).join("; ")}`;
  return subScore(components, naReason);
}

function efficiencyScore(health: SystemHealth): SubScore {
  const e = health.efficiency;
  if (!e) return { ok: false, reason: `database unreachable — ${health.dbError ?? "no snapshot"}` };
  const components: ScoreComponent[] = [];

  if (!e.dbStats.ok) {
    components.push({ key: "cacheHit", label: "Buffer cache hit", weight: 1, points: null, detail: `pg_stat_database could not be read: ${e.dbStats.reason}`, excludedReason: e.dbStats.reason });
    components.push({ key: "rollbackShare", label: "Rollback share", weight: 1, points: null, detail: `pg_stat_database could not be read: ${e.dbStats.reason}`, excludedReason: e.dbStats.reason });
    components.push({ key: "deadlocks", label: "Deadlock penalty", weight: 0, points: null, detail: `pg_stat_database could not be read: ${e.dbStats.reason}`, excludedReason: e.dbStats.reason });
  } else {
    const st = e.dbStats.value;
    if (st.cacheHitPct === null) {
      components.push({ key: "cacheHit", label: "Buffer cache hit", weight: 1, points: null, detail: "no block reads or hits since stats reset — cache hit is undefined", excludedReason: "no block activity since stats reset" });
    } else {
      const points = round1(mapCacheHit(st.cacheHitPct));
      components.push({ key: "cacheHit", label: "Buffer cache hit", weight: 1, points, detail: `cache hit ${fmt(st.cacheHitPct)} % → ${fmt(points)} (≥ 99 % is 100, 95 % is 50, ≤ 90 % is 0, linear between)` });
    }
    const total = st.xactCommit + st.xactRollback;
    if (total === 0) {
      components.push({ key: "rollbackShare", label: "Rollback share", weight: 1, points: null, detail: "no transactions since stats reset — rollback share is undefined", excludedReason: "no transactions since stats reset" });
    } else {
      const share = (st.xactRollback / total) * 100;
      const points = round1(mapRollbackShare(st.xactCommit, st.xactRollback));
      components.push({ key: "rollbackShare", label: "Rollback share", weight: 1, points, detail: `${fmt(st.xactRollback, 0)} rollbacks of ${fmt(total, 0)} transactions = ${fmt(share, 2)} % → ${fmt(points)} (≤ 1 % is 100, ≥ 10 % is 0, linear between)` });
    }
    const penalty = st.deadlocks > 0 ? -10 : 0;
    components.push({ key: "deadlocks", label: "Deadlock penalty", weight: 0, points: penalty, detail: st.deadlocks > 0
      ? `${fmt(st.deadlocks, 0)} deadlock${st.deadlocks === 1 ? "" : "s"} since stats reset${st.statsReset ? ` (${st.statsReset})` : ""} → −10 after the mean, floored at 0`
      : `no deadlocks since stats reset${st.statsReset ? ` (${st.statsReset})` : ""} → no penalty` });
  }

  if (!e.connections.ok) {
    components.push({ key: "connections", label: "Connections in use", weight: 1, points: null, detail: `pg_stat_activity could not be read: ${e.connections.reason}`, excludedReason: e.connections.reason });
  } else {
    const { active, max } = e.connections.value;
    const pct = (active / max) * 100;
    const points = round1(mapConnections(active, max));
    components.push({ key: "connections", label: "Connections in use", weight: 1, points, detail: `${active} of ${max} connections = ${fmt(pct)} % → ${fmt(points)} (≤ 50 % is 100, ≥ 90 % is 0, linear between)` });
  }

  if (!e.dbLatencyMs.ok) {
    components.push({ key: "latency", label: "DB round trip", weight: 1, points: null, detail: `latency probe failed: ${e.dbLatencyMs.reason}`, excludedReason: e.dbLatencyMs.reason });
  } else {
    const ms = e.dbLatencyMs.value;
    const points = round1(mapLatency(ms));
    components.push({ key: "latency", label: "DB round trip", weight: 1, points, detail: `median of 3 round trips ${fmt(ms)} ms → ${fmt(points)} (≤ 50 ms is 100, ≥ 500 ms is 0, linear between)` });
  }

  return subScore(components, `no efficiency input could be measured: ${components.map((c) => c.excludedReason).filter(Boolean).join("; ")}`);
}

function securityScore(health: SystemHealth): SubScore {
  const s = health.security;
  const components: ScoreComponent[] = [];

  if (!s.rls.ok) {
    components.push({ key: "rls", label: "RLS coverage", weight: 50, points: null, detail: `pg_class could not be read: ${s.rls.reason}`, excludedReason: s.rls.reason });
  } else if (s.rls.value.total === 0) {
    components.push({ key: "rls", label: "RLS coverage", weight: 50, points: null, detail: "no tables in the app schemas — coverage is undefined", excludedReason: "no app-schema tables" });
  } else {
    const { enabled, total, lockedNoPolicy } = s.rls.value;
    const points = round1(mapShare(enabled, total));
    const locked = lockedNoPolicy.length;
    components.push({ key: "rls", label: "RLS coverage", weight: 50, points, detail: `RLS on for ${enabled} of ${total} app-schema tables → ${fmt(points)} (enabled ÷ total × 100)${locked ? `; ${locked} table${locked === 1 ? "" : "s"} on with zero policies (locked to the service role) — shown, not penalised` : ""}` });
  }

  if (!s.usersWithoutRole.ok) {
    components.push({ key: "usersWithoutRole", label: "Users without a role", weight: 20, points: null, detail: `auth.users could not be read: ${s.usersWithoutRole.reason}`, excludedReason: s.usersWithoutRole.reason });
  } else {
    const n = s.usersWithoutRole.value;
    const points = round1(mapUsersWithoutRole(n));
    components.push({ key: "usersWithoutRole", label: "Users without a role", weight: 20, points, detail: `${n} signed-in-capable user${n === 1 ? "" : "s"} without an app_user_profile → ${fmt(points)} (0 users is 100, each user −25, floor 0)` });
  }

  const envSet = s.envFlags.filter((f) => f.set).length;
  const envTotal = s.envFlags.length;
  if (envTotal === 0) {
    components.push({ key: "env", label: "Env presence", weight: 15, points: null, detail: "no expected env vars listed", excludedReason: "no expected env vars" });
  } else {
    const points = round1(mapShare(envSet, envTotal));
    const missing = s.envFlags.filter((f) => !f.set).map((f) => f.name);
    components.push({ key: "env", label: "Env presence", weight: 15, points, detail: `${envSet} of ${envTotal} expected env vars set → ${fmt(points)} (set ÷ expected × 100)${missing.length ? `; missing: ${missing.join(", ")}` : ""}` });
  }

  if (!s.headers.ok) {
    components.push({ key: "headers", label: "Response headers", weight: 15, points: null, detail: `header self-check did not run: ${s.headers.reason}`, excludedReason: s.headers.reason });
  } else {
    const checks = s.headers.value.checks;
    const passed = checks.filter((c) => (c.expected === null ? c.observed !== null : (c.observed ?? "").toLowerCase() === c.expected.toLowerCase()));
    const failed = checks.filter((c) => !passed.includes(c)).map((c) => c.name);
    const points = round1(mapShare(passed.length, checks.length));
    components.push({ key: "headers", label: "Response headers", weight: 15, points, detail: `${passed.length} of ${checks.length} headers as expected on ${s.headers.value.url} (HTTP ${s.headers.value.status}) → ${fmt(points)} (pass ÷ checked × 100)${failed.length ? `; failing: ${failed.join(", ")}` : ""}` });
  }

  return subScore(components, `no security input could be measured: ${components.map((c) => c.excludedReason).filter(Boolean).join("; ")}`);
}

function consumptionScore(health: SystemHealth, history: HealthHistory): SubScore {
  const c = health.consumption;
  if (!c) return { ok: false, reason: `database unreachable — ${health.dbError ?? "no snapshot"}` };
  if (!c.budgetBytes.ok) return { ok: false, reason: `n/a — ${c.budgetBytes.reason}` };
  if (!c.dbSize.ok) return { ok: false, reason: `database size could not be read: ${c.dbSize.reason}` };
  const bytes = c.dbSize.value.bytes;
  const budget = c.budgetBytes.value;
  const used = (bytes / budget) * 100;
  const points = round1(mapBudgetUse(bytes, budget));
  const growth = history.ok ? growthPerDay(history.value.samples, "dbSizeBytes") : history;
  const growthText = growth.ok
    ? `growth ${growth.value.perDay >= 0 ? "+" : "−"}${fmtMb(Math.abs(growth.value.perDay))}/day over ${growth.value.samples} samples (${fmt(growth.value.spanHours)} h)`
    : `growth n/a — ${growth.reason}`;
  const components: ScoreComponent[] = [{
    key: "budgetUse",
    label: "Database size vs budget",
    weight: 1,
    points,
    detail: `database ${c.dbSize.value.pretty} of ${fmtMb(budget)} budget = ${fmt(used)} % used → ${fmt(points)} (100 − used %, floor 0; budget from ${c.budgetSource}); ${growthText}`,
  }];
  return subScore(components, "database size could not be measured");
}

// ─── The whole score ─────────────────────────────────────────────────────────

export function computeHealthScore(health: SystemHealth, history: HealthHistory): HealthScore {
  const freshness = freshnessScore(health);
  const efficiency = efficiencyScore(health);
  const security = securityScore(health);
  const consumption = consumptionScore(health, history);
  const subs = { freshness, efficiency, security, consumption };
  const numbers: Record<SubScoreKey, number | null> = {
    freshness: freshness.ok ? freshness.value.score : null,
    efficiency: efficiency.ok ? efficiency.value.score : null,
    security: security.ok ? security.value.score : null,
    consumption: consumption.ok ? consumption.value.score : null,
  };
  const composed = composeScores(numbers);
  const composite: Metric<CompositeScore> = composed
    ? { ok: true, value: composed }
    : {
        ok: false,
        reason: `only ${SUBSCORE_WEIGHTS.filter((w) => numbers[w.key] !== null).length} of 4 sub-scores measurable (need 2): ${
          SUBSCORE_WEIGHTS.filter((w) => numbers[w.key] === null).map((w) => { const s = subs[w.key]; return `${w.key}: ${s.ok ? "" : s.reason}`; }).join("; ")}`,
      };
  return { composite, freshness, efficiency, security, consumption, tone: scoreTone };
}
