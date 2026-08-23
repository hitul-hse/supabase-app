import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { createClient } from "./server";

type ManagementReadClient = SupabaseClient<Database>;

/**
 * The read-only data client for the management dashboard.
 *
 * In the sandbox this had a second path: a dev-cookie check that fell back to
 * the SERVICE-ROLE client, so the dashboard could be developed without a real
 * Supabase Auth session. That path was deliberately not merged. The dev-auth
 * module was excluded from the branch by its author ("Production Auth darf
 * daraus nicht uebernommen werden"), and a service-role fallback -- a client
 * that bypasses RLS -- must not be reachable from a production request path at
 * all, however well-guarded. Here the management dashboard reads exactly what
 * the signed-in user is allowed to see, like every other page.
 */
export async function createManagementReadClient(): Promise<ManagementReadClient> {
  return createClient();
}
