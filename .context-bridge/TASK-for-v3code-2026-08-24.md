# Task for the V3Code agent — HSE Hub data connectivity

Written 2026-08-24 by the jcode agent. The user asked that we work in parallel,
so this file is the handoff. **Read this before starting; the boundaries matter.**

## The goal

An operations person (Mathias) logs in and sees the customers and projects that
belong to him, sourced from the customer masterdata. Step one of connecting
masterdata → customers → projects → people → user accounts.

## What I already measured against the live DB

Do not re-derive these; they cost real queries. Scripts are in `scripts/` if you
want to re-run them (`audit-links.mjs`, `audit-mathias.mjs`,
`audit-rls-as-mathias.mjs`, `audit-gaps.mjs`).

| Link | Health |
|---|---|
| `app_user_profile.person_id` → `people.id` | **9 of 20 linked. 11 users see NOTHING.** |
| `projects.owner_person_id` → `people.id` | 176 of 231, 55 unowned, 0 dangling |
| `person_assignments` → people/projects | 344 of 352 fully linked, 8 missing project_id |
| `projects.customer` → `crm.legal_entity` | 200 of 237, **37 unmatched by name** |
| masterdata responsible/replacement | **Not ingested anywhere. No such column exists.** |

RLS is healthy and already correct: as Mathias (role `employee`), the DB returns
54 projects / 43 customers via `can_view_project(id)`. The identity gap, not the
policy, is what blocks people.

## Who is doing what (four jcode agents are live right now)

| Agent | Owns these files |
|---|---|
| identity linker | `scripts/link-user-identities.mjs`, `scripts/verify-identity-links.mjs` |
| masterdata ingest | `scripts/import-project-responsibility.mjs`, `scripts/report-masterdata-responsibility.mjs`, one new migration |
| customer linker | `scripts/link-project-customers.mjs`, `scripts/report-customer-matching.mjs`, one new migration |
| ops portal | `src/app/portal/**`, `src/lib/queries/my-work.ts`, `src/components/my-work/**` |

## STATUS UPDATE 2026-08-24 ~17:05Z — two of four landed

Both are **applied to the live DB** and independently re-verified by me (I did
not take the agents' word for the numbers; see `scripts/verify-worker-claims.mjs`).

**A. `public.project_responsibility` is live.** The masterdata "who looks after
this customer" fact now exists in the database for the first time: 148
`responsible` + 140 `replacement` rows over 149 projects, 9 distinct people, all
9 resolving to `public.people`. RLS policy is `can_view_project(project_id)`, so
it inherits project visibility. Migration `20260824160000`.
Verified through RLS as Mathias: **responsible for 4 customers, replacement on 35.**

**B. `public.projects.customer_legal_entity_id` is live.** FK to
`crm.legal_entity`, **228 of 231 backfilled** (was 208). Migration `20260824170000`.
Resolution goes through `crm.legal_entity_alias`, never fuzzy matching at query
time, per the PRODUCT.md canonical-identity rule.

**Correction to my own earlier number:** I reported "37 of 237 unmatched". That
237 was a join artefact — `Addleshaw Goddard (Germany) LLP` appears **4 times**
in `crm.legal_entity`, fanning 2 projects into 8 rows. True baseline is 231
projects / 21 unmatched. Those 4 duplicate entity rows are a real data-quality
bug and are still **unfixed**; 2 projects remain deliberately unlinked rather
than guess which duplicate is canonical. **That is a good item for you.**

Still running: identity linker, ops portal.

---

## What would help most from you (non-overlapping)

Pick whichever you can verify, and **claim it in this file before you start** so
we don't collide.

1. **Deployment + production proof.** You own the Vercel relationship. Once the
   portal lands, confirm it serves on hseportal.hs-experts.com. Your own earlier
   note (`note-for-v3code-deployment.md`) has the two traps: deployment URLs 302
   to SSO, and markers must be unconditional strings taken from the real diff.
2. **A regression gate.** `scripts/check-*.mjs` is the established pattern and
   `test:db` runs them. A gate asserting "every active non-test user profile has
   a resolvable person_id" would stop this whole class of bug returning. This is
   high value and collides with nobody.
3. ~~**The 8 `person_assignments` rows with NULL `project_id`.**~~ **RESOLVED,
   not a bug** — I checked (`scripts/audit-orphan-assignments.mjs`). All 8 belong
   to the inactive seed mockups `emp-1`..`emp-8`, and their `project_name` values
   are internal non-billable buckets ("Internal admin", "Lab calibration", "Team
   leadership & planning"). None resolves to a project because none *is* a
   project. Leave them alone; do not invent projects to satisfy the FK.

Please avoid `src/lib/queries/my-work.ts`, the two new migrations, and the four
scripts listed above until those agents report done.

## Ground rules

- RLS must stay enforced. No service-role key in any page or request path.
- Never link a real user to the seed mockups `emp-1`..`emp-8` (inactive,
  `source='seed'`).
- Migrations need a timestamp newer than `20260824100000`.
- No PII in logs.

## Claims

<!-- Append: `- [v3code] taking item N, <timestamp>` -->
