# System Health: rebuild /admin/system-health as an analytical dashboard

`feat/health-portal` → `master` (feat/ui-rework was merged as PR #18; this branch has origin/master 56b4ed6 merged in and merges cleanly). Do not merge without hitul's review.

## What changed

The developer health page was four tiles and five tables. It is now a dashboard: a composite health score with four sub-scores, charts for every panel, and a drill-down behind every figure. Nothing about its contract changed: exec-only (`admin:roles:write`), direct Postgres, every figure is measured or `n/a — reason`. Design brief and score-model brainstorm: `docs/proposals/system-health-redesign.md`.

| Before (1280) | After (1280) |
| --- | --- |
| ![before](https://github.com/hitul-hse/supabase-app/blob/feat/health-portal/docs/proposals/system-health-redesign/before-1280.png?raw=true) | ![after](https://github.com/hitul-hse/supabase-app/blob/feat/health-portal/docs/proposals/system-health-redesign/after-1280.png?raw=true) |

| Composite drill-down | Phone (375) |
| --- | --- |
| ![drill](https://github.com/hitul-hse/supabase-app/blob/feat/health-portal/docs/proposals/system-health-redesign/after-drill-composite.png?raw=true) | ![mobile](https://github.com/hitul-hse/supabase-app/blob/feat/health-portal/docs/proposals/system-health-redesign/after-375.png?raw=true) |

- **Score** (`src/lib/health-score.ts`): weighted mean of Freshness 30 / Security 30 / Efficiency 20 / Consumption 20, renormalised over measurable sub-scores, capped at 49 while any measurable sub-score is below 25, `n/a` under two measurable. Every component carries the sentence its drill shows; rows reconcile to the score with an explicit rounding row. 128 assertions in `scripts/check-health-score.mjs`.
- **Freshness**: age vs SLA bars (TrackingTime 24 h from the workflow cron plus a documented 2 h grace; the other connectors have no schedule and are listed unscored), 30-day `raw.sync_run` timeline, typed-layer counts by connector, the legacy `public.sync_sources` table as a chip strip with its caveat.
- **Efficiency**: cache-hit and connection gauges, commits vs rollbacks, heaviest statements (app roles, top-level DML, catalog reads and this page's own probes excluded, credential-shaped text redacted) top 5 + paged show-all 50, DB round trip with a sparkline from history.
- **Security**: RLS donut with the offending tables in the drill, profiles by role stacked, users-without-role tile linking to Users & Roles, env presence checklist, header chips.
- **Consumption**: largest 8 relations + other, size against the documented 500 MB free-tier budget, growth per day from history.
- **History**: hourly sampler on the rig (`scripts/sample-system-health.mjs`, user timer `hse-health-sample.timer`, one sample per night-shift cycle) appends to `~/.night-shift/health-samples.jsonl`, 90-day retention; the page reads it when present and says `n/a — no history on this host` on Vercel. Postgres version is a proposal only: `docs/proposals/health-sample-table.sql`. Not applied.
- **Charts** (`src/components/ui/Charts.tsx`): HBar, StackedHBar, ProportionBar, Timeline, Sparkline, Meter, built to the dataviz mark specs on the house tokens. No new dependencies.
- **Drill-downs**: 15, on the shared `DrillTrigger`/`DrillDialog`; the dialog now scrolls when taller than the viewport and exposes `data-drill-page` for gates.
- **Language**: 209 strings in the new `systemHealth` namespace, EN and DE. Diagnostic reasons from the query layer pass through in English by decision.
- **Reads** (`src/lib/queries/system-health.ts`): sequential on one Client (the Promise.all fan-out tripped pg's client.query deprecation), typed-table counts batched into one statement, session `statement_timeout = 5000` and read-only, reasons scrubbed of hosts and IPs, header self-check validated and memoised 60 s.

## Gates (all run on 2026-09-02 against the dev server on :3002)

```
tsc --noEmit                         exit 0
eslint                               0 errors, 12 pre-existing warnings
check-design-system                  DESIGN SYSTEM: OK
check-health-score                   128 PASS, 0 FAIL
check-i18n-system-health             I18N SYSTEM HEALTH: OK (12/12)
check-system-health-static           SYSTEM HEALTH STATIC: OK (21 checks)
check-system-health-ui               SYSTEM HEALTH UI: all checks passed
                                     1280: 2.70 screens, 375: no horizontal scroll,
                                     15/15 drills reconcile, 0 console errors
check-no-absolute-paths              PASS
check-sync-and-drilldown             all checks passed
check-table-scroll-budget            SKIP (needs .env.local in cwd; not written here by house rule)
check-page-length                    n/a (reads .env.local from cwd; has no route for this page;
                                     the 3-screen budget is asserted by check-system-health-ui)
```

## Reconciled against direct Postgres (read-only pg.Client, 14:56Z)

| figure | page | Postgres |
| --- | --- | --- |
| sync runs, last 30 days | 25 | 25 |
| rows in time.entry | 5,530 | 5,530 |
| relations sized | 92 | 92 |
| RLS enabled / total (app schemas) | 56 / 56 | 56 / 56 |
| users without a role | 2 | 2 |
| database size | 63 MB | 63 MB |

Also verified in the browser by the UI gate: typed-layer drill Σ 6,298 = chart; statements drill Σ of 50 rows = headline; relations drill Σ 54,525,952 B = `relationsTotalBytes`.

## Performance

`getSystemHealth()` median 0.8 s, p95 0.87 s against the 1.5 s budget (10 runs; ~70 % of that is TLS connect plus 29 round trips at ~15 ms). Dev page fully loaded at 1.19 s median.

## Security review (report in the session; permission verdict PASS)

Applied: statements filtered to app roles and top-level DML with redaction; session statement_timeout and read-only; reasons scrubbed; header self-check URL-validated and memoised; typed-table identifiers quoted; sampler honours `SUPABASE_CA_CERT_PATH`, hardened user unit, log at 600; night-shift hook reports a failed sample instead of swallowing it.

Left for the owner, both house-wide rather than this page:
- `ssl: { rejectUnauthorized: false }` in the shared `admin/factorial-identity/db.ts` (and six other call sites). Supabase's CA bundle plus `rejectUnauthorized: true` is the fix; the sampler already takes the CA from `SUPABASE_CA_CERT_PATH`.
- `~/.night-shift/node_modules` is a symlink into the `ui-rework` worktree, so the hourly sampler runs whatever that checkout installs. A private `pg` install under `~/.night-shift` would decouple it.

## Second-opinion review

DeepSeek-R1 14B over the branch diff via the Ollama OpenAI endpoint (LiteLLM on :4000 listed no models without a key). Two files returned no output (`health-score.ts`, `system-health.ts`); the rest returned OK or findings that describe deleted lines of the old page. Four items were checked in source and are not defects: the sampler already yields null for an unmeasured deadlock count; the hero has an explicit n/a branch; the i18n gate's `leaks` array is used; `animationDuration: "400ms"` is valid CSS.

## Findings for another day

- `select count(*)::int n from public.projects` costs 260 ms per call and `… from time.entry` 5.7 s per call under `authenticated`: RLS policy cost worth a look.
- Two `auth.users` rows have no `app_user_profile`.
- `check-page-length` and `check-table-scroll-budget` read `.env.local` from the cwd, so they cannot run in a worktree that follows the no-`.env` rule.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_014XdGt3ULn1i9JBZ1ksCerC
