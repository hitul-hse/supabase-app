/**
 * History for the developer health portal: the read side of the JSONL that
 * scripts/sample-system-health.mjs appends to.
 *
 * WHERE THE FILE LIVES AND WHY IT IS A FILE
 * -----------------------------------------
 * `~/.night-shift/health-samples.jsonl` on the rig, one JSON object per line,
 * written hourly by the `hse-health-sample` user timer and once per night-shift
 * cycle. It is a file and not a table because the page's queries are all reads
 * and the repo's rule is that nothing on this page writes to the database; the
 * Postgres version is proposed in docs/proposals/health-sample-table.sql and
 * deliberately not applied. `SYSTEM_HEALTH_SAMPLES` overrides the path.
 *
 * THE RULE THIS FILE FOLLOWS
 * --------------------------
 * The same one as src/lib/queries/system-health.ts: a figure is measured or it
 * is `{ ok: false, reason }`. On Vercel there is no file, so every history
 * figure is "n/a — no history on this host" and the page says so instead of
 * drawing a flat line. A malformed line is skipped and counted, never turned
 * into a zero.
 */
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Metric } from "./queries/system-health";

/** One connector's state as the sampler saw it. Ages are relative to `at`. */
export type HealthSampleSource = {
  source: string;
  /** Status of the latest raw.sync_run row, or null when the source has never run. */
  status: "running" | "ok" | "failed" | null;
  startedAt: string | null;
  finishedAt: string | null;
  /** Hours from (finishedAt ?? startedAt) of the latest row to `at`; null when never run. */
  ageHours: number | null;
  /** Hours since the latest run with status ok finished; null when there is none. */
  lastOkAgeHours: number | null;
};

export type HealthSampleScores = {
  freshness: number | null;
  efficiency: number | null;
  security: number | null;
  consumption: number | null;
  composite: number | null;
  capApplied: boolean | null;
  /**
   * The sampler cannot see the web process's env flags or fetch the site's
   * response headers, so its security score is renormalised over RLS coverage
   * and users-without-role only. Stated here so a chart never compares it to
   * the page's four-component security score as if they were the same figure.
   */
  securityScope: string;
};

/** One line of the samples file. A null field carries its reason in `reasons`. */
export type HealthSample = {
  /** ISO instant the sample was taken; every field is as of this instant. */
  at: string;
  host: string | null;
  dbLatencyMs: number | null;
  cacheHitPct: number | null;
  xactCommit: number | null;
  xactRollback: number | null;
  deadlocks: number | null;
  connActive: number | null;
  connMax: number | null;
  dbSizeBytes: number | null;
  dbBudgetBytes: number | null;
  rlsEnabled: number | null;
  rlsTotal: number | null;
  usersWithoutRole: number | null;
  sources: HealthSampleSource[];
  scores: HealthSampleScores;
  /** field name -> why it is null. Absent when everything was measured. */
  reasons?: Record<string, string>;
};

/** Fields of a sample that a trend can be drawn over. */
export type HealthSampleNumericField =
  | "dbLatencyMs" | "cacheHitPct" | "xactCommit" | "xactRollback" | "deadlocks"
  | "connActive" | "connMax" | "dbSizeBytes" | "dbBudgetBytes"
  | "rlsEnabled" | "rlsTotal" | "usersWithoutRole";

export type HealthHistory = Metric<{
  path: string;
  /** Oldest first. */
  samples: HealthSample[];
  /** Lines that were not a parseable sample object. Counted, never silently dropped. */
  skipped: number;
}>;

export const HISTORY_RETENTION_DAYS = 90;

export function defaultSamplesPath(): string {
  return path.join(os.homedir(), ".night-shift", "health-samples.jsonl");
}

export function samplesPath(): string {
  return process.env.SYSTEM_HEALTH_SAMPLES || defaultSamplesPath();
}

/** The minimum a line must satisfy to count as a sample: an object with a parseable `at`. */
function asSample(raw: unknown): HealthSample | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.at !== "string" || Number.isNaN(Date.parse(r.at))) return null;
  const num = (k: string): number | null => (typeof r[k] === "number" && Number.isFinite(r[k]) ? (r[k] as number) : null);
  const sources = Array.isArray(r.sources)
    ? (r.sources as unknown[]).flatMap((s): HealthSampleSource[] => {
        if (!s || typeof s !== "object") return [];
        const o = s as Record<string, unknown>;
        if (typeof o.source !== "string") return [];
        const status = o.status === "running" || o.status === "ok" || o.status === "failed" ? o.status : null;
        const n = (k: string) => (typeof o[k] === "number" && Number.isFinite(o[k]) ? (o[k] as number) : null);
        return [{
          source: o.source,
          status,
          startedAt: typeof o.startedAt === "string" ? o.startedAt : null,
          finishedAt: typeof o.finishedAt === "string" ? o.finishedAt : null,
          ageHours: n("ageHours"),
          lastOkAgeHours: n("lastOkAgeHours"),
        }];
      })
    : [];
  const sc = (r.scores && typeof r.scores === "object" ? r.scores : {}) as Record<string, unknown>;
  const scoreNum = (k: string): number | null => (typeof sc[k] === "number" && Number.isFinite(sc[k]) ? (sc[k] as number) : null);
  return {
    at: r.at,
    host: typeof r.host === "string" ? r.host : null,
    dbLatencyMs: num("dbLatencyMs"),
    cacheHitPct: num("cacheHitPct"),
    xactCommit: num("xactCommit"),
    xactRollback: num("xactRollback"),
    deadlocks: num("deadlocks"),
    connActive: num("connActive"),
    connMax: num("connMax"),
    dbSizeBytes: num("dbSizeBytes"),
    dbBudgetBytes: num("dbBudgetBytes"),
    rlsEnabled: num("rlsEnabled"),
    rlsTotal: num("rlsTotal"),
    usersWithoutRole: num("usersWithoutRole"),
    sources,
    scores: {
      freshness: scoreNum("freshness"),
      efficiency: scoreNum("efficiency"),
      security: scoreNum("security"),
      consumption: scoreNum("consumption"),
      composite: scoreNum("composite"),
      capApplied: typeof sc.capApplied === "boolean" ? sc.capApplied : null,
      securityScope: typeof sc.securityScope === "string" ? sc.securityScope : "unknown",
    },
    reasons: r.reasons && typeof r.reasons === "object" && !Array.isArray(r.reasons)
      ? Object.fromEntries(Object.entries(r.reasons as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === "string"))
      : undefined,
  };
}

/** Parse the JSONL text. Exported so the sampler's gate can exercise it without a file. */
export function parseHealthSamples(text: string): { samples: HealthSample[]; skipped: number } {
  const samples: HealthSample[] = [];
  let skipped = 0;
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const s = asSample(JSON.parse(line));
      if (s) samples.push(s); else skipped += 1;
    } catch {
      skipped += 1;
    }
  }
  samples.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return { samples, skipped };
}

export async function readHealthHistory(): Promise<HealthHistory> {
  const p = samplesPath();
  let text: string;
  try {
    text = await readFile(p, "utf8");
  } catch (e) {
    const code = e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : "";
    const why = code === "ENOENT" ? "the samples file does not exist" : `the samples file could not be read (${code || String(e)})`;
    return { ok: false, reason: `no history on this host — ${why} (${p}); samples are written by the rig's hse-health-sample timer, not by a cloud deployment` };
  }
  const { samples, skipped } = parseHealthSamples(text);
  if (samples.length === 0) {
    return { ok: false, reason: `no history on this host — ${p} holds no parseable sample${skipped ? ` (${skipped} malformed line${skipped === 1 ? "" : "s"})` : ""}` };
  }
  return { ok: true, value: { path: p, samples, skipped } };
}

/** The newest `n` samples, newest first. Empty when there is no history. */
export function latestSamples(history: HealthHistory, n: number): HealthSample[] {
  if (!history.ok) return [];
  return history.value.samples.slice(-Math.max(0, n)).reverse();
}

export const GROWTH_MIN_SPAN_HOURS = 6;

export type Growth = Metric<{
  /** Change per day between the oldest and newest sample that carry the field. Negative when shrinking. */
  perDay: number;
  fromAt: string;
  toAt: string;
  spanHours: number;
  /** Samples in the window that carry the field (the slope uses the two endpoints). */
  samples: number;
}>;

/**
 * Growth per day of one numeric field, from the endpoints of the samples that
 * carry it. Needs two samples at least GROWTH_MIN_SPAN_HOURS apart: a slope over
 * five minutes extrapolated to a day is noise dressed as a number.
 */
export function growthPerDay(samples: HealthSample[], field: HealthSampleNumericField = "dbSizeBytes"): Growth {
  const carrying = samples
    .filter((s) => typeof s[field] === "number")
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  if (carrying.length < 2) {
    return { ok: false, reason: `needs 2 samples with ${field}, have ${carrying.length}` };
  }
  const first = carrying[0];
  const last = carrying[carrying.length - 1];
  const spanHours = (Date.parse(last.at) - Date.parse(first.at)) / 3_600_000;
  if (spanHours < GROWTH_MIN_SPAN_HOURS) {
    return { ok: false, reason: `samples span ${spanHours.toFixed(1)} h; needs ≥ ${GROWTH_MIN_SPAN_HOURS} h to state a daily rate` };
  }
  const delta = (last[field] as number) - (first[field] as number);
  return {
    ok: true,
    value: {
      perDay: delta / (spanHours / 24),
      fromAt: first.at,
      toAt: last.at,
      spanHours,
      samples: carrying.length,
    },
  };
}
