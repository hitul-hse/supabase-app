import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/server";

/**
 * Landing point for every credential that arrives by redirect — email invites,
 * password resets, and OAuth (Google / Microsoft).
 *
 * Supabase hands the credential over in one of three shapes depending on the
 * flow, so all of them are handled rather than betting on one and 404-ing the
 * others:
 *
 *   ?code=...                  PKCE — exchange it for a session. Used by OAuth
 *                              and by email links on projects using PKCE.
 *   ?token_hash=...&type=...   verify the one-time token directly.
 *   #access_token=...          implicit flow puts tokens in the URL *fragment*,
 *                              which browsers never send to the server, so this
 *                              handler cannot see it. /auth/set-password deals
 *                              with that case client-side.
 *
 * On success the visitor continues to `next`. On failure they land back on
 * login with a readable reason instead of a blank screen.
 */

/**
 * Where to send the visitor afterwards.
 *
 * Same-origin relative paths only. `next` comes from the query string, so an
 * absolute URL here would turn this route into an open redirect at the exact
 * moment the visitor has just authenticated — the same class of bug that was
 * fixed on the login page. Protocol-relative "//evil.com" and the "/\evil.com"
 * form some browsers normalise to it are both rejected, because each starts with
 * "/" and is otherwise indistinguishable from a local path.
 */
function safeNext(raw: string | null, fallback: string): string {
  if (!raw || !raw.startsWith("/")) return fallback;
  if (raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  return raw;
}

/**
 * The absolute origin to send the browser back to.
 *
 * `request.nextUrl.origin` is the address the SERVER is bound to, not the one
 * the browser used. On Vercel those agree, so this never mattered. Behind a
 * reverse proxy they do not: `next start` ignores both `Host` and
 * `X-Forwarded-Host` (it honours only `X-Forwarded-Proto`), so a request
 * arriving through `tailscale serve` at https://jarvis.tailf1e5c8.ts.net is
 * seen as https://localhost:3000. Every redirect below then sent the browser
 * to a localhost that only exists on the machine running the server. Google
 * sign-in from a phone died exactly there, and the symptom pointed at Supabase
 * -- it looks identical to a rejected redirect URL falling back to Site URL.
 *
 * Deliberately narrow. The forwarded host is honoured ONLY when the origin
 * Next computed is loopback, which cannot happen on Vercel, so production
 * behaviour is bit-identical. A spoofed X-Forwarded-Host therefore cannot
 * reach anyone whose traffic was not already going through a local proxy.
 */
function proxiedOrigin(request: NextRequest): string {
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

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const origin = proxiedOrigin(request);

  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  // The provider reports user-facing refusals (consent denied, admin policy) as
  // query params rather than as a failed exchange, so there is no code to trade
  // and the useful message is right here.
  const providerError = searchParams.get("error_description") ?? searchParams.get("error");

  /**
   * Default destination differs by flow, and getting this wrong is a real dead
   * end rather than a cosmetic slip:
   *
   *  - An *invited* user has no password yet, so they must go to set-password.
   *  - An *OAuth* user has no password at all and never will. Sending them to
   *    set-password would strand them on a form they cannot meaningfully use.
   *
   * `type` is present for email OTP flows and absent for OAuth, which is the
   * distinction used here.
   */
  const isEmailFlow = Boolean(tokenHash && type);
  const next = safeNext(searchParams.get("next"), isEmailFlow ? "/auth/set-password" : "/");

  const failure = (reason: string) =>
    NextResponse.redirect(`${origin}/auth/login?error=${encodeURIComponent(reason)}`);

  if (providerError) return failure(providerError);

  if (!code && !isEmailFlow) {
    return failure("That sign-in link is missing its verification token. Try again, or ask for a new invite.");
  }

  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return failure(error.message);
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (error) return failure(error.message);
  }

  /**
   * An OAuth sign-in with no provisioned profile goes to /access-pending.
   *
   * Without this it lands in the app shell instead, and reads as a broken page
   * rather than a permissions state. Most pages gate with requireUser() and let
   * RLS scope the data (see require-profile.ts) — a deliberate choice, and the
   * right one — but it means an authenticated stranger reaches /timesheets and
   * sees an *empty grid* with no explanation. No data leaks, RLS denies all of
   * it; it just looks broken. Observed in scripts/check-oauth-success-path.mjs
   * before this existed.
   *
   * Deciding it here rather than by changing each page's gate keeps the choice in
   * the sign-in flow, where it belongs, and touches nothing else.
   *
   * Email flows are exempt: an invited user legitimately has no profile yet and
   * must reach /auth/set-password to set a password first.
   */
  if (!isEmailFlow) {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      const { data: profile } = await supabase
        .from("app_user_profile")
        .select("user_id")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .maybeSingle();

      if (!profile) {
        return NextResponse.redirect(`${origin}/access-pending`);
      }
    }
  }

  return NextResponse.redirect(`${origin}${next}`);
}
