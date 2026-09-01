/**
 * Phase 2 of the Factorial integration: connect Factorial employees to hub
 * people, through the review queue the schema demands.
 *
 * This is the first script that actually RUNS the pipeline everything else
 * prepared: lib/factorial.mjs supplies transport, paging, projection and the
 * classifier; migration 20260826140000 supplies the queue with its
 * machine-may-not-self-authorise constraints; this file only wires them
 * together and holds the door open for a human where the schema says one is
 * required.
 *
 * WHAT IT WRITES, and what it refuses to.
 *
 *   resolvable      -> crm.factorial_person_reference, match_method
 *                      'exact_email_via_time_member', reviewed_by NULL --
 *                      the constraint requires machine rows to be unsigned.
 *                      Any open review row for that employee is moved to
 *                      resolved_auto (allowed: candidate_person_id is set).
 *   everything else -> crm.factorial_identity_review, machine statuses only.
 *
 *   It NEVER writes a terminal status (excluded_*, resolved_manual) and NEVER
 *   updates a row that carries one: every UPDATE is guarded by
 *   `status in (machine set)` / `match_method is distinct from 'manual'`, so a
 *   human decision survives every future sync unconditionally. The database
 *   would reject the write anyway; the guard means we don't even ask.
 *
 * MINIMISATION. Employees pass through projectEmployee() before anything else
 * touches them, so the 54-field record is cut to the allow-list the harvest
 * gate proves. Full names are carried to the review row for display only,
 * exactly as the schema comments require.
 *
 * DRY-RUN BY DEFAULT. `npm run sync:factorial-identity` prints what would
 * happen. Nothing reaches the database until `-- --write`.
 *
 * Run:  node scripts/sync-factorial-identity.mjs [--write]
 * Env:  FACTORIAL_API_KEY      the credential (x-api-key transport, measured)
 *       FACTORIAL_COMPANY_ID   e.g. 157774; review rows and account_ref need it
 *       SUPABASE_DB_URL        direct Postgres URL (see .env.local.example)
 */
import pg from "pg";
import { loadEnv } from "./lib/gate-env.mjs";
import {
  fetchAllPages,
  projectEmployee,
  classifyEmployee,
  normaliseEmail,
} from "./lib/factorial.mjs";

const WRITE = process.argv.includes("--write");
const env = loadEnv();

const missing = ["FACTORIAL_API_KEY", "FACTORIAL_COMPANY_ID", "SUPABASE_DB_URL"]
  .filter((k) => !env[k]);
if (missing.length) {
  console.error(`BLOCKED: missing ${missing.join(", ")}.`);
  console.error("Phase 0 is not complete for this environment. Add them to .env.local");
  console.error("(FACTORIAL_* live in the Factorial admin; see docs/factorial-api-integration.md).");
  process.exit(2);
}
const COMPANY = String(env.FACTORIAL_COMPANY_ID);

/* The set of statuses a sync is allowed to touch. Everything else belongs to a
 * named human and is invisible to every UPDATE below. Mirrors the CHECK in
 * 20260826140000 -- if that migration widens, widen this deliberately. */
const MACHINE_STATUSES = ["unmatched", "bridged_unlinked", "ambiguous", "resolved_auto"];

const db = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await db.connect();

try {
  /* ── 1. Factorial side: fetch, then immediately forget what we may not keep */
  const { rows: raw, truncated } = await fetchAllPages({
    resource: "employees/employees",
    token: env.FACTORIAL_API_KEY,
    params: {},
  });
  if (truncated) throw new Error("employee paging truncated at the page cap - refusing a partial identity sync");
  const employees = raw.map(projectEmployee);
  console.log(`factorial: ${employees.length} employees (projected to allow-list)`);

  /* ── 2. Hub side: the only legitimate join surface ── */
  const members = await db.query(
    "select id, email, hub_person_id from time.member where email is not null",
  );
  const membersByEmail = new Map();
  for (const m of members.rows) {
    const key = normaliseEmail(m.email);
    if (!membersByEmail.has(key)) membersByEmail.set(key, []);
    membersByEmail.get(key).push({ id: m.id, hub_person_id: m.hub_person_id });
  }
  const claimed = await db.query(
    `select person_id from crm.factorial_person_reference
      where source_system = 'factorial' and entity_type = 'person'
        and account_ref = $1 and is_active`,
    [COMPANY],
  );
  const claimedPersonIds = new Set(claimed.rows.map((r) => r.person_id));
  console.log(`hub: ${members.rows.length} members with email, ${claimedPersonIds.size} people already claimed`);

  /* ── 3. Classify every employee; the claimed set grows as we go so two
   *      Factorial records can never resolve to the same person in one run ── */
  const buckets = { resolvable: [], unmatched: [], bridged_unlinked: [], ambiguous: [] };
  for (const e of employees) {
    const verdict = classifyEmployee(e, membersByEmail, claimedPersonIds);
    if (verdict.status === "resolvable") claimedPersonIds.add(verdict.personId);
    (buckets[verdict.status] ??= []).push({ employee: e, verdict });
  }
  console.log("");
  for (const [status, list] of Object.entries(buckets)) {
    console.log(`  ${status.padEnd(16)} ${String(list.length).padStart(3)}`);
  }

  if (!WRITE) {
    console.log("\nDRY RUN — nothing written. Re-run with -- --write to commit.");
    console.log("Queue reasons (first 8):");
    for (const { employee, verdict } of [...buckets.unmatched, ...buckets.ambiguous, ...buckets.bridged_unlinked].slice(0, 8)) {
      console.log(`  · [${verdict.status}] employee ${employee.id}: ${verdict.reason}`);
    }
    process.exit(0);
  }

  /* ── 4. Write, in one transaction, without ever touching a human's row ── */
  await db.query("begin");
  let mapped = 0, queued = 0, autoClosed = 0;

  for (const { employee, verdict } of buckets.resolvable ?? []) {
    await db.query(
      `insert into crm.factorial_person_reference
         (person_id, source_system, entity_type, external_id, account_ref,
          match_method, last_seen_at, is_active)
       values ($1, 'factorial', 'person', $2, $3, 'exact_email_via_time_member', now(), true)
       on conflict (source_system, external_id, entity_type, account_ref)
       do update set person_id = excluded.person_id,
                     match_method = excluded.match_method,
                     last_seen_at = now(),
                     is_active = true
       where crm.factorial_person_reference.match_method is distinct from 'manual'`,
      [verdict.personId, String(employee.id), COMPANY],
    );
    mapped += 1;
    const closed = await db.query(
      `update crm.factorial_identity_review
          set status = 'resolved_auto',
              status_reason = $3,
              candidate_member_id = $4,
              candidate_person_id = $5,
              candidate_count = 1,
              last_seen_at = now()
        where factorial_company_id = $1 and factorial_employee_id = $2
          and status = any($6)`,
      [COMPANY, String(employee.id), verdict.reason, verdict.memberId ?? null, verdict.personId, MACHINE_STATUSES],
    );
    autoClosed += closed.rowCount;
  }

  for (const status of ["unmatched", "bridged_unlinked", "ambiguous"]) {
    for (const { employee, verdict } of buckets[status] ?? []) {
      await db.query(
        `insert into crm.factorial_identity_review
           (factorial_company_id, factorial_employee_id, factorial_login_email,
            factorial_full_name, factorial_active,
            candidate_member_id, candidate_person_id, candidate_count,
            status, status_reason, last_seen_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
         on conflict (factorial_company_id, factorial_employee_id)
         do update set factorial_login_email = excluded.factorial_login_email,
                       factorial_full_name  = excluded.factorial_full_name,
                       factorial_active     = excluded.factorial_active,
                       candidate_member_id  = excluded.candidate_member_id,
                       candidate_person_id  = excluded.candidate_person_id,
                       candidate_count      = excluded.candidate_count,
                       status               = excluded.status,
                       status_reason        = excluded.status_reason,
                       last_seen_at         = now()
         where crm.factorial_identity_review.status = any($11)`,
        [
          COMPANY, String(employee.id), employee.login_email ?? null,
          employee.full_name ?? null, employee.active ?? null,
          verdict.memberId ?? null,
          status === "ambiguous" && verdict.count <= 1 ? null : (verdict.personId ?? null),
          verdict.count ?? 0,
          status, verdict.reason, MACHINE_STATUSES,
        ],
      );
      queued += 1;
    }
  }

  await db.query("commit");
  console.log(`\nwritten: ${mapped} mappings, ${queued} queue rows upserted, ${autoClosed} auto-closed.`);
  console.log("Open the review queue to decide the rest — a machine may not.");
} catch (err) {
  try { await db.query("rollback"); } catch { /* not in a tx */ }
  throw err;
} finally {
  await db.end();
}
