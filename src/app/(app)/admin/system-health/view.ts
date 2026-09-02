/**
 * The server-side view model for /admin/system-health.
 *
 * WHY A VIEW MODEL AND NOT PROPS STRAIGHT FROM THE READ MODEL
 * ----------------------------------------------------------
 * The charts in src/components/ui/Charts.tsx are client components that take
 * functions (valueFormat, onSelect), so the panels that draw them are client
 * components too -- and everything crossing into them must be serialisable.
 * This file turns `SystemHealth` + `HealthHistory` + `HealthScore` into plain
 * data: strings already translated, tones already decided, reasons already
 * spelled out. A panel renders; it never decides what is true.
 *
 * THE RULE, APPLIED HERE ONCE
 * ---------------------------
 * `Metric<T>` never becomes a plausible number. Every figure below is either a
 * value with its inputs or `{ ok: false, reason }`, and a chart that cannot be
 * drawn (a connector that never ran, one point where a line needs two) is an
 * absence with a sentence, not a zero-length bar. src/lib/health-score.ts
 * decides the judgements (tones) so the hero and the panels never disagree.
 */
import type { HBarRow, SparkPoint, StackedHBarRow, TimelineEvent, TimelineLane, Tone } from "@/components/ui/Charts";
import type { Drill } from "@/components/DrillDialog";
import {
  FRESHNESS_GRACE_HOURS,
  RUNNING_STALE_HOURS,
  SUBSCORE_WEIGHTS,
  mapCacheHit,
  mapConnections,
  mapLatency,
  mapRunAge,
  scoreTone,
  type HealthScore,
  type SubScoreKey,
} from "@/lib/health-score";
import { growthPerDay, latestSamples, type HealthHistory } from "@/lib/health-history";
import {
  LARGEST_CAP,
  RUNS_30D_CAP,
  SERVER_BUDGET_MS,
  STATEMENTS_CAP,
  SYNC_SOURCES,
  type LegacySyncSourceRow,
  type SystemHealth,
} from "@/lib/queries/system-health";
import { fmt1, fmtBytes, fmtHours, fmtInt, fmtMs, fmtTime, hoursBetween, toIso } from "./format";
import {
  ageDrill,
  cacheDrill,
  compositeDrill,
  connectionsDrill,
  profilesDrill,
  relationsDrill,
  rlsDrill,
  runsDrill,
  statementsDrill,
  subScoreDrill,
  typedDrill,
  xactDrill,
} from "./drills";

/** The translator the page hands down; next-intl's signature, untyped keys. */
export type T = (key: string, values?: Record<string, string | number | Date>) => string;

export type NA = { ok: false; reason: string };

// ─── Header ──────────────────────────────────────────────────────────────────

export type HeaderView = {
  title: string;
  meta: string;
  serverMs: number;
  serverTone: "neutral" | "warning";
  serverLabel: string;
};

// ─── Hero ────────────────────────────────────────────────────────────────────

export type SubScoreView = {
  key: SubScoreKey;
  label: string;
  weight: number;
  /** The 0-100 score, or null when the sub-score is n/a. */
  score: number | null;
  tone: Tone;
  /** "72" or "n/a" for the meter caption. */
  caption: string;
  /** The reason shown inline when n/a. */
  reason: string | null;
  drill: Drill;
};

export type HeroView = {
  composite:
    | { ok: true; score: number; tone: Tone; weakestLabel: string; capApplied: boolean; measured: number }
    | NA;
  status: string;
  compositeDrill: Drill;
  subs: SubScoreView[];
  labels: { composite: string; scoreLabel: string; na: string };
};

// ─── Freshness ───────────────────────────────────────────────────────────────

export type AgeListRow = { source: string; text: string; tone: Tone };

export type FreshnessView = {
  age: {
    rows: HBarRow[];
    /** Sources that are not bars: never run, or unreadable. Listed under the chart. */
    listed: AgeListRow[];
    limit: { value: number; label: string } | null;
    note: string;
    drill: Drill;
  };
  runs:
    | { ok: true; lanes: TimelineLane[]; events: TimelineEvent[]; from: string; to: string; count: number; capped: boolean }
    | NA;
  runsDrill: Drill | null;
  typed: {
    rows: HBarRow[];
    groupOrder: string[];
    missing: { relation: string; reason: string }[];
    drill: Drill;
  };
  legacy: { ok: true; rows: LegacySyncSourceRow[] } | NA;
};

// ─── Efficiency ──────────────────────────────────────────────────────────────

export type EfficiencyView = {
  cache: { ok: true; pct: number; tone: Tone; drill: Drill } | NA;
  connections: { ok: true; active: number; max: number; tone: Tone; drill: Drill } | NA;
  xact: { ok: true; commits: number; rollbacks: number; drill: Drill } | NA;
  statements: { ok: true; top: HBarRow[]; count: number; totalMs: number; drill: Drill } | NA;
  latency: {
    live: { ok: true; ms: number; tone: Tone } | NA;
    spark: { ok: true; points: SparkPoint[] } | NA;
  };
  gateRuns: string;
  requestTimings: string;
  statsReset: string | null;
};

// ─── Security ────────────────────────────────────────────────────────────────

export type SecurityView = {
  rls:
    | { ok: true; enabled: number; total: number; off: number; locked: number; coveragePct: number; tone: Tone; drill: Drill }
    | NA;
  profiles: { ok: true; rows: StackedHBarRow[]; total: number; drill: Drill } | NA;
  usersWithoutRole: { ok: true; count: number; tone: "good" | "warning" } | NA;
  env: { name: string; set: boolean }[];
  headers:
    | { ok: true; url: string; status: number; checks: { name: string; pass: boolean; observed: string | null; expected: string | null }[] }
    | NA;
};

// ─── Consumption ─────────────────────────────────────────────────────────────

export type RelationSegment = { key: string; label: string; value: number; color: string; ink?: string };

export type ConsumptionView = {
  relations: { ok: true; segments: RelationSegment[]; totalBytes: number; count: number; drill: Drill } | NA;
  size:
    | { ok: true; pretty: string; bytes: number; budget: { ok: true; bytes: number; usedPct: number; source: string } | NA }
    | NA;
  growth: { ok: true; text: string } | NA;
};

export type HealthView = {
  header: HeaderView;
  dbError: string | null;
  hero: HeroView;
  freshness: FreshnessView | null;
  efficiency: EfficiencyView | null;
  security: SecurityView;
  consumption: ConsumptionView | null;
};

// ─── Builders ────────────────────────────────────────────────────────────────

const SUB_LABEL_KEY: Record<SubScoreKey, string> = {
  freshness: "subs.freshness",
  efficiency: "subs.efficiency",
  security: "subs.security",
  consumption: "subs.consumption",
};

function buildHeader(t: T, health: SystemHealth): HeaderView {
  const { deploy, timings } = health;
  const where = deploy.deploymentId
    ? `${(deploy.env ?? "vercel").toUpperCase()} · ${deploy.deploymentId}${deploy.commit ? ` · ${deploy.commit}` : ""}${deploy.region ? ` · ${deploy.region}` : ""}`
    : t("header.rig");
  return {
    title: t("title"),
    meta: t("header.meta", { at: health.sampledAt, where }),
    serverMs: timings.serverMs,
    serverTone: timings.serverMs > SERVER_BUDGET_MS ? "warning" : "neutral",
    serverLabel: t("header.serverMs", { ms: fmtInt(timings.serverMs), budget: fmtInt(SERVER_BUDGET_MS) }),
  };
}

function buildHero(t: T, score: HealthScore): HeroView {
  const na = t("na");
  const subs: SubScoreView[] = SUBSCORE_WEIGHTS.map(({ key, weight }) => {
    const sub = score[key];
    const label = t(SUB_LABEL_KEY[key]);
    if (!sub.ok) {
      return {
        key, label, weight, score: null, tone: "neutral", caption: na, reason: sub.reason,
        drill: subScoreDrill(t, key, label, weight, sub),
      };
    }
    return {
      key, label, weight, score: sub.value.score, tone: scoreTone(sub.value.score),
      caption: String(sub.value.score), reason: null,
      drill: subScoreDrill(t, key, label, weight, sub),
    };
  });

  const c = score.composite;
  const labels = { composite: t("hero.composite"), scoreLabel: t("hero.scoreLabel"), na };
  if (!c.ok) {
    return {
      composite: c,
      status: t("hero.statusNa"),
      compositeDrill: compositeDrill(t, score, subs),
      subs,
      labels,
    };
  }
  const weakestLabel = t(SUB_LABEL_KEY[c.value.weakest]);
  return {
    composite: {
      ok: true,
      score: c.value.score,
      tone: scoreTone(c.value.score),
      weakestLabel,
      capApplied: c.value.capApplied,
      measured: c.value.measured,
    },
    status: t("hero.status", {
      weakest: weakestLabel,
      cap: c.value.capApplied ? t("hero.capApplied") : t("hero.capNotApplied"),
      measured: c.value.measured,
      total: SUBSCORE_WEIGHTS.length,
    }),
    compositeDrill: compositeDrill(t, score, subs),
    subs,
    labels,
  };
}

const DAY_MS = 86_400_000;

function buildFreshness(t: T, health: SystemHealth): FreshnessView | null {
  const f = health.freshness;
  if (!f) return null;
  const now = health.sampledAt;

  // Age vs SLA. Tones follow health-score.ts: a scheduled connector's points
  // (100/50/0) map to good/warning/critical; an unscheduled one is muted.
  const rows: HBarRow[] = [];
  const listed: AgeListRow[] = [];
  const drillRows: { source: string; hours: number | null; text: string; tone: Tone }[] = [];
  for (const s of f.sources) {
    const sla = f.sla.find((x) => x.source === s.source);
    const slaHours = sla?.slaHours ?? null;
    if (!s.lastRun.ok) {
      listed.push({ source: s.source, text: t("freshness.unreadable", { reason: s.lastRun.reason }), tone: "muted" });
      drillRows.push({ source: s.source, hours: null, text: t("freshness.unreadable", { reason: s.lastRun.reason }), tone: "muted" });
      continue;
    }
    const run = s.lastRun.value;
    if (run === null) {
      const text = slaHours === null ? t("freshness.neverRunNoSla") : t("freshness.neverRun", { sla: slaHours });
      listed.push({ source: s.source, text, tone: slaHours === null ? "muted" : "critical" });
      drillRows.push({ source: s.source, hours: null, text, tone: slaHours === null ? "muted" : "critical" });
      continue;
    }
    const anchor = run.status === "running" ? run.startedAt : (run.finishedAt ?? run.startedAt);
    const age = Math.max(0, hoursBetween(anchor, now));
    let tone: Tone = "muted";
    if (slaHours !== null) {
      if (run.status === "failed") tone = "critical";
      else if (run.status === "running") tone = age > RUNNING_STALE_HOURS ? "critical" : "warning";
      else tone = scoreTone(mapRunAge(age, slaHours));
    }
    const statusText = t(`freshness.runStatus.${run.status}`);
    const parts = [
      `${s.source}: ${fmtHours(age)}`,
      run.status === "running" ? t("freshness.sinceStarted", { at: fmtTime(anchor) }) : t("freshness.sinceFinished", { at: fmtTime(anchor) }),
      statusText,
      run.entity,
      run.recordCount !== null ? t("freshness.records", { count: fmtInt(run.recordCount) }) : null,
      slaHours === null ? t("freshness.noSchedule") : t("freshness.slaShort", { hours: slaHours }),
    ].filter(Boolean);
    const readout = parts.join(" · ");
    rows.push({ key: s.source, label: s.source, value: age, readout, tone });
    drillRows.push({ source: s.source, hours: age, text: readout, tone });
  }
  const ruleSource = f.sla.find((x) => x.slaHours !== null) ?? null;
  const limit = ruleSource && ruleSource.slaHours !== null
    ? { value: ruleSource.slaHours, label: t("freshness.slaRule", { hours: ruleSource.slaHours, source: ruleSource.source }) }
    : null;
  const note = ruleSource && ruleSource.slaHours !== null
    ? t("freshness.ageNote", { source: ruleSource.source, hours: ruleSource.slaHours, grace: FRESHNESS_GRACE_HOURS, stale: RUNNING_STALE_HOURS })
    : t("freshness.ageNoteNoSla");

  // 30-day timeline.
  const to = now;
  const from = new Date(Date.parse(now) - 30 * DAY_MS).toISOString();
  let runs: FreshnessView["runs"];
  let rDrill: Drill | null = null;
  if (f.runs30d.ok) {
    const laneKeys: string[] = [...SYNC_SOURCES];
    for (const r of f.runs30d.value) if (!laneKeys.includes(r.source)) laneKeys.push(r.source);
    const events: TimelineEvent[] = f.runs30d.value.map((r, i) => ({
      key: `${r.source}-${toIso(r.startedAt)}-${i}`,
      lane: r.source,
      at: toIso(r.startedAt),
      kind: r.status,
      readout: [
        r.source,
        r.entity,
        fmtTime(r.startedAt),
        t(`freshness.runStatus.${r.status}`),
        r.recordCount !== null ? t("freshness.records", { count: fmtInt(r.recordCount) }) : null,
        r.errorMessage ? r.errorMessage.slice(0, 60) : null,
      ].filter(Boolean).join(" · "),
    }));
    runs = {
      ok: true,
      lanes: laneKeys.map((k) => ({ key: k, label: k })),
      events,
      from,
      to,
      count: events.length,
      capped: f.runs30d.value.length >= RUNS_30D_CAP,
    };
    rDrill = runsDrill(t, f.runs30d.value, events.length);
  } else {
    runs = f.runs30d;
  }

  // Typed layer, grouped by source. A relation whose count is n/a is listed, not drawn.
  const typedRows: HBarRow[] = [];
  const missing: { relation: string; reason: string }[] = [];
  const groupOrder: string[] = [...SYNC_SOURCES];
  for (const tt of f.typed) {
    if (!groupOrder.includes(tt.source)) groupOrder.push(tt.source);
    if (tt.rows.ok) {
      typedRows.push({
        key: tt.relation,
        label: tt.relation,
        value: tt.rows.value,
        readout: t("freshness.typedReadout", { relation: tt.relation, rows: fmtInt(tt.rows.value), source: tt.source }),
        group: tt.source,
      });
    } else {
      missing.push({ relation: tt.relation, reason: tt.rows.reason });
    }
  }

  return {
    age: { rows, listed, limit, note, drill: ageDrill(t, drillRows) },
    runs,
    runsDrill: rDrill,
    typed: { rows: typedRows, groupOrder, missing, drill: typedDrill(t, f.typed) },
    legacy: f.legacy.ok ? { ok: true, rows: f.legacy.value } : f.legacy,
  };
}

/**
 * A bar label a reader can tell apart. PostgREST wraps every request in
 * `WITH pgrst_source AS (SELECT "schema"."table"...)`, so five of the heaviest
 * statements all start with the same 40 characters and truncate to the same
 * label; naming the first relation instead is what distinguishes them. The
 * full normalised text stays in the readout and in the drill.
 */
function statementLabel(t: T, query: string): string {
  const rel = query.match(/"(\w+)"\."(\w+)"/);
  if (/^WITH pgrst_source/i.test(query) && rel) return t("efficiency.postgrest", { relation: `${rel[1]}.${rel[2]}` });
  return query;
}

function buildEfficiency(t: T, health: SystemHealth, history: HealthHistory): EfficiencyView | null {
  const e = health.efficiency;
  if (!e) return null;
  const statsReset = e.dbStats.ok ? e.dbStats.value.statsReset : null;

  let cache: EfficiencyView["cache"];
  if (!e.dbStats.ok) cache = e.dbStats;
  else if (e.dbStats.value.cacheHitPct === null) cache = { ok: false, reason: t("efficiency.cacheUndefined") };
  else {
    const pct = e.dbStats.value.cacheHitPct;
    cache = { ok: true, pct, tone: scoreTone(mapCacheHit(pct)), drill: cacheDrill(t, pct, statsReset) };
  }

  const connections: EfficiencyView["connections"] = e.connections.ok
    ? {
        ok: true,
        active: e.connections.value.active,
        max: e.connections.value.max,
        tone: scoreTone(mapConnections(e.connections.value.active, e.connections.value.max)),
        drill: connectionsDrill(t, e.connections.value.active, e.connections.value.max),
      }
    : e.connections;

  let xact: EfficiencyView["xact"];
  if (!e.dbStats.ok) xact = e.dbStats;
  else if (e.dbStats.value.xactCommit + e.dbStats.value.xactRollback === 0) xact = { ok: false, reason: t("efficiency.noTransactions") };
  else {
    const { xactCommit, xactRollback } = e.dbStats.value;
    xact = { ok: true, commits: xactCommit, rollbacks: xactRollback, drill: xactDrill(t, xactCommit, xactRollback, statsReset) };
  }

  let statements: EfficiencyView["statements"];
  if (!e.statements.ok) statements = e.statements;
  else if (e.statements.value.length === 0) statements = { ok: false, reason: t("efficiency.noStatements") };
  else {
    const all = e.statements.value;
    const totalMs = all.reduce((a, s) => a + s.totalMs, 0);
    const top = all.slice(0, 5).map((s, i): HBarRow => ({
      key: `q${i}`,
      label: statementLabel(t, s.query),
      value: s.totalMs,
      readout: t("efficiency.statementReadout", { total: fmtMs(s.totalMs), calls: fmtInt(s.calls), mean: fmt1(s.meanMs) }),
    }));
    statements = { ok: true, top, count: all.length, totalMs, drill: statementsDrill(t, all, totalMs, STATEMENTS_CAP) };
  }

  const live: EfficiencyView["latency"]["live"] = e.dbLatencyMs.ok
    ? { ok: true, ms: e.dbLatencyMs.value, tone: scoreTone(mapLatency(e.dbLatencyMs.value)) }
    : e.dbLatencyMs;
  let spark: EfficiencyView["latency"]["spark"];
  if (!history.ok) spark = history;
  else {
    const samples = latestSamples(history, 48).reverse().filter((s) => typeof s.dbLatencyMs === "number");
    if (samples.length < 2) spark = { ok: false, reason: t("efficiency.sparkNeedsTwo", { count: samples.length }) };
    else {
      spark = {
        ok: true,
        points: samples.map((s) => ({
          key: s.at,
          value: s.dbLatencyMs as number,
          readout: `${fmtTime(s.at)} · ${fmt1(s.dbLatencyMs as number)} ms`,
        })),
      };
    }
  }

  return {
    cache,
    connections,
    xact,
    statements,
    latency: { live, spark },
    gateRuns: e.gateRuns.ok ? "" : e.gateRuns.reason,
    requestTimings: e.requestTimings.ok ? "" : e.requestTimings.reason,
    statsReset,
  };
}

function buildSecurity(t: T, health: SystemHealth): SecurityView {
  const s = health.security;

  let rls: SecurityView["rls"];
  if (!s.rls.ok) rls = s.rls;
  else if (s.rls.value.total === 0) rls = { ok: false, reason: t("security.noTables") };
  else {
    const { enabled, total, off, lockedNoPolicy } = s.rls.value;
    const coveragePct = Math.round((enabled / total) * 100);
    rls = {
      ok: true,
      enabled,
      total,
      off: off.length,
      locked: lockedNoPolicy.length,
      coveragePct,
      tone: off.length === 0 ? "good" : "critical",
      drill: rlsDrill(t, s.rls.value),
    };
  }

  let profiles: SecurityView["profiles"];
  if (!s.profilesByRole.ok) profiles = s.profilesByRole;
  else if (s.profilesByRole.value.length === 0) profiles = { ok: false, reason: t("security.noProfiles") };
  else {
    const rows = s.profilesByRole.value;
    const total = rows.reduce((a, r) => a + r.active + r.inactive, 0);
    profiles = {
      ok: true,
      total,
      rows: rows.map((r): StackedHBarRow => ({
        key: r.roleKey,
        label: r.roleKey,
        readout: t("security.roleReadout", { role: r.roleKey, active: fmtInt(r.active), inactive: fmtInt(r.inactive) }),
        segments: [
          { key: "active", label: t("security.active"), value: r.active, color: "var(--accent)" },
          { key: "inactive", label: t("security.inactive"), value: r.inactive, color: "var(--text-faint)", ink: "var(--surface)" },
        ],
      })),
      drill: profilesDrill(t, rows, total),
    };
  }

  const usersWithoutRole: SecurityView["usersWithoutRole"] = s.usersWithoutRole.ok
    ? { ok: true, count: s.usersWithoutRole.value, tone: s.usersWithoutRole.value > 0 ? "warning" : "good" }
    : s.usersWithoutRole;

  const headers: SecurityView["headers"] = s.headers.ok
    ? {
        ok: true,
        url: s.headers.value.url,
        status: s.headers.value.status,
        checks: s.headers.value.checks.map((c) => ({
          name: c.name,
          expected: c.expected,
          observed: c.observed,
          // The same rule health-score.ts scores with: presence when nothing
          // specific is expected, case-insensitive equality otherwise.
          pass: c.expected === null ? c.observed !== null : (c.observed ?? "").toLowerCase() === c.expected.toLowerCase(),
        })),
      }
    : s.headers;

  return { rls, profiles, usersWithoutRole, env: s.envFlags.map((f) => ({ name: f.name, set: f.set })), headers };
}

/**
 * One hue, stepped: the eight largest relations are the accent mixed into the
 * surface from 100 % down to 30 %, so the bar reads as one ramp, not eight
 * categories. No new tokens and no status colour -- size is not a judgement.
 */
function rampColor(i: number): string {
  const pct = 100 - i * 10;
  return `color-mix(in oklab, var(--accent) ${pct}%, var(--surface))`;
}

function buildConsumption(t: T, health: SystemHealth, history: HealthHistory): ConsumptionView | null {
  const c = health.consumption;
  if (!c) return null;

  let relations: ConsumptionView["relations"];
  if (!c.largest.ok) relations = c.largest;
  else if (!c.otherBytes.ok) relations = c.otherBytes;
  else if (!c.relationsTotalBytes.ok) relations = c.relationsTotalBytes;
  else if (!c.relationCount.ok) relations = c.relationCount;
  else if (c.relationsTotalBytes.value <= 0) relations = { ok: false, reason: t("consumption.noRelations") };
  else {
    const largest = c.largest.value;
    const otherCount = Math.max(0, c.relationCount.value - largest.length);
    const segments: RelationSegment[] = largest.map((r, i) => ({
      key: r.relation,
      label: r.relation,
      value: r.bytes,
      color: rampColor(i),
      // Past the midpoint the mix is mostly surface, and the accent-contrast ink stops reading on it.
      ink: i >= 5 ? "var(--text-primary)" : undefined,
    }));
    if (c.otherBytes.value > 0 || otherCount > 0) {
      segments.push({
        key: "__other",
        label: t("consumption.other", { count: otherCount }),
        value: c.otherBytes.value,
        color: "var(--border-strong)",
        ink: "var(--text-primary)",
      });
    }
    relations = {
      ok: true,
      segments,
      totalBytes: c.relationsTotalBytes.value,
      count: c.relationCount.value,
      drill: relationsDrill(t, largest, c.otherBytes.value, otherCount, c.relationsTotalBytes.value, LARGEST_CAP),
    };
  }

  const size: ConsumptionView["size"] = c.dbSize.ok
    ? {
        ok: true,
        pretty: c.dbSize.value.pretty,
        bytes: c.dbSize.value.bytes,
        budget: c.budgetBytes.ok
          ? {
              ok: true,
              bytes: c.budgetBytes.value,
              usedPct: (c.dbSize.value.bytes / c.budgetBytes.value) * 100,
              source: c.budgetSource,
            }
          : c.budgetBytes,
      }
    : c.dbSize;

  let growth: ConsumptionView["growth"];
  if (!history.ok) growth = history;
  else {
    const g = growthPerDay(history.value.samples, "dbSizeBytes");
    growth = g.ok
      ? {
          ok: true,
          text: t("consumption.growth", {
            rate: `${g.value.perDay >= 0 ? "+" : "−"}${fmtBytes(Math.abs(g.value.perDay))}`,
            samples: g.value.samples,
            span: fmt1(g.value.spanHours),
          }),
        }
      : g;
  }

  return { relations, size, growth };
}

export function buildHealthView(t: T, health: SystemHealth, history: HealthHistory, score: HealthScore): HealthView {
  return {
    header: buildHeader(t, health),
    dbError: health.dbError,
    hero: buildHero(t, score),
    freshness: buildFreshness(t, health),
    efficiency: buildEfficiency(t, health, history),
    security: buildSecurity(t, health),
    consumption: buildConsumption(t, health, history),
  };
}

/** A percent for a StatTile progress bar, or null when the budget is n/a. */
export function usedPercent(size: ConsumptionView["size"]): number | null {
  return size.ok && size.budget.ok ? size.budget.usedPct : null;
}
