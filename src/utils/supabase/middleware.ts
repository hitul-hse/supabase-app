import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Reachable without a session. /auth/set-password has to be here even though
// it is only useful to an invited user: the invite's credential can arrive in
// the URL fragment, which the browser never sends to the server, so the proxy
// genuinely cannot see a session yet and would bounce the visitor to login
// before the page had a chance to establish one.
const PUBLIC_ROUTES = new Set([
  "/auth/login",
  "/auth/callback",
  "/auth/set-password",
  "/auth/forgot-password",
]);

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const isPublicRoute = PUBLIC_ROUTES.has(request.nextUrl.pathname);

  const redirectToLogin = () => {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/auth/login";
    loginUrl.searchParams.set("redirect_to", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  };

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Fail closed. Without Supabase config we cannot authenticate anyone, so
  // protected pages must not be served. This previously returned next(), so a
  // single missing or misspelled env var silently made the entire app public.
  if (!supabaseUrl || !supabaseKey) {
    console.error(
      "Supabase env vars missing (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY); denying protected routes.",
    );
    return isPublicRoute ? supabaseResponse : redirectToLogin();
  }

  try {
    const supabase = createServerClient(supabaseUrl, supabaseKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    });

    // Refresh the auth token if needed and read the verified user. Do not add
    // logic between createServerClient and this call, and do not remove
    // getUser() — it's what actually validates the session against Supabase's
    // auth server rather than trusting a cookie's mere presence.
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user && !isPublicRoute) {
      return redirectToLogin();
    }
  } catch (err) {
    // Also fail closed: an auth-server outage or a thrown fetch must not
    // degrade into "everyone is allowed through".
    console.error("Supabase auth middleware error:", err);
    if (!isPublicRoute) {
      return redirectToLogin();
    }
  }

  return supabaseResponse;
}
