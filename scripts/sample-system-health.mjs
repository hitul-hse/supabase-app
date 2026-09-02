#!/usr/bin/env node
/**
 * Append one health sample for /admin/system-health.
 *
 * WHAT IT DOES
 * ------------
 * Runs the same read-only SQL as src/lib/queries/system-health.ts (latency
 * probe first and alone, then pg_stat_database, pg_stat_activity,
 * pg_database_size, RLS counts, users without a role, the latest raw.sync_run
 * row per source) and appends ONE JSON line matching `HealthSample` in
 * src/lib/health-history.ts to the samples file, pruning lines older than 90
 * days on the way. The page reads that file for its history charts.
 *
 * WHERE IT RUNS
 * -------------
 * On the rig, hourly (`hse-health-sample.timer`) and once per night-shift
 * cycle, from a copy at ~/.night-shift/health-sample.mjs. It therefore depends
 * on nothing in the repo: only `pg` (present in ~/.night-shift/node_modules
 * and in the repo's) and Node built-ins. SUPABASE_DB_URL comes from the
 * environment, else from ~/code/ui-rework/.env.local -- the same source
 * ~/.night-shift/truth-check.mjs uses. `SYSTEM_HEALTH_SAMPLES` overrides the
 * output path; `SYSTEM_HEALTH_DB_BUDGET_GB` overrides the disk budget.
 *
 * THE SCORE FORMULAS ARE A COPY
 * -----------------------------
 * src/lib/health-score.ts is the source of truth. It is not imported here
 * because the rig copy must keep working after the feature worktree is gone,
 * and because the TS module's own imports resolve through the repo. Every
 * function under "mirrors of health-score.ts" is duplicated verbatim in
 * meaning, and scripts/check-health-score.mjs asserts the two agree on a grid
 * of inputs and on fixtures. Change one, change both, run the gate.
 *
 * FAILURE RULES
 * -------------
 * A single failed read never fails the process: the field is null and
 * `reasons[field]` says why. Only "could not connect at all" or "could not
 * write the file" exit non-zero (so the systemd unit shows red), and even
 * then the connect failure is written as a sample first, so downtime is
 * visible in history instead of being a gap.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "pg";

// ─── mirrors of health-score.ts (source of truth: src/lib/health-score.ts) ───

/** SYNC_SLA, scored sources only. trackingtime: .github/workflows/sync-trackingtime.yml:20 cron "17 4 * * *". */
export const SLA_HOURS = { trackingtime: 24 };
/** DOCUMENTED_DB_BUDGET_BYTES: docs/superpowers/specs/2026-08-16-real-hub-replacement-design.md:32 (free tier → 500 MB). */
export const DOCUMENTED_DB_BUDGET_BYTES = 500 * 1024 * 1024;
export const SUBSCORE_WEIGHTS = [
  { key: "freshness", weight: 30 },
  { key: "security", weight: 30 },
  { key: "efficiency", weight: 20 },
  { key: "consumption", weight: 20 },
];
export const CAP_THRESHOLD = 25;
export const CAP_SCORE = 49;
export const RUNNING_STALE_HOURS = 6;
/** FRESHNESS_GRACE_HOURS: GitHub cron runs up to 90 min late. */
export const FRESHNESS_GRACE_HOURS = 2;
export const RETENTION_DAYS = 90;

export function interpolate(x, anchors) {
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
export const mapCacheHit = (pct) => interpolate(pct, [[90, 0], [95, 50], [99, 100]]);
export const mapConnections = (active, max) => interpolate((active / max) * 100, [[50, 100], [90, 0]]);
export const mapRollbackShare = (commits, rollbacks) => interpolate((rollbacks / (commits + rollbacks)) * 100, [[1, 100], [10, 0]]);
export const mapLatency = (ms) => interpolate(ms, [[50, 100], [500, 0]]);
export const mapRunAge = (ageHours, slaHours) => (ageHours <= slaHours + FRESHNESS_GRACE_HOURS ? 100 : ageHours <= 2 * slaHours ? 50 : 0);
export const mapShare = (part, whole) => (part / whole) * 100;
export const mapUsersWithoutRole = (n) => Math.max(0, 100 - 25 * n);
export const mapBudgetUse = (bytes, budgetBytes) => Math.max(0, 100 - (bytes / budgetBytes) * 100);
const round1 = (n) => Math.round(n * 10) / 10;

/** scoreFromComponents: round(Σ p·w ÷ Σ w) + Σ weight-0 adjustments, clamped 0-100; null when nothing weighted. */
export function scoreFromComponents(components) {
  const weighted = components.filter((c) => c.points !== null && c.weight > 0);
  if (weighted.length === 0) return null;
  const sumW = weighted.reduce((a, c) => a + c.weight, 0);
  const mean = weighted.reduce((a, c) => a + c.points * c.weight, 0) / sumW;
  const adjustments = components.filter((c) => c.points !== null && c.weight === 0).reduce((a, c) => a + c.points, 0);
  return Math.max(0, Math.min(100, Math.round(mean + adjustments)));
}

/** composeScores: weighted mean over measurable sub-scores, cap 49 while any < 25, null when fewer than 2. */
export function composeScores(scores) {
  const measured = SUBSCORE_WEIGHTS.filter((w) => scores[w.key] !== null && scores[w.key] !== undefined);
  if (measured.length < 2) return null;
  const sumW = measured.reduce((a, w) => a + w.weight, 0);
  const mean = measured.reduce((a, w) => a + scores[w.key] * w.weight, 0) / sumW;
  const capApplied = measured.some((w) => scores[w.key] < CAP_THRESHOLD);
  const rounded = Math.round(mean);
  let weakest = measured[0];
  for (const w of measured) if (scores[w.key] < scores[weakest.key]) weakest = w;
  return { score: capApplied ? Math.min(rounded, CAP_SCORE) : rounded, weakest: weakest.key, capApplied, measured: measured.length };
}

/**
 * The four sub-scores and the composite for one sample, by the same rules as
 * computeHealthScore() -- restricted to what a sample carries. Security is
 * over RLS coverage and users-without-role only (the sampler has no web
 * process to read env flags from and fetches no headers), and that scope is
 * written into the sample so a chart cannot mistake it for the page's figure.
 */
export function scoreSample(s) {
  // Freshness: mean over the sources with an SLA.
  const fresh = [];
  for (const src of s.sources ?? []) {
    const sla = SLA_HOURS[src.source];
    if (sla === undefined) continue;
    let points;
    if (src.status === null || src.status === undefined) points = 0;
    else if (src.status === "failed") points = 0;
    else if (src.status === "running") {
      const runningFor = src.startedAt ? (Date.parse(s.at) - Date.parse(src.startedAt)) / 3_600_000 : Infinity;
      if (runningFor > RUNNING_STALE_HOURS) points = 0;
      else if (src.lastOkAgeHours === null || src.lastOkAgeHours === undefined) points = 0;
      else points = mapRunAge(src.lastOkAgeHours, sla);
    } else points = src.ageHours === null || src.ageHours === undefined ? 0 : mapRunAge(src.ageHours, sla);
    fresh.push({ points, weight: 1 });
  }

  // Efficiency: mean of the measurable four, minus 10 for any deadlock.
  const eff = [];
  eff.push({ points: s.cacheHitPct === null ? null : round1(mapCacheHit(s.cacheHitPct)), weight: 1 });
  const total = s.xactCommit === null || s.xactRollback === null ? null : s.xactCommit + s.xactRollback;
  eff.push({ points: total === null || total === 0 ? null : round1(mapRollbackShare(s.xactCommit, s.xactRollback)), weight: 1 });
  eff.push({ points: s.deadlocks === null ? null : s.deadlocks > 0 ? -10 : 0, weight: 0 });
  eff.push({ points: s.connActive === null || s.connMax === null ? null : round1(mapConnections(s.connActive, s.connMax)), weight: 1 });
  eff.push({ points: s.dbLatencyMs === null ? null : round1(mapLatency(s.dbLatencyMs)), weight: 1 });

  // Security: RLS 50, users 20 (env 15 and headers 15 are not sampled -> renormalised over these two).
  const sec = [];
  sec.push({ points: s.rlsEnabled === null || s.rlsTotal === null || s.rlsTotal === 0 ? null : round1(mapShare(s.rlsEnabled, s.rlsTotal)), weight: 50 });
  sec.push({ points: s.usersWithoutRole === null ? null : round1(mapUsersWithoutRole(s.usersWithoutRole)), weight: 20 });

  // Consumption: 100 - used %.
  const cons = [{ points: s.dbSizeBytes === null || s.dbBudgetBytes === null ? null : round1(mapBudgetUse(s.dbSizeBytes, s.dbBudgetBytes)), weight: 1 }];

  const scores = {
    freshness: scoreFromComponents(fresh),
    efficiency: scoreFromComponents(eff),
    security: scoreFromComponents(sec),
    consumption: scoreFromComponents(cons),
  };
  const composite = composeScores(scores);
  return {
    ...scores,
    composite: composite ? composite.score : null,
    capApplied: composite ? composite.capApplied : null,
    securityScope: "rls+users only (env flags and response headers are web-process facts; not sampled)",
  };
}

// ─── env, paths ──────────────────────────────────────────────────────────────

export function samplesPath() {
  return process.env.SYSTEM_HEALTH_SAMPLES || path.join(os.homedir(), ".night-shift", "health-samples.jsonl");
}

function dbUrl() {
  if (process.env.SUPABASE_DB_URL) return process.env.SUPABASE_DB_URL;
  const envFile = path.join(os.homedir(), "code", "ui-rework", ".env.local");
  if (!fs.existsSync(envFile)) return null;
  const env = Object.fromEntries(fs.readFileSync(envFile, "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));
  return env.SUPABASE_DB_URL ?? null;
}

/**
 * TLS to the database. With SUPABASE_CA_CERT_PATH set to a PEM bundle the
 * server certificate is verified against it; without one the house behaviour
 * (encrypted, unverified -- the same as withDb() in the app) is kept and said
 * out loud on stderr once per run, so the gap is visible in the service log.
 * No bundle was found on this rig or in the repo on 2026-09-02.
 */
export function tlsOptions() {
  const caPath = process.env.SUPABASE_CA_CERT_PATH;
  if (caPath && caPath.trim() !== "") {
    try {
      return { ssl: { ca: fs.readFileSync(caPath, "utf8"), rejectUnauthorized: true }, verified: true };
    } catch (e) {
      console.error(`TLS: SUPABASE_CA_CERT_PATH could not be read (${e?.code ?? e?.message ?? e}); falling back to unverified`);
    }
  }
  console.error("TLS: no CA configured, certificate not verified (set SUPABASE_CA_CERT_PATH)");
  return { ssl: { rejectUnauthorized: false }, verified: false };
}

function budget() {
  const raw = process.env.SYSTEM_HEALTH_DB_BUDGET_GB;
  if (raw !== undefined && raw.trim() !== "") {
    const gb = Number(raw);
    if (!Number.isFinite(gb) || gb <= 0) return { bytes: null, reason: `SYSTEM_HEALTH_DB_BUDGET_GB is "${raw}", not a positive number of GB` };
    return { bytes: Math.round(gb * 1024 ** 3), reason: null };
  }
  return { bytes: DOCUMENTED_DB_BUDGET_BYTES, reason: null };
}

/** Keep only parseable lines whose `at` is within RETENTION_DAYS of `now`. Returns the kept lines and what was dropped. */
export function pruneLines(lines, now = Date.now(), days = RETENTION_DAYS) {
  const cutoff = now - days * 86_400_000;
  const kept = [];
  let old = 0;
  let malformed = 0;
  for (const line of lines) {
    if (line.trim() === "") continue;
    let at;
    try { at = Date.parse(JSON.parse(line)?.at); } catch { at = NaN; }
    if (Number.isNaN(at)) { malformed += 1; continue; }
    if (at < cutoff) { old += 1; continue; }
    kept.push(line);
  }
  return { kept, old, malformed };
}

function appendSample(sample) {
  const file = samplesPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n") : [];
  const { kept, old, malformed } = pruneLines(existing);
  kept.push(JSON.stringify(sample));
  // Write-then-rename so a reader never sees a half-written file.
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${kept.join("\n")}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
  return { file, lines: kept.length, old, malformed };
}

// ─── the sample ──────────────────────────────────────────────────────────────

async function takeSample() {
  const at = new Date().toISOString();
  const reasons = {};
  const sample = {
    at,
    host: os.hostname(),
    dbLatencyMs: null, cacheHitPct: null, xactCommit: null, xactRollback: null, deadlocks: null,
    connActive: null, connMax: null, dbSizeBytes: null, dbBudgetBytes: null,
    rlsEnabled: null, rlsTotal: null, usersWithoutRole: null,
    sources: [],
    scores: null,
    reasons,
  };
  const b = budget();
  sample.dbBudgetBytes = b.bytes;
  if (b.reason) reasons.dbBudgetBytes = b.reason;

  const url = dbUrl();
  if (!url) {
    reasons.db = "SUPABASE_DB_URL is neither in the environment nor in ~/code/ui-rework/.env.local";
    return { sample, connected: false };
  }
  const db = new Client({ connectionString: url, ssl: tlsOptions().ssl, statement_timeout: 30_000, application_name: "hse-health-sample" });
  try {
    await db.connect();
  } catch (e) {
    reasons.db = `connect failed: ${e?.message ?? e}`;
    return { sample, connected: false };
  }
  const read = async (fields, fn) => {
    try { await fn(); } catch (e) { for (const f of fields) reasons[f] = e?.message ?? String(e); }
  };
  try {
    await db.query("set default_transaction_read_only = on"); // belt and braces: this session only reads

    // Latency first and alone, like the page.
    await read(["dbLatencyMs"], async () => {
      const samples = [];
      for (let i = 0; i < 3; i += 1) { const t0 = performance.now(); await db.query("select 1"); samples.push(performance.now() - t0); }
      samples.sort((a, b2) => a - b2);
      sample.dbLatencyMs = Math.round(samples[1] * 10) / 10;
    });
    await read(["cacheHitPct", "xactCommit", "xactRollback", "deadlocks"], async () => {
      const r = (await db.query(`select xact_commit::text, xact_rollback::text, blks_hit::text, blks_read::text, deadlocks::text
                                   from pg_stat_database where datname = current_database()`)).rows[0];
      if (!r) throw new Error("pg_stat_database has no row for the current database");
      const hit = Number(r.blks_hit), rd = Number(r.blks_read);
      sample.xactCommit = Number(r.xact_commit); sample.xactRollback = Number(r.xact_rollback); sample.deadlocks = Number(r.deadlocks);
      if (hit + rd === 0) reasons.cacheHitPct = "no block activity since stats reset";
      else sample.cacheHitPct = Math.round((hit / (hit + rd)) * 1000) / 10;
    });
    await read(["connActive", "connMax"], async () => {
      const r = (await db.query(`select (select count(*) from pg_stat_activity where datname = current_database())::text as active,
                                        current_setting('max_connections') as max`)).rows[0];
      sample.connActive = Number(r.active); sample.connMax = Number(r.max);
    });
    await read(["dbSizeBytes"], async () => {
      sample.dbSizeBytes = Number((await db.query("select pg_database_size(current_database())::text as bytes")).rows[0].bytes);
    });
    await read(["rlsEnabled", "rlsTotal"], async () => {
      const r = (await db.query(`select count(*)::text as total, count(*) filter (where c.relrowsecurity)::text as enabled
                                   from pg_class c join pg_namespace n on n.oid = c.relnamespace
                                  where c.relkind in ('r', 'p') and n.nspname = any($1)`,
        [["public", "raw", "stg", "time", "projects", "crm", "hr", "platform"]])).rows[0];
      sample.rlsTotal = Number(r.total); sample.rlsEnabled = Number(r.enabled);
    });
    await read(["usersWithoutRole"], async () => {
      sample.usersWithoutRole = Number((await db.query(`select count(*)::text as count from auth.users u
                                                          left join public.app_user_profile p on p.user_id = u.id
                                                         where p.user_id is null`)).rows[0].count);
    });
    await read(["sources"], async () => {
      const latest = (await db.query(`select distinct on (source) source, status, started_at::text, finished_at::text
                                        from raw.sync_run order by source, started_at desc`)).rows;
      const latestOk = (await db.query(`select distinct on (source) source, started_at::text, finished_at::text
                                          from raw.sync_run where status = 'ok' order by source, started_at desc`)).rows;
      const okBySource = new Map(latestOk.map((r) => [r.source, r]));
      const fixed = ["trackingtime", "factorial", "asana", "samdock"];
      const names = [...fixed, ...latest.map((r) => r.source).filter((s) => !fixed.includes(s)).sort()];
      const hoursTo = (iso) => (Date.parse(at) - Date.parse(iso)) / 3_600_000;
      sample.sources = names.map((source) => {
        const r = latest.find((x) => x.source === source);
        const ok = okBySource.get(source);
        return {
          source,
          status: r?.status ?? null,
          startedAt: r?.started_at ?? null,
          finishedAt: r?.finished_at ?? null,
          ageHours: r ? Math.round(hoursTo(r.finished_at ?? r.started_at) * 100) / 100 : null,
          lastOkAgeHours: ok ? Math.round(hoursTo(ok.finished_at ?? ok.started_at) * 100) / 100 : null,
        };
      });
    });
  } finally {
    try { await db.end(); } catch { /* closing is best effort */ }
  }
  return { sample, connected: true };
}

async function main() {
  const { sample, connected } = await takeSample();
  sample.scores = scoreSample(sample);
  if (Object.keys(sample.reasons).length === 0) delete sample.reasons;
  let written;
  try {
    written = appendSample(sample);
  } catch (e) {
    console.error(`health-sample: could not write ${samplesPath()}: ${e?.message ?? e}`);
    console.log(JSON.stringify(sample));
    process.exit(1);
  }
  const sc = sample.scores;
  console.log(`${sample.at} composite=${sc.composite ?? "n/a"} freshness=${sc.freshness ?? "n/a"} efficiency=${sc.efficiency ?? "n/a"} security=${sc.security ?? "n/a"} consumption=${sc.consumption ?? "n/a"}` +
    ` -> ${written.file} (${written.lines} lines; pruned ${written.old} old, ${written.malformed} malformed)` +
    (sample.reasons ? ` unmeasured: ${Object.keys(sample.reasons).join(", ")}` : ""));
  if (!connected) { console.error(`health-sample: ${sample.reasons?.db}`); process.exit(1); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) await main();
