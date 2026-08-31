/*
 * The URL contract for /data-hygiene.
 *
 * WHY THIS IS NOT IN page.tsx
 * ---------------------------
 * It used to be, and that made half the paging feature untestable. The gates
 * could prove that `getDataHygiene` pages correctly and still stay green while
 * every PREV/NEXT link on the page pointed at the wrong param -- the reader
 * would click NEXT, the URL would change, and the same ten rows would come
 * back. `check-data-hygiene-paging.mjs` exists to catch exactly that failure and
 * could not see it, because a node gate cannot import a React server component.
 *
 * So the two pure functions that own the round trip live here, where the gate
 * imports and exercises them directly:
 *
 *     parsePages(hrefFor(kind, pages).searchParams) === pages
 *
 * Everything here is pure and dependency-free on purpose. It runs in the server
 * component and in a gate with no DOM, no React and no Next.
 */

/** Which findings to render. `all` is the report; the other two are lenses. */
export type KindFilter = "all" | "exact" | "heuristic";

/** Per-finding page numbers, keyed by finding key. 1-based; missing means 1. */
export type HygienePages = Record<string, number>;

/**
 * Page params are namespaced `p_<finding key>`.
 *
 * One shared `?page=` would be wrong rather than merely coarse: the panels are
 * independent lists that happen to share a document, so a single param would
 * move all eight at once and land seven of them on a page nobody asked for.
 */
export const PAGE_PREFIX = "p_";

/** The route this module builds URLs for. One place, so a rename cannot drift. */
export const DATA_HYGIENE_PATH = "/data-hygiene";

type ParamBag = Record<string, string | string[] | undefined>;

/** Read `?p_<key>=N` out of Next's searchParams bag. */
export function parsePages(params: ParamBag): HygienePages {
  const pages: HygienePages = {};
  for (const [k, v] of Object.entries(params)) {
    if (!k.startsWith(PAGE_PREFIX)) continue;
    const key = k.slice(PAGE_PREFIX.length);
    if (!key) continue;
    const raw = Array.isArray(v) ? v[0] : v;
    const n = Number.parseInt(raw ?? "", 10);
    /*
     * Junk and out-of-range values are NOT rejected here. They are passed on and
     * clamped in ONE place, in the query module, so a stale bookmark degrades to
     * the last page instead of 404ing or rendering an empty table -- which on
     * this page would read as "nothing left to fix".
     */
    if (Number.isFinite(n)) pages[key] = n;
  }
  return pages;
}

export function parseKind(params: ParamBag): KindFilter {
  const raw = Array.isArray(params.kind) ? params.kind[0] : params.kind;
  return raw === "exact" || raw === "heuristic" ? raw : "all";
}

/**
 * Build a URL for the page.
 *
 * `pages` should be the CLAMPED page numbers the query module actually served,
 * not the ones the URL asked for. Echoing the request back means `?p_x=9999` and
 * `?p_x=14` render an identical view under two different URLs, and a param for a
 * finding that no longer exists is carried forward for ever.
 *
 * A KIND change passes `{}` instead: the filter defines a new set of panels, and
 * UI-CONVENTIONS rule 2 says a filter change resets to page 1.
 */
export function hrefFor(kind: KindFilter, pages: HygienePages): string {
  const search = new URLSearchParams();
  if (kind !== "all") search.set("kind", kind);
  for (const [key, n] of Object.entries(pages)) {
    // Page 1 is the default, so it is never spelled out -- a URL should carry
    // what differs from the default and nothing else.
    if (Number.isFinite(n) && n > 1) search.set(`${PAGE_PREFIX}${key}`, String(Math.floor(n)));
  }
  // Sorted, so the same view always has the same URL and is cache-comparable.
  search.sort();
  const query = search.toString();
  return `${DATA_HYGIENE_PATH}${query ? `?${query}` : ""}`;
}
