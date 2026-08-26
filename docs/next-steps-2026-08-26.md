# Next steps: data integrity, then Factorial

Written 26 Aug 2026, after auditing the masterdata import against the live database
and reading the Factorial HR API documentation. Every number here was measured, not
estimated; the script that produced it is named so you can re-run it.

Companion documents:
- `docs/factorial-api-integration.md` — the full API reference and integration design
- `docs/live-people-data-map.md` — the earlier TrackingTime/people analysis
- `docs/responsibility-coverage-findings.md` — the responsibility/coverage half of
  this session: self-cover counted as coverage, the stale management allowlist that
  hid the busiest person in the company, and the two order/cover disagreements that
  still need a person

---

## 1. Is the masterdata import connected correctly?

**Largely yes. The referential integrity is sound; the honesty of the derived
numbers was not.** Reproduce the whole picture with `node scripts/audit-links.mjs`.

| Link | State | Verdict |
| --- | --- | --- |
| `app_user_profile.person_id -> people.id` | 20 rows, 2 null, **0 dangling** | Sound |
| `projects.owner_person_id -> people.id` | 231 rows, 55 null, **0 dangling** | Sound; the 55 are genuinely unassigned |
| `person_assignments -> people / projects` | 352 rows, **0 dangling**, 8 null project | Sound (see §1.1) |
| `projects.customer_legal_entity_id` | 231 rows, **230 linked**, 1 unmatched | Effectively complete (see §2.4) |
| Excel order -> project | 198 orders: 192 matched 1:1, 4 ambiguous, 2 unmatched | Good |
| Excel person -> `people` | **9 of 9** responsibles resolve | Complete |

**There are no orphans and no dangling foreign keys anywhere in the chain
auth user -> person -> project -> customer.** That is the part that is genuinely
working, and it is worth saying plainly before the problems below.

### 1.1 The 8 null-project assignments are correct as they are

`node scripts/audit-orphan-assignments.mjs` shows all 8 belong to the mockup
`emp-1..emp-8` people, with names like "Internal admin" and "Lab calibration"
that match no order because internal work has no customer order. Their NULL is the
accurate value. `npm run test:no-mockup-people` confirms no page renders these
people, so they are invisible to users. **No action needed.**

---

## 2. What is actually wrong

Ranked by how much damage each does to a decision someone would make from the UI.

### 2.1 [FIXED, needs pasting] 54 orders reported themselves as on budget without being measured

Of 231 orders, 177 resolve to a TrackingTime project by the exact key
`time.project.hub_project_id`; **54 do not**. The importer had no hours for those 54,
but `logged_hours`, `billable_hours`, `consumed_percent` and `status` were all
`NOT NULL`, so it wrote `0 / 0 / 0 / NORMAL` across **1,724 contract hours**.

Nothing in the ledger distinguished "not worked yet" from "we are not measuring
this". Both read as a confident green 0%.

Deliberately NOT changed: the **113 linked orders that also sit at 0** (3,256
contract hours). They are measured and simply have no logged time yet, so that 0 is
a fact. "Measured" is decided by the link, never by whether the number is zero.

Committed in `e7cfac3`:
- `supabase/migrations/20260826120000_projects_admit_unmeasured_hours.sql`
- `scripts/check-unmeasured-hours-migration.mjs` — runs it in PGlite twice, asserts outcomes
- `scripts/check-projects-admit-unmeasured.mjs` — permanent gate, registered as gate 78
- importer now carries a `measured` flag so a re-import cannot recreate the zeros

**ACTION: paste the migration into production.** The gate is red until you do,
which is the point. Then `npm run check:projects-admit-unmeasured` should go green.

**One consumer had to be fixed first, and it was.** `management-project-risks.ts`
is the only reader of these columns, and it surfaced statusless orders as a risk
called "Kein Status gesetzt" — somebody forgot. After the migration 54 orders have
no status *by design*, so a bare `!project.status` filter would have accused all 54
of an omission that is really the fix working. 54 false alarms invite exactly the
wrong response: distrust the panel, or "fix" it by setting NORMAL and reintroducing
the lie.

The two cases are separable from the same row, since an unmeasured order has NULL
`logged_hours` too. The predicate now requires the hours to be **known**, so a
deliberate NULL is silent and a genuine lapse is still caught.
`node scripts/check-risk-panel-survives-nulls.mjs` (gate 88) replays both
predicates over the real before/after populations and confirms the over-budget
count is unchanged at 11 while the missing-status count stays 0 instead of jumping
to 54.

**All four consumers were checked, not assumed.** Three read different tables and
are unaffected: `budget-alerts.ts` reads `public.budget_alert_feed`,
`contract-periods.ts` reads `time.contract_period_status`, and
`overbooking-notify.ts` reads `public.overbooking_alert`. Only
`management-project-risks.ts` and `my-work.ts` read `public.projects`.

`my-work.ts` is **null-safe already** and needed no change: `numOrNull` preserves
NULL, the per-project burn is computed only when both figures are known, and every
cell renders `n/a` rather than `0`. Verified by `check:my-work-survives-nulls`
(gate 89).

**The aggregate gap is fixed, and it turned out not to be a product decision.**
My Work's customer and page *totals* sum with `?? 0`, so after the migration a
total silently omits unmeasured projects: four projects contracted at 200h with two
unmeasured reads "80h of 200h" — arithmetically correct, but a **floor presented as
a total**.

I had listed three options for you to choose between. **DESIGN.md rule 7 already
decides it**: "a collapsed or paged table still states its total ... a fixed-height
list with no count is indistinguishable from a truncated one, so the reader stops
trusting every other number on the page." A sum that omits rows is the same
failure, so this was house policy, not preference.

So `measuredProjectCount` now travels with each customer and with the page totals,
and `CustomerGroup` renders `2/4 measured` beside the figure — **only when rows are
actually omitted**, so a fully-measured customer keeps the clean two-number display
(the same restraint `aliases` already uses). Counted from `loggedHours` rather than
`contractHours`, because "measured" has to mean we know what was *worked*, which is
what the sum is claiming.

### 2.2 [NEEDS A DECISION — and it is a SPREADSHEET problem, not an import bug]

Found by `node scripts/diagnose-order-name-customer-conflict.mjs`: **8 orders**
carry a name that names a different company than their own customer field. The
5-digit Lexware prefix agrees with the customer, so the name looked like the
corrupted field — the classic signature of an off-by-one row shift on import.

**That turned out to be wrong, and the truth is worse.**
`node scripts/diagnose-order-names-vs-workbook.mjs` checked each one against the
source workbook: **every bad name is in the workbook verbatim, on the same row as
the customer it contradicts.** The importer is faultless. Several appear on
multiple sheets with the same wrong name, so it has been copied around.

| Order | Customer | Name it carries | At stake |
| --- | --- | --- | --- |
| `10234_00103_104_01` | Netto ApS & Co. KG | "Mirantis Safety Engineer 2026/2027" | **201.5h logged, 288h contract** |
| `10738_00319_104_01` | Unity Technologies GmbH | "Intel GmbH / SiFa" | 9.3h logged |
| `10110_00375_205_01` | AWB Aluminiumwerk Berlin | literally `"missing"` | 5.8h logged |
| `10361_00178_205_01` | SAGE Automotive Interiors | literally `"missing"` | 4h contract |
| plus 4 more | Susell ×2, Stiftung Topographie, Kirby Group | see the findings doc | |

Two consequences that make this higher priority than a database typo:
- **re-running the import cannot fix it, and will re-import it.** Any correction
  applied to `public.projects` alone is reverted by the next import.
- **the workbook is what the team reads.** Someone checking Netto's 2026 contract
  sees "Mirantis Safety Engineer" against 288 contracted hours.

**Not all 8 are the same problem, so do not bulk-fix them.** Two look like real
Excel row shifts (Mirantis→Netto, Intel→Unity). Two are the placeholder string
`"missing"`. **Four may be perfectly legitimate** — "Reteach" is a product Susell
may genuinely have bought, "Abrechnung über SIFA Vertrag" reads like a real
invoicing note, and "NS Dokumentationszentrum" is plausibly a site name. The
detector flags a name sharing no word with its customer, which catches a row shift
and also catches a good name for a differently-named site or product.

**ACTION: fix the workbook first, then re-import.** Full detail and the
per-order judgement in `docs/order-name-corruption-findings.md`. Nothing was
written to the database: patching `projects.name` from the hub side would hide a
source error behind a change the next import silently reverts.

### 2.3 [NEEDS APPLYING] The masterdata people are labelled as seed data

- `people_source_check` still reads `CHECK (source IN ('seed','factorial'))`
- **all 26** people rows say `source='seed'`, including the **18 real `md-*` rows**
- `supabase/migrations/20260824100000_allow_masterdata_people_source.sql` is
  committed but **not applied**; nothing has been applied since **18 Aug 2026**

So `relabel-masterdata-people.mjs` cannot run: the constraint would reject
`'masterdata'`. The import did write these people — nobody hand-seeded them — but
their provenance is wrong, and **this blocks Factorial directly**: the constraint
already reserves `'factorial'`, so the sync needs `source` to mean something
truthful before it starts writing people rows.

Note the migration's comment expects "masterdata 9, seed 8" but there are **18**
`md-*` rows live. Correct that before applying.

**ACTION: apply `20260824100000`, fix its stale comment, then run the relabel.**

### 2.4 [MOSTLY A RULE BUG] The ADR-001 gate reports 3 violations; there are 64

`npm run check:management-data` fails one assertion. `node
scripts/diagnose-unlawful-tt-links.mjs` separates the causes:

- **2 are the gate's own fault.** `" 10417_asum GmbH / 26/27 GU"` has a **leading
  space**, and the rule anchors `^` on an untrimmed name. The links are correct;
  trim before matching.
- **~62 are legitimate links the rule is too narrow to describe.** e.g. TT
  `"Mbition / 26 SiFa"` -> order `"Mbition / sicherheitstechnische Betreuung 2026"`.
  Same client, same service, different wording. These were linked by the
  name+prefix+service rules that `check-management-data` itself says it honours,
  but the assertion only implements two of the three.
- **1 real unmatched customer, and it is genuinely ambiguous**: order
  `10305_00404_501_01` names `"YPOG Berlin"`. The obvious fix is to link it to
  `YPOG GmbH & Co. KG` — and that would be wrong. There are **two active YPOG
  entities** (a `GmbH & Co. KG` and a `Partnerschaft von Rechtsanwälten mbB`), and
  customer 10305 **already holds orders against both**. A German law firm bills
  through separate entities on purpose, so "Berlin" names an office, not an entity.
  `supabase/migrations/20260826130000_ypog_berlin_alias.sql` therefore flags both
  candidates `review_required` and **leaves the FK null**, because null is the
  honest value. **ACTION: confirm which entity the 501 order was contracted with.**

**ACTION (done): the gate now implements the third rule and is green on all 187
links.** `check-adr001-rule-discriminates.mjs` proves the widening did not make it
permissive: 206 deliberately wrong pairings are still rejected.

### 2.5 [KNOWN, CORRECTLY LEFT ALONE] 2,392 unattributed hours

`node scripts/diagnose-project-bridge.mjs` is thorough and its conclusion is right:
of 2,392h with no order, **1,502h is travel time and internal/HSE work that has no
customer order by definition**. The best case for speculative customer-number
matching recovers **6.2h, 0.3% of the gap**, while risking mis-billing.

**ACTION: none in the app. Fix the source** — either TrackingTime projects get their
order number entered, or `crm.trackingtime_project_reference` (0 rows, 0 referencing
functions, never implemented) gets populated and actually used by the sync.

### 2.6 [INFRASTRUCTURE, FIXED] The entire gate suite could not run

`package.json` carried a committed **UTF-8 BOM**. npm tolerates it; `JSON.parse`
does not. `run-all-gates.mjs` and six other scripts parse it, so **all 77 gates were
unrunnable** and had been for some time. Fixed in `6905b15`.

First real run: **76 green, 1 red.** The red was `check:table-scroll-budget` being
killed at the runner's 180s cap while legitimately needing 4m25s; raised to 600s in
`ee86dae`, which revealed **3 genuine mobile layout failures** it had been hiding.

**All three are now fixed and measured against a real production build** — the gate
reports "all checks passed" at both viewports:

| Route | Before | After | Budget |
| --- | --- | --- | --- |
| `/projects` | 7.40 | **2.27** | 4 |
| `/team-lead` | 6.13 | **2.32** | 4 |
| `/time/dashboard` | 5.20 | **4.55** | 5 |

None was a long-table problem: at 390px `/projects` renders zero `<table>` elements.
The height was every `lg:grid-cols-12` row collapsing into one column, so panels that
sit three abreast on a desktop stacked end to end. `MobileDisclosure` (which existed,
fully documented, and was imported nowhere) keeps `sm:block` on its content, so from
`sm` up it is a bare wrapper div — the 1440px pass is unchanged on every route.

The judgement in each case was **which panel stays open**, decided from measured
block heights rather than from reading the JSX:
- `/team-lead`: the board stays open. It is where approving happens.
- `/projects`: the totals strip stays open. It already *is* the summary.
- `/time/dashboard`: the heatmap stays open, the waffle collapses. A waffle's
  finding is one sentence and the summary states it; a heatmap's finding is its
  shape and no summary can carry it.

### 2.7 [FIXED] The importer read from a personal Downloads folder

`scripts/import-masterdata-projects.mjs` hardcoded
`C:/Users/hitul/Downloads/HSE_Masterdata_Übersicht...V2.xlsx`, so the 231-order
import was unreproducible on any other machine — and the workbook under
`.local/import/` was a **different file** (the customer master, which yields 0
orders), so a verification re-run would have silently imported nothing.

Now `.local/import/` by convention, with a `MASTERDATA_XLSX` override and an
`existsSync` check that names the correct workbook. `.local/` stays gitignored on
purpose: the file carries customer names and named personnel, so it belongs beside
the repo rather than in it.

Verified: the dry run reads **232 rows → 231 unique orders**, and reports the
unmeasured ones as `n/a` rather than `0`.

---

## 3. Are the logics working correctly?

Where I could verify against the live database and the deployed site, yes, with the
exceptions above. Specifically confirmed working:

- **76 of 77 gates green**, including all RLS, permission, and access-model gates
- `check-no-mockup-people` passes on all 45 assertions — no fictional colleague,
  no hardcoded "76% utilisation", no invented project reaches a real user
- The heaviest order's displayed hours **equal** the sum of its TrackingTime entries
  (733.2h vs 733.2h) — the hour pipeline is arithmetically sound where it is linked
- Future-dated planned entries are correctly bounded at today
- Every paged read goes through the shared pager, so nothing truncates at 1000 rows
- `management-project-risks` already refuses to judge an order with no hours, and
  already surfaces null-status orders. **The UI was more honest than the data.**

The one systemic logic flaw was §2.1: not a calculation error, but presenting an
absence of measurement as a measurement of zero.

---

## 4. Factorial: what to do next

Full design in **`docs/factorial-api-integration.md`**. The state today:

- `weekly_employee_summary` exists, **0 rows**, and is referenced by **no code**
- `crm.factorial_person_reference` exists, **0 rows**
- **0 of 26** people carry a Factorial id
- `src/lib/queries/hse.ts:35` says it plainly: "the Factorial pipeline has never run"

So this is a greenfield build against scaffolding, not a repair.

### The decisions already made and evidenced

1. **OAuth2 company token, not an API key.** An API key has "TOTAL ACCESS to
   everything" and cannot be scoped. This is German employee data including salary,
   bank details and disability percentage — an unscopeable credential cannot be
   defended under GDPR Art. 5(1)(c). Company tokens never expire, survive staff
   turnover, and are revocable.
2. **Pin version `2026-07-01`** explicitly.
3. **No documented GET rate limit exists** — only 200/min for POST. The sync must
   therefore be self-limiting by construction: sequential paging, server-side
   filters, backoff on any 4xx/5xx.
4. **Email is the only real join key, and `public.people` has no email column.**
   This is the crux. Resolution must go through a **review queue**, never silent
   fuzzy matching: 5 addresses are non-`@hs-experts.com`, and `info@` / `jobs@` are
   shared mailboxes that are not people at all.

### The payoff, concretely

Factorial supplies what TrackingTime structurally cannot:

- **Real contract weekly hours.** Today every utilisation denominator uses 40h
  because that is TrackingTime's default for all 49 members. It is not contract
  truth, and the UI is currently obliged to label it "nominal".
- **Absences and leave**, which is the other half of a correct utilisation figure.
- **Hire and termination dates**, so the "archived but has 433h of history" problem
  gets a real answer.
- **Legal entity and team structure** to join against `crm.legal_entity`.

### What is already built, before any credential exists

Phase 0 needs a human with Factorial admin rights, but three pieces did not need
to wait for it, so they are done and tested:

**1. The identity baseline is measured** (`npm run check:factorial-identity-baseline`).
One input had already moved since `live-people-data-map.md` was written on 18 Aug:
`time.member.hub_person_id` was NULL for all 49 members and is populated for 18
now. So the resolvable population is a real number today:

| | count | |
| --- | --- | --- |
| auto-resolve | **18** | exact email → member → person |
| queue for review | **31** | 25 archived leavers, 4 carry real hours, 2 look like mailboxes |

Note there is **no "excluded" bucket**, and that is the result of a bug this work
found in itself. The classifier originally returned `excluded_not_a_person` for
`info@` and `jobs@`, giving a tidier 18 / 29 / 2. But the schema requires a named
human for any terminal status, so **the first sync would have aborted on `info@`** —
proved by `node scripts/check-factorial-classifier-schema-agree.mjs`, which inserts
a row for every status the classifier can emit.

The schema was right and the classifier was wrong. A machine that can
self-authorise a permanent exclusion can quietly remove a named colleague from
every hours figure with nobody's name against it. So the two mailboxes now arrive
as `ambiguous` with a reason telling a human to confirm, and sit in the open queue
until someone signs off. The population did not change; the responsibility did.

Phase 2 is now a comparison against a known baseline rather than a discovery
exercise, and the honest headline for its gate is both counts, never just the first.

**It also surfaced a problem that exists today, independent of Factorial.** 636h
sits behind members with no person link. Most is archived leavers, whose NULL is
correct. But **Stefan Goelzner is not archived**, has logged 59 entries and
**139.8h, every one billable**, and his last entry was yesterday — and nothing in
the hub can attribute that work to a colleague. His address is
`stefan-external@hs-expert.com`, missing the `s` in `hs-experts`, so it will never
match by luck. **ACTION: set his `hub_person_id`, or say he should not have a
`people` row.**

**2. The schema is written and attacked** (`20260826140000`, gate 85). It adds
`crm.factorial_identity_review` so an unresolved employee is a reviewable row
rather than a silent omission, plus provenance columns on the existing mapping
table. Two things the *database* now enforces rather than a code review:
- a terminal or manual decision must name an accountable human, while the machine
  states must not — this is what stops a script backdating itself as a decision
- `match_method` accepts only `exact_email_via_time_member` or `manual`, so a
  `fuzzy_name` method is rejected by Postgres

It also fixes a collision with the honest-nulls rule: `expected_minutes` was
`NOT NULL`, but Factorial returns `source='none'` when it does not know a day's
expectation. Writing `0` reads as infinite utilisation; writing `2400` reinvents
the fake 40h week that Factorial is being brought in to *replace*. Now nullable
with a companion `expected_minutes_source`, and a `CHECK` making both "a number
with source=none" and "a number with no source" impossible. The table has 0 rows,
so this was free now and a data migration later.

**Deliberately not written:** staging tables for `worked_times`, `leaves` and
`contract_versions`. Their column lists would be transcribed from documentation
rather than observed, because there is no credential and no demo tenant yet. That
would be inventing a schema and calling it a migration.

**3. The paging client is built and unit-tested** (`scripts/lib/factorial.mjs`,
gate 86). 47 assertions against a fake transport — no network, no token. It is
built first because its failure mode is silence: a short page does not throw, it
produces a smaller number. The cases that matter all throw rather than return:

- a repeated **or cycling** `end_cursor` (the infinite-loop bug)
- `has_next_page` true with no cursor to advance with
- `data` missing or an object, instead of reading as zero rows
- `has_next_page` as the string `"false"`, which is truthy and would end early
- HTTP 500 or 429 mid-run, so rows already read are never mistaken for all of them
- an endless `has_next_page` stops at 500 pages and returns `truncated: true`,
  which a rollup must discard

Writing that test found a real bug in my own helper: `boundedAtToday` returned
`""` rather than `false` for a null date, so a caller comparing `=== false` would
have silently included undated rows.

### Sequencing

**Do §2.1 and §2.3 first.** Both are prerequisites, not preferences:
- §2.3 unblocks `people.source` meaning anything, and the constraint already
  reserves `'factorial'` for this integration.
- §2.1 establishes the honest-null discipline in the hours pipeline *before*
  Factorial starts feeding it. Landing real contract hours on top of a table that
  invents zeros would make the fake numbers harder to find, not easier.

Then Phase 0 of the integration plan: credentials, version pinning, **zero writes**.

---

## 6. Gate suite state at the end of this session

`node scripts/run-all-gates.mjs` — **86 gates: 83 pass, 1 skip, 2 red.**
Verified over the final tree, not an earlier snapshot.

### The gates were themselves tested

Every gate added this session was written *after* its fix and then observed to
pass, which proves nothing: a gate asserting `true === true` also passes. So
`node scripts/check-new-gates-can-fail.mjs` breaks the source each one reads,
requires it to go red, and restores the original bytes with a hash-verified
`finally`.

**It found a real weakness immediately.** `check-factorial-pager` asserted
`r.pages === MAX_PAGES` — comparing the result against the same constant the code
under test had used. With the cap mutated from 500 to 3 the gate stayed **green**
and cheerfully printed "3-page cap" in its own summary. The same shape appeared
twice more on `MAX_LIMIT`. All three now assert the documented literals (500
pages, 100 rows), so changing either requires editing a test.

Eight mutations are covered and all eight are now caught: the cursor-cycle guard,
the envelope array check, the page cap, the page size, a classifier that starts
stripping dots, the importer's `: 0` coercion, its `measured` flag, and the trim
in the ADR-001 link rule.

Both red gates are red for a stated reason, and neither needs a judgement call:

| Gate | Why red | Clears when |
| --- | --- | --- |
| `check:projects-admit-unmeasured` | The fix is committed; the migration is not applied | You paste `20260826120000` |
| `check:table-scroll-budget` | It measures **production**, and the layout fix is committed but **not deployed** | `npx vercel --prod --yes` |

That second row matters, so be precise about it: the three mobile routes are fixed
and **verified green** against a real `next build` served locally, at both 1440x900
and 390x844 ("all checks passed"). The gate is red only because production is still
serving the pre-fix bundle. `check:deploy-skew` is green, so this is ordinary
undeployed work rather than a broken deploy.

One flake to be aware of, not a regression: `test:user-management` failed once in a
full-suite run and passes standalone. It creates five real auth accounts per run and
Supabase rate-limits the invite mail, so running it concurrently with other gates
(several agents were committing in parallel) trips it. It is worth making that gate
tolerate a rate-limit response rather than treating it as a product failure.

Four gates were added this session and all are wired into `test:db`:
- `check:projects-admit-unmeasured` (78) — the honest-nulls gate
- `check:adr001-discriminates` (79) — the negative control for the rule widening
- `check:invite-throttle-classification` (84) — proves the new rate-limit SKIP is narrow
- `check:factorial-identity-migration` (85) — 25 assertions, 10 of which try to
  insert rows the constraints must refuse
- `check:factorial-pager` (86) — 47 assertions against a fake transport

Two more are registered but deliberately **not** chained, because they report
"blocked, needs a human" rather than pass/fail, and a suite that goes red for an
unmade decision teaches people to ignore red:
- `check:factorial-auth` — exits 2 until Phase 0 credentials exist
- `check:factorial-identity-baseline` — exits 2 while an active member has hours
  and no person link (currently Stefan, see §4)

Four migrations are written, PGlite-verified twice each, and **awaiting a paste**:
- `20260826120000_projects_admit_unmeasured_hours.sql`
- `20260826130000_ypog_berlin_alias.sql`
- `20260826140000_factorial_identity_review.sql`
- `20260824100000_allow_masterdata_people_source.sql` (pre-existing, still unapplied)

Nothing in this session wrote to the production database. Every change is either a
committed script, a committed migration awaiting your review, or a document.

---

## 7. What is left

**Needs only a paste (no judgement):**

1. Paste `20260826120000` — 54 orders stop reporting a burn they never measured.
   Gate 78 goes green. *(minutes)*
2. Paste `20260824100000` — relabels the 18 real `md-*` colleagues off `'seed'`.
   **This blocks Factorial**, whose constraint already reserves `'factorial'`.
   Verify with `node scripts/check-masterdata-source-migration.mjs`. *(minutes)*
3. Paste `20260826130000` — flags the YPOG ambiguity where a human will see it.
4. Paste `20260826140000` — the Factorial identity review queue.
5. `npx vercel --prod --yes` — ships the mobile layout fix, taking
   `check:table-scroll-budget` green in a full run.

**Needs your judgement, and I deliberately did not substitute for it:**

6. **The 8 mis-named orders** (§2.2). These are **workbook** errors, not database
   errors — every bad name is in the source verbatim, so a database patch would be
   reverted by the next import. Fix the workbook, then re-import. Two look like
   real Excel row shifts, two are the placeholder `"missing"`, and **four may be
   legitimate**, so check before changing. `docs/order-name-corruption-findings.md`
   has the per-order judgement.

   **Before running that re-import, know what it does** — measured by
   `node scripts/check-reimport-is-safe.mjs`:
   - It **upserts** the 231 project rows. Upsert *merges*: the 11 columns the
     importer omits (including `customer_legal_entity_id` on 230 rows and
     `department` on 176) are **preserved** on existing rows. Verified against
     real Postgres in `check-upsert-merge-semantics.mjs`, because reasoning about
     `ON CONFLICT` is how you lose 230 links.
   - It **DELETEs and re-INSERTs `person_assignments`** for all 231 project ids.
     Only responsible/replacement rows derivable from the workbook come back, so
     any assignment created another way is lost. The 8 rows with a NULL
     `project_id` survive, since the delete is scoped by project id.
   - It **does not touch `public.project_responsibility`** (288 rows), which
     therefore goes stale against the workbook it just re-read.
     `scripts/import-project-responsibility.mjs` owns that table and must be
     re-run after.
   - A **newly added order number** arrives with `department` and
     `customer_legal_entity_id` unset and needs re-linking.

   So the safe sequence is: `--dry-run` first, then the import, then
   `import-project-responsibility.mjs`, then `npm run check:management-data`.
7. **Which YPOG entity** order `10305_00404_501_01` was contracted with — the
   `GmbH & Co. KG` or the `Partnerschaft von Rechtsanwälten mbB`.
8. **Who Stefan Goelzner is in the hub.** Active, 139.8h all billable, last entry
   yesterday, no `hub_person_id`. Either link him or say he should not have a
   `people` row.

**Then Factorial, which is now mostly waiting on one thing:**

9. **Phase 0 needs a Factorial admin**: create the OAuth application with the six
   scopes, complete the client-credentials flow for a **company** token (not a
   user token — those die on a 7-day cliff), request the demo tenant, and put
   `FACTORIAL_ACCESS_TOKEN` in `.env.local`. `npm run check:factorial-auth` lists
   the exact steps and verifies them once the token exists.
10. Phase 1 then has a tested pager, a measured identity baseline and a schema
    waiting for it. What it still needs is the staging tables, which were
    deliberately left unwritten until a real API response can be inspected.

Items 1, 2 and 8 are prerequisites for Factorial rather than preferences. Landing
real contract hours on top of a table that invents zeros, or a `people` table where
provenance means nothing, would make the fake numbers harder to find rather than
easier.
