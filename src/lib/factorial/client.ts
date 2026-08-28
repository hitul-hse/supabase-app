import "server-only";

/**
 * The server-side Factorial reader — identity and attendance only.
 *
 * WHY THIS FILE IS DELIBERATELY SMALL
 * -----------------------------------
 * The API key can read everything Factorial holds: salary (contract_versions.
 * salary_amount is populated), bank_number, birthday_on, nationality, home
 * address, disability percentage. An API key there is all-or-nothing; the scope
 * cannot be narrowed server-side. So the minimisation the GDPR argument needs
 * (Art. 5(1)(c)) has to happen HERE: this module fetches exactly two resources,
 * projects each row to the fields the feature needs the moment it arrives, and
 * exports nothing that could carry the rest. A gate greps the projections
 * (check-factorial-hours-page.mjs), so a future `...row` spread fails loudly.
 *
 * MEASURED API BEHAVIOUR THIS CODE DEPENDS ON (2026-08-28, company 157774)
 * -----------------------------------------------------------------------
 *  - Auth is `x-api-key`. `Authorization: Bearer` returns 401 for this
 *    credential (it is the OAuth scheme).
 *  - /attendance/shifts IGNORES `limit` (`paginateable: false`) and returns the
 *    whole filtered set in one response. It must be bounded by DATE.
 *  - `start_on`/`end_on` filter correctly. `filter[date][gte]` is accepted and
 *    silently ignored — HTTP 200 with all 20,929 rows. Never use it.
 *  - /employees/employees pages with `after_id` = meta.end_cursor (opaque;
 *    passing a row id gives 400), max limit 100.
 */

const BASE = "https://api.factorialhr.com/api/2026-07-01";

/** The ONLY employee fields this feature is allowed to carry. */
export type FactorialPerson = {
  factorialId: string;
  fullName: string;
  email: string | null;
  active: boolean;
};

export type FactorialTeam = {
  teamId: string;
  /** English half of the bilingual name ("Safety Team / Sicherheitsteam"). */
  name: string;
  employeeIds: string[];
};

/** One person's attendance total for the requested window. */
export type FactorialPresence = {
  factorialId: string;
  presentMinutes: number;
  daysClocked: number;
};

export class FactorialUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FactorialUnavailableError";
  }
}

function key(): string | null {
  return process.env.FACTORIAL_API_KEY ?? null;
}

async function get(path: string): Promise<unknown> {
  const k = key();
  if (!k) throw new FactorialUnavailableError("FACTORIAL_API_KEY is not configured");
  const res = await fetch(`${BASE}${path}`, {
    headers: { "x-api-key": k, Accept: "application/json" },
    // The dashboard reads a 90-day aggregate; attendance changes at human speed.
    // 15 minutes keeps the page fast without showing yesterday's staffing as
    // today's. `no-store` here would put a 7s upstream call on every page view.
    next: { revalidate: 900 },
  });
  if (!res.ok) {
    throw new FactorialUnavailableError(`Factorial ${path.split("?")[0]} returned HTTP ${res.status}`);
  }
  return res.json();
}

function dataOf(body: unknown): Record<string, unknown>[] {
  const data = (body as { data?: unknown })?.data;
  if (!Array.isArray(data)) {
    // A missing envelope must fail loudly: optional-chaining into [] here would
    // render every colleague as "not clocked", which reads as an answer.
    throw new FactorialUnavailableError("Factorial response has no data array");
  }
  return data as Record<string, unknown>[];
}

/**
 * All employees, projected to identity fields ON ARRIVAL. Nothing else from the
 * 54-field payload survives this function.
 */
export async function fetchFactorialPeople(): Promise<FactorialPerson[]> {
  // 43 employees < the 100-row page, but follow the cursor anyway: headcount
  // crossing 100 must not silently truncate the roster.
  const out: FactorialPerson[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 20; page++) {
    const q = cursor ? `&after_id=${encodeURIComponent(cursor)}` : "";
    const body = await get(`/resources/employees/employees?limit=100${q}`);
    for (const row of dataOf(body)) {
      out.push({
        factorialId: String(row.id),
        fullName: String(row.full_name ?? `${row.first_name ?? ""} ${row.last_name ?? ""}`).trim(),
        email: row.email ? String(row.email).toLowerCase().trim() : null,
        active: row.active === true,
      });
    }
    const meta = (body as { meta?: { has_next_page?: boolean; end_cursor?: string } }).meta;
    if (!meta?.has_next_page) return out;
    if (!meta.end_cursor || meta.end_cursor === cursor) {
      throw new FactorialUnavailableError("employees cursor did not advance");
    }
    cursor = meta.end_cursor;
  }
  throw new FactorialUnavailableError("employees exceeded 20 pages — refusing a possibly-truncated roster");
}

export async function fetchFactorialTeams(): Promise<FactorialTeam[]> {
  const body = await get(`/resources/teams/teams?limit=100`);
  return dataOf(body).map((row) => ({
    teamId: String(row.id),
    name: String(row.name ?? "").split(" /")[0].trim(),
    employeeIds: Array.isArray(row.employee_ids) ? row.employee_ids.map(String) : [],
  }));
}

/**
 * Attendance minutes per person for [from, to], inclusive ISO dates.
 *
 * One request: the endpoint returns the entire date-bounded set (measured:
 * 2,288 rows for 90 days, ~7s cold). The projection keeps employee_id, minutes
 * and the day — clock times, geolocation and workplace fields do not survive.
 */
export async function fetchFactorialPresence(fromIso: string, toIso: string): Promise<FactorialPresence[]> {
  const body = await get(`/resources/attendance/shifts?start_on=${fromIso}&end_on=${toIso}`);
  const rows = dataOf(body);

  // The response is unpaged by contract; verify the envelope agrees, because if
  // Factorial ever starts paging this endpoint a silent first-page read would
  // undercount everyone's presence.
  const meta = (body as { meta?: { total?: number; has_next_page?: boolean } }).meta;
  if (meta?.has_next_page) {
    throw new FactorialUnavailableError("attendance/shifts began paginating — the single-read contract no longer holds");
  }
  if (typeof meta?.total === "number" && meta.total !== rows.length) {
    throw new FactorialUnavailableError(`attendance/shifts returned ${rows.length} rows but claims total ${meta.total}`);
  }

  const byPerson = new Map<string, { minutes: number; days: Set<string> }>();
  for (const row of rows) {
    const id = String(row.employee_id);
    const minutes = Number(row.minutes ?? 0);
    if (!Number.isFinite(minutes) || minutes <= 0) continue;
    const cur = byPerson.get(id) ?? { minutes: 0, days: new Set<string>() };
    cur.minutes += minutes;
    if (row.date) cur.days.add(String(row.date));
    byPerson.set(id, cur);
  }
  return [...byPerson].map(([factorialId, v]) => ({
    factorialId,
    presentMinutes: v.minutes,
    daysClocked: v.days.size,
  }));
}
