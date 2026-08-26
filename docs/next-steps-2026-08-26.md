# Next steps: data integrity, then Factorial

Written 26 Aug 2026, after auditing the masterdata import against the live database
and reading the Factorial HR API documentation. Every number here was measured, not
estimated; the script that produced it is named so you can re-run it.

Companion documents:
- `docs/factorial-api-integration.md` — the full API reference and integration design
- `docs/live-people-data-map.md` — the earlier TrackingTime/people analysis

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

### 2.2 [NEEDS A DECISION] Three orders carry another company's name

Found by `node scripts/diagnose-order-name-customer-conflict.mjs`. In each case the
5-digit Lexware prefix agrees with the **customer**, so the TrackingTime link is
right and the **name** is the corrupted field — the signature of a row shift while
reading the workbook.

| Order | Customer | Name it wrongly carries | At stake |
| --- | --- | --- | --- |
| `10234_00103_104_01` | Netto ApS & Co. KG | "Mirantis Safety Engineer 2026/2027" | **398h** of real logged time |
| `10738_00319_104_01` | Unity Technologies GmbH | "Intel GmbH / SiFa" | 6.4h |
| `10110_00375_205_01`, `10361_00178_205_01` | AWB, SAGE | literally `"missing"` | 5.8h |

Anyone reading the projects ledger sees the wrong client against real billable
hours. Two more (`10305`, `10822`, Susell GmbH named "Reteach") need the same
judgement.

**ACTION: confirm the correct names against the source workbook, then correct
`projects.name` for those rows.** I have deliberately not guessed at them — a name
is customer-facing and 398h of billing hangs off one of them.

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

`node scripts/run-all-gates.mjs` — **79 gates: 77 pass, 1 skip, 1 red.**

The one red gate is red **on purpose**, and it clears without any judgement call:

| Gate | Why red | Clears when |
| --- | --- | --- |
| `check:projects-admit-unmeasured` | The fix is committed; the migration is not applied | You paste `20260826120000` |

`check:table-scroll-budget` is now **fully green** ("all checks passed") at both
1440x900 and 390x844, verified against a real `next build` served locally.
`test:my-work-scoping` SKIPs, as it did before this session.

Two gates were added and both are wired into `test:db`, so they run from now on:
- `check:projects-admit-unmeasured` (gate 78)
- `check:adr001-discriminates` (gate 79) — the negative control for the rule widening

Three migrations are written, PGlite-verified twice each, and **awaiting a paste**:
- `20260826120000_projects_admit_unmeasured_hours.sql`
- `20260826130000_ypog_berlin_alias.sql`
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

**Needs your judgement, and I deliberately did not substitute for it:**

4. **The 3–5 mis-named orders** (§2.2). `10234_00103_104_01` is Netto carrying
   "Mirantis Safety Engineer 2026/2027" with **398h of real logged time** behind it.
   Confirm the correct names against the workbook; I will apply them.
5. **Which YPOG entity** order `10305_00404_501_01` was contracted with — the
   `GmbH & Co. KG` or the `Partnerschaft von Rechtsanwälten mbB`.

**Then the actual goal:**

6. Factorial Phase 0: credentials, version pinning, **zero writes**. Then Phase 1,
   the read-only harvest into staging. Full plan in
   `docs/factorial-api-integration.md`.

Items 1, 2 and 4 are all prerequisites for Factorial rather than preferences.
Landing real contract hours on top of a table that invents zeros, or a `people`
table where provenance means nothing, would make the fake numbers harder to find
rather than easier.
