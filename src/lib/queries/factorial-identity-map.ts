import "server-only";

import { Pool } from "pg";

/**
 * The ONLY lawful way for app code to turn a Factorial employee id into a hub
 * person. ADR-001, stated as code.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Until 2026-09-03 `/operations-analytics` resolved Factorial employees to
 * TrackingTime members like this:
 *
 *     const m = (f.email ? memberByEmail.get(f.email) : undefined)
 *               ?? memberByName.get(norm(f.fullName));
 *
 * Two separate ADR-001 violations in one expression.
 *
 *  1. NAME EQUALITY AS AN IDENTITY DECISION. When the email lookup missed, the
 *     page joined a colleague's HR attendance record to a colleague's project
 *     hours because two strings matched after lowercasing and whitespace
 *     collapse. ADR-001 permits name similarity to be SHOWN to a human and
 *     forbids code from ACTING on it. This acted on it, silently, and the
 *     result was rendered as a measured figure about a named person.
 *
 *     Measured on production before the fix: 18 active Factorial employees, of
 *     whom exactly one — Hendryk Arndt, employee 3024573 — reached a member
 *     through the name fallback. It happened to land on the right person. That
 *     is luck, not correctness: `time.member` carries 49 rows, and the day two
 *     of them normalise to the same display_name, or a leaver's name is reused,
 *     the page attributes one colleague's hours to another with no error and
 *     nothing to see.
 *
 *  2. THE WRONG EMAIL KEY. It keyed the Factorial side on `row.email`, which
 *     the vendor's employee resource documents as the PERSONAL address, while
 *     scripts/sync-factorial-identity.mjs keys on `login_email`, the work
 *     address. Measured on the same roster: 3 of 43 employees carry different
 *     values in those two fields (goldene4@outlook.de vs hendryk@hs-experts.com
 *     being the live one). Two code paths keyed on two different columns can
 *     disagree about who somebody is, and the one in the browser was using the
 *     column nobody links on.
 *
 * THE CHAIN THIS MODULE IMPLEMENTS, and nothing else:
 *
 *     Factorial employee id
 *       -> crm.factorial_person_reference.external_id   (exact, unique key)
 *       -> .person_id
 *       -> public.people.id                             (the person must exist)
 *       -> time.member.hub_person_id                    (done by the caller)
 *
 * `public.people` has NO email column, which is why the chain cannot skip the
 * reference table: the reference table IS the recorded decision, written either
 * by the sync's exact-email rule or by a named human in the review queue.
 * Anything the chain does not resolve is reported as UNRESOLVED — visibly — and
 * never guessed at.
 *
 * WHY DIRECT POSTGRES AND NOT THE DATA API
 * ----------------------------------------
 * `crm` is absent from PostgREST's exposed schema list (PGRST106, confirmed
 * 2026-09-01 with the dashboard claiming otherwise), so `supabase.schema("crm")`
 * cannot read this table at all. The identity queue page already reads it over
 * a direct connection for the same reason; this follows the pooled shape used
 * by src/lib/queries/management-customer-mapping.ts.
 *
 * WHEN THE CONNECTION IS ABSENT the answer is `available: false` and an EMPTY
 * map — never a fallback to some looser rule. A page that cannot read the
 * identity table must say it cannot, not quietly go back to matching names.
 */

export type FactorialIdentityMap = {
  /** False when SUPABASE_DB_URL is absent or the read failed. */
  available: boolean;
  /** Human-readable reason when `available` is false. Null otherwise. */
  fault: string | null;
  /** Factorial employee id -> public.people.id. Exact keys only. */
  personByEmployeeId: Map<string, string>;
  /** public.people.id -> people.name, for labelling a person with no TT account. */
  personName: Map<string, string>;
};

const EMPTY = (fault: string | null): FactorialIdentityMap => ({
  available: fault === null,
  fault,
  personByEmployeeId: new Map(),
  personName: new Map(),
});

let pool: Pool | undefined;

function getPool(): Pool | null {
  const connectionString = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
  if (!connectionString) return null;
  pool ??= new Pool({ connectionString, max: 3, ssl: { rejectUnauthorized: false } });
  return pool;
}

export async function readFactorialIdentityMap(): Promise<FactorialIdentityMap> {
  const database = getPool();
  if (!database) {
    return EMPTY("SUPABASE_DB_URL is not configured, so crm.factorial_person_reference cannot be read");
  }

  let rows: { external_id: string; person_id: string; name: string | null }[];
  try {
    /*
     * The INNER JOIN to public.people is load-bearing: a reference row whose
     * person was deleted must resolve to nothing rather than to a person id the
     * rest of the app cannot look up. An active reference is required for the
     * same reason a revoked one is not a decision any more.
     *
     * account_ref is deliberately NOT filtered here. FACTORIAL_COMPANY_ID is not
     * guaranteed to be present in a web runtime, and filtering on a value that
     * may be undefined would silently return nothing. The duplicate guard below
     * covers what the filter was for: if the same employee id or the same person
     * ever appears twice, neither is a key any more.
     */
    const result = await database.query<{ external_id: string; person_id: string; name: string | null }>(`
      select r.external_id, r.person_id, p.name
        from crm.factorial_person_reference r
        join public.people p on p.id = r.person_id
       where r.source_system = 'factorial'
         and r.entity_type = 'person'
         and r.is_active
    `);
    rows = result.rows;
  } catch (error) {
    return EMPTY(
      `crm.factorial_person_reference read failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  /*
   * AMBIGUITY IS NOT A MATCH. The unique constraint on the reference table is
   * (source_system, external_id, entity_type, account_ref), so one employee id
   * CAN legitimately appear twice under two company accounts, and nothing at all
   * stops two employee ids pointing at the same person. Either case means the
   * key no longer identifies one human, so both sides are dropped and the people
   * involved come back unresolved. Silently taking the first row would be
   * exactly the guess this module exists to refuse.
   */
  const employeesPerPerson = new Map<string, number>();
  const rowsPerEmployee = new Map<string, number>();
  for (const r of rows) {
    rowsPerEmployee.set(r.external_id, (rowsPerEmployee.get(r.external_id) ?? 0) + 1);
  }
  const distinctPersonPerEmployee = new Map<string, Set<string>>();
  for (const r of rows) {
    const set = distinctPersonPerEmployee.get(r.external_id) ?? new Set<string>();
    set.add(r.person_id);
    distinctPersonPerEmployee.set(r.external_id, set);
  }
  for (const [, set] of distinctPersonPerEmployee) {
    for (const personId of set) {
      employeesPerPerson.set(personId, (employeesPerPerson.get(personId) ?? 0) + 1);
    }
  }

  const personByEmployeeId = new Map<string, string>();
  const personName = new Map<string, string>();
  for (const r of rows) {
    if ((distinctPersonPerEmployee.get(r.external_id)?.size ?? 0) > 1) continue;
    if ((employeesPerPerson.get(r.person_id) ?? 0) > 1) continue;
    if ((rowsPerEmployee.get(r.external_id) ?? 0) > 1 && personByEmployeeId.has(r.external_id)) continue;
    personByEmployeeId.set(r.external_id, r.person_id);
    if (r.name) personName.set(r.person_id, r.name);
  }

  return { available: true, fault: null, personByEmployeeId, personName };
}
