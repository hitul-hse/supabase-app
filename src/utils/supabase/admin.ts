import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

/**
 * Service-role client. Bypasses RLS entirely — only ever import this from
 * server actions/route handlers that need Auth Admin APIs (creating/inviting
 * users), never from anything that renders a page or handles a request body
 * directly from the client. Requires SUPABASE_SERVICE_ROLE_KEY (server-only,
 * not NEXT_PUBLIC_-prefixed) — see .env.local.example.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set. Add it to .env.local (and to Vercel's project env vars) — see .env.local.example.",
    );
  }

  return createSupabaseClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
