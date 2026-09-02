# System Health redesign — design brief

Date: 2026-09-02 · Branch: feat/health-portal → feat/ui-rework · Owner's ask:
"the system health page is still in bad uiux … provide more proper analysis
like with graphs and charts and all".

## What the page is for

`/admin/system-health` answers one question for a developer: **can the numbers
on the other pages be trusted right now?** It is exec-only (`admin:roles:write`)
and reads Postgres directly. The one law it inherits from
`src/lib/queries/system-health.ts` stays law: every figure is
`Metric<T> = {ok,value} | {ok:false,reason}`, and the page never renders a
plausible number where the truth is "not measured".

## Inventory (what exists on 2026-09-02)

| Layer | State |
| --- | --- |
| Query | 534 lines, four panels (freshness, efficiency, security, consumption) + deploy identity. All reads are `SELECT`. Latency measured first and alone. |
| Page | 617 lines, one server component. Four `StatTile`s, then five tables. No charts, no drill-downs, no i18n, no motion beyond `PageTransition`. |
| Charts | `Charts.tsx`: AreaTrend, BarTrend, Donut, Gauge, TrendFigure, LegendDot. Hand-rolled SVG on `var(--*)` tokens. No horizontal bar, no timeline, no sparkline, no proportion bar. |
| Drill-downs | `DrillDialog` + `DrillTrigger` (server page hands a serialisable `Drill`; rows carry `data-value`, headline `data-check`). Paged at 10. |
| Motion | `.rise-in .stagger .bar-grow .chart-draw .chart-fill-in .card-elev`, all under `prefers-reduced-motion`. |
| History | None. Nothing is persisted; the page samples live per request. |
| i18n | `messages/{en,de}.json`, namespaces `nav, common, overview, drill, management, people, timeDashboard`. Page strings are hard-coded English. |

## Score model — brainstorm and decision

Three options were weighed for the composite 0–100:

| Option | Shape | For | Against |
| --- | --- | --- | --- |
| A. Weighted mean of four sub-scores | Σ wᵢ·sᵢ / Σ wᵢ over the sub-scores that are measurable | Explainable in one line; one bad panel cannot hide a good one and vice versa; degrades honestly when a sub-score is n/a | A 0 in Freshness still leaves a 70 composite, which can read as "fine" |
| B. Weakest link | min(sᵢ) | Brutally honest; a failed connector is the headline | One stale connector makes the other three panels invisible in the number; noisy overnight |
| C. Weighted mean with a critical floor | A, but capped at 49 while any sub-score is < 25 | Keeps A's legibility and B's honesty about a real failure | Two rules to explain instead of one |

**Decision: C.** The composite is the weighted mean of the measurable sub-scores
(Freshness 30, Security 30, Efficiency 20, Consumption 20; weights renormalised
over the sub-scores that are `ok`), **capped at 49 while any measurable
sub-score is below 25**, and `n/a` when fewer than two sub-scores are
measurable. The hero always names the weakest sub-score and whether the cap
applied. Every sub-score has a drill-down listing its components, the points
each earned, its weight, and what was excluded and why.

### Sub-score formulas (each 0–100; components that are n/a are excluded and named)

**Freshness** — mean over the connectors that have an SLA. Per connector:
latest `raw.sync_run` row is `ok` and its age ≤ SLA → 100; ≤ 2×SLA → 50;
older, `failed`, `running` for > 6 h, or never run → 0. SLAs come from the
actual schedule of each sync (the health-auditor reads the timers / scripts and
documents them in `src/lib/health-score.ts`); a connector without a documented
schedule is listed but not scored.

**Efficiency** — mean of: buffer cache hit (≥ 99 % → 100, 95 % → 50, ≤ 90 % → 0,
linear between), connections in use (≤ 50 % of max → 100, ≥ 90 % → 0),
rollback share (rollbacks / (commits + rollbacks): ≤ 1 % → 100, ≥ 10 % → 0),
DB round trip (≤ 50 ms → 100, ≥ 500 ms → 0). Deadlocks > 0 since stats reset
subtract 10 points, floored at 0.

**Security** — weighted: RLS coverage (enabled / total app-schema tables × 100,
weight 50), users without a role (0 → 100, each user −25, floor 0, weight 20),
env presence (set / expected × 100, weight 15), response headers (pass / checked
× 100, weight 15). "RLS on with zero policies" is shown but does not lower the
score: it locks the table to the service role, which is safe.

**Consumption** — database size against a known budget: 100 − used %, floored at
0. The budget is the Supabase plan's disk limit if it is documented in the repo
or vault, else the `SYSTEM_HEALTH_DB_BUDGET_GB` env var; with neither the
sub-score is `n/a — no budget defined` and is excluded from the composite. Growth
(bytes/day) is reported from history when ≥ 2 samples exist, else `n/a`.

Colour by threshold, tokens only: ≥ 80 `--good`, 50–79 `--warning`, < 50
`--critical`; `n/a` in `--text-faint`.

## Layout sketch

```
1280px                                                            375px
┌──────────────────────────────────────────────────────────────┐   ┌────────────┐
│ PageHeader  System Health · sampled 13:52:04Z · rig/vercel   │   │ header     │
├──────────────────────────────────────────────────────────────┤   ├────────────┤
│ HERO (tone=hero)                                              │   │ gauge      │
│  ┌──────────┐  Freshness  ▓▓▓▓▓▓░░ 72   Efficiency ▓▓▓▓▓▓▓░ 88 │   │ 4 meters   │
│  │  Gauge   │  Security   ▓▓▓▓░░░░ 41   Consumption  n/a       │   │ (stacked)  │
│  │  63/100  │  weakest: Security · cap applied (41 < 25? no)   │   ├────────────┤
│  └──────────┘  each meter is a DrillTrigger → formula rows     │   │ freshness  │
├───────────────────────────┬──────────────────────────────────┤   │ age bars   │
│ FRESHNESS                 │ SYNC RUNS · LAST 30 DAYS         │   │ timeline   │
│ age vs SLA (HBar + line)  │ Timeline: one lane per source,   │   │ typed bars │
│ trackingtime ▓▓▓▓│ 3h/24h │ a mark per run (ok/failed/run)   │   │ legacy     │
│ factorial    ▓▓▓▓▓▓▓│ 30h  │ ○ ○ ● ○ ○ ○ ○ ○ ✕ ○ ○ ○ ○ ○ ○ ○ │   │ callout    │
│ asana        ─ never       │                                  │   ├────────────┤
│ TYPED LAYER (HBar grouped by source, log-free, labelled tips)│   │ efficiency │
│ LEGACY public.sync_sources — a callout, not a table          │   │ 2 gauges   │
├───────────────────────────┬──────────────────────────────────┤   │ proportion │
│ EFFICIENCY                │ HEAVIEST STATEMENTS              │   │ ranked     │
│ Gauge cache hit  Gauge    │ ranked HBar by total ms, top 5   │   │ sparkline  │
│ 99.6 %          conns 7/60│ calls · mean as secondary text   │   ├────────────┤
│ commits ▓▓▓▓▓▓▓▓▓▓░ rb    │ "show all N" → paged drill       │   │ security   │
│ DB round trip: sparkline  │                                  │   │ donut      │
│ (or n/a — no history yet) │                                  │   │ stacked    │
├───────────────────────────┬──────────────────────────────────┤   │ tile→users │
│ SECURITY                  │ PROFILES BY ROLE (stacked HBar)  │   │ checklist  │
│ Donut RLS on/off/locked   │ exec ▓▓▓▓░ hr ▓▓ …               │   │ chips      │
│ users w/o role tile→/admin│ ENV checklist · HEADER chips     │   ├────────────┤
├───────────────────────────┴──────────────────────────────────┤   │ consumption│
│ CONSUMPTION  proportional bar: 8 largest + other · size tile │   │ bar + tile │
└──────────────────────────────────────────────────────────────┘   └────────────┘
```

Every tile and chart is a `DrillTrigger`; the drill's rows reconcile exactly with
the chart (same numbers, same rounding, `data-check` set).

## Chart forms (dataviz skill, form before colour)

| Figure | Job | Form | Colour job |
| --- | --- | --- | --- |
| Composite score | one bounded value with a judgement | Gauge | status by threshold |
| Sub-scores | four bounded values | Meter row (track = lighter step of same ramp) | status by threshold |
| Age vs SLA | magnitude against a limit | horizontal bar + SLA rule | status (over/under SLA) |
| Sync runs 30 d | events over time, three states | timeline of marks, one lane per source | status: ok/failed/running, with shape + label, never colour alone |
| Typed-layer rows | magnitude by category, grouped | horizontal bars grouped by source, one hue | sequential (single hue) |
| Cache hit, connections | ratio against a limit | Gauge | status |
| Commits vs rollbacks | part-to-whole, 2 parts | proportion bar (not a 2-slice donut) | accent + critical |
| Heaviest statements | ranked magnitude | ranked horizontal bars, top 5 | one hue |
| DB round trip | trend | sparkline (12+ points) or honest `n/a` | accent |
| RLS coverage | part-to-whole, 3 parts | Donut, centre = coverage % | good / critical / muted |
| Profiles by role | part-to-whole per category | stacked horizontal bars (active/inactive) | accent + de-emphasis |
| Relation sizes | part-to-whole, ≤ 9 parts | proportional bar, largest 8 + other | one hue stepped + gray "other" |

Rules carried over: no dual axes, no number on every point, 2 px surface gaps
between stacked segments, ≤ 24 px bars, hairline solid grid, text in text
tokens never in series colour, legend for ≥ 2 series, keyboard-reachable hit
targets ≥ 24 px, a table twin for every chart (the drill-down is that twin).

## History model

The page samples live only. History is added in the least invasive honest way
that works on the rig today:

- **What:** one JSON line per sample: `at`, `dbLatencyMs`, `cacheHitPct`,
  `xactCommit`, `xactRollback`, `deadlocks`, `connActive`, `connMax`,
  `dbSizeBytes`, `rlsEnabled`, `rlsTotal`, `usersWithoutRole`, per-source
  last-run age/status, plus the four sub-scores and the composite as computed
  by the same `health-score.ts` the page uses (so history and live agree).
- **Where:** `~/.night-shift/health-samples.jsonl` (the directory already holds
  the overnight loop's standalone scripts and its own `node_modules` with `pg`).
- **Cadence:** hourly, via a user systemd timer `hse-health-sample.timer` that
  runs `scripts/sample-system-health.mjs`; the night-shift cycle also appends
  one sample so every overnight report has a matching point.
- **Retention:** 90 days, pruned on write.
- **Read side:** `src/lib/health-history.ts` reads the file when it exists
  (`SYSTEM_HEALTH_SAMPLES` env overrides the path); on Vercel there is no file
  and every history figure is `n/a — no history on this host`. A chart that
  needs history and has fewer than two points says so instead of drawing a
  flat line.
- **Postgres version:** `docs/proposals/health-sample-table.sql` proposes
  `platform.health_sample` with the same columns; it is a proposal only and
  is not applied by this PR.

## Performance budget

Server time for the page stays under 1.5 s. The queries already run in
parallel after the latency probe; the new reads (30-day sync runs, top-50
statements, all-relation sizes) are added to the same `Promise.all`. The page
logs its own server duration and the performance-engineer verifies the budget
against the live database.

## Security

The page's permission (`admin:roles:write`, exec-only) is unchanged. No secret
value is ever read into a string; env flags stay presence-only. Statement text
is the extension's normalised form, truncated. The sampler runs read-only SQL.

## Verification gates (all must be green before the PR)

`tsc --noEmit` · `eslint` · `node scripts/check-design-system.mjs` ·
`check-page-length` · `check-i18n-*` · a Playwright run that logs in as the
review account, opens the page on :3002 at 1280 px and 375 px, screenshots
each section, and asserts no `NaN`, `undefined`, `[object Object]` or an
unexplained `n/a` appears where a Metric is ok · three numbers reconciled
against direct Postgres.
