/**
 * The drill-down payloads for /admin/system-health, built on the server.
 *
 * THE ONE LAW (src/components/DrillDialog.tsx): the rows must reconcile with
 * the headline. Every drill here states `check` and `headlineValue`, and where
 * the arithmetic has a step the figure hides -- rounding once at the end, the
 * 49 cap, the 0 floor -- that step is an explicit, labelled row with the
 * exact remainder as its magnitude. A gate can add the rows up itself.
 *
 * Text that the read model already wrote as a diagnostic sentence (a
 * component's `detail`, a Metric's `reason`, a statement's normalised query)
 * passes through verbatim; every label, kicker, footer and value the page
 * itself composes goes through the `systemHealth` catalogue.
 */
import type { Drill, DrillRow } from "@/components/DrillDialog";
import type { Tone } from "@/components/ui/Charts";
import { CAP_SCORE, CAP_THRESHOLD, SUBSCORE_WEIGHTS, type HealthScore, type SubScore, type SubScoreKey } from "@/lib/health-score";
import type { RlsSummary, RelationSize, RoleCount, SlowStatement, SyncRunRow, TypedTableCount } from "@/lib/queries/system-health";
import { fmt1, fmtBytes, fmtHours, fmtInt, fmtMs, fmtPct, fmtTime } from "./format";

type T = (key: string, values?: Record<string, string | number | Date>) => string;

const KICKER: Record<SubScoreKey, string> = {
  freshness: "subs.freshness",
  efficiency: "subs.efficiency",
  security: "subs.security",
  consumption: "subs.consumption",
};

// ─── Hero ────────────────────────────────────────────────────────────────────

/**
 * One sub-score: its components as rows whose magnitudes SUM to the score.
 * A measured component contributes points × weight ÷ Σ weight (over the
 * measured weighted components); a weight-0 adjustment contributes its points
 * after the mean; an excluded one contributes 0 and says why. Rounding and
 * the 0-100 clamp happen once in health-score.ts, so the last row carries
 * exactly that remainder when it is not zero.
 */
export function subScoreDrill(t: T, key: SubScoreKey, label: string, weight: number, sub: SubScore): Drill {
  const kicker = t("drills.subKicker", { name: t(KICKER[key]).toUpperCase(), weight });
  if (!sub.ok) {
    return {
      kicker,
      title: t("drills.subTitle", { name: label }),
      headline: t("na"),
      subline: sub.reason,
      rows: [],
      error: sub.reason,
      footer: t("drills.subFooter"),
    };
  }
  const { score, components } = sub.value;
  const weighted = components.filter((c) => c.points !== null && c.weight > 0);
  const sumW = weighted.reduce((a, c) => a + c.weight, 0);
  const rows: DrillRow[] = components.map((c): DrillRow => {
    if (c.points === null) {
      return { name: c.label, sub: c.excludedReason ?? c.detail, value: t("drills.excluded"), magnitude: 0, tone: "muted" };
    }
    if (c.weight === 0) {
      return { name: c.label, sub: c.detail, value: `${c.points >= 0 ? "+" : "−"}${fmt1(Math.abs(c.points))}`, magnitude: c.points, tone: c.points < 0 ? "critical" : "muted" };
    }
    const contribution = sumW > 0 ? (c.points * c.weight) / sumW : 0;
    return {
      name: c.label,
      sub: c.detail,
      value: t("drills.pointsTimesWeight", { points: fmt1(c.points), weight: c.weight }),
      magnitude: contribution,
      tone: c.points >= 80 ? "accent" : c.points >= 50 ? "warning" : "critical",
    };
  });
  // The one step the rows cannot show: round(mean + adjustments) clamped to 0-100.
  const raw = rows.reduce((a, r) => a + r.magnitude, 0);
  const remainder = score - raw;
  if (Math.abs(remainder) >= 0.5) {
    rows.push({ name: t("drills.clampRow"), sub: t("drills.clampSub"), value: `${remainder >= 0 ? "+" : "−"}${fmt1(Math.abs(remainder))}`, magnitude: remainder, tone: "muted" });
  }
  return {
    kicker,
    title: t("drills.subTitle", { name: label }),
    headline: String(score),
    headlineValue: score,
    check: "sum",
    subline: t("drills.subSubline", { measured: weighted.length, total: components.length }),
    rows,
    footer: t("drills.subFooter"),
  };
}

/** The composite: four sub-scores as rows summing to the score, the cap as a row when it applied. */
export function compositeDrill(
  t: T,
  score: HealthScore,
  subs: { key: SubScoreKey; label: string; weight: number; score: number | null; reason: string | null }[],
): Drill {
  const kicker = t("drills.compositeKicker");
  const title = t("drills.compositeTitle");
  const footer = t("drills.compositeFooter", { cap: CAP_SCORE, threshold: CAP_THRESHOLD });
  const c = score.composite;
  const measured = subs.filter((s) => s.score !== null);
  const sumW = measured.reduce((a, s) => a + s.weight, 0);
  const rows: DrillRow[] = subs.map((s): DrillRow => {
    if (s.score === null) {
      return { name: s.label, sub: s.reason ?? t("na"), value: t("na"), magnitude: 0, tone: "muted" };
    }
    const below = s.score < CAP_THRESHOLD;
    return {
      name: s.label,
      sub: below ? t("drills.belowThreshold", { threshold: CAP_THRESHOLD }) : t("drills.weightOf", { weight: s.weight, total: sumW }),
      value: t("drills.pointsTimesWeight", { points: String(s.score), weight: s.weight }),
      magnitude: (s.score * s.weight) / sumW,
      tone: s.score >= 80 ? "accent" : s.score >= 50 ? "warning" : "critical",
    };
  });
  if (!c.ok) {
    return { kicker, title, headline: t("na"), subline: c.reason, rows, error: c.reason, footer };
  }
  const raw = rows.reduce((a, r) => a + r.magnitude, 0);
  const remainder = c.value.score - raw;
  if (Math.abs(remainder) >= 0.5) {
    rows.push({
      name: c.value.capApplied ? t("drills.capRow", { cap: CAP_SCORE }) : t("drills.clampRow"),
      sub: c.value.capApplied ? t("drills.capSub", { threshold: CAP_THRESHOLD }) : t("drills.clampSub"),
      value: `${remainder >= 0 ? "+" : "−"}${fmt1(Math.abs(remainder))}`,
      magnitude: remainder,
      tone: c.value.capApplied ? "critical" : "muted",
    });
  }
  const weakest = subs.find((s) => s.key === c.value.weakest);
  return {
    kicker,
    title,
    headline: String(c.value.score),
    headlineValue: c.value.score,
    check: "sum",
    subline: t("drills.compositeSubline", {
      weakest: weakest?.label ?? c.value.weakest,
      cap: c.value.capApplied ? t("hero.capApplied") : t("hero.capNotApplied"),
      measured: c.value.measured,
      total: SUBSCORE_WEIGHTS.length,
    }),
    rows,
    footer,
  };
}

// ─── Freshness ───────────────────────────────────────────────────────────────

export function ageDrill(t: T, rows: { source: string; hours: number | null; text: string; tone: Tone }[]): Drill {
  return {
    kicker: t("drills.ageKicker"),
    title: t("drills.ageTitle"),
    headline: t("drills.connectors", { count: rows.length }),
    headlineValue: rows.length,
    check: "count",
    rows: rows.map((r): DrillRow => ({
      name: r.source,
      sub: r.text,
      value: r.hours === null ? t("na") : fmtHours(r.hours),
      magnitude: r.hours ?? 0,
      tone: r.tone === "good" ? "accent" : r.tone === "warning" ? "warning" : r.tone === "critical" ? "critical" : "muted",
    })),
    footer: t("drills.ageFooter"),
  };
}

export function runsDrill(t: T, runs: SyncRunRow[], count: number): Drill {
  return {
    kicker: t("drills.runsKicker"),
    title: t("drills.runsTitle"),
    headline: t("drills.runs", { count }),
    headlineValue: count,
    check: "count",
    rows: runs.map((r): DrillRow => ({
      name: `${r.source} · ${r.entity}`,
      sub: `${fmtTime(r.startedAt)}${r.errorMessage ? ` · ${r.errorMessage.slice(0, 80)}` : ""}`,
      value: r.recordCount !== null ? `${t(`freshness.runStatus.${r.status}`)} · ${fmtInt(r.recordCount)}` : t(`freshness.runStatus.${r.status}`),
      magnitude: r.recordCount ?? 0,
      tone: r.status === "failed" ? "critical" : r.status === "running" ? "warning" : "accent",
    })),
    footer: t("drills.runsFooter"),
  };
}

export function typedDrill(t: T, typed: TypedTableCount[]): Drill {
  const total = typed.reduce((a, r) => a + (r.rows.ok ? r.rows.value : 0), 0);
  const missing = typed.filter((r) => !r.rows.ok).length;
  return {
    kicker: t("drills.typedKicker"),
    title: t("drills.typedTitle"),
    headline: t("drills.rows", { count: fmtInt(total) }),
    headlineValue: total,
    check: "sum",
    subline: missing ? t("drills.typedMissing", { count: missing }) : undefined,
    rows: typed.map((r): DrillRow => (
      r.rows.ok
        ? { name: r.relation, sub: r.source, value: fmtInt(r.rows.value), magnitude: r.rows.value, tone: "accent" }
        : { name: r.relation, sub: `${r.source} · ${r.rows.reason}`, value: t("na"), magnitude: 0, tone: "muted" }
    )),
    footer: t("drills.typedFooter"),
  };
}

// ─── Efficiency ──────────────────────────────────────────────────────────────

export function cacheDrill(t: T, pct: number, statsReset: string | null): Drill {
  const miss = Math.round((100 - pct) * 10) / 10;
  return {
    kicker: t("drills.cacheKicker"),
    title: t("drills.cacheTitle"),
    headline: fmtPct(100),
    headlineValue: 100,
    check: "sum",
    subline: t("drills.cacheSubline", { pct: fmt1(pct) }),
    rows: [
      { name: t("drills.cacheHitRow"), sub: t("drills.cacheHitSub"), value: fmtPct(pct, 1), magnitude: pct, tone: "accent" },
      { name: t("drills.cacheMissRow"), sub: t("drills.cacheMissSub"), value: fmtPct(miss, 1), magnitude: 100 - pct, tone: miss > 1 ? "warning" : "muted" },
    ],
    footer: statsReset ? t("drills.sinceReset", { at: fmtTime(statsReset) }) : t("drills.noReset"),
  };
}

export function connectionsDrill(t: T, active: number, max: number): Drill {
  return {
    kicker: t("drills.connKicker"),
    title: t("drills.connTitle"),
    headline: fmtInt(max),
    headlineValue: max,
    check: "sum",
    subline: t("drills.connSubline", { pct: fmt1((active / max) * 100) }),
    rows: [
      { name: t("drills.connActive"), sub: t("drills.connActiveSub"), value: fmtInt(active), magnitude: active, tone: "accent" },
      { name: t("drills.connFree"), sub: t("drills.connFreeSub"), value: fmtInt(max - active), magnitude: max - active, tone: "muted" },
    ],
    footer: t("drills.connFooter"),
  };
}

export function xactDrill(t: T, commits: number, rollbacks: number, statsReset: string | null): Drill {
  const total = commits + rollbacks;
  return {
    kicker: t("drills.xactKicker"),
    title: t("drills.xactTitle"),
    headline: fmtInt(total),
    headlineValue: total,
    check: "sum",
    subline: t("drills.xactSubline", { pct: fmt1((rollbacks / total) * 100) }),
    rows: [
      { name: t("drills.commits"), value: fmtInt(commits), magnitude: commits, tone: "accent" },
      { name: t("drills.rollbacks"), value: fmtInt(rollbacks), magnitude: rollbacks, tone: "critical" },
    ],
    footer: statsReset ? t("drills.sinceReset", { at: fmtTime(statsReset) }) : t("drills.noReset"),
  };
}

export function statementsDrill(t: T, all: SlowStatement[], totalMs: number, cap: number): Drill {
  return {
    kicker: t("drills.stmtKicker"),
    title: t("drills.stmtTitle", { count: all.length }),
    headline: fmtMs(totalMs),
    headlineValue: totalMs,
    check: "sum",
    subline: t("drills.stmtSubline", { count: all.length }),
    rows: all.map((s, i): DrillRow => ({
      name: s.query,
      sub: t("drills.stmtSub", { calls: fmtInt(s.calls), mean: fmt1(s.meanMs) }),
      value: fmtMs(s.totalMs),
      magnitude: s.totalMs,
      tone: i < 5 ? "accent" : "muted",
    })),
    footer: t("drills.stmtFooter", { cap }),
  };
}

// ─── Security ────────────────────────────────────────────────────────────────

export function rlsDrill(t: T, rls: RlsSummary): Drill {
  const listed = rls.off.length + rls.lockedNoPolicy.length;
  const rows: DrillRow[] = [
    ...rls.off.map((r): DrillRow => ({
      name: r.relation,
      sub: t("drills.rlsOffSub", { policies: r.policies }),
      value: t("drills.rlsOff"),
      magnitude: 1,
      tone: "critical",
    })),
    ...rls.lockedNoPolicy.map((r): DrillRow => ({
      name: r.relation,
      sub: t("drills.rlsLockedSub"),
      value: t("drills.rlsLocked"),
      magnitude: 1,
      tone: "muted",
    })),
  ];
  return {
    kicker: t("drills.rlsKicker"),
    title: t("drills.rlsTitle"),
    headline: t("drills.tables", { count: listed }),
    headlineValue: listed,
    check: "count",
    subline: t("drills.rlsSubline", { enabled: rls.enabled, total: rls.total, pct: Math.round((rls.enabled / rls.total) * 100) }),
    rows,
    footer: t("drills.rlsFooter"),
  };
}

export function profilesDrill(t: T, rows: RoleCount[], total: number): Drill {
  return {
    kicker: t("drills.profilesKicker"),
    title: t("drills.profilesTitle"),
    headline: t("drills.profiles", { count: fmtInt(total) }),
    headlineValue: total,
    check: "sum",
    rows: rows.map((r): DrillRow => ({
      name: r.roleKey,
      sub: t("drills.profileSub", { active: fmtInt(r.active), inactive: fmtInt(r.inactive) }),
      value: fmtInt(r.active + r.inactive),
      magnitude: r.active + r.inactive,
      tone: r.active + r.inactive === r.inactive ? "muted" : "accent",
    })),
    footer: t("drills.profilesFooter"),
  };
}

// ─── Consumption ─────────────────────────────────────────────────────────────

export function relationsDrill(t: T, largest: RelationSize[], otherBytes: number, otherCount: number, totalBytes: number, cap: number): Drill {
  const rows: DrillRow[] = largest.map((r): DrillRow => ({
    name: r.relation,
    sub: t("drills.estRows", { rows: fmtInt(r.estRows) }),
    value: r.pretty,
    magnitude: r.bytes,
    tone: "accent",
  }));
  rows.push({
    name: t("consumption.other", { count: otherCount }),
    sub: t("drills.otherSub"),
    value: fmtBytes(otherBytes),
    magnitude: otherBytes,
    tone: "muted",
  });
  return {
    kicker: t("drills.relationsKicker"),
    title: t("drills.relationsTitle", { cap }),
    headline: fmtBytes(totalBytes),
    headlineValue: totalBytes,
    check: "sum",
    subline: t("drills.relationsSubline", { count: largest.length + otherCount }),
    rows,
    footer: t("drills.relationsFooter"),
  };
}
