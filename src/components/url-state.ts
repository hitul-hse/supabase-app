"use client";

/**
 * Page state in the URL WITHOUT a server round-trip.
 *
 * UI-CONVENTIONS rule 2: page, sort and filter state live in the URL, never in
 * useState alone -- the back button, a shared link and a refresh all have to
 * land on the same rows. Every list page that pages on the server already does
 * this with `<Link>`s. The client-sorted tables (DataTable, the projects ledger,
 * the explorer's filter bar) did not, and were accepted as a known deviation
 * (APPLE_REF §5.4 "State"), because the obvious fix -- `router.push` -- costs a
 * full RSC round-trip for what is a pure re-projection of rows already in the
 * browser.
 *
 * Next's App Router integrates the native History API: `window.history
 * .pushState` / `replaceState` update `useSearchParams` and the router's own
 * notion of the URL, with no fetch (node_modules/next/dist/docs/01-app/
 * 01-getting-started/04-linking-and-navigating.md, "Native History API").
 * That is what this hook wraps.
 *
 * WHY LOCAL STATE IS THE SOURCE OF TRUTH, AND THE URL A MIRROR
 * ------------------------------------------------------------
 * Next applies an external pushState/replaceState through `startTransition`
 * (app-router.js, the patched `window.history`), so `useSearchParams` catches
 * up a beat later. A controlled search box whose `value` came from the URL
 * would lag the keystroke and drop characters under fast typing. So the state
 * lives in React for immediacy, the URL mirrors it on every change, and the
 * URL is READ only at mount (the shared-link / refresh case) and on `popstate`
 * (the back-button case). A Link elsewhere on the page that navigates to the
 * same route with other params remounts the page segment, which re-reads it.
 *
 * OUTSIDE THE ROUTER (the render-to-string gates) `useSearchParams()` returns
 * null and the hook degrades to plain component state: nothing is written and
 * nothing is read. The gates render the same markup they always did.
 */

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

/** A partial rewrite of the query string: null / undefined / "" deletes the key. */
export type UrlPatch = Record<string, string | readonly string[] | null | undefined>;

export type UrlMode = "push" | "replace";

/**
 * Apply a patch to the CURRENT location's search params and write it to the
 * history. Reads `window.location` rather than a captured params object so two
 * hooks on one page (the explorer's filters and the ledger's page) never
 * overwrite each other's keys with stale copies.
 */
export function writeUrl(patch: UrlPatch, mode: UrlMode): void {
  if (typeof window === "undefined") return;
  const next = new URLSearchParams(window.location.search);
  for (const [key, value] of Object.entries(patch)) {
    next.delete(key);
    if (value === null || value === undefined || value === "") continue;
    if (typeof value === "string") next.set(key, value);
    else for (const v of value) if (v !== "") next.append(key, v);
  }
  const qs = next.toString();
  const url = `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`;
  if (mode === "push") window.history.pushState(null, "", url);
  else window.history.replaceState(null, "", url);
}

/**
 * Component state mirrored into the URL.
 *
 * @param fromParams Parse the state out of a query string. Must tolerate
 *   anything: a stale bookmark carries values that no longer exist, and the
 *   contract is "degrade to the default", never throw.
 * @param toPatch The keys this state owns, as a patch. Every key must be
 *   present (with null for "unset") so a change clears what it no longer needs.
 * @param mode `push` when the change is a step the back button should undo
 *   (page N -> N+1, a view switch); `replace` for filters, sorts and sizes,
 *   which would otherwise bury the previous page under one entry per click.
 *   The setter accepts a per-call override.
 * @param enabled False keeps the state in the component only. The initial
 *   value is still parsed from the URL, so a caller can opt out of WRITING
 *   without losing a shared link's starting point.
 */
export function useUrlState<T>(
  fromParams: (params: URLSearchParams) => T,
  toPatch: (state: T) => UrlPatch,
  { mode = "replace", enabled = true }: { mode?: UrlMode; enabled?: boolean } = {},
): [T, (next: T, modeOverride?: UrlMode) => void] {
  // Cast: the App Router types promise a non-null value, but outside a request
  // (the gates) the context is absent and the runtime returns null.
  const initial = useSearchParams() as URLSearchParams | null;
  // `enabled` is how a primitive with an OPTIONAL URL binding (DataTable's
  // `urlKeys`) keeps plain component state when the caller did not ask: hooks
  // cannot be conditional, but the mirror can be switched off.
  const urlBacked = enabled && initial !== null;

  const [state, setState] = useState<T>(() =>
    fromParams(new URLSearchParams(initial?.toString() ?? "")),
  );

  // The parsers are kept in refs, refreshed after every commit, so the
  // popstate subscription is set up once: callers pass inline arrow functions,
  // and a subscription keyed on their identity would be torn down and rebuilt
  // on every render. Refs are written in an effect, never during render.
  const parse = useRef(fromParams);
  const serialise = useRef(toPatch);
  useEffect(() => {
    parse.current = fromParams;
    serialise.current = toPatch;
  });

  useEffect(() => {
    if (!urlBacked) return;
    const onPop = () => setState(parse.current(new URLSearchParams(window.location.search)));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [urlBacked]);

  const set = useCallback(
    (next: T, modeOverride?: UrlMode) => {
      setState(next);
      if (urlBacked) writeUrl(serialise.current(next), modeOverride ?? mode);
    },
    [urlBacked, mode],
  );

  return [state, set];
}

/** The first value of a repeated key, or null. */
export function firstParam(params: URLSearchParams, key: string): string | null {
  const v = params.get(key);
  return v === null || v === "" ? null : v;
}

/** A 1-based `?page=N` as a 0-based index; anything unparsable is page 0. */
export function pageFromParams(params: URLSearchParams, key: string): number {
  const n = Number.parseInt(params.get(key) ?? "", 10);
  return Number.isFinite(n) && n > 1 ? n - 1 : 0;
}

/** The inverse: page 0 is the absence of the key, so a clean URL stays clean. */
export function pageToParam(page: number): string | null {
  return page > 0 ? String(page + 1) : null;
}
