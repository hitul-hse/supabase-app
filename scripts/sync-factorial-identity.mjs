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
 * happen. Nothing reaches the database until `-- --write`. `--dry-run` states
 * that default explicitly, so a scheduled caller never relies on the ABSENCE of
 * a flag to stay read-only; passing both flags is an error rather than a guess.
 *
 * EVERY RUN IS RECORDED in raw.sync_run (source 'factorial').
 *
 * Before this, that table held 26 rows and every single one was TrackingTime.
 * The Factorial side had no observable freshness at all: "when did this last
 * run" could only be answered by reading last_seen_at off the mapping rows and
 * inferring, which cannot distinguish "ran and found nothing to change" from
 * "has not run since August". A write run inserts exactly one row, ok or
 * failed. A DRY RUN INSERTS NONE -- it refreshed nothing, and a row claiming
 * otherwise is precisely the false freshness signal the table exists to
 * prevent. scripts/check-factorial-freshness.mjs reads it.
 *
 * Run:  node scripts/sync-factorial-identity.mjs [--write | --dry-run]
 * Env:  FACTORIAL_API_KEY      the credential (x-api-key transport, measured)
 *       FACTORIAL_COMPANY_ID   e.g. 157774; review rows and account_ref need it
 *       SUPABASE_DB_URL        Postgres URL. On a GitHub runner this MUST be the
 *                              POOLER url: db.<ref>.supabase.co publishes only an
 *                              AAAA record (measured 2026-09-03) and hosted
 *                              runners are IPv4-only. See the ENETUNREACH branch
 *                              at the foot of this file.
 */
import pg from "pg";
import { loadEnv } from "./lib/gate-env.mjs";
import {
  fetchAllPages,
  projectEmployee,
  classifyEmployee,
  normaliseEmail,
} from "./lib/factorial.mjs";

const argv = process.argv.slice(2);
const WRITE = argv.includes("--write");
const EXPLICIT_DRY_RUN = argv.includes("--dry-run");

/*
 * Both flags together is a contradiction, and the safe-looking resolution --
 * "dry run wins" -- is the wrong one to pick silently. A caller who passed both
 * has a bug in whatever built the argument list, and if we quietly honoured the
 * safe flag they would see a green run that wrote nothing and conclude the sync
 * works. Refuse, and make them say which they meant.
 */
if (WRITE && EXPLICIT_DRY_RUN) {
  console.error("BLOCKED: --write and --dry-run are mutually exclusive. Pass one.");
  process.exit(2);
}

/*
 * Captured at module load, NOT at insert time. raw.sync_run.started_at defaults
 * to now(), which Postgres evaluates when the row is written -- i.e. AFTER the
 * work finished -- and the TrackingTime importer shipped exactly that bug: its
 * first row has finished_at < started_at, so every duration derived from it is
 * negative. Bracketing the real work is the whole point of the column pair.
 */
const RUN_STARTED_AT = new Date();

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

try {
  await db.connect();
} catch (err) {
  /*
   * ENETUNREACH here is almost never a real outage; it is the direct-connection
   * host on an IPv4-only network, and the raw error names neither cause nor fix.
   *
   * Measured 2026-09-03: db.<ref>.supabase.co publishes an AAAA record and NO A
   * record. GitHub-hosted runners have no IPv6 route. So the exact URL that
   * works on this workstation fails on the runner, and it fails at connect --
   * before any sync_run row can be written, which is why the scheduled workflow
   * would have gone red with no database evidence of why.
   *
   * The pooler host resolves to IPv4 (verified: aws-N-<region>.pooler.supabase.com).
   * Session mode, port 5432, because this script uses an explicit transaction.
   */
  const netErr = err?.code === "ENETUNREACH" || err?.code === "EHOSTUNREACH";
  const directHost = /(^|@)db\.[a-z0-9]+\.supabase\.co(:|\/|$)/.test(String(env.SUPABASE_DB_URL));
  if (netErr && directHost) {
    console.error("BLOCKED: cannot reach the direct Postgres host over IPv4.");
    console.error("  db.<ref>.supabase.co is IPv6-only and this network has no IPv6 route");
    console.error("  (GitHub-hosted runners are IPv4-only).");
    console.error("  FIX: set SUPABASE_DB_URL to the SESSION POOLER url instead --");
    console.error("  Supabase dashboard > Connect > Session pooler, port 5432.");
    console.error("  Transaction mode (6543) is NOT usable here: this sync needs a transaction.");
    process.exit(2);
  }
  throw err;
}

/**
 * Record one attempt in raw.sync_run — the row check-factorial-freshness.mjs
 * reads, and the only durable evidence that this sync ran at all.
 *
 * Deliberately NOT inside the sync's transaction. A failed run rolls that
 * transaction back, and a failure row enrolled in it would roll back with the
 * work, leaving the failure invisible — the exact opposite of the point. It is
 * written after commit, or after rollback, on its own.
 *
 * Never throws. If this insert fails the sync may still have written real
 * mappings, so turning that into a crash would trade a freshness gap for lost
 * work. It warns loudly instead, because the resulting state (correct data that
 * reads as stale) is confusing enough to deserve a sentence in the log.
 */
async function recordRun(status, recordCount, cursorRef, errorMessage) {
  if (!WRITE) return;
  try {
    await db.query(
      `insert into raw.sync_run
         (source, entity, started_at, finished_at, status, record_count, error_message, cursor_ref)
       values ('factorial', 'employees-identity', $1, now(), $2, $3, $4, $5)`,
      [RUN_STARTED_AT.toISOString(), status, recordCount, errorMessage ?? null, cursorRef ?? null],
    );
  } catch (e) {
    console.warn(`\nWARNING: could not record the sync run: ${e.message}`);
    console.warn("The identity map may be current, but freshness will read stale.\n");
  }
}

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
    `select external_id, person_id from crm.factorial_person_reference
      where source_system = 'factorial' and entity_type = 'person'
        and account_ref = $1 and is_active`,
    [COMPANY],
  );
  /*
   * Two views of the same rows, because "claimed" must mean claimed by SOMEONE
   * ELSE. The first run of this script proved why: on run two, every mapped
   * employee found their own person in the claimed set and came back
   * "ambiguous" -- 17 colleagues flagged for stealing their own identity.
   * An employee with an existing mapping short-circuits below and never
   * re-enters classification at all; the claimed set guards the rest.
   */
  const mappedByEmployee = new Map(claimed.rows.map((r) => [String(r.external_id), r.person_id]));
  const claimedPersonIds = new Set(claimed.rows.map((r) => r.person_id));
  console.log(`hub: ${members.rows.length} members with email, ${claimedPersonIds.size} people already mapped`);

  /* ── 3. Classify every employee; the claimed set grows as we go so two
   *      Factorial records can never resolve to the same person in one run ── */
  const buckets = { resolvable: [], unmatched: [], bridged_unlinked: [], ambiguous: [] };
  let alreadyMapped = 0;
  for (const e of employees) {
    if (mappedByEmployee.has(String(e.id))) { alreadyMapped += 1; continue; }
    const verdict = classifyEmployee(e, membersByEmail, claimedPersonIds);
    if (verdict.status === "resolvable") claimedPersonIds.add(verdict.personId);
    (buckets[verdict.status] ??= []).push({ employee: e, verdict });
  }
  console.log("");
  console.log(`  already mapped    ${String(alreadyMapped).padStart(3)} (untouched)`);
  for (const [status, list] of Object.entries(buckets)) {
    console.log(`  ${status.padEnd(16)} ${String(list.length).padStart(3)}`);
  }

  const queueCandidates = [...buckets.unmatched, ...buckets.ambiguous, ...buckets.bridged_unlinked];

  if (!WRITE) {
    /*
     * A dry run that just prints the bucket sizes overstates its own effect,
     * and this account is the proof: all 20 queue candidates below already
     * carry `excluded_not_employee`, a decision a human made and signed. The
     * upsert's `where status = any(machine statuses)` guard means every one of
     * those 20 writes would change zero rows -- so "20 queue rows" is not what
     * would happen, it is what would be attempted.
     *
     * The distinction is the whole point of a dry run, so it is read from the
     * live queue rather than assumed. Reporting effort as if it were effect is
     * how a no-op sync gets mistaken for a working one.
     */
    const existing = await db.query(
      `select factorial_employee_id, status from crm.factorial_identity_review
        where factorial_company_id = $1`,
      [COMPANY],
    );
    const statusByEmployee = new Map(existing.rows.map((r) => [String(r.factorial_employee_id), r.status]));
    const wouldChange = [];
    const humanHeld = [];
    for (const item of queueCandidates) {
      const current = statusByEmployee.get(String(item.employee.id));
      (current === undefined || MACHINE_STATUSES.includes(current) ? wouldChange : humanHeld).push({ ...item, current });
    }

    console.log("\nDRY RUN — nothing written. Re-run with -- --write to commit.");
    console.log(`  would map          ${String(buckets.resolvable.length).padStart(3)}`);
    console.log(`  would queue        ${String(wouldChange.length).padStart(3)} (new or machine-owned rows)`);
    console.log(`  held by a human    ${String(humanHeld.length).padStart(3)} (terminal status — the guard blocks these)`);

    if (wouldChange.length) {
      console.log("\nQueue reasons (first 8):");
      for (const { employee, verdict, current } of wouldChange.slice(0, 8)) {
        console.log(`  · [${verdict.status}] employee ${employee.id} (now ${current ?? "absent"}): ${verdict.reason}`);
      }
    }
    if (humanHeld.length) {
      const byStatus = new Map();
      for (const h of humanHeld) byStatus.set(h.current, (byStatus.get(h.current) ?? 0) + 1);
      console.log("\nUntouchable, and correctly so:");
      for (const [s, n] of byStatus) console.log(`  · ${n} employee(s) already ${s}`);
    }
    console.log("\nNo raw.sync_run row written: a dry run refreshed nothing.");
  } else {

    /* ── 4. Write, in one transaction, without ever touching a human's row ── */
    await db.query("begin");
    /*
     * `queued` counts rows the database actually changed, not upserts attempted.
     * It used to be incremented once per loop iteration, which made it a count of
     * effort rather than effect: on this account all 20 candidates are held at a
     * terminal status, every upsert's `where status = any(machine)` guard matches
     * nothing, and the run still reported "20 queue rows upserted". A sync that
     * changed nothing would have printed the same line as a sync that queued 20
     * new colleagues -- and the second run over the same window, the one that is
     * supposed to prove idempotency, is exactly where that lie would land.
     */
    let mapped = 0, queued = 0, queueBlocked = 0, autoClosed = 0;

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
        const upserted = await db.query(
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
        if (upserted.rowCount > 0) queued += 1;
        else queueBlocked += 1;
      }
    }


    /*
     * Heal: an employee with an active mapping must not also sit open in the
     * queue. The buggy first version of run two put 17 mapped colleagues there
     * as "ambiguous"; this closes such rows to resolved_auto on every write,
     * so that state cannot survive a sync no matter how it arose.
     */
    let healed = 0;
    for (const [extId, personId] of mappedByEmployee) {
      const h = await db.query(
        `update crm.factorial_identity_review
            set status = 'resolved_auto',
                candidate_person_id = $3,
                status_reason = 'employee already carries an active mapping',
                last_seen_at = now()
          where factorial_company_id = $1 and factorial_employee_id = $2
            and status = any($4) and status <> 'resolved_auto'`,
        [COMPANY, extId, personId, MACHINE_STATUSES],
      );
      healed += h.rowCount;
    }
    await db.query("commit");
    console.log(`\nwritten: ${mapped} mappings, ${queued} queue rows changed, ${autoClosed + healed} auto-closed.`);
    if (queueBlocked > 0) {
      console.log(`         ${queueBlocked} queue upsert(s) correctly refused — a human owns those rows.`);
    }
    console.log("Open the review queue to decide the rest — a machine may not.");

    /*
     * record_count is EMPLOYEES READ, not rows written. A healthy steady state
     * writes nothing at all -- everyone is mapped or human-decided -- so a
     * record_count of rows-written would sit at 0 on every good run and be
     * indistinguishable from a run that fetched an empty roster. Employees read
     * is the figure that actually goes wrong when the credential or the endpoint
     * breaks, which is what the freshness reader needs to see.
     */
    await recordRun(
      "ok",
      employees.length,
      `mapped=${mapped} queued=${queued} blocked=${queueBlocked} closed=${autoClosed + healed}`,
      null,
    );
  }
} catch (err) {
  try { await db.query("rollback"); } catch { /* not in a tx */ }
  /*
   * Recorded AFTER the rollback and outside the transaction, or it would be
   * rolled back with the work it is reporting on. A failure nobody can see is
   * the failure mode this whole row exists to close: without it, a broken
   * credential shows up as an identity map that simply stops changing, which
   * looks exactly like an account where nobody joined or left.
   */
  await recordRun("failed", null, null, String(err?.message ?? err).slice(0, 500));
  throw err;
} finally {
  await db.end();
}
