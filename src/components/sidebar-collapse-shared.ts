/**
 * Values shared between the SERVER layout and the client sidebar components.
 *
 * This file exists because of a genuine Next.js App Router trap, found by
 * probing the running server rather than by reading code:
 *
 *   Importing a plain constant FROM a "use client" module INTO a server
 *   component does not give you the constant. The bundler replaces the whole
 *   module with a client-reference proxy, so every named export arrives as an
 *   opaque function. `cookieStore.get(SIDEBAR_COOKIE)` was therefore looking up
 *   a cookie literally named "[Function (anonymous)]", found nothing, and
 *   silently reported "not collapsed" on every request -- the preference was
 *   written correctly and then ignored forever.
 *
 *   It fails silently and it type-checks. `cookies().get()` accepts a string,
 *   and the client-reference proxy satisfies enough of the type system to
 *   compile, so nothing warns you.
 *
 * The fix is this module: no "use client" directive, so both sides import the
 * real value. Do NOT move these back into SidebarCollapseContext.tsx.
 */

/** Name of the cookie holding the desktop sidebar collapse preference. */
export const SIDEBAR_COOKIE = "hse_sidebar_collapsed";

/** Cookie lifetime. A UI preference, not a security boundary. */
export const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Expanded desktop sidebar width, in px. Mirrors --sidebar-width in globals.css. */
export const SIDEBAR_WIDTH = 220;
