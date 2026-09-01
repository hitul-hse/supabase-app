import type { NextRequest } from "next/server";

/**
 * The absolute origin to send the browser back to.
 *
 * `request.nextUrl.origin` is the address the SERVER is bound to, not the one
 * the browser used. On Vercel those agree, so this never mattered. Behind a
 * reverse proxy they do not: `next start` ignores both `Host` and
 * `X-Forwarded-Host` (it honours only `X-Forwarded-Proto`), so a request
 * arriving through `tailscale serve` at https://jarvis.tailf1e5c8.ts.net is
 * seen as https://localhost:3000. Every absolute redirect then sent the browser
 * to a localhost that only exists on the machine running the server. Google
 * sign-in from a phone died exactly there, and the symptom pointed at Supabase
 * -- it looks identical to a rejected redirect URL falling back to Site URL.
 *
 * It bit twice. The OAuth callback was fixed first; the proxy's own
 * logged-out redirect (`updateSession` -> /auth/login) had the same bug from
 * `request.nextUrl.clone()`, so signing out through the tunnel and touching
 * any protected page still landed on localhost. Every absolute redirect the
 * app builds now goes through here; do not read `nextUrl.origin` directly for
 * a URL the browser will follow.
 *
 * Deliberately narrow. The forwarded host is honoured ONLY when the origin
 * Next computed is loopback, which cannot happen on Vercel, so production
 * behaviour is bit-identical. A spoofed X-Forwarded-Host therefore cannot
 * reach anyone whose traffic was not already going through a local proxy.
 *
 * Pure and dependency-free on purpose: the proxy runs on the edge runtime.
 */
export function proxiedOrigin(request: NextRequest): string {
  const origin = request.nextUrl.origin;
  if (!/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)) return origin;

  // A proxy chain sends a comma-separated list; the first entry is the client-
  // facing host. Anything that is not a plain hostname[:port] is ignored rather
  // than trusted, so a malformed header degrades to the old behaviour.
  const forwarded = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  if (!forwarded || !/^[A-Za-z0-9.-]+(:\d+)?$/.test(forwarded)) return origin;

  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  return `${proto === "http" ? "http" : "https"}://${forwarded}`;
}
