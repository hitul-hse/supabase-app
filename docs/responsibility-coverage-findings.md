# Responsibility and coverage: what was wrong, and what still needs a person

Companion to `docs/next-steps-2026-08-26.md`, covering the responsibility /
coverage half of the same session. That document owns the migrations, the mobile
layout work and the gate-suite state; this one owns the questions "is the
masterdata import connected correctly" and "are the logics working correctly"
as they apply to **who covers which project**.

Everything below was measured against the live database. Commits:
`e922254`, `7eb0c1f`, `4e78282`, `1be8936`, `707809e`, plus `b004574` for the
Factorial Phase 0 gate.

---

## 1. The replacement person did survive the import

This was the first thing to rule out, because if the Vertretung column had been
dropped there would be nothing to fix downstream.

It was not dropped. `import-masterdata-projects.mjs:292-303` writes the
replacement as a second `person_assignments` row with `share_percent = 0` and
`sort_order = 1`, distinct from the owner's `100` / `0`:

| | count |
| --- | --- |
| `person_assignments` rows encoding a cover | **168** |
| projects carrying both an owner and a cover | **167** |
| `project_responsibility` rows with `role = 'replacement'` | **140** |
| of those 140, contradicted by `person_assignments` | **0** |

Reproduce: `node scripts/diagnose-replacement-visibility.mjs` and
`node scripts/diagnose-replacement-readpaths.mjs`.

---

## 2. Three things were wrong

### 2.1 [FIXED] Self-cover was counted as coverage

The single worst finding of the session, because it inflated a safety metric.

The source workbook repeats the responsible person's name in the Vertretung
column on **78 rows**. The import copied that faithfully, so **65 projects name
someone as their own replacement**. `getEmployeeOwnershipOverview` counted them,
and reported **100% replacement coverage for five of seven people**.

A project whose only named fallback is the person who would be absent has no
fallback. Excluded by comparing against `projects.owner_person_id`, which is the
same value the row's own RESPONSIBLE column displays, so the two columns cannot
disagree on screen.

| | before | after |
| --- | --- | --- |
| Hendryk's coverage | 82.9% | **75.6%** |
| Hendryk's projects without cover | 7 | **10** |
| Open projects without independent cover, company-wide | 91 | **156 of 231** |

The import is **not** at fault here and should not be "fixed": it reproduced the
source correctly. The workbook is where the repeated names live.

### 2.2 [FIXED] The busiest person in the company was invisible

`management-contract-hours.ts:7` held a hardcoded seven-name allowlist that gated
the service grid, the utilisation outlook and the employee overview. Anyone
missing was dropped, and the page still rendered a complete-looking table, so the
omission could not be seen.

**Rency Sebastian was missing**: 62 responsible projects, 62 replacement
projects, 690.3h of owned contract hours, and **1,184.8h logged in TrackingTime,
more than anyone else in the company**. Not archived, status VERIFIED. Björn was
missing too, with 1,638h owned.

Meanwhile Serhii *was* listed, while being archived in TrackingTime with a single
3h project. So the list was never a policy about who counts; it was a snapshot
from the utilisation-outlook commit that nothing kept current.

**This is the finding to act on.** With both restored, the page shows two people
over capacity, one of whom could not previously be seen:

| person | bound hours | utilisation | status |
| --- | --- | --- | --- |
| Björn | 1,638h | **125.6%** | Kapazitätsrisiko |
| Hendryk | 1,487.5h | **114.1%** | Kapazitätsrisiko |
| Rency Sebastian | 690.3h | 52.9% | Gesunde Auslastung |

Rency also reads **0% replacement coverage across 65 open projects**, which is
what §2.1 and §2.2 look like when combined: all 62 of those replacement rows
named Rency as Rency's own cover.

(The two views count differently and both are right. Rency has exactly 130
assignment rows, all on open projects: **65 carrying load** (`share > 0`) and
**65 as cover** (`share = 0`). The employee overview shows 65 because it skips
cover rows; the service grid's drilldown shows 130 because it resolves every
assignment. Neither number is the other's error. My first guess — that the
difference was closed work — was wrong, and checking it took one query.)

### 2.3 [FIXED, not user-visible] A hardcoded null claiming the data did not exist

`management-service-overview.ts` returned `projectsWithoutReplacement: null`
under the comment *"No confirmed replacement relation exists in the current
schema"*, while 140 rows sat in `project_responsibility`. That is not an honest
null; the relation existed and was simply never read.

Worth stating plainly: `graphify explain` confirms this function currently has
**no callers**, so fixing it changed nothing a user sees. It is
correctness-in-waiting, and it is listed here so nobody records it as a delivered
improvement.

---

## 3. Two disagreements that need a decision, not a fix

### 3.1 [NEEDS A DECISION] The two cover tables disagree on 28 projects

The same fact is stored twice, and the encodings do not agree:

- `person_assignments`: `share_percent = 0` / `sort_order = 1` → 168 projects
- `project_responsibility`: `role = 'replacement'` → 140 projects

The 28-project difference is **not** a deliberate filter. All 28 are absent from
`project_responsibility` entirely, carrying no role row at all, not even
`responsible`. And 25 of the 28 name a genuinely different person from the
responsible, which rules out the tempting theory that a later, stricter import
dropped self-cover rows on purpose. The role table is simply incomplete.

Measured impact, which is smaller than it first appears: all 28 projects remain
**listed** on `/my-work`, because the `share_percent = 0` row itself satisfies the
`assigned` rung. What is lost is the REPLACEMENT badge and the role count, so the
page understates cover duty on 25 projects — Mathias 12, Thorsten 5, Hendryk 5,
Stephan 3. A mislabel, not a disappearance.

**The decision:** backfill `project_responsibility` from those 28 rows, which
would restore 25 REPLACEMENT badges and let the gate's tolerance drop to zero? It
writes to a canonical table, so it needs sign-off rather than initiative.

### 3.2 [NEEDS DATA ENTRY] 8 orders cannot reach exactly one project

`report-masterdata-responsibility.mjs` has been counting this for a while but
never naming the rows, so it stayed abstract. Against the live order book — the
same seven sheets the importer reads — 223 rows, 221 distinct names, 213 matching
exactly one project.

**2 ambiguous**, because two `public.projects` rows share a normalised name:

| workbook name | candidates |
| --- | --- |
| `Intel GmbH / SiFa` | `10738_00319_104_01` (cust Unity Technologies, WARNING) and `10747_00360_104_01` (cust Intel Deutschland) |
| `missing` | `10110_00375_205_01` (AWB) and `10361_00178_205_01` (SAGE Automotive) |

The first is the same corrupted-name problem as `next-steps-2026-08-26.md` §2.2.

**6 unmatched, and they split by who can fix them:**

*5 cannot link at any price — the identity is absent at source:*

| order number | Kundennummer | customer named in the row | name |
| --- | --- | --- | --- |
| `#N/A` | `#N/A` | `ƒ∆` (mojibake) | BBH Sicherheitsteschnische Betreuung 2026 |
| `_0_2_01` | *(empty)* | PBS Germany Operations GmbH | PBS Neu Isenburg / company doctor 2025/2026 |
| `_0_2_01` | *(empty)* | Trinity Bet Operations Ltd | Trinity Bet Malta / company doctor 2025/2026 |
| `_0_2_01` | *(empty)* | PBS Germany Operations GmbH | PBS Berlin / company doctor 2025/2026 |
| `_0_701_01` | *(empty)* | Quantica3D | Quantica3D / Basic instruction 2025/2026 |

Verified with `node scripts/diagnose-malformed-order-numbers.mjs`, and the result
is worse than "a malformed id". The `Kundennummer` cell is genuinely empty on
four and `#N/A` on the fifth, so the order number cannot be reconstructed from
the row: the id shape is `customer_AB_service_artikel` and the customer segment
is the missing one. The BBH row's customer name is also mojibake (`ƒ∆`), so that
row has lost its customer twice over.

**And none of these five customers exists in `public.projects` at all** — every
one returns zero projects. So these are not mislinked orders whose link could be
repaired; they are five customers the database has never heard of. Whoever fixes
this is entering a customer number that is missing, not correcting one that is
wrong, and the affected work may never have been imported.

*1 is a genuine data gap:*

`10443_00253_104_01` — "RISE FX GmbH / 25-26 SiFa Stuttgart" is well-formed and
points at a project the database does not have.

### 3.3 Three of these are the same bug as the mis-named orders

`docs/order-name-corruption-findings.md` reached eight mis-named orders from the
*database* side: a project whose name belongs to a different customer. I reached
mine from the *workbook* side: a name that resolves to zero or several projects.
Three rows appear in both lists, which means they are one root cause observed
twice rather than two problems to schedule separately.

| order | stored name | actual customer |
| --- | --- | --- |
| `10110_00375_205_01` | `missing` | AWB Aluminiumwerk Berlin GmbH |
| `10361_00178_205_01` | `missing` | SAGE Automotive Interiors |
| `10738_00319_104_01` | `Intel GmbH / SiFa` | **Unity Technologies GmbH** |

Correcting those three names fixes both symptoms at once: the name stops
belonging to the wrong customer, and the workbook name stops colliding so the
order matches 1:1. Verified with
`node scripts/diagnose-order-findings-overlap.mjs`, which parses the other
document's ids rather than restating them, so the two cannot drift apart.

**The five unmatchable orders in §3.2 are not part of this.** Their customers —
PBS Germany Operations GmbH, Trinity Bet Operations Ltd, Quantica3D — appear in
**zero** projects, so there is no name to correct. Those five need a customer
number entered, or the work behind them imported; renaming cannot reach them.

---

## 4. Gates added

Five, each **verified to fail when its bug is reintroduced**, because a gate that
has never been seen to fail has not been tested:

| Gate | Asserts | In `test:db` |
| --- | --- | --- |
| `check:replacement-coverage` | the relation is read, and self-cover stays excluded | yes |
| `check:management-people-complete` | nobody carrying responsibility is silently absent | yes |
| `check:management-contract-hours-live` | the service grid covers everyone; totals reconcile | yes |
| `check:responsibility-encodings-agree` | the 28-project gap does not grow | yes |
| `check:order-project-matching` | the 8 failures do not grow, split by cause | no — see below |

Two of them (`-live`) compile and execute the **real production TypeScript** the
page imports, rather than a reimplementation, following the pattern in
`check-employee-ownership-live.mjs`.

`check:order-project-matching` is deliberately **not** in `test:db`: the workbook
lives outside the repo, so the gate exits `2` (BLOCKED) rather than passing when
it is absent, which would fail the suite on any machine without the file. Same
reasoning as `check:factorial-auth`.

Each gate pins its known-failure count as a named constant. Tightening one is a
deliberate edit, and each prints a note when the real number improves so the win
can be locked in.

---

## 5. What these gates deliberately cannot see

**`check:management-people-complete` keys off `project_responsibility`.** It
catches a person who exists in `public.people` and carries responsibility but is
missing from the management allowlist, which is exactly the Rency bug. It cannot
catch someone who was never imported into `public.people` at all, because there
is no row for it to compare against.

That population is not empty. `check:factorial-identity-baseline` found **Stefan
Goelzner**: 57 entries, **134.8h billable**, not archived, `hub_person_id` null,
and **no `public.people` row whatsoever** — zero responsibility rows, zero
assignments, zero owned projects. He is a different bug from Rency, not a missed
instance of the same one, and he is invisible to my gate by construction.

Three more, all archived, so lower priority but the same shape:

| member | billable hours | archived |
| --- | --- | --- |
| Stefan Goelzner | **134.8** | no |
| Kamila Evangelista da Silva | 61.9 | yes |
| Pablo Guerra Ares | 27.9 | yes |
| Liliia Ganeeva | 0.8 | yes |

Reproduce with `node scripts/diagnose-unlinked-billable-members.mjs`. The
Factorial identity work is the right place to fix this, because the email is the
only candidate key and Stefan's (`stefan-external@hs-expert.com`) is on a
near-miss domain — `hs-expert` rather than `hs-experts` — which is precisely the
case `check:factorial-pager` asserts must **not** fuzzy-match.

**`check:responsibility-encodings-agree` pins a tolerance, it does not fix.** It
fails if the 28-project gap grows and notes when it shrinks. It cannot tell you
which of the two tables should win; that decision is in §3.1.

**`check:order-project-matching` measures the workbook, not the deployment.** It
exits 2 (BLOCKED) when the workbook is absent rather than passing, so it proves
nothing about a machine that does not have the file.

---

## 6. Deploy order: is it safe to ship before the migrations?

**Yes for the web app, no for the next import run.** Established with
`node scripts/diagnose-deploy-migration-order.mjs` rather than assumed, because
getting this backwards means a runtime failure on a live request.

Three columns on `public.projects` are still `NOT NULL` on the live database —
`billable_hours`, `consumed_percent`, `status` — because migration
`20260826120000` has not been applied. Code that writes an honest `null` into any
of them fails at runtime. The question is therefore *which* code writes them.

Answer: **zero files under `src/`**, and seven under `scripts/`, including
`import-masterdata-projects.mjs`. So no live web request can hit the constraint;
the hazard is confined to scripts a human runs deliberately.

| | verdict |
| --- | --- |
| `npm run build` | clean, compiled in 7.0s |
| `src/` paths writing a NOT NULL column | **none** |
| Deploy without the migration | **safe** |
| Run the importer without the migration | **will fail** — apply it first |
| Read paths against the unmigrated DB | verified working (231 projects, 0 nulls) |

The reverse direction was checked too: the new management code runs correctly
against the database *as it is today*, so deploying does not depend on the
migration landing first. `20260826140000_factorial_identity_review` is likewise
safe to defer — no `src/` file references `factorial_identity_review` at all.

The migrations are still required. They are just not a deploy blocker, and
knowing which of the two it is decides whether you can ship this afternoon.

---

## 7. Two notes for whoever works on this next

**The allowlist has more than one consumer.** Widening `PEOPLE` changed both
`getEmployeeOwnershipOverview` and `getManagementContractHours`. Only the first
had a gate. Changing a shared allowlist while half its consumers are unverified is
how a fix becomes a regression, which is why `check:management-contract-hours-live`
exists.

**Do not join the two responsibility tables.** Joining `project_responsibility` to
`person_assignments` fans out and turned a real 62 into 8,060 — a number that
looks entirely plausible in a report. Use scalar subqueries.
`scripts/diagnose-management-people-allowlist.mjs` shows the correct shape.
