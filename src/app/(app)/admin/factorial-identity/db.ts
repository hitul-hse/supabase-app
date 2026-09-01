// Server-only by usage: imported exclusively from a server component and
// "use server" actions. (The server-only marker package is not a dependency,
// and the house rule is no new dependencies without asking.)
import { Client } from "pg";

/**
 * Direct Postgres for the identity queue — deliberately NOT the Supabase Data
 * API. The crm schema is absent from PostgREST's exposed list, and 2026-09-01
 * showed the dashboard's Data API settings (5 of 7 exposed, project restarted)
 * disagreeing with what PostgREST actually serves (still four schemas,
 * PGRST106 for crm). A page whose availability depends on a platform config
 * pipeline that can silently diverge from its own UI is a page that breaks on
 * someone else's schedule. SUPABASE_DB_URL is already project env in every
 * deployed environment that matters.
 *
 * One short-lived connection per call, closed in finally: this is a low-traffic
 * admin surface, not a hot path, and a per-request Client keeps us clear of
 * pool leakage across serverless invocations.
 */
export async function withDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    throw new Error(
      "SUPABASE_DB_URL is not set in this environment — the identity queue reads Postgres directly (see .env.local.example).",
    );
  }
  const db = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    return await fn(db);
  } finally {
    await db.end();
  }
}

/* The statuses a machine wrote and a machine (or this page) may still touch.
 * Terminal and manual states belong to a named human and are excluded from
 * every UPDATE issued here on top of the DB's own constraints. */
export const MACHINE_STATUSES = ["unmatched", "bridged_unlinked", "ambiguous", "resolved_auto"];
