import { redirect } from "next/navigation";
import { createClient } from "./server";

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
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const loginUrl = `/auth/login?redirect_to=${encodeURIComponent(currentPath)}`;
    redirect(loginUrl);
  }

  return user;
}
