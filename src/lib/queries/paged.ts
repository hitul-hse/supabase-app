/**
 * Parallel paging for PostgREST reads.
 *
 * THE PROBLEM, measured (scripts/tmp-latency-rls.mjs, 2026-08-21, real exec
 * session against the live project):
 *
 *     entry, all pages SEQUENTIAL   12,160ms   (6 pages, each awaited in turn)
 *     entry, pages 0-5 PARALLEL      7,947ms   (same rows, same session)
 *
 * Sequential paging serialises round trips AND RLS evaluation: every page costs
 * network + ~280ms/1000 rows of per-row policy work (scripts/check-rls-hoisting.mjs),
 * and the app's four query layers all await page N before asking for page N+1.
 * That loop is the single largest avoidable cost on /people, /projects and
 * /team-lead.
 *
 * THE SHAPE OF THE FIX. PostgREST cannot say "how many pages" without a COUNT
 * that costs a scan of its own, so total-then-fan-out is a false economy. But a
 * request beyond the last row returns an EMPTY 200 (measured), so over-asking is
 * harmless. Fetch pages in BATCHES of `width` in parallel; a batch whose last
 * page came back full means there may be more, so fetch the next batch. For
 * today's 5.3k rows one 6-wide batch does the whole table in a single round of
 * parallel requests.
 *
 * THE 1000-ROW TRAP THIS PRESERVES: PostgREST silently truncates any response at
 * db-max-rows (1000). Callers pass a page-shaped query factory and this module
 * pages it honestly, reporting truncation when the safety ceiling is hit rather
 * than returning a short total that looks complete.
 */

/** PostgREST's silent per-response cap on this project (db-max-rows). */
export const PAGE = 1000;

/** Pages fetched concurrently per batch. Sized to cover today's largest table
 * (5.3k rows) in one batch without hammering PostgREST if a table grows 10x. */
const BATCH_WIDTH = 6;

export type PagedResult<Row> = {
  rows: Row[];
  /** True when the safety ceiling stopped the read before the data ran out. */
  truncated: boolean;
};

/**
 * Fetch every row of a paged query, batches of pages in parallel.
 *
 * `queryForRange` must return a FRESH PostgREST builder for each call — builders
 * are single-use. An error on any page aborts the read: partial totals presented
 * as complete are exactly the failure mode this module exists to prevent.
 */
export async function fetchAllPaged<Row>(
  queryForRange: (from: number, to: number) => PromiseLike<{
    data: Row[] | null;
    error: { message: string } | null;
  }>,
  opts: { maxPages?: number } = {},
): Promise<PagedResult<Row>> {
  const maxPages = opts.maxPages ?? 30;
  const rows: Row[] = [];

  for (let base = 0; base < maxPages; base += BATCH_WIDTH) {
    const width = Math.min(BATCH_WIDTH, maxPages - base);
    const results = await Promise.all(
      Array.from({ length: width }, (_, i) => {
        const page = base + i;
        return queryForRange(page * PAGE, page * PAGE + PAGE - 1);
      }),
    );

    let sawShortPage = false;
    for (const r of results) {
      if (r.error) throw new Error(`paged read failed: ${r.error.message}`);
      const data = r.data ?? [];
      // Pages are requested in order and PostgREST fills them in order, so the
      // first short page in a batch is the end of the data; later pages in the
      // same batch are empty and appending them adds nothing (and keeps order).
      rows.push(...data);
      if (data.length < PAGE) sawShortPage = true;
    }

    if (sawShortPage) return { rows, truncated: false };
  }

  return { rows, truncated: true };
}
