import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import PageTransition from "@/components/animations/PageTransition";
import { Card, CardHeader, CardDivider, ChartNote, StatTile } from "@/components/ui/Card";
import { requirePermission } from "@/utils/supabase/require-profile";
import { PERMISSIONS } from "@/lib/permissions";
import {
  getSystemHealth,
  type Metric,
  type RlsTable,
  type SourceFreshness,
  type SyncRun,
} from "@/lib/queries/system-health";

/**
 * The developer health portal.
 *
 * WHO SEES IT. admin:roles:write is the one administrative key the schema
 * withholds from every non-exec role by name ("HR must not be able to grant
 * itself exec", add_hr_role_and_profile_admin.sql). hr holds admin:users:write
 * and even admin:entries:write, so those would not keep this page exec-only.
 * The permission is checked in the database like every other route; the
 * sidebar's roles filter only decides whether the link is drawn.
 *
 * WHAT IT IS NOT. Not a dashboard of the business -- that is /dashboard/
 * management. This page answers "can the numbers on the other pages be
 * trusted right now": when data last arrived, whether the database is
 * healthy, whether every table is behind RLS, what the deployment is.
 *
 * EVERY FIGURE IS AS OF ONE INSTANT. Rendered on the server per request, no
 * cache, direct Postgres. The header carries the sample time so a screenshot
 * pasted into a thread dates itself.
 */
export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const RLS_PAGE_SIZE = 10;

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

// ─── Formatting ──────────────────────────────────────────────────────────────

const nf = new Intl.NumberFormat("en-GB");

function fmtInt(n: number): string {
  return nf.format(n);
}

/** "3h ago" from an ISO/Postgres timestamp; the exact value goes in a title. */
function ageOf(iso: string | null, now: Date): string {
  if (!iso) return "never";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "unparseable";
  const s = Math.max(0, Math.round((now.getTime() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function hoursSince(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : (now.getTime() - t) / 3_600_000;
}

/** Freshness tone: failed is critical, stale (older than two days) is a warning. */
function runTone(run: SyncRun | null, now: Date): "neutral" | "good" | "warning" | "critical" {
  if (!run) return "neutral";
  if (run.status === "failed") return "critical";
  if (run.status === "running" && (hoursSince(run.startedAt, now) ?? 0) > 6) return "critical";
  const age = hoursSince(run.finishedAt ?? run.startedAt, now);
  if (age === null) return "neutral";
  return age > 48 ? "warning" : "good";
}

const TONE_COLOUR = {
  neutral: "var(--text-muted)",
  good: "var(--good)",
  warning: "var(--warning)",
  critical: "var(--critical)",
} as const;

const LABEL = "font-mono text-[10px] tracking-[0.08em] text-[var(--text-faint)]";
const TH = `sticky top-0 z-10 bg-[var(--surface-2)] px-4 py-1.5 text-left font-mono text-[9px] font-semibold tracking-[0.08em] text-[var(--text-faint)]`;
const TD = "px-4 py-1.5 text-[12px] text-[var(--text-secondary)]";
const TD_NUM = `${TD} text-right font-mono tabular-nums`;

/**
 * The one line under a figure that says why it is blank. Rendered inline so a
 * reader never has to guess whether "n/a" means zero, unknown, or broken.
 */
function Reason({ reason }: { reason: string }) {
  return <span className="font-mono text-[10px] text-[var(--text-faint)]">n/a — {reason}</span>;
}

/** The reason a metric is blank, or the page-level fallback when the panel never loaded. */
function reasonOf<T>(m: Metric<T> | undefined, fallback: string): string {
  if (!m) return fallback;
  return m.ok ? "" : m.reason;
}

function MetricText<T>({ m, render }: { m: Metric<T>; render: (v: T) => React.ReactNode }) {
  return m.ok ? <>{render(m.value)}</> : <Reason reason={m.reason} />;
}

// ─── Panels ──────────────────────────────────────────────────────────────────

function FreshnessRow({ row, now }: { row: SourceFreshness; now: Date }) {
  const run = row.lastRun.ok ? row.lastRun.value : null;
  const tone = row.lastRun.ok ? runTone(run, now) : "neutral";
  return (
    <tr className="align-top">
      <th scope="row" className="px-4 py-1.5 text-left font-mono text-[11px] font-semibold text-[var(--text-primary)]">
        <span className="flex items-center gap-2">
          <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: TONE_COLOUR[tone] }} />
          {row.source}
        </span>
      </th>
      <td className={TD}>
        <MetricText
          m={row.lastRun}
          render={(r) =>
            r ? (
              <span className="flex flex-col gap-0.5">
                <span title={r.finishedAt ?? r.startedAt} className="font-mono tabular-nums">
                  {ageOf(r.finishedAt ?? r.startedAt, now)}
                  <span className="text-[var(--text-faint)]"> · {r.status}</span>
                </span>
                <span className="font-mono text-[10px] text-[var(--text-faint)]">
                  {r.entity}
                  {r.recordCount !== null ? ` · ${fmtInt(r.recordCount)} records` : ""}
                </span>
                {r.errorMessage && (
                  <span className="text-[11px] text-[var(--critical)]">{r.errorMessage}</span>
                )}
              </span>
            ) : (
              <Reason reason="no row in raw.sync_run — this connector has never run" />
            )
          }
        />
      </td>
      <td className={TD_NUM}>
        <MetricText m={row.raw} render={(r) => fmtInt(r.count)} />
      </td>
      <td className={`${TD} font-mono tabular-nums`}>
        <MetricText
          m={row.raw}
          render={(r) => (
            <span title={r.lastFetchedAt ?? undefined}>{ageOf(r.lastFetchedAt, now)}</span>
          )}
        />
      </td>
    </tr>
  );
}

function RlsPager({ currentPage, pageCount, total }: { currentPage: number; pageCount: number; total: number }) {
  // The house pager: first, last, a one-step window, elided middle. Server
  // <Link>s so the page state lives in the URL (docs/UI-CONVENTIONS.md §2-3).
  const windowed: (number | "gap")[] = [];
  for (let n = 1; n <= pageCount; n += 1) {
    if (n === 1 || n === pageCount || Math.abs(n - currentPage) <= 1) windowed.push(n);
    else if (windowed[windowed.length - 1] !== "gap") windowed.push("gap");
  }
  const pageLink = (n: number, label: string, disabled: boolean, current = false) =>
    disabled ? (
      <span key={`${label}-off`} className="border border-[var(--border)] px-2.5 py-1 font-mono text-[10px] text-[var(--text-faint)] opacity-40">{label}</span>
    ) : (
      <Link
        key={`${label}-${n}`}
        href={`/admin/system-health?page=${n}#rls`}
        scroll={false}
        aria-current={current ? "page" : undefined}
        className={`border px-2.5 py-1 font-mono text-[10px] transition-colors ${current ? "border-[var(--accent)] bg-[var(--accent-wash)] text-[var(--accent)]" : "border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"}`}
      >
        {label}
      </Link>
    );
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--divider)] px-4 py-3">
      <span className="font-mono text-[10px] text-[var(--text-faint)]">
        PAGE {currentPage} OF {pageCount} · {total} TABLES
      </span>
      <nav aria-label="Tables without RLS, pages" className="flex items-center gap-1.5">
        {pageLink(currentPage - 1, "Prev", currentPage === 1)}
        {windowed.map((n, i) =>
          n === "gap" ? (
            <span key={`gap-${i}`} className="px-1 font-mono text-[10px] text-[var(--text-faint)]">…</span>
          ) : (
            pageLink(n, String(n), false, n === currentPage)
          ),
        )}
        {pageLink(currentPage + 1, "Next", currentPage === pageCount)}
      </nav>
    </div>
  );
}

function RlsOffTable({ rows }: { rows: RlsTable[] }) {
  return (
    <table className="w-full border-collapse text-left">
      <caption className="sr-only">Tables with row level security off</caption>
      <thead>
        <tr>
          <th scope="col" className={TH}>TABLE</th>
          <th scope="col" className={`${TH} text-right`}>POLICIES</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-[var(--divider)]">
        {rows.map((r) => (
          <tr key={r.relation}>
            <th scope="row" className="px-4 py-1.5 text-left font-mono text-[11px] font-semibold text-[var(--critical)]">{r.relation}</th>
            <td className={TD_NUM}>{r.policies}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default async function SystemHealthPage({ searchParams }: { searchParams: SearchParams }) {
  await requirePermission("/admin/system-health", PERMISSIONS.ADMIN_ROLES_WRITE);

  const params = await searchParams;
  const health = await getSystemHealth();
  const now = new Date(health.sampledAt);
  const dbFallback = health.dbError ?? "database unreachable";
  const { freshness, efficiency, security, consumption, deploy } = health;

  // RLS-off list paging: clamp out-of-range pages to the last one.
  const rlsOff = security.rls.ok ? security.rls.value.off : [];
  const rlsPageCount = Math.max(1, Math.ceil(rlsOff.length / RLS_PAGE_SIZE));
  const requested = Number.parseInt(first(params.page) ?? "1", 10);
  const rlsPage = Math.min(rlsPageCount, Math.max(1, Number.isNaN(requested) ? 1 : requested));
  const rlsSlice = rlsOff.slice((rlsPage - 1) * RLS_PAGE_SIZE, rlsPage * RLS_PAGE_SIZE);

  const rlsCoverage: Metric<string> = security.rls.ok
    ? { ok: true, value: `${security.rls.value.enabled} / ${security.rls.value.total}` }
    : security.rls;
  const rlsTone = security.rls.ok
    ? security.rls.value.enabled === security.rls.value.total ? "good" : "critical"
    : "neutral";

  const deployLabel = deploy.deploymentId
    ? `${deploy.env ?? "vercel"} · ${deploy.deploymentId}${deploy.commit ? ` · ${deploy.commit}` : ""}${deploy.region ? ` · ${deploy.region}` : ""}`
    : "rig — no VERCEL_DEPLOYMENT_ID in this process";

  return (
    <PageTransition>
      <div className="flex flex-col">
        <PageHeader
          title="System Health"
          meta={`FRESHNESS · EFFICIENCY · SECURITY · CONSUMPTION · DIRECT POSTGRES · SAMPLED ${health.sampledAt}`}
        />
        <main className="flex flex-col gap-4 page-shell">
          {health.dbError && (
            <Card>
              <CardHeader title="Database unreachable" qualifier="EVERY DB-BACKED FIGURE BELOW IS N/A" />
              <p className="px-4 pb-4 text-[12px] text-[var(--text-muted)]">{health.dbError}</p>
            </Card>
          )}

          {/* Headline strip: the four numbers that decide whether to read on. */}
          <div className="grid grid-cols-2 gap-[var(--card-gap)] lg:grid-cols-4">
            <StatTile
              data-metric="db-latency"
              label="DB ROUND TRIP"
              value={efficiency?.dbLatencyMs.ok ? efficiency.dbLatencyMs.value : null}
              unit="ms"
              hint={efficiency?.dbLatencyMs.ok ? "median of 3 × select 1, this request" : reasonOf(efficiency?.dbLatencyMs, dbFallback)}
              tone={efficiency?.dbLatencyMs.ok ? (efficiency.dbLatencyMs.value > 250 ? "warning" : "good") : "neutral"}
            />
            <StatTile
              data-metric="rls-coverage"
              label="RLS ENABLED"
              value={rlsCoverage.ok ? rlsCoverage.value : null}
              unit="tables"
              hint={rlsCoverage.ok ? "public · raw · stg · time · projects · crm · hr · platform" : rlsCoverage.reason}
              tone={rlsTone}
            />
            <StatTile
              data-metric="users-without-role"
              label="USERS WITHOUT ROLE"
              value={security.usersWithoutRole.ok ? security.usersWithoutRole.value : null}
              hint={security.usersWithoutRole.ok ? "auth.users with no app_user_profile" : security.usersWithoutRole.reason}
              tone={security.usersWithoutRole.ok ? (security.usersWithoutRole.value > 0 ? "warning" : "good") : "neutral"}
            />
            <StatTile
              data-metric="db-size"
              label="DATABASE SIZE"
              value={consumption?.dbSize.ok ? consumption.dbSize.value.pretty : null}
              hint={consumption?.dbSize.ok ? "pg_database_size(current_database())" : reasonOf(consumption?.dbSize, dbFallback)}
            />
          </div>

          {/* 1. Data freshness */}
          <Card as="section" aria-labelledby="freshness-h">
            <CardHeader title="Data freshness" qualifier="RAW.SYNC_RUN · RAW.VENDOR_RECORD · PER CONNECTOR" />
            <div className="overflow-x-auto border-t border-[var(--divider)]">
              <table className="w-full border-collapse text-left">
                <caption id="freshness-h" className="sr-only">Last sync per connector</caption>
                <thead>
                  <tr>
                    <th scope="col" className={TH}>SOURCE</th>
                    <th scope="col" className={TH}>LAST RUN</th>
                    <th scope="col" className={`${TH} text-right`}>RAW RECORDS</th>
                    <th scope="col" className={TH}>LAST FETCHED</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--divider)]">
                  {freshness
                    ? freshness.sources.map((row) => <FreshnessRow key={row.source} row={row} now={now} />)
                    : (
                      <tr>
                        <td colSpan={4} className={TD}><Reason reason={dbFallback} /></td>
                      </tr>
                    )}
                </tbody>
              </table>
            </div>
            <ChartNote>
              Last run is the newest raw.sync_run row per source (any entity); a run older than 48 hours is amber, a failed one red,
              one still marked running after six hours red. Raw records are exact counts from raw.vendor_record with the newest fetched_at.
            </ChartNote>

            <CardDivider />
            <CardHeader title="Typed layer" qualifier="EXACT ROW COUNTS · TABLES EACH CONNECTOR FEEDS" />
            <div className="overflow-x-auto border-t border-[var(--divider)]">
              <table className="w-full border-collapse text-left">
                <caption className="sr-only">Row counts in the typed tables</caption>
                <thead>
                  <tr>
                    <th scope="col" className={TH}>TABLE</th>
                    <th scope="col" className={TH}>SOURCE</th>
                    <th scope="col" className={`${TH} text-right`}>ROWS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--divider)]">
                  {freshness
                    ? freshness.typed.map((t) => (
                      <tr key={t.relation}>
                        <th scope="row" className="px-4 py-1.5 text-left font-mono text-[11px] font-semibold text-[var(--text-primary)]">{t.relation}</th>
                        <td className={TD}>{t.source}</td>
                        <td className={TD_NUM}><MetricText m={t.rows} render={fmtInt} /></td>
                      </tr>
                    ))
                    : (
                      <tr>
                        <td colSpan={3} className={TD}><Reason reason={dbFallback} /></td>
                      </tr>
                    )}
                </tbody>
              </table>
            </div>

            <CardDivider />
            <CardHeader title="Legacy sync bar table" qualifier="PUBLIC.SYNC_SOURCES · SELF-REPORTED TEXT · NO TIMESTAMP" />
            <div className="px-4 pb-3">
              {freshness ? (
                <MetricText
                  m={freshness.legacy}
                  render={(rows) => (
                    <ul className="flex flex-wrap gap-x-4 gap-y-1">
                      {rows.map((r) => (
                        <li key={r.source} className="font-mono text-[10px] text-[var(--text-muted)]">
                          <span className="text-[var(--text-primary)]">{r.source}</span> · {r.status} · {r.freshness}
                        </li>
                      ))}
                    </ul>
                  )}
                />
              ) : (
                <Reason reason={dbFallback} />
              )}
            </div>
            <ChartNote>
              This table has no timestamp column and was seeded for a mockup (see queries/overview-live.ts). It is shown so a
              disagreement with raw.sync_run is visible; it is not evidence that a sync happened.
            </ChartNote>
          </Card>

          {/* 2. Processing efficiency */}
          <Card as="section" aria-labelledby="efficiency-h">
            <CardHeader title="Processing efficiency" qualifier="PG_STAT_DATABASE · PG_STAT_ACTIVITY · PG_STAT_STATEMENTS" />
            <h3 id="efficiency-h" className="sr-only">Processing efficiency</h3>
            <div className="grid grid-cols-2 gap-[var(--card-gap)] px-4 pb-4 lg:grid-cols-4">
              <div className="flex flex-col gap-1">
                <span className={LABEL}>GATE RUNS</span>
                <Reason reason={reasonOf(efficiency?.gateRuns, "not persisted")} />
              </div>
              <div className="flex flex-col gap-1">
                <span className={LABEL}>SERVER TIMINGS P50 / P95</span>
                <Reason reason={reasonOf(efficiency?.requestTimings, "not instrumented")} />
              </div>
              <div className="flex flex-col gap-1">
                <span className={LABEL}>BUFFER CACHE HIT</span>
                {efficiency ? (
                  <MetricText
                    m={efficiency.dbStats}
                    render={(s) =>
                      s.cacheHitPct === null
                        ? <Reason reason="no block reads recorded since stats reset" />
                        : <span className="font-mono text-[15px] font-semibold tabular-nums text-[var(--text-primary)]">{s.cacheHitPct}<span className="text-[11px] font-normal text-[var(--text-muted)]"> %</span></span>
                    }
                  />
                ) : <Reason reason={dbFallback} />}
              </div>
              <div className="flex flex-col gap-1">
                <span className={LABEL}>CONNECTIONS</span>
                {efficiency ? (
                  <MetricText
                    m={efficiency.connections}
                    render={(c) => <span className="font-mono text-[15px] font-semibold tabular-nums text-[var(--text-primary)]">{c.active}<span className="text-[11px] font-normal text-[var(--text-muted)]"> of {c.max}</span></span>}
                  />
                ) : <Reason reason={dbFallback} />}
              </div>
            </div>
            {efficiency?.dbStats.ok && (
              <ChartNote>
                Since stats reset {efficiency.dbStats.value.statsReset ? `${ageOf(efficiency.dbStats.value.statsReset, now)} (${efficiency.dbStats.value.statsReset})` : "(never)"}:
                {" "}{fmtInt(efficiency.dbStats.value.xactCommit)} commits, {fmtInt(efficiency.dbStats.value.xactRollback)} rollbacks,
                {" "}{fmtInt(efficiency.dbStats.value.deadlocks)} deadlocks. Cache hit is blks_hit / (blks_hit + blks_read) for this database.
              </ChartNote>
            )}

            <CardDivider />
            <CardHeader title="Heaviest statements" qualifier="PG_STAT_STATEMENTS · TOP 5 BY TOTAL TIME · NORMALISED TEXT" />
            <div className="overflow-x-auto border-t border-[var(--divider)]">
              {efficiency?.statements.ok ? (
                <table className="w-full border-collapse text-left">
                  <caption className="sr-only">Heaviest statements by total execution time</caption>
                  <thead>
                    <tr>
                      <th scope="col" className={TH}>STATEMENT</th>
                      <th scope="col" className={`${TH} text-right`}>CALLS</th>
                      <th scope="col" className={`${TH} text-right`}>MEAN MS</th>
                      <th scope="col" className={`${TH} text-right`}>TOTAL MS</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--divider)]">
                    {efficiency.statements.value.map((s, i) => (
                      <tr key={i} className="align-top">
                        <td className={`${TD} max-w-[32rem] truncate font-mono text-[11px]`} title={s.query}>{s.query}</td>
                        <td className={TD_NUM}>{fmtInt(s.calls)}</td>
                        <td className={TD_NUM}>{s.meanMs}</td>
                        <td className={TD_NUM}>{fmtInt(s.totalMs)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="px-4 py-3"><Reason reason={reasonOf(efficiency?.statements, dbFallback)} /></p>
              )}
            </div>
          </Card>

          {/* 3. Security posture */}
          <Card as="section" aria-labelledby="security-h">
            <CardHeader title="Security posture" qualifier="AUTH.USERS · APP_USER_PROFILE · PG_CLASS · PROCESS.ENV (PRESENCE ONLY)" />
            <h3 id="security-h" className="sr-only">Security posture</h3>
            <div className="grid gap-[var(--card-gap)] px-4 pb-4 lg:grid-cols-2">
              <div className="flex flex-col gap-2">
                <span className={LABEL}>PROFILES BY ROLE</span>
                <MetricText
                  m={security.profilesByRole}
                  render={(rows) => (
                    <table className="w-full border-collapse text-left">
                      <caption className="sr-only">Profiles by role</caption>
                      <thead>
                        <tr>
                          <th scope="col" className={TH}>ROLE</th>
                          <th scope="col" className={`${TH} text-right`}>ACTIVE</th>
                          <th scope="col" className={`${TH} text-right`}>INACTIVE</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--divider)]">
                        {rows.map((r) => (
                          <tr key={r.roleKey}>
                            <th scope="row" className="px-4 py-1.5 text-left font-mono text-[11px] font-semibold text-[var(--text-primary)]">{r.roleKey}</th>
                            <td className={TD_NUM}>{r.active}</td>
                            <td className={TD_NUM}>{r.inactive}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                />
              </div>
              <div className="flex flex-col gap-2">
                <span className={LABEL}>SERVER ENVIRONMENT · PRESENCE FLAGS</span>
                <ul className="flex flex-col divide-y divide-[var(--divider)]">
                  {security.envFlags.map((f) => (
                    <li key={f.name} className="flex items-center justify-between gap-3 px-4 py-1.5">
                      <span className="font-mono text-[11px] text-[var(--text-primary)]">{f.name}</span>
                      <span className="font-mono text-[10px] tracking-[0.08em]" style={{ color: f.set ? "var(--good)" : "var(--critical)" }}>
                        {f.set ? "SET" : "MISSING"}
                      </span>
                    </li>
                  ))}
                </ul>
                <span className={LABEL}>DEPLOYMENT</span>
                <span className="px-4 font-mono text-[11px] text-[var(--text-secondary)]">{deployLabel}</span>
              </div>
            </div>

            <CardDivider />
            <CardHeader
              title="Response headers"
              qualifier={security.headers.ok ? `GET ${security.headers.value.url} · HTTP ${security.headers.value.status}` : "SELF-CHECK AGAINST NEXT_PUBLIC_SITE_URL"}
            />
            <div className="overflow-x-auto border-t border-[var(--divider)]">
              {security.headers.ok ? (
                <table className="w-full border-collapse text-left">
                  <caption className="sr-only">Security headers observed on the site&apos;s own origin</caption>
                  <thead>
                    <tr>
                      <th scope="col" className={TH}>HEADER</th>
                      <th scope="col" className={TH}>EXPECTED</th>
                      <th scope="col" className={TH}>OBSERVED</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--divider)]">
                    {security.headers.value.checks.map((c) => {
                      const ok = c.expected === null ? c.observed !== null : c.observed === c.expected;
                      return (
                        <tr key={c.name}>
                          <th scope="row" className="px-4 py-1.5 text-left font-mono text-[11px] font-semibold text-[var(--text-primary)]">{c.name}</th>
                          <td className={`${TD} font-mono text-[11px]`}>{c.expected ?? "present"}</td>
                          <td className={`${TD} font-mono text-[11px]`} style={{ color: ok ? "var(--good)" : "var(--critical)" }}>
                            {c.observed ?? "missing"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <p className="px-4 py-3"><Reason reason={security.headers.reason} /></p>
              )}
            </div>

            <CardDivider />
            <div id="rls">
              <CardHeader
                title="Tables without row level security"
                qualifier={security.rls.ok ? `${security.rls.value.off.length} OF ${security.rls.value.total} · ${security.rls.value.lockedNoPolicy.length} MORE ARE RLS-ON WITH ZERO POLICIES (SERVICE ROLE ONLY)` : "PG_CLASS.RELROWSECURITY"}
              />
              <div className="overflow-x-auto border-t border-[var(--divider)]">
                {!security.rls.ok ? (
                  <p className="px-4 py-3"><Reason reason={security.rls.reason} /></p>
                ) : rlsOff.length === 0 ? (
                  <p className="px-4 py-3 font-mono text-[11px] text-[var(--good)]">Every table in the app schemas has RLS enabled.</p>
                ) : (
                  <RlsOffTable rows={rlsSlice} />
                )}
              </div>
              {rlsOff.length > RLS_PAGE_SIZE && (
                <RlsPager currentPage={rlsPage} pageCount={rlsPageCount} total={rlsOff.length} />
              )}
            </div>
          </Card>

          {/* 4. Consumption */}
          <Card as="section" aria-labelledby="consumption-h">
            <CardHeader title="Consumption" qualifier="PG_TOTAL_RELATION_SIZE · LARGEST 8 · TABLE + INDEXES + TOAST" />
            <h3 id="consumption-h" className="sr-only">Consumption</h3>
            <div className="overflow-x-auto border-t border-[var(--divider)]">
              {consumption?.largest.ok ? (
                <table className="w-full border-collapse text-left">
                  <caption className="sr-only">Largest relations</caption>
                  <thead>
                    <tr>
                      <th scope="col" className={TH}>RELATION</th>
                      <th scope="col" className={`${TH} text-right`}>SIZE</th>
                      <th scope="col" className={`${TH} text-right`}>EST. ROWS</th>
                      <th scope="col" className={`${TH} text-right`}>SHARE</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--divider)]">
                    {consumption.largest.value.map((r) => {
                      const share = consumption.dbSize.ok && consumption.dbSize.value.bytes > 0
                        ? Math.round((r.bytes / consumption.dbSize.value.bytes) * 100)
                        : null;
                      return (
                        <tr key={r.relation}>
                          <th scope="row" className="px-4 py-1.5 text-left font-mono text-[11px] font-semibold text-[var(--text-primary)]">{r.relation}</th>
                          <td className={TD_NUM}>{r.pretty}</td>
                          <td className={TD_NUM}>{fmtInt(r.estRows)}</td>
                          <td className={TD_NUM}>{share === null ? "n/a" : `${share}%`}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <p className="px-4 py-3"><Reason reason={reasonOf(consumption?.largest, dbFallback)} /></p>
              )}
            </div>
            <ChartNote>
              Est. rows is pg_class.reltuples, the planner&apos;s estimate from the last ANALYZE, not a count. Share is against the
              whole database size, which also includes catalogs and free space.
            </ChartNote>
          </Card>
        </main>
      </div>
    </PageTransition>
  );
}
