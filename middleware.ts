import { type NextRequest } from "next/server";
import { updateSession } from "@/utils/supabase/middleware";

// Routes that don't require authentication (login/signup pages)
const PUBLIC_ROUTES = new Set(["/", "/auth/login", "/auth/signup", "/auth/callback"]);

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Always refresh the session
  let response = await updateSession(request);

  // If not a public route, require authentication
  if (!PUBLIC_ROUTES.has(pathname)) {
    const sessionCookie = request.cookies.get("sb-auth-token");

    if (!sessionCookie) {
      // Redirect to login if trying to access a protected route
      const loginUrl = new URL("/auth/login", request.url);
      loginUrl.searchParams.set("redirect_to", pathname);
      return new URL(loginUrl).href;
    }
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
