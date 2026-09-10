# Security review — the masterdata pipeline

**Date** 2026-09-10 · **Ticket** HSEHU-74 (brief also at issue #69) · **Reviewer** Sam Idris (Security & Supply Chain)
**Subject** the pipeline that shipped the same day in PRs #66 and #68, without a security pass.

```
Google Sheet "V1 HSE-Masterdata Kundenliste"
  -> docs/masterdata/apps-script-push.gs           hourly, in hitul's own Drive
  -> supabase/functions/masterdata-sheet-drop      POST, shared secret
  -> private Storage bucket masterdata-sheet, V1/  latest.xlsx, latest.json, heartbeat.json, <modified>_<sha12>.xlsx
  -> scripts/pull-masterdata-sheet.mjs             rig timer, service-role key
  -> scripts/import-masterdata-sheet-staging.mjs   stg.import_batch / stg.import_record
  -> scripts/promote-masterdata-sheet.mjs          public.project_masterdata, public.project_contact,
                                                   projects.project_order, public.projects,
                                                   person_assignments, project_responsibility,
                                                   project_link, crm.*
Migration: supabase/migrations/20260910120000_masterdata_sheet_warehouse.sql
```

**Verdict.** No critical finding. The pipeline's own controls are better than average for
something shipped in a day: the secret is compared in constant time before anything else
happens, the bucket is private, the function reaches no table, every SQL statement in the
promote path is parameterised, the workbook parser takes no npm dependency, and the promote
step refuses empty and mass-historical batches. The staging path — the one place personal
data could have escaped the new RLS policy — comes out clean four independent ways.

What the review did find is a layer of **gates that assert less than they appear to**, one
**wrong-project hole in the puller**, a **floating dependency in the function that holds the
service-role key**, and a **TLS weakness whose obvious fix would take the pipeline down** —
which is why it is reported here rather than "fixed".

Nine fixes are in this change. Twelve items are deferred, each with the reason.

---

## Method, and its limits

Stated first, because a report that cannot be told from one that stopped early is worth
little.

- **Read** every file in the pipeline end to end, plus `supabase/schema.sql`,
  `20260822130000_create_customer_master_foundation.sql`, `check-secret-parity.mjs`,
  `check-gates-runnable-on-ci.mjs` and the CSV/export paths in `src/`.
- **Executed** rather than reasoned wherever possible: the gate-defeat probes below were run,
  not imagined; the TLS conclusion comes from live handshakes with a control; the RLS audience
  is measured in PGlite, not read off the policy.
- **No live credentials exist in this worktree**, so nothing was run against the production
  database or the deployed function. Every claim about the *live* system — the deployed
  function's `verify_jwt` setting, who holds edit access to the Apps Script project, the rig's
  timer schedule — is named as unverified rather than assumed.
- `trivy`, `semgrep` and `npm audit` were **refused by this session's permission system**.
  No scanner output backs this report; it is source reading plus targeted execution. A run
  with those three available could still surface transitive advisories invisible here.

---

## Ranked findings

Severity is ranked by exploitability **in this deployment**, not by a generic list.

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | High (gate quality) | The Apps Script scope assertion admitted `gmail.readonly`, and an empty scope list | **fixed** |
| 2 | Medium | The puller had no project-ref guard, and decides "nothing new" on that connection | **fixed** |
| 3 | Medium | The RLS gate exercised one persona, so the real audience of the personal data was untested | **fixed** |
| 4 | Medium | Four security regressions in the edge function slip past the existing gate | **fixed** (new gate) |
| 5 | Medium | Six masterdata gates were absent from the assertion baseline | **fixed** |
| 6 | Medium | `@supabase/supabase-js@2` floats, in code holding the service-role key | **fixed** |
| 7 | Medium–High | `rejectUnauthorized: false` on every pg connection (118 files, pre-existing) | **deferred — the obvious fix breaks it** |
| 8 | Medium | The dead-man switch's threshold was silently ignored when set in `.env.local` | **fixed** |
| 9 | Low | The puller spawned its children by a cwd-relative path | **fixed** |
| 10 | Low | `MASTERDATA_DROP_SECRET` was named in no secret registry | **fixed** |
| 11 | Low/Info | `verify_jwt` was claimed in a comment and pinned nowhere | **fixed** |
| 12 | Medium | Every contact in the caller's book of work ships to the browser on each render | **deferred** |
| 13 | Medium | `x-sheet-id` is shape-checked, never identity-checked | **deferred** |
| 14 | Medium | `drive.readonly` spans hitul's whole Drive | **deferred** |
| 15 | Medium | The running Apps Script can drift from the committed one with no signal | **deferred (residual)** |
| 16 | Medium (doc) | The `project_contact` comment describes UI behaviour as if it were policy | **deferred — needs a migration** |
| 17 | Low | The project-ref guard is a substring test | **deferred** |
| 18 | Low–Med | The puller verifies a *mutable* object, so a benign race reads as a failure | **deferred** |
| 19 | Low–Med | A failed promote reads green on every later run until the sheet changes | **deferred** |
| 20 | Low | The puller passes every `.env.local` secret to its children | **deferred** |
| 21 | Low | Zip-bomb / XML-bomb in the workbook reader (availability only) | **deferred** |
| 22 | Low | Committed Drive file id: a latent capability if the sheet is ever link-shared | **deferred** |

---

# Fixes applied

## 1 — The Apps Script scope assertion was defeated by a substring match · HIGH (gate quality)

`scripts/check-masterdata-drop.mjs:44`, as it stood:

```js
manifest.oauthScopes.every((s) => /readonly|external_request|script\.scriptapp/.test(s))
  && !manifest.oauthScopes.some((s) => /\/auth\/(drive|spreadsheets)$/.test(s))
```

**Evidence — the predicate was run against candidate manifests, not reasoned about:**

```
current manifest                   OLD gate: PASS
+ gmail.readonly                   OLD gate: PASS      <- read all of the owner's mail
+ contacts.readonly                OLD gate: PASS
+ calendar.readonly                OLD gate: PASS
+ admin.directory.user.readonly    OLD gate: PASS      <- the whole Workspace directory
oauthScopes = []                   OLD gate: PASS      <- vacuously true
```

`every` is a **substring** test, so essentially every `.readonly` scope Google publishes
satisfied it. And `[].every()` is vacuously true, so *emptying* `oauthScopes` — which makes
Apps Script infer scopes at authorisation time from whatever the code happens to call —
also passed. That is the plausible-looking edit, not the obviously hostile one.

Three examples from the brief were checked and do **not** slip through, because `every`
applies to all entries: `drive.file`, `script.projects` and `https://mail.google.com/` each
fail. The real bypass family is *anything containing "readonly"*, plus the empty array.

**Attacker** anyone who can land a commit touching the manifest, or an agent doing it by
accident. Google's consent screen is still a real second barrier — a human must click through
new scopes — so this is a defence-in-depth failure, not a silent one.

**Fix applied.** `check-masterdata-drop.mjs` now compares against a named `ALLOWED_SCOPES`
list as a **set**, so an extra scope and a missing one both fail. Widening the grant of a
script that holds the drop secret is now a reviewable diff naming the scope and the call that
needs it.

**Gate** this *is* the gate; `check-masterdata-security.mjs` additionally asserts the check
keeps its **shape** — a named allowlist compared with `sameSet`, and no `oauthScopes.every(`
in the code — so the pattern form cannot quietly return.

## 2 — The puller connected with no project-ref guard · MEDIUM

`scripts/import-masterdata-sheet-staging.mjs:89` and `scripts/promote-masterdata-sheet.mjs:91`
both refuse when `SUPABASE_DB_URL` is not the project `NEXT_PUBLIC_SUPABASE_URL` names.
`scripts/pull-masterdata-sheet.mjs` did not, and it reads two variables that can disagree:
the **bucket** from `NEXT_PUBLIC_SUPABASE_URL` (line 53) and the **database** from
`SUPABASE_DB_URL` (line 102).

The write path was already safe — the puller spawns both children, and both re-derive the ref
and stop. **The decision made above them was not:**

```js
const newest = (await client.query(
  `select id, file_hash, received_at from stg.import_batch where source_system = $1 order by received_at desc limit 1`, …
if (newest && newest.file_hash === manifest.sha256) {
  console.log(`already staged as batch ${newest.id} …; nothing new to stage`);
  process.exit(0);
}
```

Point the two variables at different projects — a restored snapshot during an incident, two
projects in one `.env.local` — and a matching `file_hash` in the **wrong** `stg.import_batch`
makes the hourly job print *"nothing new to stage"* and **exit 0**. The dead-man switch then
reports success while the real warehouse goes stale. That is this repository's own named worst
bug: silence read as success.

**Fix applied.** The same refusal, in `pull-masterdata-sheet.mjs`, before the connection.
Deliberately the *identical* substring form as the two existing copies rather than a better
one — see deferred item 17 for why unifying them is a separate change.

**Gate** `check-masterdata-security.mjs` asserts all three CLIs derive the ref from
`NEXT_PUBLIC_SUPABASE_URL` and refuse on `includes(projectRef)`, and that each opens its own
`pg.Client` so the guard is the thing protecting it. The two library modules are deliberately
excluded: they take an injected `db` and open nothing, which is what lets the promote gate run
the identical code in PGlite.

## 3 — The RLS gate exercised one persona · MEDIUM

`public.project_contact` holds third-party names, phones and emails. "Who can read it" is the
question the gate exists to answer, and until now it seeded exactly **one** profile — an
active `employee` who owned a project — and asserted owner-sees / stranger-does-not.

That leaves the four cases that actually decide the audience untested. My role rule here is
that *a policy says what we intended; a query says what is true* — so the audience is now
measured, in PGlite, with no credentials:

```
exec reads EVERY masterdata row — the first branch admits all projects
  — 10110_00358_104_01, 10234_00103_104_01
exec reads EVERY customer contact, company-wide — this is the real audience of the personal data
  — 10110_00358_104_01, 10234_00103_104_01
a dept_head reads the contacts of every project in THEIR department, touched or not
  — 10110_00358_104_01
a dept_head does NOT reach another department's contacts        — 10110_00358_104_01
a plain assignee — owning nothing — reads the assigned project's contacts — 10234_00103_104_01
and reaches nothing they are neither assigned to nor own        — 10234_00103_104_01
a DEACTIVATED exec reads no masterdata row — is_active revokes, it does not merely hide — (none)
a DEACTIVATED exec reads no customer contact either             — (none)
```

**So the real audience, stated plainly:** an **exec** reads every customer contact in the
company — on the first sheet that is ~247 orders, so up to ~500 names, phones and emails in a
single `GET /rest/v1/project_contact?select=*`. A **dept_head** reads every contact of every
project in their department, whether or not they have ever touched the order. An ordinary
employee reads the contacts of their whole book of work, not one order.

**That is the intended policy** — it is the same `can_view_project()` every other project
table uses, and an operations consultant does need the contact for their orders. It is
reported because the migration's own comment implies something narrower (deferred item 16),
and because nobody had measured it.

**Note on the fixture.** The first draft of this block gave the dept_head and the assignee the
same `person_id`, so the dept_head reached the other department's row through the *assignment*
branch and the department assertion failed for a reason that had nothing to do with
departments. They are different people now, with a comment saying why. One variable at a time,
or the test measures the fixture.

**Cost** 8 assertions, ~40 lines, no credentials, in a gate that already existed.

## 4 — Four regressions slip past the existing gate · MEDIUM

`check-masterdata-drop.mjs` asks, twenty-four times, "does this text appear somewhere". That
cannot assert **order**, **exhaustiveness** or **absence**. Each regression below was applied
to the real file, both gates were run, and the file was restored:

```
regression                                      old gate / new gate
(0) unmodified tree                             old:PASS   new:PASS
(1) + gmail.readonly in the manifest            old:FAIL   new:PASS
(2) oauthScopes emptied (vacuously true)        old:FAIL   new:PASS
(3) secret checked after req.arrayBuffer()      old:PASS   new:FAIL
(4) console.error leaks the presented secret    old:PASS   new:FAIL
(5) 401 body echoes the presented secret        old:PASS   new:FAIL
(6) writes public.app_user_profile              old:PASS   new:FAIL
(7) supabase-js back to a floating @2           old:PASS   new:FAIL
(8) tree restored                               old:PASS   new:PASS
```

Rows 1 and 2 read `old:FAIL` because finding 1's fix is already in — those are the cases the
old gate passed before this change, and the new gate leaves the manifest itself to the old
gate rather than keeping two copies of the scope list. Rows 3–7 are what the old gate still
cannot see:

- **(3)** `/return json\(401/` matches wherever the guard sits, so the secret check could be
  moved below `await req.arrayBuffer()` and the function would buffer an unauthenticated 15 MB
  body first. The new gate compares **source positions**: the 401 guard must precede the body
  read, `createClient`, every `.storage.` call, and the header validation.
- **(4)** the "never logs the secret" assertion is `/console\.log\([^)]*(secret|presented|expected)/`
  — it never looks at `console.error`, `.warn`, `.info` or `.debug`.
- **(5)** nor at a **response body**. The new gate enumerates every `console.*` call and every
  `json()` call and asserts that none of them mentions `presented` or `expected`.
- **(6)** "writes only under the bucket prefix, never to a table" asserts one bucket upload
  *exists* and that four schema names do not appear — so any table outside that list, or the
  same list in single quotes, is invisible. The function holds a **service-role** client, which
  can read and write every table and every bucket in the project and bypasses RLS. The new gate
  asserts **every** `.from()` names the `BUCKET` constant, and that there is no `.rpc(`, no
  `.schema(` and no auth-admin call.

**Fix applied.** `scripts/check-masterdata-security.mjs`, 47 assertions, static, chained into
`test:db`.

## 5 — Six masterdata gates were absent from the assertion baseline · MEDIUM

`scripts/gates/assertion-baseline.json` is what turns "the gate ran" into "the gate still
checked as much as it used to". Every masterdata gate was chained into `test:db` on 2026-09-10
and **none was recorded there**, so any of them could have dropped from eighty-three assertions
to two and still read green — for exactly the pipeline this ticket is about.

**Fix applied.** All six recorded, plus the new one:

```
check:masterdata-sheet-import 47   check:masterdata-drop 24   check:masterdata-security 47
check:masterdata-warehouse-migration 42   check:masterdata-promote 83   check:masterdata-customers 13
```

**Why it is legitimate to record these numbers from a machine with no credentials**, when the
file's own comment says the counts are taken on a machine that has them: all seven are static
or PGlite-backed. Each was executed here, with no environment at all, and returned a full green
RESULT line — so their counts are the same on a runner as on the rig and a missing entry has no
excuse. `npm run gates:baseline` was **not** run: it rewrites the whole file, and from this
worktree it would lower every credentialed gate's count to whatever it evaluates without
credentials. The six entries were added by hand for that reason.

`check:table-scroll-budget`, `test:factorial-mutations` and `check:invite-role-default` are also
missing from the baseline. They are outside this ticket and are left alone; the first is
deliberate and listed under `unstable`.

**Gate** `check-masterdata-security.mjs` fails if any `check:masterdata-*` in `test:db` lacks a
baseline entry, so the seventh gate cannot repeat this.

## 6 — The function holding the service-role key floated on a major range · MEDIUM

`supabase/functions/masterdata-sheet-drop/deno.json` pinned `npm:@supabase/supabase-js@2` — a
floating major resolved **at deploy time** from npm, in code that hands that library the
project's service-role key (`index.ts:78-80`). Any published 2.x, including a compromised one,
was what deployed next, and the Deno edge runtime permits arbitrary outbound `fetch`.

The consistency argument matters here and is worth stating precisely, because on the surface
`package.json` also uses caret ranges. **The caret is inert there**: `package-lock.json` records
`2.112.3` with an integrity hash and CI installs with `npm ci`, so a hostile `2.112.4` cannot
enter the app without appearing as a reviewable lockfile diff. The edge function has no
lockfile and no such diff. The repo already pins its *linters* to a commit SHA
(`.github/workflows/house-rules.yml`) for exactly this reason.

Mitigating fact, stated honestly: the exposure window is **per-deploy, not continuous**, and
this function is deployed rarely.

**Fix applied.** Pinned to `npm:@supabase/supabase-js@2.112.3` — the version this repo already
ships and integrity-verifies for the app, so the two copies are now one reviewed number.

**Gate** the new gate asserts an exact `X.Y.Z`, that no import resolves through a bare major,
and that the function's version **equals** `package-lock.json`'s, so a bump is a single
decision rather than two that drift.

The `jsr:@supabase/functions-js/edge-runtime.d.ts` import carries no version either, but it
resolves a `.d.ts`: types are erased at runtime, so a hostile version can mislead a compile and
not execute. Pin it for reproducibility when the next deploy reveals the resolved number.

## 8 — The dead-man switch's threshold was a no-op when configured · MEDIUM

```js
const MAX_HEARTBEAT_AGE_H = Number(process.env.MASTERDATA_MAX_HEARTBEAT_AGE_H || 3);   // line 48
…
const env = loadEnv();                                                                  // line 52
```

`loadEnv()` merges `process.env` **then** `.env.local`, and it was called four lines *after*
this read. So a threshold set in `.env.local` was silently ignored and the default 3 h used,
with nothing printed to say so. A dead-man switch whose threshold cannot be set is precisely
the failure mode the switch exists to catch. `MASTERDATA_SHEET_XLSX` had the same defect one
line down, hidden only because the puller overrides it explicitly for the child.

**Fix applied.** `loadEnv()` moved above both, and both read from `env`.
**Gate** asserted in the new gate.

## 9 — The children were spawned by a cwd-relative path · LOW

`spawnSync(process.execPath, ["scripts/import-masterdata-sheet-staging.mjs", …])` resolves
against the **working directory**. Run the timer from anywhere but the repo root and it dies on
`MODULE_NOT_FOUND`; run it from a directory someone else can write to and node executes *their*
`scripts/import-masterdata-sheet-staging.mjs` — with this rig's service-role key and database
URL in its environment.

**Fix applied.** Both children resolve against `import.meta.url`. **Gate** asserted.

## 10 — The drop secret was named in no registry · LOW

`MASTERDATA_DROP_SECRET` has three homes — the Apps Script property `DROP_SECRET`, the function
env, and `~/.config/hse/masterdata-drop.env` on the rig — and appeared **zero times** in
`check-secret-parity.mjs`, whose own header says *"an unexplained absence from this list is
indistinguishable from an oversight."*

**But adding it to `MAPPED` or `PRESENCE_ONLY` would turn that gate red forever**, because both
assert the name exists as a **GitHub Actions** secret, and this one is not and should not
become one.

Being fair about the runtime risk: drift between the first two homes **is** detected, and
better than in the Factorial incident that gate was written for. A mismatch 401s every hourly
push, the Apps Script logs the drop's own `{"error":"bad secret"}` verbatim — the *cause*, not
the symptom — the heartbeat stops, and the puller fails after `MASTERDATA_MAX_HEARTBEAT_AGE_H`.
**The third home is the hole**: no code reads it, so a stale copy there breaks nothing until
someone re-sets one of the other two from it.

**Fix applied.** A third, **printed-not-asserted** `NOT_IN_GITHUB` block in
`check-secret-parity.mjs`, naming the credential, its three homes and what does and does not
detect drift. It adds **zero** assertions, so no baseline moves.
**Gate** the new gate asserts the name appears in `check-secret-parity.mjs` and is *not* in
`MAPPED`.

## 11 — `verify_jwt` was claimed in a comment and pinned nowhere · LOW / INFO

`index.ts:17` documents `Authorization: Bearer <anon key>  the gateway's JWT check (verify_jwt)`
as part of the design. There was **no `supabase/config.toml`, no deploy script and no workflow**
that deploys this function, so the flag was whatever the last hand-run deploy left it as, and a
single `--no-verify-jwt` would have removed it with nothing to notice.

**Be clear what this buys.** The anon key is public by design — it ships to every browser and is
written into an Apps Script property. `verify_jwt` therefore does **not** authenticate the
caller; it keeps unauthenticated internet scanners off the function, and that is all. **The only
authentication on this endpoint is the shared secret.** Saying so is the point of this item.

**Fix applied.** `supabase/config.toml` pins `verify_jwt = true` for the function, with the
above written into it. **Limit, stated:** this pins intent for the next CLI deploy. It says
nothing about the function deployed on 2026-09-10 — that is a dashboard fact and is item 1 of
the follow-up list below.

---

# Deferred, with the reason

## 7 — `rejectUnauthorized: false` on every pg connection · MEDIUM–HIGH · repo-wide

Raised by the 2026-09-10 audit; present at `pull-masterdata-sheet.mjs:102`,
`import-masterdata-sheet-staging.mjs:97`, `promote-masterdata-sheet.mjs:99` — and in **118
files** across `scripts/` (122 occurrences).

**What is actually true.** The connection **is** encrypted — `pg` sends the SSLRequest preamble
and completes a TLS handshake regardless — so passive wiretapping is already defeated. What is
missing is **peer verification**. An attacker who can redirect the TCP flow presents any
certificate, becomes the server, chooses `AuthenticationCleartextPassword`, and receives the
`SUPABASE_DB_URL` password verbatim. That password is the direct-Postgres credential for the
whole project and bypasses RLS. Every row in flight — `crm.lexware_customer`,
`public.project_contact`, `public.people` — is readable and modifiable.

**Why the obvious fix is wrong, proven rather than assumed.** Live TLS probes from this
worktree today, with a control:

```
CONTROL  api.supabase.com:443
         authorized: true      chain: supabase.com <- WE1 <- GTS Root R4 <- GlobalSign Root CA

db.wdbedblvyrfqwypngghs.supabase.co:5432
         verified_by_node_defaults: false     SELF_SIGNED_CERT_IN_CHAIN
         db.wdbedblvyrfqwypngghs.supabase.co (O=Supabase Inc) <- Supabase Intermediate 2021 CA
         Supabase Intermediate 2021 CA       (O=Supabase Inc) <- Supabase Root 2021 CA
         Supabase Root 2021 CA               (O=Supabase Inc) <- itself

aws-0-eu-central-1.pooler.supabase.com:5432
         verified_by_node_defaults: false     SELF_SIGNED_CERT_IN_CHAIN
         *.pooler.supabase.com (O=Supabase Inc) <- … <- Supabase Root 2021 CA
```

The control proves Node's bundled root store on this rig is intact, so the failure is genuinely
Supabase's private CA and not a middlebox. **Setting `ssl: true` or `rejectUnauthorized: true`
would take the hourly pipeline down with `SELF_SIGNED_CERT_IN_CHAIN`** — the kind of "fix" that
gets reverted at 3am and leaves the original weakness plus a scar.

**Two options.**

- **A — fix the four masterdata scripts now.** Cost ~1 hour. 114 files keep the identical
  exposure over the identical wire with the identical credential. The threat is per-connection,
  not per-script, so this reduces risk by close to nothing while creating a sense of closure,
  and a gate scoped to four files cannot stop file 119.
- **B — one shared TLS helper, a committed CA, and a repo-wide gate with a shrinking allowlist.**
  Cost ~half a day for helper + gate + baseline; migrating the 118 files is mechanical and can
  proceed in batches behind the allowlist.

**Recommendation: B.** Concretely: `scripts/lib/db-tls.mjs` exporting `tlsOptions()` — the
implementation already exists, unarmed, at `scripts/sample-system-health.mjs:191-202`, whose own
comment records *"No bundle was found on this rig or in the repo on 2026-09-02"*; ship the
Supabase Root 2021 CA as a committed `.crt` (a file, not a dependency); `scripts/check-db-tls.mjs`
failing on any `rejectUnauthorized: false` outside the helper and outside a documented allowlist
seeded at today's 118 files and never allowed to grow; convert the four masterdata scripts first
and delete them from the allowlist in the same commit. Note the pinned root expires
**2031-04-26** and Supabase may rotate sooner — a pinned CA with no rotation plan is a scheduled
outage, so the helper must fail *loudly*, not silently.

**Why not in this change:** it touches 118 files and needs a committed CA bundle and a rotation
owner. That is its own ticket, and doing a quarter of it here would be the false-closure failure
described above.

**Could a gate prevent the class?** Yes — step 3 above, static, no credentials, runs in CI.

## 12 — Every contact in the caller's book of work ships to the browser · MEDIUM

`src/lib/queries/my-work.ts:914-946` reads `project_contact` for the **whole** project list, and
`src/components/my-work/MyWorkTables.tsx` receives all of it in a client component; the selection
is a client-side `find`. So third-party names, phones and emails for tens of orders cross to the
browser on every `/my-work` render, even when nothing is selected and only one order's contacts
are ever displayed. For an exec that is the company's entire customer contact list.

Not a cross-tenant leak — it is bounded by the same `can_view_project` set the caller is entitled
to — but it is a data-minimisation defect, and it contradicts the migration's own claim.

The code says so itself, at `my-work.ts:908-911`: *"It is read for the whole book of work in one
round rather than per selection because the page is server-rendered and has no per-row endpoint;
what keeps it out of the LIST is the UI contract."* So it was a **conscious trade with a stated
reason**, not an oversight.

**Deferred because** it is a change to the My Work rendering path — a feature shipped the day
before under HSEHU-64 — not to the pipeline this ticket reviews, and it cannot be verified from
here: there is no running app and no credentials. Making an unverifiable change to a live page
inside a security-review PR is the wrong trade.

**Proposed fix, for its own ticket:** `/my-work` is already `force-dynamic` and already reads
`?project=` server-side. Fetch `project_contact` for the single selected `project_id`, or strip
`contacts` from every non-selected row before handing `projects` to `MyWorkTables`. One query
and one map.
**Gate** two static assertions in `check-my-work-detail.mjs`: that `fetchMyContacts` is called
with a single id, and that at most one row carries a non-empty `contacts`.

## 13 — `x-sheet-id` is shape-checked, never identity-checked · MEDIUM

`index.ts:74` validates `/^[A-Za-z0-9_-]{20,}$/` and nothing pins the **expected** sheet. A
holder of the drop secret can push a different sheet's export and the pipeline stages and
promotes it as `MASTERDATA_SHEET_V1` within the hour; the puller never compares
`manifest.sheet_id` with anything.

**Deferred because** the fix needs the live sheet id, and the only evidence available here is the
value in the committed `.gs` header. Pinning a wrong id fails the hourly pipeline closed — a real
operational outage caused by a security PR that could not verify its own input.

**Proposed fix:** pin it rig-side, where no deploy is needed. In `pull-masterdata-sheet.mjs`,
after reading the manifest:

```js
const EXPECTED_SHEET_ID = env.MASTERDATA_SHEET_ID || "16Xs8SbSdfW_yLY51IKPYZUsZVo-HkEWzGqEt6mJ6rsQ";
if (manifest.sheet_id !== EXPECTED_SHEET_ID) {
  console.error(`FAIL: the drop names sheet ${manifest.sheet_id}, not the masterdata sheet; refusing`);
  process.exit(1);
}
```

Confirm the constant against the live Apps Script property first. **Gate** static: assert the
puller compares `manifest.sheet_id` against a configured id.

## 14 — `drive.readonly` spans hitul's whole Drive · MEDIUM

The script reads exactly one file; the granted token can read **every** file in the authorizing
account's Drive. Because consent is already granted, a code edit widens the *use* without
widening the *scopes*, so no re-prompt occurs.

**Deferred because narrowing it cannot be asserted from here.** Sheets API v4 has no xlsx export,
and `docs.google.com/…/export?format=xlsx` is a Docs/Drive frontend endpoint that authorises
against Drive-family scopes, so `spreadsheets.readonly` very likely does not work;
`drive.metadata.readonly` cannot serve content; `drive.file` grants nothing for a file the app did
not create. All three are **reasoned, not observed**. Changing a manifest on that basis is how an
unattended 03:00 job dies.

**Recommendation, which needs no untested scope:** the lever is the **identity**, not the scope
string. Move the script to a dedicated Google account whose Drive contains nothing but this one
shared sheet. That bounds the blast radius exactly. If the scope is to be narrowed instead, treat
it as *verify then narrow*: test each candidate against a scratch sheet first.
**Gate** finding 1's allowlist already freezes today's set, so any widening is a reviewable diff.

## 15 — The running Apps Script can drift from the committed one · MEDIUM (residual)

`check-masterdata-drop.mjs` asserts real properties — no write call, no `SpreadsheetApp`, the
secret from Script Properties — but it binds **a file in git**, not the code at
script.google.com. The drop records `x-sheet-id` and `x-sheet-modified`: facts about the *sheet*,
never about the *script*. Nothing observes the running version.

A drifted script holds `DROP_SECRET` (the only real authentication), can push arbitrary
zip-shaped bytes that stage and promote within the hour, and can read anything in that Drive
through the already-consented token.

**Deferred, and partly not fixable.** A version marker echoed in a header and recorded by the
function (~6 lines across three files) catches **accidental** drift — a browser edit never
mirrored back to git, which is the realistic case. It does **nothing** against a deliberate
attacker, who updates the marker too. Real attestation needs the Apps Script API, a service
account and a key file — the exact thing rejected on 2026-09-10 when this design was chosen.

**Recommendation:** add the marker for accidental drift, and record malicious drift in the vault
as an **accepted residual risk** with its blast radius, rather than pretending a marker closes it.
Also: confirm and record who has edit access to that standalone project — anyone who does holds
the secret in plain text. Nothing in this repository records it, so it could not be checked here.

## 16 — The `project_contact` comment describes UI behaviour as policy · MEDIUM (documentation)

`20260910120000_masterdata_sheet_warehouse.sql:151-152` says contacts are *"shown only to the
project's people, for one selected order at a time; omitted from every export."* Measured against
finding 3: *"the project's people"* is a lay phrase for a predicate that also admits **every exec
unconditionally** and **every dept_head department-wide**; *"one selected order at a time"* is not
enforced anywhere, not even at the transport layer (finding 12); *"omitted from every export"* is
genuinely true and pinned by `check-my-work-detail.mjs`.

**Deferred because a table comment is a migration**, and this ticket must not touch
`supabase/migrations`. Proposed text, for someone with that authority:

```sql
-- PROPOSED: supabase/migrations/<ts>_project_contact_comment_states_the_real_audience.sql
begin;
comment on table public.project_contact is
  'Customer contact persons (Ansprechpartner 1 and 2) of a service order, from the '
  'masterdata sheet. Personal data of third parties. THE POLICY IS can_view_project(project_id) '
  'AND NOTHING NARROWER: an exec reads EVERY contact row in this table, a dept_head reads every '
  'contact of every project in their department whether or not they have touched it, and an '
  'owner or assignee reads every contact of every order in their book of work -- not one order. '
  '"One selected order at a time" is a UI rendering rule in MyWorkDetail.tsx, not a database '
  'guarantee. Omission from CSV is enforced in code by explicit per-column csv callbacks and '
  'pinned by scripts/check-my-work-detail.mjs -- also not a database guarantee. '
  'Measured personas: scripts/check-masterdata-warehouse-migration.mjs.';
commit;
```

A second, optional proposal: the migration claims *"Same shape as public.project_link"* at line
155, but `project_link` grants `service_role` nothing while this grants it
`select, insert, update, delete`. Not a security finding — `service_role` bypasses RLS anyway and
the promote path connects as direct `pg`, so the write half is unused surface — but the "same
shape as X" claim is false and the next table copied from this one inherits it. **Correct the
comment; do not revoke**, which would risk a future promote for no gain.

## 17 — The project-ref guard is a substring test · LOW

`connectionString.includes(projectRef)` passes if the ref appears **anywhere** — in the password,
in `?application_name=`, or as the database name:

```
postgresql://postgres:wdbedblvyrfqwypngghs@db.OTHERREF.supabase.co:5432/postgres
postgresql://postgres:pw@db.OTHERREF.supabase.co:5432/postgres?application_name=wdbedblvyrfqwypngghs
```

**Theoretical**, and the substring form is *deliberate*: the ref sits in the **hostname** of the
direct URL and in the **username** of the session-pooler URL
(`aws-0-eu-central-1.pooler.supabase.com`, confirmed today to carry no ref in its host), so a
strict hostname equality would break the pooler. Every bypass also requires an actor who can
already write `.env.local`, at which point they own the URL outright. The guard's real job —
catching the *mistake* of two projects in one env file — it does.

**Deferred** so this change adds the missing guard in the identical form rather than changing the
semantics of three live scripts at once.
**Proposed fix:** `scripts/lib/require-project-ref.mjs` parsing with `new URL()` and accepting
exactly `hostname === \`db.${ref}.supabase.co\`` or `username === \`postgres.${ref}\``. A pure
function, so it is testable with a table of strings and needs no database — and the new gate's
"all three CLIs refuse" assertion becomes "all three import the helper".

## 18 — The puller verifies a *mutable* object · LOW–MEDIUM

The puller reads `latest.json`, then `latest.xlsx`. The function writes `latest.xlsx` **first**
and `latest.json` **second**. A POST landing between the two reads gives old manifest + new bytes
→ hash mismatch → `exit 1` → the dead-man switch reports a failure that is not one.

**Proposed fix, one line:** download `manifest.path` — the dated object, written with
`upsert:false` and therefore immutable — instead of `latest.xlsx`. The race disappears and the
hash then verifies the object the manifest actually names. **Deferred** only because it changes
what the live hourly job fetches and cannot be exercised end to end from here.

**While here, the honest reading of that hash check:** it is a **checksum, not an
authentication**. Both objects are written by the same POST, from the same bytes, by the same
client — a poisoner writes both consistently by construction. It catches a torn download and
storage corruption. It does not distinguish a genuine export from a forged one, and the existing
gate's label *"a download that does not match its manifest is a failure"* reads stronger than it
is. Real drop integrity would need the Apps Script to sign the manifest with a key the function
never sees and the rig pins.

## 19 — A failed promote reads green on every later run · LOW–MEDIUM

If the promote child fails, the job exits non-zero — correct. But the **next** hourly run finds
`newest.file_hash === manifest.sha256`, prints *"already staged … nothing new to stage"* and exits
**0**, so the dead-man switch reports success while that batch was never promoted. It self-heals
when the sheet next changes, and `--promote` is the manual escape, but between those moments the
pipeline reports green while stale. **Deferred:** the fix is to record the promote outcome on the
batch, which is a schema decision. **Gate** PGlite: stage a batch, fail the promote, assert the
next decision is not "success".

## 20 — The puller passes every `.env.local` secret to its children · LOW

`env: { ...process.env, ...env }` at both spawn sites copies `FACTORIAL_API_KEY`,
`TRACKINGTIME_AUTH` and the rest into children that need three variables. **It exposes nothing
new** — both children call `loadEnv()` themselves and would read the same file anyway — so this is
redundancy with a nonzero blast radius (a crash handler, a core dump, `ps e`), not a breach.
**Deferred:** restricting the set risks the live job for a hygiene gain, and it cannot be
exercised here. **Gate** static: flag `env: { ...process.env, ...env }` on a spawn.

## 21 — Zip bomb and XML entity expansion in the workbook reader · LOW (availability)

`scripts/lib/masterdata-sheet.mjs` parses the xlsx with Python's `zipfile` + `ElementTree` and
reads members with no expanded-size budget. 15 MB compressed can become many GB resident;
`maxBuffer` caps stdout, not the heap. `ElementTree` does not resolve *external* entities — there
is no XXE, no SSRF, no file read — but internal-entity amplification depends on the bundled
libexpat, which was not testable here. Both need bucket-write ability, i.e. the drop secret.
**Consequence is a loud crash that the dead-man switch reports**, not a compromise, which is why
it is last. **Deferred; gate** optional: assert a cumulative expanded-size budget before `read`.

## 22 — The committed Drive file id · LOW

`apps-script-push.gs:16` commits `16Xs8SbSdfW_yLY51IKPYZUsZVo-HkEWzGqEt6mJ6rsQ` to a public
repository. **It is not a credential** — Drive authorises per identity, and line 93's own error
(*"is the sheet still shared with this account?"*) shows that model. Today's disclosure is that
HSE has a masterdata sheet and what its id is, which is close to worthless without the grant.
**But it is a latent capability**: if that sheet is ever set to "anyone with the link", the id in
a public repo converts instantly into a public read of the entire customer and service-order
master list. **Recommendation:** one line in the header stating the sheet must never be
link-shared, since the id is public. Not inflated further.

---

# Verified clean

Listed so this report can be told from one that stopped early.

**The staging bypass does not exist — the thing worth checking hardest.** The same contact
personal data is written to `stg.import_record.raw_payload`, and four independent locks hold:
the foundation migration's loop takes the `else` branch for `stg`, granting **service_role only**
and creating **no policy at all** while RLS is enabled (deny-all); schema `USAGE` is revoked from
`authenticated`, and USAGE and table privilege are **conjunctive** in Postgres, so a table grant
would be inert without it; `stg` is not in `pgrst.db_schemas`, so PostgREST returns
`PGRST106 Invalid schema` before RLS is reached; and `/customer-master/import-review` reads it
with a direct `pg` pool behind `requireProfile(…, ["exec"])`. Its only human audience is `exec`,
who already reads 100% of `project_contact` through the policy — so it is not even a widening.
Already pinned by `check-customer-master-foundation.mjs`.

- **No views, materialized views or SQL functions** — security-definer or otherwise — read
  `project_masterdata`, `project_contact`, or the four new `project_order` columns.
  `check-views-are-invoker.mjs` *enumerates* rather than names, covers `public`, requires inline
  `security_invoker`, and is chained into `test:db`, so it would catch a new one.
- **The four new `projects.project_order` columns widen nothing.** That table is exec-only in both
  `USING` and `WITH CHECK`, and the `projects` schema is not PostgREST-exposed.
- **Exports genuinely omit contacts, in code.** Both CSV serialisers are explicit-column; there is
  no generic row serialisation anywhere in `src/components/data-table/`, no server-side export
  route, and `MyWorkDetail` has no download, clipboard or print affordance. Pinned by
  `check-my-work-detail.mjs` with three anti-bypass assertions and negative controls.
- **No SQL injection anywhere in the pipeline.** All 20+ promote-path queries and the importer's
  are parameterised; a grep for interpolation inside a query template returns zero. The importer's
  dynamically-built tuple placeholders derive every character from a numeric loop index, and its
  arity is correct — no sheet content reaches the SQL string.
- **No command injection.** `spawnSync("python3", ["-c", …])` and `spawnSync(process.execPath, …)`
  both pass argv arrays with no `shell: true`.
- **No zip-slip**, at the exact spot a naive implementation would have it: the reader uses
  `z.read(target)` — a member *inside* the archive — not `z.extract`, even though `target` comes
  from attacker-controlled `workbook.xml.rels`.
- **No SheetJS/`xlsx` dependency exists at any version**, so CVE-2023-30533 (prototype pollution),
  CVE-2024-22363 (ReDoS) and the vendor's npm deprecation are all inapplicable. The parser takes
  **zero** npm dependencies, deliberately. This removes the largest single item the audit expected
  to find.
- **PRs #66/#68 added no dependency.** Across `071281d~5..071281d` the only change to the
  dependency objects is `next ^16.3.1 -> ^16.3.3`, a CVE patch from a different PR. Counts
  unchanged at 8 prod / 10 dev. The house rule was followed.
- **No credential is committed.** Zero JWT-shaped strings, zero `sb_secret`, zero secret-shaped
  assignments across `supabase/`, `scripts/` and `docs/masterdata/`. The one
  `postgresql://…` hit is a `<PASSWORD>` placeholder. `.gitignore` covers `.env*` (with
  `!.env*.example`), `.secrets/` and `.local/`; no `.xlsx` is tracked. Now gated.
- **No secret is printed on any path**, including every `catch`. All 18 `json()` returns and every
  `console.*` / `Logger.log` were enumerated: none carries `presented` or `expected`. The Apps
  Script's failure email, which quotes the response body, therefore cannot carry the secret.
- **The path cannot be escaped.** `isIso()` was probed with traversal payloads, embedded slashes
  and trailing newlines: JavaScript's `$` anchors at end-of-input, so no accepted string yields
  `/` or `..` in the object name.
- **The dated archive object is written with `upsert:false`** and can never be rewritten — now
  gated, since it is the only record of what was actually delivered.
- **The constant-time comparison is sound.** Digesting both sides then comparing the digests is
  correct; the trailing length check is redundant but harmless, since it only runs once the
  digests already match.
- **The secret is checked first** — before the body is read, before a client is built, before any
  storage call, before the headers are validated. Verified by source position, not by pattern, and
  now gated as an ordering invariant.
- **The dead-man switch fails loudly**: no heartbeat, stale heartbeat, or manifest mismatch each
  exit 1. The puller never talks to Google.
- **The promote step's blast-radius guards are real**: empty-batch refusal, the ≤50% historical
  bound checked *before* any write persists, exact-key-only resolution, never deleting, and
  `--allow-mass-historical` as an explicit override rather than a default.
- **The two promote library modules are clean by construction** — both take an injected `db` and
  open no connection, read no env and touch no TLS. That purity is what lets the promote gate run
  the identical code in PGlite.
- **`file_storage` is a plain folder label**, not a path, URL or credential — fixture-pinned as
  `"Ordner A"`.
- **No commercial figures ride on `project_masterdata`.** Contract hours stay on `public.projects`
  under budget redaction; the sheet's planned/on-site/remote hours were never promoted.
- **`gate-env.mjs` ordering is correct**: `process.env` wins over `.env.local`, so a local file
  cannot silently override a CI secret.
- **Both repo semgrep house rules produce zero hits** on every pipeline file (applied by hand;
  semgrep itself was unavailable).

---

# Follow-up list, in priority order

1. **Confirm `verify_jwt` is on for the deployed function** in the Supabase dashboard. The repo
   now pins intent; only the dashboard shows the fact.
2. **Confirm and record who holds edit access to the Apps Script project.** Anyone who does holds
   the drop secret in plain text and can push arbitrary bytes. If it is broader than one person,
   do finding 13's sheet-id pin at the same time.
3. **Open the TLS ticket (finding 7, option B).** It is the largest real exposure in the report
   and the one this change deliberately did not half-do.
4. **Open the My Work minimisation ticket (finding 12).**
5. **Land the proposed comment migration (finding 16)** with whoever owns `supabase/migrations`.
6. Move the Apps Script to a dedicated Google account (finding 14); add the drift marker and
   record the residual risk in the vault (finding 15).
