import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_ROUTES = new Set(["/", "/auth/login", "/auth/signup", "/auth/callback"]);

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return supabaseResponse;
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

    if (!user && !PUBLIC_ROUTES.has(request.nextUrl.pathname)) {
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = "/auth/login";
      loginUrl.searchParams.set("redirect_to", request.nextUrl.pathname);
      return NextResponse.redirect(loginUrl);
    }
  } catch (err) {
    console.error("Supabase auth middleware error:", err);
  }

  return supabaseResponse;
}
