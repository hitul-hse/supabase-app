import { cache } from "react";
import type { SupabaseTyped } from "./types";

/**
 * Per-REQUEST memoisation for reads that the shared app shell repeats.
 *
 * WHY THIS EXISTS (measured, not guessed)
 * ---------------------------------------
 * scripts/measure-page-timing.mjs against production showed TTFB at ~21ms and
 * the RSC stream at 2.6-9.3s, while the heaviest SQL query measured 62ms. The
 * time was never in the database. scripts/.tmp-shell-cost proved where it was:
 *
 *   /auth/login   (outside the (app) layout, no auth shell)     47ms
 *   /profile      (inside it, ONE single-row query of its own) 689ms
 *
 * ~640ms of every single page render is the shared authenticated shell, before
 * the page's own data is touched at all. That shell re-reads the same two facts
 * -- "who is signed in" and "what is their profile" -- once per component that
 * needs them, serially:
 *
 *   <Sidebar/>        getUser + getProfileView   (x2: the layout mounts it
 *                                                 twice, desktop + mobile drawer)
 *   <TopBarChrome/>   getUser + getProfileView
 *   <TimerBarSlot/>   getUser + profile lookup   (since removed, 2026-08-25 --
 *                                                 it wrote to the wrong table and
 *                                                 had been used once ever)
 *   requireProfile()  getUser + getCurrentProfile
 *
 * Same user, same request, same answer, ~50ms of network each.
 *
 * WHY THIS IS NOT A DATA-LEAK RISK
 * --------------------------------
 * This app is RLS-scoped per user, so a shared cache would be a serious bug.
 * This is not a shared cache. React's `cache()` scope is ONE server render of
 * ONE request: the store is created when the request's render begins and is
 * discarded when it ends. Nothing survives to a second request, so no second
 * user can ever observe a value produced for the first. Two independent
 * guarantees, either of which would be sufficient on its own:
 *
 *   1. LIFETIME. Not `unstable_cache`, not `revalidate`, not the Data Cache,
 *      not a module-level Map -- all of which DO outlive a request and would
 *      genuinely be unsafe here. Nothing in this file persists across requests.
 *   2. KEY. Every entry is keyed on the subject's own id (`userId`/`personId`),
 *      so even within a single render a value cannot be handed to a lookup for
 *      a different subject.
 *
 * It also does not weaken RLS: the memoised value is whatever the caller's own
 * RLS-scoped client returned. It removes duplicate round trips; it does not
 * widen what any of them were allowed to see.
 */

/**
 * A per-request slot, keyed by a string.
 *
 * `cache()` memoises on ARGUMENT IDENTITY, which is why the cached functions
 * cannot simply take the Supabase client: every caller builds its own client
 * object, so `cache(fn)(clientA, id)` and `cache(fn)(clientB, id)` are two
 * different keys and nothing would ever be reused. Keying a box on a plain
 * string sidesteps that, and the promise is stored inside the box.
 *
 * Storing the PROMISE (not the resolved value) is what makes concurrent
 * callers collapse: components rendering in parallel all await the same
 * in-flight request instead of each starting their own.
 *
 * Outside a React render -- a `scripts/*.mjs` gate, say -- `cache()` has no
 * request store to attach to and returns a fresh box per call, so this
 * degrades to "no memoisation" rather than to a stale value.
 */
const slot = cache((_key: string): { promise: Promise<unknown> | null } => ({ promise: null }));

/**
 * Run `load` at most once per (key, request).
 *
 * A REJECTED promise is deliberately cleared rather than remembered: a
 * transient network failure in the sidebar must not be replayed as a
 * guaranteed failure into every other component in the same render.
 */
export function oncePerRequest<T>(key: string, load: () => Promise<T>): Promise<T> {
  const box = slot(key);
  if (!box.promise) {
    box.promise = load().catch((err) => {
      box.promise = null;
      throw err;
    });
  }
  return box.promise as Promise<T>;
}

/**
 * The verified signed-in user, at most once per request.
 *
 * WHY THIS MATTERS MORE THAN IT LOOKS. `supabase.auth.getUser()` is NOT a local
 * cookie parse -- it is a network round trip to the Supabase auth server that
 * validates the token, measured at ~47ms median from here. That round trip is
 * deliberate and must stay (trusting a cookie's mere presence is the
 * CVE-2025-29927 class of bug), but it should be paid ONCE per request rather
 * than once per component that happens to need the answer.
 *
 * Measured, a single navigation made 4-6 of these: the proxy, <Sidebar/> twice
 * (the layout mounts it for desktop and again for the mobile drawer),
 * <TopBarChrome/> and the page's own requireProfile() gate --
 * in series, all returning the same user.
 *
 * This does NOT weaken the check. The token is still verified against the auth
 * server on every request; it is simply not re-verified five times inside one
 * render. The memo lives and dies with that render, so a revoked session is
 * still rejected on the very next request.
 *
 * Keyed on a constant because a request has exactly one signed-in user; the
 * per-request store is what provides the isolation, so another user's request
 * gets a different store and can never observe this value.
 */
export async function getSignedInUser(supabase: SupabaseTyped) {
  return oncePerRequest("auth:user", async () => {
    const { data } = await supabase.auth.getUser();
    return data.user;
  });
}
