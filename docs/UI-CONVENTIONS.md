# UI conventions: long lists, tables, and review queues

Written 2026-08-23 after the customer-master review queue shipped as one
endless scroll. These rules exist so every future list lands right the first
time. Inspiration reviewed: outcrowd.io's case-study layouts -- what transfers
to an internal BI tool is their restraint (few things visible at once, strong
hierarchy, generous whitespace), not their marketing aesthetics.

## The rules

1. **Paginate anything a person works THROUGH.** A review queue, an approval
   list, an alert log: 10 rows per page. Working a queue means handling item
   by item, and an endless column forces scrolling past everything already
   done. Charts and dashboards AGGREGATE and are exempt; ledgers people scan
   may use larger pages (25-50).

2. **Page state lives in the URL** (`?page=N`), never in useState. Every list
   page in this app is a server component whose filters are searchParams;
   pagination that broke that would break the back button, shareable links,
   and refresh. Corollaries:
   - a FILTER change resets to page 1 (a filter defines a new list),
   - selecting an ITEM keeps its page, and a shared link with a selected item
     must jump to the page containing it,
   - out-of-range pages CLAMP to the last page rather than erroring: stale
     bookmarks should degrade, not 404.

3. **The pager is boring on purpose.** First / last / a one-step window around
   the current page / elided middle. Server-rendered `<Link>`s in the house
   tokens (`var(--accent)` for the current page, `font-mono text-[10px]`).
   Always show "SEITE X VON Y - N CASES" so the size of the remaining work is
   visible -- a queue you cannot size is a queue nobody finishes.

4. **Detail panels stick.** A master list with a detail panel keeps the detail
   `lg:sticky lg:top-4` so row N's detail is readable next to row N, not after
   a scroll back up. Pagination makes this work: with 10 rows, the sticky
   panel never drifts out of reach of the row it describes.

5. **Worst first, never alphabetical.** Attention lists (risks, overruns,
   review queues) order by severity, then size, then name. Alphabetical order
   is for phone books.

6. **Counts are honest.** If a list shows a slice, say so ("10 von 257").
   If data is partial (unmatched hours, unmapped orders), a one-line footnote
   states how much is missing. A silent omission reads as "everything is
   fine", which is a lie by layout.

## The house tokens, for any new list UI

- numbers: `font-mono tabular-nums`, hours to 1 decimal, percent as integers
- severity colours: `var(--critical)`, `var(--warning, #d99b3d)`,
  `var(--accent)` for healthy/active, never hardcoded hex
- labels: `font-mono text-[10px] tracking-[0.08em] text-[var(--text-faint)]`
- no emoji or unicode glyphs in app-shell files (check-design-system enforces
  this); use inline SVG
- focus rings stay (never `focus:outline-none` without a replacement)

## Reference implementation

`src/app/(app)/customer-master/import-review/page.tsx` -- the Pager component
and its hrefFor integration are the pattern to copy.
