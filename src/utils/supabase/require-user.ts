import { redirect } from "next/navigation";
import { createClient } from "./server";
import { getSignedInUser } from "@/lib/queries/request-cache";

/**
 * Server-side auth gate for protected pages. The proxy (src/proxy.ts) also
 * redirects unauthenticated requests, but per Next.js's own guidance that
 * layer is defense-in-depth only, not the sole auth boundary (see
 * CVE-2025-29927, a middleware auth-bypass). Every protected page verifies
 * its own session directly against Supabase's auth server instead of
 * trusting that the proxy already ran.
 */
export async function requireUser(currentPath: string) {
  const supabase = await createClient();
  /*
    getSignedInUser(), not a raw supabase.auth.getUser().

    The verification is IDENTICAL -- getSignedInUser calls the same method and
    still hits the auth server on every request; it just does so once per
    render instead of once per caller (see request-cache.ts, where the ~50ms
    round trip and the six-per-navigation measurement are recorded). Nothing is
    trusted from a cookie that was not trusted before.

    Made explicit here because this file is the auth boundary for the two pages
    that have no profile gate, and enforceRoleRouteAccess() now runs beside it
    on both. Left raw, each of those pages would pay two auth round trips where
    one answers both questions.
  */
  const user = await getSignedInUser(supabase);

  if (!user) {
    const loginUrl = `/auth/login?redirect_to=${encodeURIComponent(currentPath)}`;
    redirect(loginUrl);
  }

  return user;
}
