# Review: feature/customer-dashboard-development (Bjoern, 27 commits, +6,330)

Reviewed 2026-08-23 against master (7e4b2a0). One three-way test merge
performed and aborted: a single conflict, docs/architecture/ADR-001 (both
sides wrote it -- his original vs my adoption from his session log). Everything
else auto-merges.

## Verdict by area

### MERGE AS-IS (high quality, fits our conventions)

1. **The docs.** ADR-002 (customer master target model), ENTITY_RESOLUTION_RULES,
   the dashboard architecture docs, the Excel mapping doc, and the HANDOFF.
   These are decision documents; no runtime risk. His ADR-001 supersedes my
   adopted copy (keep his text, fold in my two provenance notes).

2. **Change control for responsibles** (`20260823090000_add_project_change_control.sql`
   + `management-change-requests.ts` + `actions.ts`). This is genuinely good:
   - request/approve as SECURITY DEFINER functions, direct table writes not granted
   - four-eyes: a user cannot approve their own request (asserted in the fn)
   - one open request per project via a partial unique index (the same
     anti-spam pattern our alert dedup uses)
   - append-only event log
   - optimistic concurrency ("project changed since request" check)
   It needs our gate treatment before apply: PGlite execution, twice, plus the
   `"time"` keyword check does not apply (he used public schema) but
   `app_permission` conventions do -- he checks `projects:write` via RPC,
   which matches our model.

### MERGE WITH ADAPTATION

3. **Management dashboard read models** (11 query files + 7 components + the
   route). The components are read-only and gated. Two adaptations needed:
   - Two paged reads missing `.order()` before `.range()`
     (management-contract-hours.ts:120, management-project-risks.ts:239).
     Our documented PostgREST bug: unordered paging repeats/skips rows.
   - `management-read.ts` imports `@/lib/auth/dev-auth`, WHICH IS NOT IN THE
     BRANCH (deliberately excluded per his handoff). As-is the branch does not
     compile. Fix: strip the dev-auth path so it always returns the normal
     cookie-bound client. That also removes the service-role fallback, which
     must not reach our production anyway.
   - His `/dashboard/management` page must gate on a permission via
     `app_user_has_permission` (his components assume the caller may read
     management-wide data). Our overview page's exec/dept_head gate is the
     pattern.

4. **Customer master foundation** (`20260822130000_create_customer_master_foundation.sql`,
   499 lines: crm.*, projects.*, stg.* schemas -- legal_entity, location,
   lexware_customer, alias, corporate_group, framework_agreement,
   project_order, import staging). This is the ADR-001/ADR-002 model made
   real, and it is the right shape. HOLD briefly: it creates three new
   Postgres schemas, which need PostgREST exposure decisions and RLS review
   before they exist in production. It also has no gate script yet. Apply
   AFTER the dashboard, not blocking it: none of the dashboard read models
   join crm.* yet (they read time.* + the Excel-imported staging in his own
   instance).

### DO NOT MERGE (he says so himself, and he is right)

5. **Anything dev-auth related.** The middleware carve-out for
   /customer-master/import-review is NODE_ENV-gated and route-exact, but our
   production build sets NODE_ENV=production so it is dead code there -- and
   still, an auth bypass pattern must not enter master. Same for the
   management-read service-role fallback.
6. **`import-customer-master-staging.mjs` against production** until the crm/stg
   schemas are applied and the source Excel is fachlich approved (his words).

## Order of operations

1. Merge docs + change-control + dashboard (with the three adaptations).
2. Gate scripts: PGlite execution for his migration; check-management-ui for
   permission gating and ordered paging.
3. Excel/masterdata: his staging import lands after crm.* schemas are
   reviewed; our reconcile-masterdata.mjs already covers the read-only half.
4. crm.* foundation as its own reviewed migration with RLS + exposure gates.

## What we still need from his machine

Per his handoff, NOT in the branch and possibly worth having:
- `scripts/import-management-excel.mjs` (his Excel->staging importer)
- `docs/management/project-risk-resolution-actions.md`, `project-risks-model.md`
- Nothing else: dev-auth files are deliberately withheld and should stay so.
