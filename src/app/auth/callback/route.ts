import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/server";

/**
 * Landing point for links that arrive from an email — invites and password
 * resets. Supabase hands the credential over in one of two shapes depending
 * on the project's flow settings, so both are handled rather than betting on
 * one and 404-ing the other:
 *
 *   ?code=...                  PKCE — exchange it for a session
 *   ?token_hash=...&type=...   verify the one-time token directly
 *
 * A third shape exists: implicit flow puts tokens in the URL *fragment*
 * (#access_token=...), which browsers never send to the server, so this
 * handler cannot see it. /auth/set-password handles that case client-side.
 *
 * On success the visitor continues to `next` (defaulting to set-password,
 * since an invited user has no password yet). On failure they land back on
 * login with a readable reason instead of a blank screen.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;

  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  // Only allow same-origin relative paths — an attacker-supplied absolute URL
  // here would turn this route into an open redirect.
  const requestedNext = searchParams.get("next");
  const next =
    requestedNext && requestedNext.startsWith("/") && !requestedNext.startsWith("//")
      ? requestedNext
      : "/auth/set-password";

  const failure = (reason: string) =>
    NextResponse.redirect(`${origin}/auth/login?error=${encodeURIComponent(reason)}`);

  if (!code && !(tokenHash && type)) {
    return failure("That link is missing its verification token. Ask for a new invite.");
  }

  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return failure(error.message);
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (error) return failure(error.message);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
