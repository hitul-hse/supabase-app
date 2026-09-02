/**
 * Reads for the developer health portal at /admin/system-health.
 *
 * WHY DIRECT POSTGRES
 * -------------------
 * Every figure here comes from pg_catalog, pg_stat_*, or a schema PostgREST
 * does not expose (raw, crm, auth). The Data API cannot answer "is RLS on for
 * every table" or "how big is the database" at all, so this file uses the same
 * per-request `pg` Client the Factorial identity queue uses (see
 * admin/factorial-identity/db.ts for why that pattern and not a pool).
 *
 * READ-ONLY BY CONSTRUCTION
 * -------------------------
 * Every statement is a SELECT. The one non-catalog write this page could ever
 * want -- persisting its own gate runs -- deliberately does not exist yet; see
 * `efficiency.gateRuns` below. History comes from a file the rig's sampler
 * writes (src/lib/health-history.ts), never from this process.
 *
 * SEQUENTIAL ON ONE CONNECTION
 * ----------------------------
 * Every read below is awaited in turn on the single Client. The earlier
 * Promise.all fan-outs issued queries while the client was still executing
 * one, which pg 8.23 reports as "Calling client.query() when the client is
 * already executing a query is deprecated and will be removed in pg@9.0" --
 * and bought nothing, because a Postgres connection executes serially anyway.
 * The only thing that truly runs in parallel is the header self-check, which
 * is a network call to ourselves and needs no database.
 *
 * THE RULE EVERY FIELD FOLLOWS
 * ----------------------------
 * A figure is either measured or it is `{ ok: false, reason }`. There is no
 * third state, and in particular there is no 0 standing in for "could not
 * read". A health page that renders a plausible number where it has none is
 * the single worst thing a health page can do, because it is precisely the
 * page people look at when they suspect something is wrong. Each sub-query
 * fails independently so one missing relation (say `crm.*` on a database the
 * migration has not reached) blanks one row, not the panel.
 */
import type { Client } from "pg";
import { withDb } from "@/app/(app)/admin/factorial-identity/db";
import { DOCUMENTED_DB_BUDGET_BYTES, DOCUMENTED_DB_BUDGET_SOURCE, slaFor, type SourceSla } from "@/lib/health-score";

export type Metric<T> = { ok: true; value: T } | { ok: false; reason: string };

const unavailable = (reason: string): Metric<never> => ({ ok: false, reason });

function errorMessage(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return String(e);
}

/** Run one read; a thrown error becomes a reason, never a crash. */
async function attempt<T>(fn: () => Promise<T>): Promise<Metric<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    return unavailable(errorMessage(e));
  }
}

// ─── Data freshness ──────────────────────────────────────────────────────────

/** The connectors raw.sync_run and raw.vendor_record know about. Fixed order so
 *  a source that has never run still gets a row saying so. */
export const SYNC_SOURCES = ["trackingtime", "factorial", "asana", "samdock"] as const;

export type SyncRun = {
  entity: string;
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "ok" | "failed";
  recordCount: number | null;
  errorMessage: string | null;
};

/** A raw.sync_run row with its source, for the 30-day timeline. */
export type SyncRunRow = SyncRun & { source: string };

export type RawRecordStats = { count: number; lastFetchedAt: string | null };

export type SourceFreshness = {
  source: string;
  /** Latest row in raw.sync_run for this source; null when it has never run. */
  lastRun: Metric<SyncRun | null>;
  /** Rows in raw.vendor_record for this source and when the newest was fetched. */
  raw: Metric<RawRecordStats>;
};

export type TypedTableCount = {
  /** schema.table */
  relation: string;
  /** Which connector feeds it, for the eye. */
  source: string;
  rows: Metric<number>;
};

/**
 * The typed layers each connector feeds, with the source spelled out so the
 * panel can say "TrackingTime: 5,218 entries" without a join nobody can check.
 * Tables that do not exist on this database (a migration not yet applied)
 * report that as the reason rather than 0.
 */
const TYPED_TABLES: { relation: string; source: string }[] = [
  { relation: "time.entry", source: "trackingtime" },
  { relation: "time.member", source: "trackingtime" },
  { relation: "time.project", source: "trackingtime" },
  { relation: "time.customer", source: "trackingtime" },
  { relation: "crm.trackingtime_project_reference", source: "trackingtime" },
  { relation: "crm.factorial_person_reference", source: "factorial" },
  { relation: "crm.factorial_identity_review", source: "factorial" },
  { relation: "public.weekly_employee_summary", source: "factorial" },
  { relation: "crm.asana_project_reference", source: "asana" },
  { relation: "crm.legal_entity", source: "customer master" },
];

export type LegacySyncSourceRow = { source: string; freshness: string; status: string; message: string | null };

/** Cap on the 30-day run list: 2,000 rows is 66 runs a day for a month, far above any schedule here. */
export const RUNS_30D_CAP = 2000;

export type FreshnessPanel = {
  sources: SourceFreshness[];
  /**
   * The documented schedule per source, in the same order as `sources`. From
   * SYNC_SLA in src/lib/health-score.ts, which cites the workflow, timer or
   * script for each. `slaHours: null` means nothing schedules that source.
   */
  sla: SourceSla[];
  /** Every raw.sync_run row of the last 30 days, newest first, capped at RUNS_30D_CAP. */
  runs30d: Metric<SyncRunRow[]>;
  typed: TypedTableCount[];
  /**
   * public.sync_sources is the table the original Hub sync bar read. It has no
   * timestamp column -- `freshness` is free text -- and overview-live.ts
   * documents that it was seeded ("ok, 4m ago") for pipelines that had never
   * run. It is shown so the discrepancy with raw.sync_run is visible, not as
   * evidence of anything.
   */
  legacy: Metric<LegacySyncSourceRow[]>;
};

type SyncRunDbRow = {
  source: string; entity: string; started_at: string; finished_at: string | null;
  status: SyncRun["status"]; record_count: number | null; error_message: string | null;
};

const toSyncRun = (r: SyncRunDbRow): SyncRun => ({
  entity: r.entity,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
  status: r.status,
  recordCount: r.record_count,
  errorMessage: r.error_message,
});

async function readFreshness(db: Client): Promise<FreshnessPanel> {
  const runs = await attempt(async () => {
    const res = await db.query<SyncRunDbRow>(
      `select distinct on (source)
              source, entity, started_at::text, finished_at::text, status, record_count, error_message
         from raw.sync_run
        order by source, started_at desc`,
    );
    return new Map(res.rows.map((r) => [r.source, toSyncRun(r)]));
  });

  const raws = await attempt(async () => {
    const res = await db.query<{ source: string; count: string; last_fetched_at: string | null }>(
      `select source, count(*)::text as count, max(fetched_at)::text as last_fetched_at
         from raw.vendor_record
        group by source`,
    );
    return new Map(res.rows.map((r) => [r.source, { count: Number(r.count), lastFetchedAt: r.last_fetched_at }]));
  });

  const legacy = await attempt(async () => {
    const res = await db.query<LegacySyncSourceRow>(
      `select source, freshness, status, message from public.sync_sources order by sort_order`,
    );
    return res.rows;
  });

  const runs30d = await attempt(async () => {
    const res = await db.query<SyncRunDbRow>(
      `select source, entity, started_at::text, finished_at::text, status, record_count, error_message
         from raw.sync_run
        where started_at >= now() - interval '30 days'
        order by started_at desc
        limit $1`,
      [RUNS_30D_CAP],
    );
    return res.rows.map((r): SyncRunRow => ({ source: r.source, ...toSyncRun(r) }));
  });

  // Fixed four first, then anything else the tables mention (lexware joined
  // the check constraint on 2026-08-22).
  const seen = new Set<string>(SYNC_SOURCES);
  const extra: string[] = [];
  if (runs.ok) for (const s of runs.value.keys()) if (!seen.has(s)) { seen.add(s); extra.push(s); }
  if (raws.ok) for (const s of raws.value.keys()) if (!seen.has(s)) { seen.add(s); extra.push(s); }

  const sources: SourceFreshness[] = [...SYNC_SOURCES, ...extra.sort()].map((source) => ({
    source,
    lastRun: runs.ok ? { ok: true, value: runs.value.get(source) ?? null } : runs,
    raw: raws.ok ? { ok: true, value: raws.value.get(source) ?? { count: 0, lastFetchedAt: null } } : raws,
  }));
  const sla = sources.map((s) => slaFor(s.source));

  // to_regclass for all ten in one round trip: a count(*) on a missing
  // relation throws 42P01, and "relation missing" is a more useful reason than
  // the raw error. Asking per table cost ten round trips (~150 ms here).
  const existing = await attempt(async () => {
    const res = await db.query<{ relation: string; reg: string | null }>(
      `select r as relation, to_regclass(r)::text as reg from unnest($1::text[]) as r`,
      [TYPED_TABLES.map((t) => t.relation)],
    );
    return new Set(res.rows.filter((r) => r.reg).map((r) => r.relation));
  });

  const typed: TypedTableCount[] = [];
  for (const { relation, source } of TYPED_TABLES) {
    typed.push({
      relation,
      source,
      rows: await attempt(async () => {
        if (existing.ok && !existing.value.has(relation)) throw new Error("relation does not exist on this database");
        // `relation` is from the constant list above, never from input. If the
        // existence probe itself failed, the count still runs and reports its own error.
        const res = await db.query<{ count: string }>(`select count(*)::text as count from ${relation}`);
        return Number(res.rows[0].count);
      }),
    });
  }

  return { sources, sla, runs30d, typed, legacy };
}

// ─── Processing efficiency ───────────────────────────────────────────────────

export type DbStats = {
  xactCommit: number;
  xactRollback: number;
  /** blks_hit / (blks_hit + blks_read), or null when both are zero. */
  cacheHitPct: number | null;
  deadlocks: number;
  statsReset: string | null;
};

export type SlowStatement = { calls: number; meanMs: number; totalMs: number; query: string };

/** How many statements `efficiency.statements` holds: the page shows 5 and pages the rest. */
export const STATEMENTS_CAP = 50;

export type EfficiencyPanel = {
  /** check-*.mjs results. Not persisted anywhere today -- always a reason. */
  gateRuns: Metric<never>;
  /** p50/p95 of server timings. No request-log table exists -- always a reason. */
  requestTimings: Metric<never>;
  /** Median of three `select 1` round trips on this request's connection. */
  dbLatencyMs: Metric<number>;
  dbStats: Metric<DbStats>;
  connections: Metric<{ active: number; max: number }>;
  /** Top STATEMENTS_CAP statements by total time, if pg_stat_statements is installed. */
  statements: Metric<SlowStatement[]>;
};

async function readEfficiency(db: Client): Promise<EfficiencyPanel> {
  // First and alone: latency is meaningless if measured while any other read
  // is in flight on the same connection.
  const dbLatencyMs = await attempt(async () => {
    const samples: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const t0 = performance.now();
      await db.query("select 1");
      samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    return Math.round(samples[1] * 10) / 10;
  });

  const dbStats = await attempt(async () => {
    const res = await db.query<{
      xact_commit: string; xact_rollback: string; blks_hit: string; blks_read: string;
      deadlocks: string; stats_reset: string | null;
    }>(
      `select xact_commit::text, xact_rollback::text, blks_hit::text, blks_read::text,
              deadlocks::text, stats_reset::text
         from pg_stat_database where datname = current_database()`,
    );
    const r = res.rows[0];
    if (!r) throw new Error("pg_stat_database has no row for the current database");
    const hit = Number(r.blks_hit);
    const read = Number(r.blks_read);
    return {
      xactCommit: Number(r.xact_commit),
      xactRollback: Number(r.xact_rollback),
      cacheHitPct: hit + read === 0 ? null : Math.round((hit / (hit + read)) * 1000) / 10,
      deadlocks: Number(r.deadlocks),
      statsReset: r.stats_reset,
    } satisfies DbStats;
  });

  const connections = await attempt(async () => {
    const res = await db.query<{ active: string; max: string }>(
      `select (select count(*) from pg_stat_activity where datname = current_database())::text as active,
              current_setting('max_connections') as max`,
    );
    return { active: Number(res.rows[0].active), max: Number(res.rows[0].max) };
  });

  const statements = await attempt(async () => {
    const ext = await db.query("select 1 from pg_extension where extname = 'pg_stat_statements'");
    if (ext.rowCount === 0) throw new Error("pg_stat_statements is not installed on this database");
    // Query text is normalised by the extension (constants become $n), and
    // truncated here so a long statement cannot dominate the card.
    const res = await db.query<{ calls: string; mean_ms: string; total_ms: string; query: string }>(
      `select calls::text, round(mean_exec_time::numeric, 2)::text as mean_ms,
              round(total_exec_time::numeric, 0)::text as total_ms,
              left(regexp_replace(query, '\\s+', ' ', 'g'), 120) as query
         from pg_stat_statements
        where dbid = (select oid from pg_database where datname = current_database())
        order by total_exec_time desc
        limit $1`,
      [STATEMENTS_CAP],
    );
    return res.rows.map((r) => ({
      calls: Number(r.calls), meanMs: Number(r.mean_ms), totalMs: Number(r.total_ms), query: r.query,
    }));
  });

  return {
    gateRuns: unavailable("not persisted — scripts/check-*.mjs print to stdout; no gate-run table exists"),
    requestTimings: unavailable("not instrumented — no request-log table; nothing records server timings"),
    dbLatencyMs,
    dbStats,
    connections,
    statements,
  };
}

// ─── Security posture ────────────────────────────────────────────────────────

export type RoleCount = { roleKey: string; active: number; inactive: number };

export type RlsTable = { relation: string; policies: number };

export type RlsSummary = {
  total: number;
  enabled: number;
  /** Tables in the app schemas with row security OFF. The list the page pages. */
  off: RlsTable[];
  /** RLS on but zero policies: locked to the service role. Not a fault, but worth seeing. */
  lockedNoPolicy: RlsTable[];
};

export type EnvFlag = { name: string; set: boolean };

export type HeaderCheck = { name: string; expected: string | null; observed: string | null };

export type SecurityPanel = {
  /** auth.users rows with no app_user_profile -- signed-in-capable, no role. */
  usersWithoutRole: Metric<number>;
  profilesByRole: Metric<RoleCount[]>;
  rls: Metric<RlsSummary>;
  /** Presence only. The values never leave process.env. */
  envFlags: EnvFlag[];
  headers: Metric<{ url: string; status: number; checks: HeaderCheck[] }>;
};

/** Schemas this app owns. pg_catalog and friends are not ours to secure. */
const APP_SCHEMAS = ["public", "raw", "stg", "time", "projects", "crm", "hr", "platform"];

async function readSecurity(db: Client): Promise<Omit<SecurityPanel, "envFlags" | "headers">> {
  const usersWithoutRole = await attempt(async () => {
    const res = await db.query<{ count: string }>(
      `select count(*)::text as count
         from auth.users u
         left join public.app_user_profile p on p.user_id = u.id
        where p.user_id is null`,
    );
    return Number(res.rows[0].count);
  });

  const profilesByRole = await attempt(async () => {
    const res = await db.query<{ role_key: string; active: string; inactive: string }>(
      `select role_key,
              count(*) filter (where is_active)::text as active,
              count(*) filter (where not is_active)::text as inactive
         from public.app_user_profile
        group by role_key
        order by role_key`,
    );
    return res.rows.map((r) => ({ roleKey: r.role_key, active: Number(r.active), inactive: Number(r.inactive) }));
  });

  const rls = await attempt(async () => {
    const res = await db.query<{ relation: string; rls: boolean; policies: string }>(
      `select n.nspname || '.' || c.relname as relation,
              c.relrowsecurity as rls,
              (select count(*) from pg_policy p where p.polrelid = c.oid)::text as policies
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where c.relkind in ('r', 'p')
          and n.nspname = any($1)
        order by c.relrowsecurity asc, n.nspname, c.relname`,
      [APP_SCHEMAS],
    );
    const rows = res.rows.map((r) => ({ relation: r.relation, rls: r.rls, policies: Number(r.policies) }));
    return {
      total: rows.length,
      enabled: rows.filter((r) => r.rls).length,
      off: rows.filter((r) => !r.rls).map(({ relation, policies }) => ({ relation, policies })),
      lockedNoPolicy: rows.filter((r) => r.rls && r.policies === 0).map(({ relation, policies }) => ({ relation, policies })),
    } satisfies RlsSummary;
  });

  return { usersWithoutRole, profilesByRole, rls };
}

/**
 * Presence flags only. Reading the value into a boolean and discarding it is
 * the whole contract -- nothing here may ever hold the string.
 */
function readEnvFlags(): EnvFlag[] {
  return [
    "SUPABASE_DB_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "NEXT_PUBLIC_SITE_URL",
  ].map((name) => ({ name, set: Boolean(process.env[name]) }));
}

/** What next.config.ts promises on every route, plus the HSTS the edge adds. */
const EXPECTED_HEADERS: { name: string; expected: string | null }[] = [
  { name: "x-frame-options", expected: "DENY" },
  { name: "x-content-type-options", expected: "nosniff" },
  { name: "referrer-policy", expected: "strict-origin-when-cross-origin" },
  { name: "permissions-policy", expected: "camera=(), microphone=(), geolocation=()" },
  // Set by the platform, not by us, so presence is the check and the value is
  // reported as observed.
  { name: "strict-transport-security", expected: null },
];

/**
 * One GET against the site's own public origin, three-second budget. On the
 * rig NEXT_PUBLIC_SITE_URL is localhost and the check reads the dev server; in
 * production it reads the deployed edge -- which is the point, because a
 * header configured in next.config.ts and dropped by a proxy looks identical
 * from inside the process.
 */
async function readHeaders(): Promise<SecurityPanel["headers"]> {
  const base = process.env.NEXT_PUBLIC_SITE_URL;
  if (!base) return unavailable("NEXT_PUBLIC_SITE_URL is not set — nothing to check against");
  const url = `${base.replace(/\/$/, "")}/login`;
  return attempt(async () => {
    const res = await fetch(url, {
      method: "GET",
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    return {
      url,
      status: res.status,
      checks: EXPECTED_HEADERS.map(({ name, expected }) => ({ name, expected, observed: res.headers.get(name) })),
    };
  });
}

// ─── Consumption ─────────────────────────────────────────────────────────────

export type RelationSize = { relation: string; bytes: number; pretty: string; estRows: number };

/** How many relations `consumption.largest` names; the rest are summed into `otherBytes`. */
export const LARGEST_CAP = 8;

export type ConsumptionPanel = {
  dbSize: Metric<{ bytes: number; pretty: string }>;
  /** The LARGEST_CAP biggest relations (tables, partitions, materialised views outside the system schemas). */
  largest: Metric<RelationSize[]>;
  /** Sum of every relation in the same filter that is not in `largest`, so a proportional bar can end honestly. */
  otherBytes: Metric<number>;
  /** Sum over every relation in the filter (= largest + other). Smaller than dbSize: indexes on system catalogs, WAL and free space are not relations. */
  relationsTotalBytes: Metric<number>;
  /** How many relations the filter matched. */
  relationCount: Metric<number>;
  /** The disk budget the consumption score is measured against. See readBudget. */
  budgetBytes: Metric<number>;
  /** Where `budgetBytes` came from, so the page can say so instead of presenting a bare limit. */
  budgetSource: string;
};

/**
 * The budget, in this order:
 *   1. `SYSTEM_HEALTH_DB_BUDGET_GB` when set -- explicit configuration beats a
 *      dated document, and it is the only way to record a plan change without
 *      a commit;
 *   2. the plan documented in the repo (DOCUMENTED_DB_BUDGET_BYTES, with its
 *      citation in src/lib/health-score.ts);
 *   3. otherwise `n/a`. Today branch 2 always answers, so 3 is reached only if
 *      the constant is ever removed. Kept so the reason text stays honest then.
 */
function readBudget(): { budgetBytes: Metric<number>; budgetSource: string } {
  const raw = process.env.SYSTEM_HEALTH_DB_BUDGET_GB;
  if (raw !== undefined && raw.trim() !== "") {
    const gb = Number(raw);
    if (!Number.isFinite(gb) || gb <= 0) {
      return {
        budgetBytes: unavailable(`SYSTEM_HEALTH_DB_BUDGET_GB is "${raw}", not a positive number of GB`),
        budgetSource: "SYSTEM_HEALTH_DB_BUDGET_GB (invalid)",
      };
    }
    return { budgetBytes: { ok: true, value: Math.round(gb * 1024 ** 3) }, budgetSource: `SYSTEM_HEALTH_DB_BUDGET_GB=${gb}` };
  }
  if (Number.isFinite(DOCUMENTED_DB_BUDGET_BYTES) && DOCUMENTED_DB_BUDGET_BYTES > 0) {
    return { budgetBytes: { ok: true, value: DOCUMENTED_DB_BUDGET_BYTES }, budgetSource: DOCUMENTED_DB_BUDGET_SOURCE };
  }
  return {
    budgetBytes: unavailable("no budget defined — set SYSTEM_HEALTH_DB_BUDGET_GB or document the plan"),
    budgetSource: "none",
  };
}

async function readConsumption(db: Client): Promise<ConsumptionPanel> {
  const dbSize = await attempt(async () => {
    const res = await db.query<{ bytes: string; pretty: string }>(
      `select pg_database_size(current_database())::text as bytes,
              pg_size_pretty(pg_database_size(current_database())) as pretty`,
    );
    return { bytes: Number(res.rows[0].bytes), pretty: res.rows[0].pretty };
  });

  // One read for the whole list, so `largest`, `otherBytes` and
  // `relationsTotalBytes` come from the same snapshot and add up exactly.
  const relations = await attempt(async () => {
    const res = await db.query<{ relation: string; bytes: string; pretty: string; est_rows: string }>(
      `select n.nspname || '.' || c.relname as relation,
              pg_total_relation_size(c.oid)::text as bytes,
              pg_size_pretty(pg_total_relation_size(c.oid)) as pretty,
              greatest(c.reltuples, 0)::bigint::text as est_rows
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where c.relkind in ('r', 'p', 'm')
          and n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
        order by pg_total_relation_size(c.oid) desc`,
    );
    const rows = res.rows.map((r): RelationSize => ({
      relation: r.relation, bytes: Number(r.bytes), pretty: r.pretty, estRows: Number(r.est_rows),
    }));
    const largest = rows.slice(0, LARGEST_CAP);
    const otherBytes = rows.slice(LARGEST_CAP).reduce((a, r) => a + r.bytes, 0);
    const totalBytes = rows.reduce((a, r) => a + r.bytes, 0);
    return { largest, otherBytes, totalBytes, count: rows.length };
  });

  const { budgetBytes, budgetSource } = readBudget();

  return {
    dbSize,
    largest: relations.ok ? { ok: true, value: relations.value.largest } : relations,
    otherBytes: relations.ok ? { ok: true, value: relations.value.otherBytes } : relations,
    relationsTotalBytes: relations.ok ? { ok: true, value: relations.value.totalBytes } : relations,
    relationCount: relations.ok ? { ok: true, value: relations.value.count } : relations,
    budgetBytes,
    budgetSource,
  };
}

// ─── Deploy identity ─────────────────────────────────────────────────────────

export type DeployIdentity = {
  /** Vercel's own id for this build, or null on the rig. */
  deploymentId: string | null;
  env: string | null;
  /** Short SHA. */
  commit: string | null;
  region: string | null;
};

function readDeploy(): DeployIdentity {
  return {
    deploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? null,
    env: process.env.VERCEL_ENV ?? null,
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    region: process.env.VERCEL_REGION ?? null,
  };
}

// ─── The whole page ──────────────────────────────────────────────────────────

/** The page's performance budget for getSystemHealth(), from the brief. */
export const SERVER_BUDGET_MS = 1500;

export type HealthTimings = {
  /** Wall time of getSystemHealth() itself, measured inside it. Compare with SERVER_BUDGET_MS. */
  serverMs: number;
};

export type SystemHealth = {
  /** When this snapshot was taken, ISO. Every number on the page is as of this instant. */
  sampledAt: string;
  /** Null when the database was reached; otherwise why every DB metric is blank. */
  dbError: string | null;
  freshness: FreshnessPanel | null;
  efficiency: EfficiencyPanel | null;
  security: SecurityPanel;
  consumption: ConsumptionPanel | null;
  deploy: DeployIdentity;
  timings: HealthTimings;
};

export async function getSystemHealth(): Promise<SystemHealth> {
  const t0 = performance.now();
  const sampledAt = new Date().toISOString();
  const envFlags = readEnvFlags();
  const deploy = readDeploy();

  // The header self-check is a network call to ourselves and must not wait on
  // the database (or vice versa). It is the only read that runs concurrently.
  const headersPromise = readHeaders();

  let dbError: string | null = null;
  let panels: {
    freshness: FreshnessPanel; efficiency: EfficiencyPanel;
    security: Omit<SecurityPanel, "envFlags" | "headers">; consumption: ConsumptionPanel;
  } | null = null;

  try {
    panels = await withDb(async (db) => {
      // Latency first and alone (see readEfficiency), then the rest in turn on
      // the same connection -- never two statements in flight at once.
      const efficiency = await readEfficiency(db);
      const freshness = await readFreshness(db);
      const security = await readSecurity(db);
      const consumption = await readConsumption(db);
      return { freshness, efficiency, security, consumption };
    });
  } catch (e) {
    dbError = errorMessage(e);
  }

  const headers = await headersPromise;
  const dbUnavailable = unavailable(dbError ?? "database unreachable");

  return {
    sampledAt,
    dbError,
    freshness: panels?.freshness ?? null,
    efficiency: panels?.efficiency ?? null,
    security: {
      usersWithoutRole: panels?.security.usersWithoutRole ?? dbUnavailable,
      profilesByRole: panels?.security.profilesByRole ?? dbUnavailable,
      rls: panels?.security.rls ?? dbUnavailable,
      envFlags,
      headers,
    },
    consumption: panels?.consumption ?? null,
    deploy,
    timings: { serverMs: Math.round(performance.now() - t0) },
  };
}
