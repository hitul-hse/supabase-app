import "server-only";

import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { DEV_AUTH_COOKIE, isDevAuthCookie } from "@/lib/auth/dev-auth";
import { createAdminClient } from "./admin";
import { createClient } from "./server";

type ManagementReadClient = SupabaseClient<Database>;

/**
 * Selects the read-only data client for the management dashboard.
 *
 * The development identity is not a Supabase Auth session, so an anon/server
 * client would still be rejected by RLS. In development only, and only when
 * the existing dev cookie is valid, management read models use the server-only
 * service-role client. The client never crosses into a Client Component.
 *
 * Production always uses the cookie-bound Supabase client. That keeps the
 * existing Supabase Auth + RLS path unchanged.
 */
export async function createManagementReadClient(): Promise<ManagementReadClient> {
  const cookieStore = await cookies();
  if (isDevAuthCookie(cookieStore.get(DEV_AUTH_COOKIE)?.value)) {
    return createAdminClient();
  }

  return createClient();
}
