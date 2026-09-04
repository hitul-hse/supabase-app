/**
 * Factorial contract hours: the DENOMINATOR only.
 *
 * This is deliberately narrow. It fetches `contracts/reference_contracts` for
 * every employee this hub has already mapped to a person (crm.
 * factorial_person_reference), converts the vendor's hundredths-of-an-hour
 * `working_hours` into decimal hours/week through the ONE conversion function
 * in scripts/lib/factorial.mjs (contractWeeklyHours), and writes:
 *
 *   crm.factorial_contract_version   -- the contract fact, upserted per employee
 *   public.people.contract_hours     -- the denominator every profile/reassignment
 *                                        view already renders (or waits for)
 *
 * WHAT THIS DOES NOT DO, ON PURPOSE.
 *
 * It does not build a per-person UTILISATION view (logged ÷ available). That
 * numerator comes from time.entry, and time.entry's SELECT policy is
 * caller-scoped -- an exec reads real hours, everyone else reads their own.
 * A view built on that aggregate would silently reproduce the understatement
 * migration 20260903090000_contract_status_view_must_not_bypass_rls.sql
 * measured and deliberately did NOT fix with a SECURITY DEFINER shortcut. The
 * fix there is a definer function that checks hr:contract:read itself,
 * "filed, not smuggled in" -- and this PR does not smuggle it in either. It
 * writes the denominator and stops.
 *
 * It does not touch src/lib/queries/management-contract-hours.ts. That is the
 * COMMERCIAL contract-hours figure (public.projects.contract_hours) and
 * src/lib/budget-visibility.ts:150 already states why the two must never
 * merge: they only share a name.
 *
 * It does not fetch contracts for anyone this hub has not already resolved to
 * a person (crm.factorial_identity_review is the queue for everyone else) --
 * reading a contract with nowhere honest to attribute it is the opposite of
 * minimisation.
 *
 * MINIMISATION. Every contract passes through projectContract() before
 * anything else touches it, so it is cut to CONTRACT_ALLOWED_FIELDS before
 * this file even sees a field name. salary_amount / salary_frequency, which
 * this exact endpoint also returns (docs/factorial-api-integration.md §7.5),
 * never survive that projection -- scripts/check-factorial-harvest.mjs proves
 * it offline, with no credential.
 *
 * DRY-RUN BY DEFAULT, same convention as sync-factorial-identity.mjs: nothing
 * reaches the database until `-- --write`. Passing both --write and
 * --dry-run is refused rather than silently resolved.
 *
 * EVERY RUN IS RECORDED in raw.sync_run, source='factorial', entity=
 * 'reference-contracts' -- a DIFFERENT entity than the identity sync's
 * 'employees-identity', deliberately, under the SAME source (raw.sync_run's
 * source column is a fixed CHECK allow-list and 'factorial' is the only
 * value this integration may use). check-factorial-freshness.mjs reads the
 * latest run across all entities for source='factorial' as "the Factorial
 * sync"; once this sync runs on its own schedule, that gate's headline could
 * reflect a contracts run instead of an identity run on any given day. That
 * is a pre-existing multi-entity design decision in that gate, not something
 * this file changes -- flagged here and in the PR description as a known
 * follow-up, not silently worked around.
 *
 * Run:  node scripts/sync-factorial-contracts.mjs [--write | --dry-run]
 * Env:  FACTORIAL_API_KEY, FACTORIAL_COMPANY_ID, SUPABASE_DB_URL -- same as
 *       sync-factorial-identity.mjs; see that file's header for the pooler-
 *       vs-direct-host IPv4 note, which applies identically here.
 */
import pg from "pg";
import { loadEnv } from "./lib/gate-env.mjs";
import {
  fetchReferenceContracts,
  projectContract,
  contractWeeklyHours,
} from "./lib/factorial.mjs";

const argv = process.argv.slice(2);
const WRITE = argv.includes("--write");
const EXPLICIT_DRY_RUN = argv.includes("--dry-run");

if (WRITE && EXPLICIT_DRY_RUN) {
  console.error("BLOCKED: --write and --dry-run are mutually exclusive. Pass one.");
  process.exit(2);
}

// Captured before any work starts -- see sync-factorial-identity.mjs's
// comment on RUN_STARTED_AT for why this must not be evaluated at insert
// time (a default now() there brackets the row wrong, not the work).
const RUN_STARTED_AT = new Date();

const env = loadEnv();
const missing = ["FACTORIAL_API_KEY", "FACTORIAL_COMPANY_ID", "SUPABASE_DB_URL"]
  .filter((k) => !env[k]);
if (missing.length) {
  console.error(`BLOCKED: missing ${missing.join(", ")}.`);
  console.error("(FACTORIAL_* live in the Factorial admin; see docs/factorial-api-integration.md).");
  process.exit(2);
}
const COMPANY = String(env.FACTORIAL_COMPANY_ID);

const db = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });

try {
  await db.connect();
} catch (err) {
  // Identical IPv4/IPv6 diagnosis as sync-factorial-identity.mjs -- same
  // database, same network, same failure mode. See that file for the full
  // measured explanation.
  const netErr = err?.code === "ENETUNREACH" || err?.code === "EHOSTUNREACH";
  const directHost = /(^|@)db\.[a-z0-9]+\.supabase\.co(:|\/|$)/.test(String(env.SUPABASE_DB_URL));
  if (netErr && directHost) {
    console.error("BLOCKED: cannot reach the direct Postgres host over IPv4.");
    console.error("  FIX: set SUPABASE_DB_URL to the SESSION POOLER url (port 5432).");
    process.exit(2);
  }
  throw err;
}

/**
 * Record one attempt in raw.sync_run. Never inside the sync's own
 * transaction (a rollback must not erase the evidence of the failure), never
 * throws (a failed insert here must not turn a partially-successful sync
 * into an unrecorded one). See sync-factorial-identity.mjs#recordRun for the
 * full reasoning -- unchanged here except the entity name.
 */
async function recordRun(status, recordCount, cursorRef, errorMessage) {
  if (!WRITE) return;
  try {
    await db.query(
      `insert into raw.sync_run
         (source, entity, started_at, finished_at, status, record_count, error_message, cursor_ref)
       values ('factorial', 'reference-contracts', $1, now(), $2, $3, $4, $5)`,
      [RUN_STARTED_AT.toISOString(), status, recordCount, errorMessage ?? null, cursorRef ?? null],
    );
  } catch (e) {
    console.warn(`\nWARNING: could not record the sync run: ${e.message}`);
  }
}

try {
  /* ── 1. Who is even eligible: only people this hub has already resolved ── */
  const mapped = await db.query(
    `select external_id, person_id from crm.factorial_person_reference
      where source_system = 'factorial' and entity_type = 'person'
        and account_ref = $1 and is_active`,
    [COMPANY],
  );
  const personByEmployeeId = new Map(mapped.rows.map((r) => [String(r.external_id), r.person_id]));
  const employeeIds = [...personByEmployeeId.keys()];

  console.log(`hub: ${employeeIds.length} employee(s) already mapped to a person`);

  if (employeeIds.length === 0) {
    console.log("nothing to fetch: no mapped employees yet. Run sync:factorial-identity first.");
    await recordRun("ok", 0, "mapped=0", null);
    process.exitCode = 0;
  } else {
    /* ── 2. Factorial side: fetch, project, convert ── */
    const { rows: raw, truncated } = await fetchReferenceContracts({
      token: env.FACTORIAL_API_KEY,
      employeeIds,
    });
    if (truncated) throw new Error("contract paging truncated at the page cap - refusing a partial contract sync");

    const contracts = raw.map(projectContract);
    console.log(`factorial: ${contracts.length} reference contract(s) (projected to allow-list)`);

    const derived = contracts.map((c) => {
      const employeeId = String(c.employee_id);
      const weeklyHours = contractWeeklyHours({
        working_hours_centihours: c.working_hours,
        working_hours_frequency: c.working_hours_frequency,
        working_week_days: c.working_week_days,
      });
      return { employeeId, personId: personByEmployeeId.get(employeeId), contract: c, weeklyHours };
    }).filter((d) => d.personId); // must resolve to a mapped person; every id we asked for should

    const unresolved = employeeIds.filter((id) => !derived.some((d) => d.employeeId === id));
    if (unresolved.length > 0) {
      console.log(`  note  Factorial returned no contract for ${unresolved.length} mapped employee(s): ${unresolved.join(", ")}`);
    }

    const withHours = derived.filter((d) => d.weeklyHours !== null);
    const unconvertible = derived.filter((d) => d.weeklyHours === null);
    console.log(`  converted ${withHours.length}, unconvertible ${unconvertible.length} (unrecognised or missing frequency -- left NULL)`);
    if (unconvertible.length > 0) {
      const freqs = [...new Set(unconvertible.map((d) => d.contract.working_hours_frequency ?? "(none)"))];
      console.log(`  note  unconvertible frequencies seen: ${freqs.join(", ")}`);
    }

    if (!WRITE) {
      console.log("\nDRY RUN — nothing written. Re-run with -- --write to commit.");
      console.log(`  would upsert   ${derived.length} crm.factorial_contract_version row(s)`);
      console.log(`  would set      ${withHours.length} public.people.contract_hours value(s)`);
      console.log(`  would clear    ${unconvertible.length} public.people.contract_hours value(s) to NULL (honest, not a guess)`);
      console.log("\nNo raw.sync_run row written: a dry run refreshed nothing.");
    } else {
      await db.query("begin");
      let upserted = 0;
      let peopleWritten = 0;

      for (const d of derived) {
        await db.query(
          `insert into crm.factorial_contract_version
             (factorial_employee_id, effective_on, starts_on, ends_on,
              working_hours_centihours, working_hours_frequency, working_week_days,
              working_time_percentage_in_cents, maximum_weekly_hours_centihours,
              job_title, country, last_seen_at, is_active)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now(), true)
           on conflict (factorial_employee_id) do update
             set effective_on = excluded.effective_on,
                 starts_on = excluded.starts_on,
                 ends_on = excluded.ends_on,
                 working_hours_centihours = excluded.working_hours_centihours,
                 working_hours_frequency = excluded.working_hours_frequency,
                 working_week_days = excluded.working_week_days,
                 working_time_percentage_in_cents = excluded.working_time_percentage_in_cents,
                 maximum_weekly_hours_centihours = excluded.maximum_weekly_hours_centihours,
                 job_title = excluded.job_title,
                 country = excluded.country,
                 last_seen_at = now(),
                 is_active = true`,
          [
            d.employeeId,
            d.contract.effective_on ?? null,
            d.contract.starts_on ?? null,
            d.contract.ends_on ?? null,
            d.contract.working_hours ?? null,
            d.contract.working_hours_frequency ?? null,
            Array.isArray(d.contract.working_week_days) ? d.contract.working_week_days : null,
            d.contract.working_time_percentage_in_cents ?? null,
            d.contract.maximum_weekly_hours ?? null,
            d.contract.job_title ?? null,
            d.contract.country ?? null,
          ],
        );
        upserted += 1;

        /*
         * Honest, always -- including NULL. A contract that came back
         * unconvertible this run must not leave a stale value from a
         * previous, possibly-superseded contract sitting there looking
         * current. See contractWeeklyHours()'s own comment on why a wrong
         * number is worse than an honest gap.
         */
        const r = await db.query(
          `update public.people set contract_hours = $2 where id = $1`,
          [d.personId, d.weeklyHours],
        );
        peopleWritten += r.rowCount;
      }
      await db.query("commit");

      console.log(`\nwritten: ${upserted} contract row(s), ${peopleWritten} people.contract_hours value(s) touched.`);
      await recordRun(
        "ok",
        contracts.length,
        `mapped=${employeeIds.length} contracts=${contracts.length} withHours=${withHours.length} unconvertible=${unconvertible.length}`,
        null,
      );
    }
  }
} catch (err) {
  try { await db.query("rollback"); } catch { /* not in a tx */ }
  await recordRun("failed", null, null, String(err?.message ?? err).slice(0, 500));
  throw err;
} finally {
  await db.end();
}
