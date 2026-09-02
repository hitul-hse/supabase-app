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
 * `efficiency.gateRuns` below.
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

export type FreshnessPanel = {
  sources: SourceFreshness[];
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

async function readFreshness(db: Client): Promise<FreshnessPanel> {
  const [runs, raws, legacy] = await Promise.all([
    attempt(async () => {
      const res = await db.query<{
        source: string; entity: string; started_at: string; finished_at: string | null;
        status: SyncRun["status"]; record_count: number | null; error_message: string | null;
      }>(
        `select distinct on (source)
                source, entity, started_at::text, finished_at::text, status, record_count, error_message
           from raw.sync_run
          order by source, started_at desc`,
      );
      return new Map(res.rows.map((r) => [r.source, {
        entity: r.entity,
        startedAt: r.started_at,
        finishedAt: r.finished_at,
        status: r.status,
        recordCount: r.record_count,
        errorMessage: r.error_message,
      } satisfies SyncRun]));
    }),
    attempt(async () => {
      const res = await db.query<{ source: string; count: string; last_fetched_at: string | null }>(
        `select source, count(*)::text as count, max(fetched_at)::text as last_fetched_at
           from raw.vendor_record
          group by source`,
      );
      return new Map(res.rows.map((r) => [r.source, { count: Number(r.count), lastFetchedAt: r.last_fetched_at }]));
    }),
    attempt(async () => {
      const res = await db.query<LegacySyncSourceRow>(
        `select source, freshness, status, message from public.sync_sources order by sort_order`,
      );
      return res.rows;
    }),
  ]);

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

  const typed: TypedTableCount[] = await Promise.all(
    TYPED_TABLES.map(async ({ relation, source }) => ({
      relation,
      source,
      rows: await attempt(async () => {
        // to_regclass first: a count(*) on a missing relation throws 42P01,
        // and "relation missing" is a more useful reason than the raw error.
        const exists = await db.query<{ reg: string | null }>("select to_regclass($1)::text as reg", [relation]);
        if (!exists.rows[0]?.reg) throw new Error("relation does not exist on this database");
        // `relation` is from the constant list above, never from input.
        const res = await db.query<{ count: string }>(`select count(*)::text as count from ${relation}`);
        return Number(res.rows[0].count);
      }),
    })),
  );

  return { sources, typed, legacy };
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

export type EfficiencyPanel = {
  /** check-*.mjs results. Not persisted anywhere today -- always a reason. */
  gateRuns: Metric<never>;
  /** p50/p95 of server timings. No request-log table exists -- always a reason. */
  requestTimings: Metric<never>;
  /** Median of three `select 1` round trips on this request's connection. */
  dbLatencyMs: Metric<number>;
  dbStats: Metric<DbStats>;
  connections: Metric<{ active: number; max: number }>;
  /** Top statements by total time, if pg_stat_statements is installed. */
  statements: Metric<SlowStatement[]>;
};

async function readEfficiency(db: Client): Promise<EfficiencyPanel> {
  // Sequential on purpose: latency is meaningless if measured while the other
  // reads are in flight on the same connection.
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

  const [dbStats, connections, statements] = await Promise.all([
    attempt(async () => {
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
    }),
    attempt(async () => {
      const res = await db.query<{ active: string; max: string }>(
        `select (select count(*) from pg_stat_activity where datname = current_database())::text as active,
                current_setting('max_connections') as max`,
      );
      return { active: Number(res.rows[0].active), max: Number(res.rows[0].max) };
    }),
    attempt(async () => {
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
          limit 5`,
      );
      return res.rows.map((r) => ({
        calls: Number(r.calls), meanMs: Number(r.mean_ms), totalMs: Number(r.total_ms), query: r.query,
      }));
    }),
  ]);

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
  const [usersWithoutRole, profilesByRole, rls] = await Promise.all([
    attempt(async () => {
      const res = await db.query<{ count: string }>(
        `select count(*)::text as count
           from auth.users u
           left join public.app_user_profile p on p.user_id = u.id
          where p.user_id is null`,
      );
      return Number(res.rows[0].count);
    }),
    attempt(async () => {
      const res = await db.query<{ role_key: string; active: string; inactive: string }>(
        `select role_key,
                count(*) filter (where is_active)::text as active,
                count(*) filter (where not is_active)::text as inactive
           from public.app_user_profile
          group by role_key
          order by role_key`,
      );
      return res.rows.map((r) => ({ roleKey: r.role_key, active: Number(r.active), inactive: Number(r.inactive) }));
    }),
    attempt(async () => {
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
    }),
  ]);
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

export type ConsumptionPanel = {
  dbSize: Metric<{ bytes: number; pretty: string }>;
  largest: Metric<RelationSize[]>;
};

async function readConsumption(db: Client): Promise<ConsumptionPanel> {
  const [dbSize, largest] = await Promise.all([
    attempt(async () => {
      const res = await db.query<{ bytes: string; pretty: string }>(
        `select pg_database_size(current_database())::text as bytes,
                pg_size_pretty(pg_database_size(current_database())) as pretty`,
      );
      return { bytes: Number(res.rows[0].bytes), pretty: res.rows[0].pretty };
    }),
    attempt(async () => {
      const res = await db.query<{ relation: string; bytes: string; pretty: string; est_rows: string }>(
        `select n.nspname || '.' || c.relname as relation,
                pg_total_relation_size(c.oid)::text as bytes,
                pg_size_pretty(pg_total_relation_size(c.oid)) as pretty,
                greatest(c.reltuples, 0)::bigint::text as est_rows
           from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
          where c.relkind in ('r', 'p', 'm')
            and n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
          order by pg_total_relation_size(c.oid) desc
          limit 8`,
      );
      return res.rows.map((r) => ({
        relation: r.relation, bytes: Number(r.bytes), pretty: r.pretty, estRows: Number(r.est_rows),
      }));
    }),
  ]);
  return { dbSize, largest };
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
};

export async function getSystemHealth(): Promise<SystemHealth> {
  const sampledAt = new Date().toISOString();
  const envFlags = readEnvFlags();
  const deploy = readDeploy();

  // The header self-check is a network call to ourselves and must not wait on
  // the database (or vice versa).
  const headersPromise = readHeaders();

  let dbError: string | null = null;
  let panels: {
    freshness: FreshnessPanel; efficiency: EfficiencyPanel;
    security: Omit<SecurityPanel, "envFlags" | "headers">; consumption: ConsumptionPanel;
  } | null = null;

  try {
    panels = await withDb(async (db) => {
      // Latency first and alone (see readEfficiency), then the rest together.
      const efficiency = await readEfficiency(db);
      const [freshness, security, consumption] = await Promise.all([
        readFreshness(db),
        readSecurity(db),
        readConsumption(db),
      ]);
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
  };
}
